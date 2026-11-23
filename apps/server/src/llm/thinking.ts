// Thinking per step (design.md, "Prompt caching", "Thinking per step"; decided with the user 2026-11-23 for the
// demo). One table, so the choice is visible and measured in one place; a dynamic choice per call is deferred.
// Only "low" or "off" (decided with the user 2026-11-23). "off" sends thinking disabled; whether "low" reaches the
// endpoint as a level depends on the provider (DeepSeek: yes, by default; otherwise only with REASONING_EFFORT=send).
export type Thinking = "off" | "low" | "medium" | "high";
export const THINKING = {
  readerPlan: "off",
  readerMemo: "low",
  readerBrief: "low",
  meetingPrepare: "low",
  facilitatorOpenClose: "low",
  discussion: "low",
  speakingSignal: "off",
  decisionDraft: "low",
  decisionAssessment: "off",
  planDraft: "low",
  planAssessment: "off",
  planFinal: "low",
  documents: "off",
} as const satisfies Record<string, Thinking>;
