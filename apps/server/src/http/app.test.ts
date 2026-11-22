// Queue integration tests (tasks.md 3.9; R28.2, R28.3, R28.5, R28.6).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry } from "@graftlab/shared";
import { EventStore } from "../events/store.ts";
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
