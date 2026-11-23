// Test fixtures for the decision step (not product code; imported only by tests).
import type { DecisionDocContent } from "@graftlab/shared";

export const check = { id: "c1", kind: "test_suite" as const, command: ["python", "manage.py", "test", "bookmarks.tests.test_ai_tags"], timeoutS: 600 };
export function content(over: Partial<DecisionDocContent> = {}): DecisionDocContent {
  const assessment = (complete: boolean, effort: "small" | "large" = "small") => ({
    feasibility: "fits the save step",
    effort,
    risk: "wrong tags",
    neededEnvironments: ["development_sandbox" as const],
    acceptanceChecks: complete ? [check] : [],
    label: "LLM assessment, not a guarantee" as const,
    claims: [],
    complete,
  });
  return {
    purpose: "B",
    workflows: [{ id: "w1", name: "Tag suggestions", purpose: "B", description: "suggest tags at save", evidence: [], evidenceStatus: "unverified" }],
    inScope: ["suggest tags"],
    outOfScope: ["bulk retagging"],
    acceptanceCriteria: ["suggested tags appear in the save form"],
    approachOptions: [
      { id: "src", kind: "source_change", title: "Change the save step", summary: "add a suggestion call", assessment: assessment(true) },
      { id: "agent", kind: "independent_agent", title: "Separate helper", summary: "a helper next to the app", assessment: assessment(false, "large") },
    ],
    chosenApproachIds: [],
    uiImpact: "a row of suggested tags under the tag box",
    executableAcceptanceChecks: [],
    risks: ["wrong tags"],
    evidenceSources: [],
    openQuestions: [],
    ...over,
  };
}
