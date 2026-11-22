import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry } from "@graftlab/shared";
import { EventStore } from "../events/store.ts";
import { SseHub } from "./hub.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

async function setup(secrets = new SecretRegistry()) {
  const dataDir = await mkdtemp(join(tmpdir(), "gl-hub-"));
  dirs.push(dataDir);
  const store = await EventStore.open({ dataDir, taskId: "t1", secrets });
  const leaks: string[][] = [];
  const hub = new SseHub({ secrets, heartbeatMs: 60_000, onLeak: (n) => leaks.push(n) });
  hub.attach(store);
  return { store, hub, leaks };
}

const started = { type: "message_started", node: "meeting", actor: { kind: "role", roleId: "product" }, payload: { messageId: "m1", roleId: "product", purpose: "statement" } } as const;

describe("SseHub", () => {
  it("resumes after Last-Event-ID and forwards new events with id = seq", async () => {
    const { store, hub } = await setup();
    await store.append(started);
    await store.append({ ...started, payload: { ...started.payload, messageId: "m2" } });
    const out: string[] = [];
    hub.connect({ sessionId: undefined, write: (c) => out.push(c) }, 1);
    expect(out.join("")).toContain("id: 2\nevent: event\n");
    expect(out.join("")).not.toContain("id: 1\n");
    await store.append({ ...started, payload: { ...started.payload, messageId: "m3" } });
    expect(out.at(-1)).toMatch(/^id: 3\nevent: event\n/);
    hub.close();
    await store.close();
  });

  it("sends in-progress buffers on connect and drops them when the message completes", async () => {
    const { store, hub } = await setup();
    await store.append(started);
    hub.delta("m1", "reasoning", "thinking about ");
    hub.delta("m1", "text", "Suggest tags");
    const late: string[] = [];
    hub.connect({ sessionId: undefined, write: (c) => late.push(c) });
    const buffer = late.find((c) => c.startsWith("event: buffer"))!;
    expect(JSON.parse(buffer.split("data: ")[1]!)).toEqual([{ messageId: "m1", text: "Suggest tags", reasoning: "thinking about ", toolcall: "" }]);
    await store.append({ type: "message_completed", node: "meeting", actor: started.actor, payload: { messageId: "m1", text: "Suggest tags", finishReason: "stop" } });
    const after: string[] = [];
    hub.connect({ sessionId: undefined, write: (c) => after.push(c) });
    expect(after.some((c) => c.startsWith("event: buffer"))).toBe(false);
    hub.close();
    await store.close();
  });

  // Feature: graftlab-ai, Property 12: Secret redaction (SSE frame part: delta frames and buffers)
  it("no registered secret leaves in a delta or buffer frame, and every leaking delta is reported by name", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.stringMatching(/^zq[a-z0-9]{10,20}$/), { minLength: 1, maxLength: 3 }),
        fc.array(fc.tuple(fc.string({ maxLength: 15 }), fc.boolean(), fc.string({ maxLength: 15 })), { minLength: 1, maxLength: 8 }),
        async (secrets, chunks) => {
          const registry = new SecretRegistry();
          secrets.forEach((s, i) => registry.register(`secret_${i}`, s));
          const { store, hub, leaks } = await setup(registry);
          const out: string[] = [];
          hub.connect({ sessionId: undefined, write: (c) => out.push(c) });
          let expectedLeaks = 0;
          chunks.forEach(([a, leak, b], i) => {
            if (leak) expectedLeaks++;
            hub.delta("m1", "text", `${a}${leak ? secrets[i % secrets.length] : ""}${b}`);
          });
          hub.connect({ sessionId: undefined, write: (c) => out.push(c) }); // buffer frame
          const sent = out.join("");
          for (const s of secrets) expect(sent.includes(s)).toBe(false);
          expect(leaks.length).toBe(expectedLeaks);
          hub.close();
          await store.close();
        },
      ),
      { numRuns: 100 },
    );
  });
});
