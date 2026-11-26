// Queue integration tests (tasks.md 3.9; R28.2, R28.3, R28.5, R28.6).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry } from "@graftlab/shared";
import { EventStore } from "../events/store.ts";
import { SandboxService } from "../containers/sandboxService.ts";
import type { SandboxResult } from "../containers/sandbox.ts";
import { AccessCodes } from "../queue/access.ts";
import { createStudio, type Studio } from "./app.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((c) => c()));
});

const ORIGIN = "http://localhost:8080";

async function setup(): Promise<{ studio: Studio; store: EventStore }> {
  const dataDir = await mkdtemp(join(tmpdir(), "gl-app-"));
  const secrets = new SecretRegistry();
  const studio = createStudio({ secrets, heartbeatMs: 60_000 });
  const store = await EventStore.open({ dataDir, taskId: "t1", secrets });
  studio.setCurrent(store);
  await store.append({ type: "card_opened", node: "meeting", actor: { kind: "role", roleId: "facilitator" }, payload: { cardId: "q1", kind: "question", title: "Confirm?", body: "", options: [{ id: "yes", label: "Yes" }], allowFreeText: true } });
  cleanups.push(async () => {
    await studio.app.close();
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return { studio, store };
}

async function join_(studio: Studio): Promise<string> {
  const r = await studio.app.inject({ method: "POST", url: "/api/queue/join", headers: { origin: ORIGIN, host: "localhost:8080" } });
  const cookie = String(r.headers["set-cookie"]).split(";")[0]!;
  return cookie;
}

const post = (studio: Studio, url: string, cookie: string | undefined, body: unknown, origin: string | null = ORIGIN) =>
  studio.app.inject({
    method: "POST",
    url,
    headers: { host: "localhost:8080", ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}), "content-type": "application/json" },
    payload: JSON.stringify(body),
  });

describe("queue and commands", () => {
  it("a queued session is rejected server-side on every command endpoint; the operator is accepted", async () => {
    const { studio } = await setup();
    const operator = await join_(studio);
    const queued = await join_(studio);
    const commands: [string, unknown][] = [
      ["/api/tasks/t1/messages", { to: "all", text: "hello" }],
      ["/api/tasks/t1/cards/q1/answer", { optionId: "yes" }],
    ];
    for (const [url, body] of commands) {
      expect((await post(studio, url, queued, body)).statusCode).toBe(403);
      expect((await post(studio, url, undefined, body)).statusCode).toBe(403);
    }
    expect((await post(studio, "/api/tasks/t1/messages", operator, { to: "all", text: "hello" })).json()).toMatchObject({ accepted: true });
    expect((await post(studio, "/api/tasks/t1/cards/q1/answer", operator, { optionId: "yes" })).statusCode).toBe(200);
    expect((await post(studio, "/api/tasks/t1/cards/q1/answer", operator, { optionId: "yes" })).statusCode).toBe(409);
  });

  it("refuses a cross-origin command even from the operator", async () => {
    const { studio } = await setup();
    const operator = await join_(studio);
    expect((await post(studio, "/api/tasks/t1/messages", operator, { to: "all", text: "x" }, "https://evil.example")).statusCode).toBe(403);
    expect((await post(studio, "/api/tasks/t1/messages", operator, { to: "all", text: "x" }, null)).statusCode).toBe(403);
  });

  it("promotes the queued session when the Task ends", async () => {
    const { studio } = await setup();
    await join_(studio);
    const next = await join_(studio);
    studio.lease.taskStarted();
    studio.lease.taskEnded();
    expect((await post(studio, "/api/tasks/t1/messages", next, { to: "all", text: "now me" })).statusCode).toBe(200);
  });

  it("a Viewer receives the stream read-only, resumes with Last-Event-ID, and sees its queue position", async () => {
    const { studio, store } = await setup();
    await join_(studio);
    const viewer = await join_(studio);
    await studio.app.listen({ port: 0, host: "127.0.0.1" });
    const address = studio.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/tasks/current/stream`, { headers: { cookie: viewer, "last-event-id": "0" }, signal: ctrl.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) text += decoder.decode((await reader.read()).value);
    };
    await readUntil('"role":"queued"');
    expect(text).toContain("id: 1\nevent: event\n");
    await store.append({ type: "file_read", node: "meeting", actor: { kind: "role", roleId: "reader" }, payload: { path: "a.py", bytes: 1 } });
    await readUntil("id: 2\n");
    ctrl.abort();
  });
});

describe("sandbox restore (R29.2)", () => {
  const okResult: SandboxResult = { ok: true, state: { name: "s", volume: "v", hostPort: 1, generation: 1, secretEnv: {}, credentials: {} }, equality: [{ item: "a", pass: true, expected: "x", actual: "as expected" }], ms: { start: 0, readiness: 0, provision: 0, seed: 0, equality: 0 } };
  it("accepts the operator and the admin, refuses a queued session and a missing token", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gl-app-"));
    const sandbox = new SandboxService();
    let resets = 0;
    await sandbox.start({ start: async () => okResult, reset: async () => (resets++, okResult), stop: async () => {} });
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000, sandbox, adminToken: "admin-token-123456" });
    cleanups.push(async () => {
      await studio.app.close();
      await rm(dataDir, { recursive: true, force: true });
    });
    const operator = await join_(studio);
    const queued = await join_(studio);
    expect((await post(studio, "/api/sandbox/restore", queued, {})).statusCode).toBe(403);
    expect((await post(studio, "/api/sandbox/restore", undefined, {})).statusCode).toBe(403);
    const r = await post(studio, "/api/sandbox/restore", operator, {});
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true });
    const admin = await studio.app.inject({ method: "POST", url: "/api/sandbox/restore", headers: { host: "localhost:8080", "x-admin-token": "admin-token-123456" } });
    expect(admin.statusCode).toBe(200);
    expect(resets).toBe(2);
  });
});

describe("access codes (R28.7)", () => {
  const tasks = (calls: string[]) => ({
    create: async (url: string) => (calls.push(url), url.includes("bad") ? { ok: false as const, status: 400, error: "no such repository" } : { ok: true as const, taskId: "t9" }),
  });
  it("lets anyone watch, needs a code to join, and caps Tasks per code", async () => {
    const calls: string[] = [];
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000, access: new AccessCodes({ codes: ["judge-code-1"], dailyTasks: 1 }), tasks: tasks(calls) as never });
    cleanups.push(() => studio.app.close());
    const s = await studio.app.inject({ method: "POST", url: "/api/session", headers: { origin: ORIGIN, host: "localhost:8080" } });
    const cookie = String(s.headers["set-cookie"]).split(";")[0]!;
    const status = await studio.app.inject({ method: "GET", url: "/api/status", headers: { cookie } });
    expect(status.json().access).toEqual({ required: true, unlocked: false });
    expect((await post(studio, "/api/queue/join", cookie, {})).statusCode).toBe(403);
    expect((await post(studio, "/api/access", cookie, { code: "judge-code-1" }, "https://evil.example")).statusCode).toBe(403);
    const wrong = await post(studio, "/api/access", cookie, { code: "not-the-code" });
    expect(wrong.statusCode).toBe(401);
    expect(JSON.stringify(wrong.json())).not.toContain("judge-code-1");
    expect((await post(studio, "/api/access", cookie, { code: "judge-code-1" })).statusCode).toBe(200);
    expect((await studio.app.inject({ method: "GET", url: "/api/status", headers: { cookie } })).json().access).toEqual({ required: true, unlocked: true });
    expect((await post(studio, "/api/queue/join", cookie, {})).json().role).toBe("operator");
    // A failed creation does not use up the day's Task.
    expect((await post(studio, "/api/tasks", cookie, { url: "https://github.com/a/bad" })).statusCode).toBe(400);
    expect((await post(studio, "/api/tasks", cookie, { url: "https://github.com/a/b" })).statusCode).toBe(200);
    const capped = await post(studio, "/api/tasks", cookie, { url: "https://github.com/a/c" });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error).toMatch(/daily limit/);
    expect(calls).toEqual(["https://github.com/a/bad", "https://github.com/a/b"]);
  });
  it("answers 429 with retry-after after 5 wrong codes from one address", async () => {
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000, access: new AccessCodes({ codes: ["judge-code-1"] }) });
    cleanups.push(() => studio.app.close());
    const send = (code: string) =>
      studio.app.inject({ method: "POST", url: "/api/access", payload: { code }, headers: { origin: ORIGIN, host: "localhost:8080", "content-type": "application/json", "x-forwarded-for": "203.0.113.7" } });
    for (let i = 0; i < 5; i++) expect((await send("nope-nope")).statusCode).toBe(401);
    const blocked = await send("judge-code-1");
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(800);
  });
  it("is off when no code is configured", async () => {
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000 });
    cleanups.push(() => studio.app.close());
    const r = await studio.app.inject({ method: "POST", url: "/api/queue/join", headers: { origin: ORIGIN, host: "localhost:8080" } });
    expect(r.json().role).toBe("operator");
  });
});

describe("session cookie (R28)", () => {
  it("is Secure when the public front end relays the request, and not for local http", async () => {
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000 });
    cleanups.push(() => studio.app.close());
    const local = await studio.app.inject({ method: "POST", url: "/api/session", headers: { origin: ORIGIN, host: "localhost:8080" } });
    expect(String(local.headers["set-cookie"])).not.toContain("Secure");
    const pub = await studio.app.inject({ method: "POST", url: "/api/session", headers: { origin: ORIGIN, host: "localhost:8080", "x-gl-public": "https" } });
    expect(String(pub.headers["set-cookie"])).toContain("; Secure");
  });
});
