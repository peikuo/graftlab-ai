import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StudioEvent } from "./events.ts";
import { foldEvents, initialUiState, reduce } from "./reducer.ts";
import { eventStreamArb } from "./testing/arbitraries.ts";

const at = (seq: number) => `2026-11-22T10:00:${String(seq).padStart(2, "0")}.000Z`;

const events: StudioEvent[] = [
  {
    v: 1, seq: 1, ts: at(1), taskId: "t1", node: "reading", actor: { kind: "system" }, type: "task_created",
    payload: { url: "https://github.com/sissbruecker/linkding", owner: "sissbruecker", repo: "linkding", repoKind: "adapted", runtimeRulesVersion: "0.1.0" },
  },
  { v: 1, seq: 2, ts: at(2), taskId: "t1", node: "reading", actor: { kind: "role", roleId: "reader" }, type: "file_read", payload: { path: "bookmarks/models.py", bytes: 1200 } },
  { v: 1, seq: 3, ts: at(3), taskId: "t1", node: "reading", actor: { kind: "role", roleId: "reader" }, type: "message_started", payload: { messageId: "m1", roleId: "reader", purpose: "statement" } },
  { v: 1, seq: 4, ts: at(4), taskId: "t1", node: "reading", actor: { kind: "role", roleId: "reader" }, type: "message_progress", payload: { messageId: "m1", phase: "speaking", textChars: 40, reasoningChars: 0 } },
  { v: 1, seq: 5, ts: at(5), taskId: "t1", node: "reading", actor: { kind: "role", roleId: "reader" }, type: "message_incomplete", payload: { messageId: "m1", partialText: "Tags are", reason: "stream closed" } },
  { v: 1, seq: 6, ts: at(6), taskId: "t1", node: "reading", actor: { kind: "system" }, type: "failure", payload: { failureClass: "interface_call_failure", source: "llm", detail: "stream closed" } },
  { v: 1, seq: 7, ts: at(7), taskId: "t1", node: "reading", actor: { kind: "system" }, type: "node_entered", payload: { from: "reading", to: "adapter_branch", edgeId: "reading_done" } },
];

describe("reducer", () => {
  it("folds the basic lifecycle", () => {
    const s = foldEvents(events);
    expect(s.lastSeq).toBe(7);
    expect(s.node).toBe("adapter_branch");
    expect(s.repo?.repo).toBe("linkding");
    expect(s.messages.m1).toMatchObject({ status: "incomplete", text: "Tags are", reason: "stream closed" });
    expect(s.failuresByClass).toEqual({ interface_call_failure: 1 });
    expect(s.feed.find((f) => f.type === "file_read")?.path).toBe("bookmarks/models.py");
  });

  it("ignores events at or below the last applied seq", () => {
    const s = foldEvents(events);
    expect(reduce(s, events[3]!)).toBe(s);
    expect(foldEvents([...events, ...events.slice(2)])).toEqual(s);
  });

  it("folding in chunks with duplicates gives the same state as one batch", () => {
    fc.assert(
      fc.property(eventStreamArb(30), fc.nat({ max: 30 }), (evs, cut) => {
        const once = foldEvents(evs);
        const k = Math.min(cut, evs.length);
        const first = foldEvents(evs.slice(0, k));
        const resent = foldEvents(evs.slice(Math.max(0, k - 3)), first);
        expect(resent).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });

  it("starts empty", () => {
    expect(foldEvents([])).toEqual(initialUiState);
  });
});
