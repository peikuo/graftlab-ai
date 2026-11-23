// Fastify app: routes of design.md "HTTP API" that milestone 3 needs. Every command endpoint checks the
// same-origin request and the operator lease server-side (HTTP 403), regardless of what the UI shows (R28.6).
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { RoleIdSchema, type SecretRegistry } from "@graftlab/shared";
import type { EventStore } from "../events/store.ts";
import { Lease } from "../queue/lease.ts";
import { SseHub } from "../sse/hub.ts";
import { ensureSession, readSession, sameOrigin, tokenEquals } from "./session.ts";

/** The Task operations the HTTP layer needs (implemented by TaskService). */
export interface TaskApi {
  create(url: string): Promise<{ ok: true; taskId: string } | { ok: false; status: number; error: string }>;
  /** null when the Task is not the runner's Task; false when the card is not open. */
  answer(taskId: string, cardId: string, a: { optionId?: string; text?: string }): boolean | null;
  abort(taskId: string): boolean;
  endGathering(taskId: string): boolean;
  fileText(taskId: string, path: string): Promise<string | null>;
  decision(taskId: string, action: "review" | "select" | "send-back" | "freeze" | "end", body: { draftId?: string; itemId?: string; itemHash?: string; verdict?: "accept" | "reject"; reason?: string; optionId?: string }, sessionId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }>;
}

export interface StudioOptions {
  secrets: SecretRegistry;
  tasks?: TaskApi;
  /** Whether live execution is possible (a container engine answered), for the home page (R25.8). */
  liveExecution?: () => Promise<{ available: boolean; reason?: string }>;
  /** The active LLM profile and model, shown on the status endpoint (never the key, R30.18). */
  llm?: { profile: string; model: string; keySet: boolean };
  allowedOrigins?: string[];
  secureCookie?: boolean;
  adminToken?: string;
  heartbeatMs?: number;
  lease?: Lease;
  logger?: boolean;
}

export interface Studio {
  app: FastifyInstance;
  lease: Lease;
  hub: SseHub;
  /** The Task currently shown (one Task at a time, R28). */
  current: EventStore | null;
  setCurrent(store: EventStore | null): void;
}

const MessageBody = z.object({ to: z.union([z.literal("all"), RoleIdSchema]), text: z.string().trim().min(1).max(4000) });
const AnswerBody = z.object({ optionId: z.string().min(1).optional(), text: z.string().max(4000).optional() });
const AdminQueueBody = z.object({ open: z.boolean() });

export function createStudio(opts: StudioOptions): Studio {
  const { secrets } = opts;
  const lease = opts.lease ?? new Lease();

  // First guard: no headers, bodies or environment in logs (Fastify's default serializers log method, url and
  // status only). Second guard: every finished log line passes the redactor before it is written; a hit is a
  // defect and is reported like a leaked delta.
  let reportLeak: (names: string[], where: string) => void = () => {};
  const logStream = {
    write(line: string) {
      const { value, hits } = secrets.redactText(line);
      if (hits.length > 0) reportLeak(hits, "a server log line");
      process.stdout.write(value);
    },
  };
  const app = Fastify({ logger: opts.logger ? { stream: logStream } : false });

  const studio: Studio = {
    app,
    lease,
    hub: new SseHub({
      secrets,
      ...(opts.heartbeatMs === undefined ? {} : { heartbeatMs: opts.heartbeatMs }),
      queueView: (sid) => lease.view(sid),
      onLeak: (names, where) => reportLeak(names, where),
    }),
    current: null,
    setCurrent(store) {
      studio.current = store;
      studio.hub.attach(store);
    },
  };
  lease.onChange(() => studio.hub.queueChanged());
  reportLeak = (names, where) => {
    const store = studio.current;
    if (!store) return;
    void store.append({
      type: "failure",
      node: store.events().at(-1)?.node ?? "reading",
      actor: { kind: "system" },
      payload: { failureClass: "rejected_by_safety_rule", source: "persistence", detail: `secret found in ${where} and redacted: ${names.join(", ")}` },
    });
  };

  // Command guard: same origin and operator lease (R28.6).
  const command = async (req: FastifyRequest) => {
    if (!sameOrigin(req, opts.allowedOrigins ?? [])) return { status: 403, error: "cross-origin request refused" };
    if (!lease.isOperator(readSession(req))) return { status: 403, error: "only the current operator can do this" };
    return null;
  };

  app.post("/api/session", async (req, reply) => {
    const sid = ensureSession(req, reply, !!opts.secureCookie);
    return { ok: true, queue: lease.view(sid) };
  });

  for (const action of ["join", "heartbeat", "leave"] as const) {
    app.post(`/api/queue/${action}`, async (req, reply) => {
      if (!sameOrigin(req, opts.allowedOrigins ?? [])) return reply.code(403).send({ error: "cross-origin request refused" });
      const sid = ensureSession(req, reply, !!opts.secureCookie);
      if (action === "join") return lease.join(sid);
      if (action === "heartbeat") return lease.heartbeat(sid);
      lease.leave(sid);
      return lease.view(sid);
    });
  }

  app.get("/api/tasks/current/stream", (req, reply) => {
    const sid = readSession(req);
    const last = Number(req.headers["last-event-id"]);
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    const disconnect = studio.hub.connect({ sessionId: sid, write: (c) => reply.raw.write(c) }, Number.isFinite(last) ? last : 0);
    req.raw.on("close", disconnect);
  });

  app.get<{ Params: { id: string } }>("/api/tasks/:id/events", async (req, reply) => {
    const store = studio.current;
    if (!store || store.taskId !== req.params.id) return reply.code(404).send({ error: "no such Task" });
    return { events: store.events() };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/messages", async (req, reply) => {
    const denied = await command(req);
    if (denied) return reply.code(denied.status).send({ error: denied.error });
    const store = studio.current;
    if (!store || store.taskId !== req.params.id) return reply.code(404).send({ error: "no such Task" });
    const body = MessageBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid message" });
    const clientMsgId = randomUUID();
    // Milestone 3 has no task runner yet: the message is recorded as queued; delivery is added with the runner.
    void store.append({
      type: "judge_message",
      node: store.events().at(-1)?.node ?? "reading",
      actor: { kind: "judge" },
      payload: { clientMsgId, to: body.data.to, text: body.data.text, status: "queued", deliveredTo: [] },
    });
    return { accepted: true, clientMsgId };
  });

  app.post<{ Params: { id: string; cardId: string } }>("/api/tasks/:id/cards/:cardId/answer", async (req, reply) => {
    const denied = await command(req);
    if (denied) return reply.code(denied.status).send({ error: denied.error });
    const store = studio.current;
    if (!store || store.taskId !== req.params.id) return reply.code(404).send({ error: "no such Task" });
    const body = AnswerBody.safeParse(req.body ?? {});
    if (!body.success || (!body.data.optionId && !body.data.text)) return reply.code(400).send({ error: "an option or a text is required" });
    const viaRunner = opts.tasks?.answer(req.params.id, req.params.cardId, body.data);
    if (viaRunner === true) return { accepted: true };
    if (viaRunner === false) return reply.code(409).send({ error: "the card is not open" });
    const events = store.events();
    const opened = events.find((e) => e.type === "card_opened" && e.payload.cardId === req.params.cardId);
    const answered = events.some((e) => e.type === "card_answered" && e.payload.cardId === req.params.cardId);
    if (!opened || answered) return reply.code(409).send({ error: "the card is not open" });
    const payload: { cardId: string; optionId?: string; text?: string } = { cardId: req.params.cardId };
    if (body.data.optionId) payload.optionId = body.data.optionId;
    if (body.data.text) payload.text = body.data.text;
    await store.append({ type: "card_answered", node: events.at(-1)!.node, actor: { kind: "judge" }, payload });
    return { accepted: true };
  });

  app.post("/api/tasks", async (req, reply) => {
    const denied = await command(req);
    if (denied) return reply.code(denied.status).send({ error: denied.error });
    if (!opts.tasks) return reply.code(503).send({ error: "Task creation is not available on this server" });
    const body = z.object({ url: z.string().max(400) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "a repository address is required" });
    const r = await opts.tasks.create(body.data.url);
    if (!r.ok) return reply.code(r.status).send({ error: r.error });
    return { taskId: r.taskId };
  });

  // Decision step (R5.7, R15.3, R15.11): operator only; the desk checks every rule again.
  const DecisionBody = z.object({
    draftId: z.string().max(40).optional(),
    itemId: z.string().max(40).optional(),
    itemHash: z.string().max(80).optional(),
    verdict: z.enum(["accept", "reject"]).optional(),
    reason: z.string().max(1000).optional(),
    optionId: z.string().max(40).optional(),
  });
  for (const action of ["review", "select", "send-back", "freeze", "end"] as const) {
    app.post<{ Params: { id: string } }>(`/api/tasks/:id/decision/${action}`, async (req, reply) => {
      const denied = await command(req);
      if (denied) return reply.code(denied.status).send({ error: denied.error });
      if (!opts.tasks) return reply.code(503).send({ error: "not available on this server" });
      const body = DecisionBody.safeParse(req.body ?? {});
      if (!body.success) return reply.code(400).send({ error: "invalid request" });
      const clean = Object.fromEntries(Object.entries(body.data).filter(([, v]) => v !== undefined));
      const r = await opts.tasks.decision(req.params.id, action, clean, readSession(req) ?? "unknown");
      if (!r.ok) return reply.code(r.status).send({ error: r.error });
      return { accepted: true };
    });
  }
  app.post<{ Params: { id: string } }>("/api/tasks/:id/abort", async (req, reply) => {
    const denied = await command(req);
    if (denied) return reply.code(denied.status).send({ error: denied.error });
    if (!opts.tasks?.abort(req.params.id)) return reply.code(409).send({ error: "no running Task with this id" });
    return { accepted: true };
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/gathering/end", async (req, reply) => {
    const denied = await command(req);
    if (denied) return reply.code(denied.status).send({ error: denied.error });
    if (!opts.tasks?.endGathering(req.params.id)) return reply.code(409).send({ error: "the team is not trying the app right now" });
    return { accepted: true };
  });

  // Read-only: the text of a downloaded file of the current Task (R4.4). Viewers may see it too (public repositories).
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>("/api/tasks/:id/files", async (req, reply) => {
    const path = req.query.path ?? "";
    if (!path || path.includes("..") || path.startsWith("/")) return reply.code(400).send({ error: "invalid path" });
    const text = await opts.tasks?.fileText(req.params.id, path);
    if (text == null) return reply.code(404).send({ error: "file not available" });
    return { path, text: text.length > 60_000 ? text.slice(0, 60_000) : text, truncated: text.length > 60_000 };
  });

  app.get("/api/status", async () => {
    const live = (await opts.liveExecution?.()) ?? { available: false, reason: "not checked" };
    return { liveExecution: live.available, ...(live.reason ? { reason: live.reason } : {}), creating: !!opts.tasks, ...(opts.llm ? { llm: opts.llm } : {}) };
  });

  app.post("/api/admin/queue", async (req, reply) => {
    if (!tokenEquals(req.headers["x-admin-token"] as string | undefined, opts.adminToken)) return reply.code(403).send({ error: "admin token required" });
    const body = AdminQueueBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid body" });
    lease.setOpen(body.data.open);
    return { open: lease.open };
  });

  app.addHook("onClose", async () => studio.hub.close());
  return studio;
}
