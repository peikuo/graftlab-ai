import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ROLE_IDS, type StudioEvent } from "./events.ts";
import { actorKey, foldEvents, type ActorKey } from "./reducer.ts";
import { DEFAULT_RECENCY_WINDOW_MS, roleStatus } from "./roleStatus.ts";
import { activityStreamArb, eventStreamArb } from "./testing/arbitraries.ts";

const W = DEFAULT_RECENCY_WINDOW_MS;
const actors: ActorKey[] = [...ROLE_IDS, "code_agent", "verifier", "system", "judge"];

function openMessageFor(events: StudioEvent[], actor: ActorKey): boolean {
  const open = new Set<string>();
  for (const e of events) {
    if (e.type === "message_started" && actorKey(e.actor) === actor) open.add(e.payload.messageId);
    if ((e.type === "message_completed" || e.type === "message_incomplete") && open.has(e.payload.messageId)) open.delete(e.payload.messageId);
  }
  return open.size > 0;
}

describe("roleStatus", () => {
  // Feature: graftlab-ai, Property 6: Role_Status never shows work without a recent event
  it("a working status always has an event of that role inside the Recency_Window; speaking and thinking need an open message", () => {
    fc.assert(
      fc.property(fc.oneof(eventStreamArb(40), activityStreamArb), fc.constantFrom(...actors), fc.integer({ min: -5_000, max: 60_000 }), (events, actor, offset) => {
        fc.pre(events.length > 0);
        const state = foldEvents(events);
        // `now` near the events: offset from a random event timestamp.
        const anchor = Date.parse(events[Math.abs(offset) % events.length]!.ts);
        const now = anchor + offset;
        const st = roleStatus(state, actor, now);
        if (!st.working) return;
        const recentOwn = events.some((e) => actorKey(e.actor) === actor && now - Date.parse(e.ts) <= W && Date.parse(e.ts) <= now);
        expect(recentOwn).toBe(true);
        if (st.kind === "speaking" || st.kind === "thinking") expect(openMessageFor(events, actor)).toBe(true);
        expect(["reading", "using_browser", "speaking", "thinking"]).toContain(st.kind);
      }),
      { numRuns: 500 },
    );
  });
});

describe("roleStatus examples", () => {
  const t = (s: number) => new Date(Date.UTC(2026, 10, 22, 10, 0, s)).toISOString();
  const arch = { kind: "role" as const, roleId: "reader" as const };
  const ev = (seq: number, s: number, rest: Pick<StudioEvent, "type" | "payload">, actor: StudioEvent["actor"] = arch) =>
    ({ v: 1, seq, ts: t(s), taskId: "t1", node: "meeting", actor, ...rest }) as StudioEvent;
  const now = (s: number) => Date.parse(t(s));

  const started = ev(1, 0, { type: "message_started", payload: { messageId: "m1", roleId: "reader", purpose: "statement" } });
  const speaking = ev(2, 2, { type: "message_progress", payload: { messageId: "m1", phase: "speaking", textChars: 10, reasoningChars: 0 } });

  it("waiting for LLM with elapsed seconds before the first progress", () => {
    expect(roleStatus(foldEvents([started]), "reader", now(7))).toMatchObject({ kind: "waiting_for_llm", text: "waiting for LLM, 7 s", working: false });
  });

  it("speaking while progress is recent, then waiting with no output for N s", () => {
    const s = foldEvents([started, speaking]);
    expect(roleStatus(s, "reader", now(10))).toMatchObject({ kind: "speaking", working: true });
    expect(roleStatus(s, "reader", now(30))).toMatchObject({ kind: "waiting_for_llm", text: "waiting for LLM, no output for 28 s" });
  });

  it("blocked with the reason after a failure, idle after a later event", () => {
    const fail = ev(3, 3, { type: "failure", payload: { failureClass: "interface_call_failure", source: "llm", detail: "stream closed" } });
    expect(roleStatus(foldEvents([started, speaking, fail]), "reader", now(4))).toMatchObject({ kind: "blocked", text: "blocked: stream closed" });
    const done = ev(4, 5, { type: "message_incomplete", payload: { messageId: "m1", partialText: "x", reason: "stream closed" } });
    expect(roleStatus(foldEvents([started, speaking, fail, done]), "reader", now(6)).kind).toBe("idle");
  });

  it("waiting for answer names the asked party", () => {
    const q = ev(1, 0, { type: "question_opened", payload: { questionId: "q1", from: "code_agent", askedParty: "judge", kind: "feature", text: "Only existing tags?" } }, { kind: "code_agent" });
    expect(roleStatus(foldEvents([q]), "code_agent", now(42))).toMatchObject({ kind: "waiting_for_answer", text: "waiting for answer from you, 42 s" });
  });

  it("the generators produce every working status, so the property is not vacuous", () => {
    const seen = new Set<string>();
    for (const evs of fc.sample(activityStreamArb, 300)) {
      const s = foldEvents(evs);
      for (const e of evs) for (const a of ROLE_IDS) seen.add(roleStatus(s, a, Date.parse(e.ts) + 500).kind);
    }
    expect([...seen]).toEqual(expect.arrayContaining(["speaking", "thinking", "reading", "waiting_for_llm", "blocked", "waiting_for_tool", "idle"]));
  });

  it("reading stops as soon as the role does something else", () => {
    const read = ev(1, 0, { type: "file_read", payload: { path: "a.py", bytes: 1 } });
    expect(roleStatus(foldEvents([read]), "reader", now(2)).kind).toBe("reading");
    const said = ev(2, 1, { type: "message_started", payload: { messageId: "m9", roleId: "reader", purpose: "statement" } });
    const done = ev(3, 2, { type: "message_completed", payload: { messageId: "m9", text: "x", finishReason: "stop" } });
    expect(roleStatus(foldEvents([read, said, done]), "reader", now(3)).kind).toBe("idle");
  });

  it("progress from another actor does not make a role look active", () => {
    const foreign = ev(2, 2, { type: "message_progress", payload: { messageId: "m1", phase: "speaking", textChars: 1, reasoningChars: 0 } }, { kind: "system" });
    expect(roleStatus(foldEvents([started, foreign]), "reader", now(3)).kind).toBe("waiting_for_llm");
  });
});
