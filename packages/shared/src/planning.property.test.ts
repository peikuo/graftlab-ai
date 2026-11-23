import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildPlan } from "./planning.ts";

const DEFECTS = ["none", "no_priority", "no_criteria", "no_demo", "no_contract", "extra_field", "no_should_do", "bad_kind"] as const;
type Defect = (typeof DEFECTS)[number];

function story(i: number, defect: Defect) {
  const contract: Record<string, unknown> = {
    feature: "Suggest tags for a new bookmark",
    shouldDo: ["suggest up to three tags"],
    shouldNotDo: ["change existing tags"],
    executionKind: defect === "bad_kind" ? "magic" : "source_change",
    acceptanceChecks: [],
  };
  if (defect === "extra_field") contract.files = ["bookmarks/views.py"];
  if (defect === "no_should_do") contract.shouldDo = [];
  return {
    id: `S${i + 1}`,
    title: `Story ${i + 1}`,
    ...(defect === "no_priority" ? {} : { priority: i + 1 }),
    userStory: "As a user I want tag suggestions so that saving is faster",
    acceptanceCriteria: defect === "no_criteria" ? [] : ["tags are suggested"],
    demoPoint: defect === "no_demo" ? "" : "add a bookmark and see the suggested tags",
    references: ["workflow:w1"],
    ...(defect === "no_contract" ? {} : { featureContract: contract }),
  };
}

describe("backlog validity", () => {
  // Feature: graftlab-ai, Property 15: For any generated Product_Backlog, validation accepts it if and only if every story has a priority, at least one acceptance criterion, exactly one demo point and a Feature_Contract with all required parts and no extra fields; when it rejects, the error names an incomplete story.
  it("accepts iff every story is complete, and names an incomplete story", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom(...DEFECTS), { minLength: 1, maxLength: 4 }), (defects) => {
        const plan = { sprintGoal: "Faster saving", stories: defects.map((d, i) => story(i, d)), definitionOfDone: ["all checks pass"] };
        const r = buildPlan(plan, 2);
        const complete = defects.every((d) => d === "none");
        expect(r.ok).toBe(complete);
        if (r.ok) {
          expect(r.backlog.decisionVersion).toBe(2);
          expect(r.sprintPlan.storyIds).toEqual(r.backlog.stories.map((s) => s.id));
          expect(r.backlog.stories.every((s) => s.featureContract.derivedFromDecisionVersion === 2 && s.featureContract.budgets.maxAttempts === 3)).toBe(true);
        } else {
          const bad = defects.flatMap((d, i) => (d === "none" ? [] : [`S${i + 1}`]));
          expect(r.problems.some((p) => bad.some((id) => p.includes(`story ${id}`)))).toBe(true);
          // No complete story is blamed.
          const good = defects.flatMap((d, i) => (d === "none" ? [`story S${i + 1} `] : []));
          expect(r.problems.some((p) => good.some((g) => p.startsWith(g)))).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("refuses more than four stories and an empty Definition_of_Done", () => {
    const five = { sprintGoal: "g", stories: [0, 1, 2, 3, 4].map((i) => story(i, "none")), definitionOfDone: ["x"] };
    expect(buildPlan(five, 1)).toMatchObject({ ok: false });
    expect(buildPlan({ sprintGoal: "g", stories: [story(0, "none")], definitionOfDone: [] }, 1)).toEqual({ ok: false, problems: ["the Definition_of_Done has no entry"] });
  });
});
