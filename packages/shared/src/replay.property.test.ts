// Live and Replay equality (tasks.md 9.4; R26.7, R27.14, R7.5).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { foldEvents, initialUiState, reduce } from "./reducer.ts";
import { activityStreamArb, eventStreamArb } from "./testing/arbitraries.ts";

describe("Live and Replay", () => {
  // Feature: graftlab-ai, Property 4: Live and Replay produce the same UI state
  it("the live state after event k equals the Replay state folded from the stored file up to the playhead k", () => {
    fc.assert(
      fc.property(fc.oneof(eventStreamArb(40), activityStreamArb), fc.nat(), (events, cut) => {
        const k = events.length === 0 ? 0 : cut % (events.length + 1);
        // Live: one event at a time, as the SSE client applies them.
        let live = initialUiState;
        for (const e of events.slice(0, k)) live = reduce(live, e);
        // Replay: the stored file (JSON) parsed and folded up to the playhead.
        const stored = JSON.parse(JSON.stringify({ header: { label: "Replay" }, events })).events;
        expect(foldEvents(stored.slice(0, k))).toEqual(live);
      }),
      { numRuns: 200 },
    );
  });
});
