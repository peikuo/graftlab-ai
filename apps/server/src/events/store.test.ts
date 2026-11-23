import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry, parseEvents, type StudioEvent } from "@graftlab/shared";
import { AppendError, EventStore, type EventDraft } from "./store.ts";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "gl-store-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const clock = () => {
  let t = Date.UTC(2026, 10, 22, 10, 0, 0);
  return () => new Date((t += 1000));
};

const fileRead = (path: string): EventDraft => ({ type: "file_read", node: "reading", actor: { kind: "role", roleId: "reader" }, payload: { path, bytes: 10 } });

// Free-text drafts where a leaked secret could realistically appear.
const textDraft = (text: string): fc.Arbitrary<EventDraft> =>
  fc.constantFrom<EventDraft>(
    { type: "message_completed", node: "meeting", actor: { kind: "role", roleId: "user_value" }, payload: { messageId: "m1", text, reasoning: text, finishReason: "stop" } },
    { type: "tool_finished", node: "story_develop", actor: { kind: "code_agent" }, payload: { callId: "c1", tool: "bash", ok: false, outputSummary: text } },
    { type: "failure", node: "reading", actor: { kind: "system" }, payload: { failureClass: "interface_call_failure", source: "github", detail: text || "x" } },
    { type: "browser_observation", node: "browser_experience", actor: { kind: "role", roleId: "user_value" }, payload: { snapshotSummary: text } },
    { type: "card_opened", node: "meeting", actor: { kind: "role", roleId: "facilitator" }, payload: { cardId: "k1", kind: "question", title: "Q", body: text, options: [], allowFreeText: true } },
  );

describe("EventStore", () => {
  // Feature: graftlab-ai, Property 7: Event serialization round trip (event-store part: seq from 1 without gaps, timestamps)
  it("assigns seq from 1 without gaps under concurrent appends, and the file parses back to the same events", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.stringMatching(/^[a-z]{1,8}\.py$/), { minLength: 1, maxLength: 30 }), async (paths) => {
        const store = await EventStore.open({ dataDir: await tmp(), taskId: "t1", secrets: new SecretRegistry(), now: clock() });
        await Promise.all(paths.map((p) => store.append(fileRead(p))));
        expect(store.events().map((e) => e.seq)).toEqual(paths.map((_, i) => i + 1));
        expect(store.events().every((e) => !Number.isNaN(Date.parse(e.ts)))).toBe(true);
        const parsed = parseEvents(await readFile(join(store.dir, "events.jsonl"), "utf8"));
        expect(parsed.ok && parsed.events).toEqual(store.events());
        await store.close();
      }),
      { numRuns: 100 },
    );
  });

  // Feature: graftlab-ai, Property 12: Secret redaction (persisted JSONL line and the broadcast event; the SSE frame and Replay parts are added with the SSE hub and the Replay exporter)
  it("no registered secret reaches the file or the listeners, and every hit is followed by exactly one failure that names it", async () => {
    const secretArb = fc.uniqueArray(fc.stringMatching(/^zq[a-z0-9]{10,20}$/), { minLength: 1, maxLength: 3 });
    const caseArb = secretArb.chain((secrets) =>
      fc.tuple(
        fc.constant(secrets),
        fc.array(
          fc.tuple(fc.string({ maxLength: 20 }), fc.option(fc.constantFrom(...secrets), { nil: undefined }), fc.string({ maxLength: 20 })).chain(([a, s, b]) =>
            textDraft(`${a}${s ?? ""}${b}`).map((d) => ({ d, leaked: s })),
          ),
          { minLength: 1, maxLength: 10 },
        ),
      ),
    );
    await fc.assert(
      fc.asyncProperty(caseArb, async ([secrets, drafts]) => {
        const registry = new SecretRegistry();
        secrets.forEach((s, i) => registry.register(`secret_${i}`, s));
        const store = await EventStore.open({ dataDir: await tmp(), taskId: "t1", secrets: registry, now: clock() });
        const broadcast: StudioEvent[] = [];
        store.subscribe((m) => m.kind === "event" && broadcast.push(m.event));
        for (const { d } of drafts) await store.append(d);

        const file = await readFile(join(store.dir, "events.jsonl"), "utf8");
        const sent = JSON.stringify(broadcast);
        for (const s of secrets) {
          expect(file.includes(s)).toBe(false);
          expect(sent.includes(s)).toBe(false);
        }
        const events = store.events();
        const hitSeqs = events.filter((e) => JSON.stringify(e.payload).includes("[REDACTED:")).filter((e) => !(e.type === "failure" && e.payload.failureClass === "rejected_by_safety_rule" && e.actor.kind === "system" && e.payload.source === "persistence"));
        for (const e of hitSeqs) {
          const next = events.find((x) => x.seq === e.seq + 1);
          expect(next?.type).toBe("failure");
          if (next?.type === "failure") {
            expect(next.payload.failureClass).toBe("rejected_by_safety_rule");
            expect(next.payload.detail).toMatch(/secret_\d/);
          }
        }
        expect(hitSeqs.length).toBe(drafts.filter((x) => x.leaked !== undefined).length);
        await store.close();
      }),
      { numRuns: 100 },
    );
  }, 30_000); // 100 runs with file writes; slow when the whole suite runs in parallel

  it("continues seq after reopening", async () => {
    const dataDir = await tmp();
    const a = await EventStore.open({ dataDir, taskId: "t1", secrets: new SecretRegistry(), now: clock() });
    await a.append(fileRead("a.py"));
    await a.append(fileRead("b.py"));
    await a.close();
    const b = await EventStore.open({ dataDir, taskId: "t1", secrets: new SecretRegistry(), now: clock() });
    const [e] = await b.append(fileRead("c.py"));
    expect(e!.seq).toBe(3);
    expect(b.eventsAfter(1).map((x) => x.seq)).toEqual([2, 3]);
    await b.close();
  });

  it("an append failure sends an error frame, marks the Task incomplete and refuses further appends", async () => {
    const store = await EventStore.open({ dataDir: await tmp(), taskId: "t1", secrets: new SecretRegistry(), now: clock() });
    const frames: string[] = [];
    store.subscribe((m) => frames.push(m.kind));
    await store.append(fileRead("a.py"));
    await store.close(); // closing the handle makes the next append fail like a disk error
    await expect(store.append(fileRead("b.py"))).rejects.toBeInstanceOf(AppendError);
    expect(frames).toEqual(["event", "error"]);
    expect(JSON.parse(await readFile(join(store.dir, "meta.json"), "utf8"))).toMatchObject({ incomplete: true });
    await expect(store.append(fileRead("c.py"))).rejects.toThrow(/broken/);
    expect(store.events()).toHaveLength(1);
  });

  it("rejects an invalid event without writing anything", async () => {
    const store = await EventStore.open({ dataDir: await tmp(), taskId: "t1", secrets: new SecretRegistry(), now: clock() });
    await expect(store.append({ type: "file_read", node: "reading", actor: { kind: "system" }, payload: { path: "", bytes: -1 } })).rejects.toThrow(/invalid event/);
    expect(store.lastSeq).toBe(0);
    await store.close();
  });
});
