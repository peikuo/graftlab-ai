import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EVENT_TYPES, parseEvents, serializeEvents, validateEvent, type StudioEvent } from "./events.ts";
import { eventBodyArb, eventStreamArb } from "./testing/arbitraries.ts";

describe("event serialization", () => {
  // Feature: graftlab-ai, Property 7: Event serialization round trip
  // (serialization part; the event-store append part is added with the event store in milestone 3)
  it("serializing to JSONL and parsing back gives an equal Event_Stream", () => {
    fc.assert(
      fc.property(eventStreamArb(), (events) => {
        const parsed = parseEvents(serializeEvents(events));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.events).toEqual(events);
      }),
      { numRuns: 200 },
    );
  });

  it("the generator covers every event type", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(eventBodyArb, (b) => {
        seen.add(b.type);
      }),
      { numRuns: 2000 },
    );
    expect([...seen].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it("rejects a rejection review without a reason", () => {
    const e = {
      v: 1,
      seq: 1,
      ts: "2026-11-22T10:00:00.000Z",
      taskId: "t1",
      node: "awaiting_confirmation",
      actor: { kind: "judge" },
      type: "decision_item_reviewed",
      payload: { draftId: "d2", itemId: "4", itemHash: "h", verdict: "reject", reason: "  " },
    };
    expect(validateEvent(e).ok).toBe(false);
  });

  it("rejects an unknown type, a bad seq and a bad timestamp", () => {
    const base: StudioEvent = {
      v: 1,
      seq: 1,
      ts: "2026-11-22T10:00:00.000Z",
      taskId: "t1",
      node: "reading",
      actor: { kind: "system" },
      type: "file_read",
      payload: { path: "a.py", bytes: 3 },
    };
    expect(validateEvent(base).ok).toBe(true);
    expect(validateEvent({ ...base, type: "chunk" }).ok).toBe(false);
    expect(validateEvent({ ...base, seq: 0 }).ok).toBe(false);
    expect(validateEvent({ ...base, ts: "yesterday" }).ok).toBe(false);
  });

  it("reports the line of an invalid JSONL entry", () => {
    const r = parseEvents('\n{"v":1}\n');
    expect(r).toMatchObject({ ok: false, line: 2 });
  });
});
