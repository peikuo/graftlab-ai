// Decision step properties (tasks.md 7.2, 7.5; R16.5, R15.11, R37.4, R37.5).
import { canonicalJson, type DecisionDocContent } from "@graftlab/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecisionDesk } from "./desk.ts";
import { content } from "./fixtures.ts";
import { contentHash } from "./hash.ts";
import { splitItems } from "./items.ts";

/** Reorders object keys at every level (a different serialization of the same content). */
function shuffleKeys(v: unknown, seed: number): unknown {
  if (Array.isArray(v)) return v.map((x, i) => shuffleKeys(x, seed + i));
  if (v === null || typeof v !== "object") return v;
  const entries = Object.entries(v as Record<string, unknown>);
  entries.sort((a, b) => ((a[0].length * 31 + seed) % 7) - ((b[0].length * 31 + seed) % 7) || (seed % 2 ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])));
  return Object.fromEntries(entries.map(([k, x]) => [k, shuffleKeys(x, seed + 1)]));
}

describe("Decision_Doc hash", () => {
  // Feature: graftlab-ai, Property 8: Decision_Doc hash recomputation
  it("the recorded hash equals the hash recomputed from the stored content, whatever the key order; a changed content changes it", () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(), fc.string({ minLength: 1 }), (value, seed, extra) => {
        const recorded = contentHash(value);
        const stored = JSON.parse(JSON.stringify(shuffleKeys(value, seed)));
        expect(contentHash(stored)).toBe(recorded);
        expect(canonicalJson(stored)).toBe(canonicalJson(value));
        expect(contentHash({ value, extra })).not.toBe(contentHash({ value, extra: `${extra}!` }));
      }),
      { numRuns: 200 },
    );
  });
});

describe("Only complete approach options can be confirmed", () => {
  // Feature: graftlab-ai, Property 10: Only complete approach options can be confirmed
  it("selecting an option succeeds iff it has an executable Acceptance_Check; a freeze always names a complete option", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.boolean(), { minLength: 1, maxLength: 4 }), fc.nat({ max: 3 }), async (completes, pick) => {
        const base = content();
        const c: DecisionDocContent = { ...base, approachOptions: completes.map((ok, i) => ({ ...base.approachOptions[0]!, id: `o${i}`, title: `Option ${i}`, assessment: { ...base.approachOptions[0]!.assessment, acceptanceChecks: ok ? base.approachOptions[0]!.assessment.acceptanceChecks : [], complete: ok } })) };
        const items = splitItems(c);
        const desk = new DecisionDesk({ draftId: "d1", content: c, items, verdicts: new Map(), nextVersion: 1, emit: async () => {} });
        const id = `o${pick % completes.length}`;
        const r = await desk.select("d1", id);
        expect(r.ok).toBe(completes[pick % completes.length]);
        for (const i of items) await desk.reviewItem("d1", i.id, i.hash, "accept");
        const f = await desk.freeze("d1", "s1");
        expect(f.ok).toBe(r.ok);
        if (f.ok) {
          const out = await desk.outcome;
          expect(out.kind === "confirmed" && out.content.approachOptions.find((o) => o.id === out.content.chosenApproachIds[0])!.assessment.complete).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
