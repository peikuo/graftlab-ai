import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Plan, TechDesign } from "@graftlab/shared";
import { featureContext } from "./context.ts";

/** A plan with n stories and a design with 1 or 2 Features per story; every text carries a unique marker. */
function world(n: number, split: boolean[]) {
  const stories = Array.from({ length: n }, (_, i) => ({
    id: `S${i + 1}`,
    title: `story-title-${i + 1}`,
    priority: i + 1,
    userStory: `user-story-${i + 1}`,
    acceptanceCriteria: [`criterion-${i + 1}`],
    demoPoint: { description: `demo-${i + 1}` },
    references: [],
    featureContract: { feature: `contract-${i + 1}`, shouldDo: [`do-${i + 1}`], shouldNotDo: [`dont-${i + 1}`], executionKind: "source_change" as const, acceptanceChecks: [{ id: `c${i + 1}`, kind: "test_suite" as const, command: ["pytest", `check-${i + 1}`], timeoutS: 60 }], budgets: { maxAttempts: 3, maxCodeAgentMinutes: 10 }, derivedFromDecisionVersion: 1 },
  }));
  const features = stories.flatMap((s, i) => {
    const one = { id: "", storyId: s.id, title: `feature-title-${i + 1}a`, summary: `feature-summary-${i + 1}a`, scope: { modules: [`module-${i + 1}a`], files: [`file-${i + 1}a.py`], notTouch: [] }, interfaces: [`iface-${i + 1}a`], tests: { files: [`test-${i + 1}a.py`], command: ["pytest", `test-${i + 1}a.py`] }, size: "S" as const, dependsOn: [] as string[], servesChecks: [`c${i + 1}`] };
    return split[i] ? [one, { ...one, title: `feature-title-${i + 1}b`, summary: `feature-summary-${i + 1}b`, scope: { modules: [`module-${i + 1}b`], files: [`file-${i + 1}b.py`], notTouch: [] }, interfaces: [`iface-${i + 1}b`], tests: { files: [`test-${i + 1}b.py`], command: ["pytest", `test-${i + 1}b.py`] } }] : [one];
  });
  features.forEach((f, k) => (f.id = `F${k + 1}`));
  const plan = { decisionVersion: 1, backlog: { decisionVersion: 1, stories }, sprintPlan: { decisionVersion: 1, goal: "g", storyIds: stories.map((s) => s.id), featureContractRefs: [] }, definitionOfDone: { decisionVersion: 1, checklist: ["x"] }, assessments: { feasibility: [], risk: [] }, facilitatorNote: "", label: "LLM assessment, not a guarantee" } as unknown as Plan;
  const design = { decisionVersion: 1, architecture: { decisionVersion: 1, overview: "arch-overview", affected: [{ part: "p", how: "h", quotes: [] }], newComponents: [], dataChanges: [], decisions: [{ decision: "d", why: "w", rejected: [] }] }, breakdown: { decisionVersion: 1, features }, review: [], grades: [], reviewerNote: "", label: "LLM assessment, not a guarantee" } as unknown as TechDesign;
  return { plan, design, features };
}

describe("small scope per Agent", () => {
  // Feature: graftlab-ai, Property 16: For any plan and Feature breakdown, the context of a Code_Agent attempt contains exactly the assigned Feature, its story with the Feature_Contract and the referenced documents, and nothing that belongs only to another story or another Feature of the same story.
  it("the context holds the assigned Feature and its story only", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }).chain((n) => fc.tuple(fc.constant(n), fc.array(fc.boolean(), { minLength: n, maxLength: n }), fc.nat())), ([n, split, pick]) => {
        const { plan, design, features } = world(n, split);
        const f = features[pick % features.length]!;
        const text = featureContext({ featureId: f.id, plan, design });
        const own = Number(f.storyId.slice(1));
        expect(text).toContain(f.title);
        expect(text).toContain(f.tests.command.join(" "));
        for (const k of [`story-title-${own}`, `contract-${own}`, `criterion-${own}`, `demo-${own}`, "arch-overview"]) expect(text).toContain(k);
        for (let i = 1; i <= n; i++) {
          if (i === own) continue;
          for (const k of [`story-title-${i}`, `user-story-${i}`, `contract-${i}`, `criterion-${i}`, `demo-${i}`, `feature-title-${i}`, `file-${i}`, `check-${i}`]) expect(text).not.toContain(k);
        }
        // Other Features of the same story stay out unless the assigned one builds on them.
        for (const g of features) if (g.id !== f.id && !f.dependsOn.includes(g.id)) expect(text).not.toContain(g.title);
      }),
      { numRuns: 200 },
    );
  });
});
