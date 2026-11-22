import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALWAYS_NARRATED, foldEvents } from "./reducer.ts";
import { activityStreamArb, eventStreamArb } from "./testing/arbitraries.ts";

describe("Activity_Feed", () => {
  // Feature: graftlab-ai, Property 5: Every Activity_Feed entry maps to an event
  it("every entry references an existing event, narrated types give exactly one entry, and file entries carry the path", () => {
    fc.assert(
      fc.property(fc.oneof(eventStreamArb(40), activityStreamArb), (events) => {
        const state = foldEvents(events);
        const bySeq = new Map(events.map((e) => [e.seq, e]));
        const perSeq = new Map<number, number>();
        for (const entry of state.feed) {
          const e = bySeq.get(entry.seq);
          expect(e).toBeDefined();
          expect(entry.type).toBe(e!.type);
          perSeq.set(entry.seq, (perSeq.get(entry.seq) ?? 0) + 1);
          if (e!.type === "file_read") expect(entry.path).toBe(e!.payload.path);
          if (e!.type === "finding_recorded" && e!.payload.evidence.length > 0) expect(entry.path).toBe(e!.payload.evidence[0]!.path);
        }
        for (const [, n] of perSeq) expect(n).toBe(1);
        for (const e of events) if (ALWAYS_NARRATED.has(e.type)) expect(perSeq.get(e.seq)).toBe(1);
      }),
      { numRuns: 300 },
    );
  });
});
