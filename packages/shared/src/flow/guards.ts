// Guard helpers for the Flow_Graph. Every guard is a pure function of TaskState (R36.2).
import { currentStory, nextPendingStory, type NodeOutcome, type TaskState } from "../task.ts";
import type { NodeId } from "./ids.ts";

export type Guard = (t: TaskState) => boolean;

export const outcomeIs =
  (...outcomes: NodeOutcome[]): Guard =>
  (t) =>
    t.outcome !== undefined && outcomes.includes(t.outcome);

export const and =
  (...gs: Guard[]): Guard =>
  (t) =>
    gs.every((g) => g(t));

export const not =
  (g: Guard): Guard =>
  (t) =>
    !g(t);

export const isAdapted: Guard = (t) => t.repoKind === "adapted";
export const isOther: Guard = (t) => t.repoKind === "other";
export const isFrozen: Guard = (t) => t.frozenVersion !== null;

export const belowRetryLimit: Guard = (t) => (currentStory(t)?.attempts ?? Infinity) < t.limits.storyAttempts;
export const atRetryLimit: Guard = not(belowRetryLimit);

export const currentKindIs =
  (kind: "source_change" | "api_operation"): Guard =>
  (t) =>
    currentStory(t)?.kind === kind;

export const nextKindIs =
  (kind: "source_change" | "api_operation"): Guard =>
  (t) =>
    nextPendingStory(t)?.kind === kind;

export const noNextStory: Guard = (t) => nextPendingStory(t) === undefined;

export const currentPurposeIs =
  (purpose: "A" | "B"): Guard =>
  (t) =>
    currentStory(t)?.purpose === purpose;

/** Every story other than the current one is verified, so success needs only the current story to pass. */
export const othersVerified: Guard = (t) =>
  t.stories.length > 0 && t.stories.every((s) => s.storyId === t.currentStoryId || s.status === "verified");

export const reviewAllAccepted: Guard = (t) =>
  !!t.review && t.review.total > 0 && t.review.accepted === t.review.total && t.review.approachComplete;

export const reviewSendBack: Guard = (t) =>
  !!t.review && t.review.total > 0 && t.review.accepted + t.review.rejected === t.review.total && t.review.rejected > 0;

export const demoCaseRetryLeft: Guard = (t) => (currentStory(t)?.demoCaseRejections ?? Infinity) <= t.limits.demoCaseRetries;

// Entry invariants, checked by transition() for every edge into the node, in addition to the edge guard.
// They keep the honest-flow rules true no matter which edge is used (design.md, "Rules that keep the graph honest").
const POST_FREEZE: readonly NodeId[] = [
  "frozen",
  "planning",
  "documenting",
  "adapter_branch_2",
  "target_check",
  "docs_only",
  "story_develop",
  "story_review",
  "story_ask",
  "story_run",
  "story_checkpoint",
  "verifying",
  "api_read",
  "api_plan",
  "api_suggest",
  "api_confirm",
  "api_try_one",
  "api_write_batch",
  "api_read_back",
];
const EXECUTION: readonly NodeId[] = POST_FREEZE.filter(
  (n) => n.startsWith("story_") || n.startsWith("api_") || n === "verifying",
);

const AFTER_DOCS: readonly NodeId[] = ["adapter_branch_2", "target_check", "docs_only"];

export function entryInvariant(target: NodeId, t: TaskState): string | null {
  if (POST_FREEZE.includes(target) && !isFrozen(t)) return "no frozen Decision_Doc version (R15.4, R15.5)";
  if (target === "documenting" && !t.backlogValid) return "Product_Backlog not valid (R20)";
  if ((AFTER_DOCS.includes(target) || EXECUTION.includes(target)) && !t.docsComplete) return "Output_Docs incomplete (R19.4)";
  if (target === "target_check" && !isAdapted(t)) return "not an Adapted_Repo (R25)";
  if (EXECUTION.includes(target)) {
    if (!isAdapted(t)) return "not an Adapted_Repo (R25)";
    if (!t.targetCheckPassed) return "target_check has not passed (R13.4)";
  }
  if (target === "failure_review" && t.failure?.node !== t.node)
    return "no recorded failure for the node being left (R36.6)";
  if (target === "api_try_one" && currentPurposeIs("B")(t) && !currentStory(t)?.suggestionConfirmed)
    return "purpose B write without a confirmed suggestion (R15.7, R18.4)";
  return null;
}
