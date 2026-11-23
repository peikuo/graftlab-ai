// Thinking per step (design.md, "Prompt caching", "Thinking per step"; decided with the user 2026-11-24 for the
// demo). One table, so the choice is visible and measured in one place; a dynamic choice per call is deferred.
// "off" sends thinking disabled; the levels reach the endpoint only with LLM_<NAME>_REASONING_EFFORT=send.
export type Thinking = "off" | "low" | "medium" | "high";
export const THINKING = {
  readerPlan: "off",
  readerMemo: "low",
  readerBrief: "low",
  meetingPrepare: "medium",
  facilitatorOpenClose: "medium",
  discussion: "low",
  speakingSignal: "off",
  decisionDraft: "medium",
  decisionAssessment: "off",
} as const satisfies Record<string, Thinking>;
