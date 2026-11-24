// TaskState (design.md, "TaskState"). Guards are pure functions over this state.
// `outcome` is the validated result of the current node's work, set by the task runner by code
// (never from free model text, R36.2). It is cleared on every accepted transition.
import type { FailureClass } from "./events.ts";
import type { NodeId, TerminalId } from "./flow/ids.ts";

export const NODE_OUTCOMES = [
  "done", // the node's validated output exists
  "failed", // the node's work failed (failure event recorded)
  "node_timeout",
  "task_timeout",
  "unrecoverable_error",
  "judge_abort",
  "judge_end", // Judge: "start the meeting now" (gathering) or end before freeze (Other_Repo)
  "prototype_requested",
  "confirmed", // Judge confirmed (freeze, api_confirm, checkpoint)
  "rejected", // Judge rejected (api_confirm) or Studio rejected (Demo_Case in api_plan)
  "send_back", // decision review sent back with rejected items
  "unconfirmed", // checkpoint: no response within the wait (R21.4)
  "feedback", // checkpoint: Judge feedback
  "question", // Code_Agent stopped and asked
  "needs_tests", // story_develop: the Feature has no tests yet, the Test_Agent writes them first (R40.20)
  "retry_limit", // Code_Agent attempt finished at the retry limit
  "approve",
  "request_changes",
  "escalate",
  "approach_change",
  "answered",
  "unanswered",
  "passed", // Verifier: every item passed
  // failure review choices of the Judge (R36.6)
  "retry",
  "skip_story",
  "end_task",
] as const;
export type NodeOutcome = (typeof NODE_OUTCOMES)[number];

export type StoryKind = "source_change" | "api_operation";
export type StoryStatus = "pending" | "in_progress" | "verified" | "failed" | "blocked";

export interface StoryProgress {
  /** The execution unit: a Feature id (F1) after the technical design. */
  storyId: string;
  /** The story the Feature belongs to (R38.10); absent for a unit that is a whole story. */
  parent?: string;
  kind: StoryKind;
  purpose: "A" | "B";
  attempts: number;
  status: StoryStatus;
  unconfirmed: boolean;
  demoCaseRejections: number;
  suggestionConfirmed: boolean;
}

export interface DecisionReview {
  total: number; // review items of the current draft
  accepted: number;
  rejected: number;
  approachComplete: boolean; // exactly one complete approach or combination selected
}

export interface TaskState {
  taskId: string;
  url: string;
  owner: string;
  repo: string;
  repoKind: "adapted" | "other";
  adapterId?: string;
  node: NodeId;
  terminal?: TerminalId;
  outcome?: NodeOutcome;
  runtimeRulesVersion: string;
  frozenVersion: number | null;
  /** A valid Repo_Brief exists for this Task (R10.7); leaving reading needs it. */
  briefReady: boolean;
  review?: DecisionReview;
  backlogValid: boolean;
  /** The Judge confirmed the current plan (R19.11). */
  planConfirmed: boolean;
  /** The Judge's reason when the plan was sent back to the meeting (R19.12); cleared at the next freeze. */
  planSentBackReason?: string;
  docsComplete: boolean;
  stories: StoryProgress[];
  currentStoryId?: string;
  pendingUnconfirmed: string[];
  failuresByClass: Partial<Record<FailureClass, number>>;
  gathering: {
    partial: boolean;
    experienceUnavailable?: string;
    queuedJudgeMessages: string[];
  };
  targetCheckPassed: boolean;
  /** Set by the runner, with the failure event, before a failure edge into failure_review (R36.6). */
  failure?: { node: NodeId; storyId?: string; failureClass: FailureClass; detail: string };
  flags: { prototypeEnabled: boolean; judgeLlm: boolean };
  limits: { storyAttempts: number; demoCaseRetries: number };
  startedAt: string;
  deadlineAt: string;
}

export function initialTaskState(init: {
  taskId: string;
  url: string;
  owner: string;
  repo: string;
  repoKind: "adapted" | "other";
  adapterId?: string;
  runtimeRulesVersion: string;
  startedAt: string;
  deadlineAt: string;
}): TaskState {
  return {
    ...init,
    node: "reading",
    frozenVersion: null,
    briefReady: false,
    backlogValid: false,
    planConfirmed: false,
    docsComplete: false,
    stories: [],
    pendingUnconfirmed: [],
    failuresByClass: {},
    gathering: { partial: false, queuedJudgeMessages: [] },
    targetCheckPassed: false,
    flags: { prototypeEnabled: false, judgeLlm: false },
    limits: { storyAttempts: 3, demoCaseRetries: 1 },
  };
}

export function currentStory(t: TaskState): StoryProgress | undefined {
  return t.stories.find((s) => s.storyId === t.currentStoryId);
}

/** The next story to work on: the first pending story other than the current one. */
export function nextPendingStory(t: TaskState): StoryProgress | undefined {
  return t.stories.find((s) => s.status === "pending" && s.storyId !== t.currentStoryId);
}
