// Flow_Graph as data (R36.1; design.md, "Flow_Graph"). transition() in transition.ts is the only way to change task.node.
import {
  and,
  briefReady,
  atRetryLimit,
  belowRetryLimit,
  currentKindIs,
  isAdapted,
  isFrozen,
  isOther,
  lastWithDemo,
  nextKindIs,
  noNextStory,
  not,
  othersVerified,
  outcomeIs,
  reviewAllAccepted,
  reviewSendBack,
  type Guard,
} from "./guards.ts";
import { currentStory } from "../task.ts";
import { GATHERING_NODES, NODE_IDS, type NodeId } from "./ids.ts";

export type NodeKind = "auto" | "agent_loop" | "wait_user" | "terminal";

export interface FlowNode {
  id: NodeId;
  kind: NodeKind;
  tools: readonly string[];
  /** Node timeout in seconds; null means only the Task timeout applies. */
  timeoutS: number | null;
  requirements: string;
}

export interface FlowEdge {
  id: string;
  from: NodeId;
  to: NodeId;
  guard: Guard;
  label: string;
  global?: true;
}

const min = (m: number) => m * 60;

export const NODES: Record<NodeId, FlowNode> = {
  reading: { id: "reading", kind: "agent_loop", tools: ["read_file", "search_repo", "read_memo", "search_memo", "submit_reading_plan", "submit_file_memos", "submit_repo_brief", "record_finding"], timeoutS: min(15), requirements: "R10, R34" },
  adapter_branch: { id: "adapter_branch", kind: "auto", tools: [], timeoutS: 5, requirements: "R25" },
  sandbox_start: { id: "sandbox_start", kind: "auto", tools: [], timeoutS: min(3), requirements: "R13, R29" },
  browser_experience: {
    id: "browser_experience",
    kind: "agent_loop",
    tools: ["browser_open", "browser_click", "browser_fill", "browser_press", "browser_snapshot", "browser_screenshot", "record_note", "finish_experience"],
    timeoutS: min(10),
    requirements: "R14",
  },
  meeting: {
    id: "meeting",
    kind: "agent_loop",
    tools: ["read_file", "search_repo", "read_memo", "search_memo", "submit_position", "submit_signal", "submit_turn", "ask_judge", "submit_close"],
    timeoutS: min(25),
    requirements: "R11, R12, R24",
  },
  prototype: { id: "prototype", kind: "agent_loop", tools: ["code_agent"], timeoutS: min(15), requirements: "R41 (Stretch)" },
  deciding: { id: "deciding", kind: "agent_loop", tools: ["read_file", "search_repo", "ask_judge", "submit_decision_draft"], timeoutS: min(20), requirements: "R15, R37" },
  awaiting_confirmation: { id: "awaiting_confirmation", kind: "wait_user", tools: [], timeoutS: null, requirements: "R5.7, R15.3, R15.4" },
  frozen: { id: "frozen", kind: "auto", tools: [], timeoutS: 5, requirements: "R15.3, R16" },
  planning: { id: "planning", kind: "agent_loop", tools: ["read_file", "search_repo", "submit_plan", "submit_plan_assessment", "submit_final_plan"], timeoutS: min(15), requirements: "R19, R20, R40.1" },
  plan_review: { id: "plan_review", kind: "wait_user", tools: [], timeoutS: null, requirements: "R19.11, R19.12" },
  documenting: {
    id: "documenting",
    kind: "agent_loop",
    tools: ["submit_requirements"],
    timeoutS: min(10),
    requirements: "R19.2, R20",
  },
  tech_design: {
    id: "tech_design",
    kind: "agent_loop",
    tools: ["read_file", "search_repo", "submit_tech_design", "submit_tech_review", "submit_final_tech_design"],
    timeoutS: min(20),
    requirements: "R19.13-R19.15",
  },
  adapter_branch_2: { id: "adapter_branch_2", kind: "auto", tools: [], timeoutS: 5, requirements: "R25" },
  target_check: { id: "target_check", kind: "auto", tools: [], timeoutS: min(3), requirements: "R13.4, R25.8, R29.5" },
  story_test: { id: "story_test", kind: "agent_loop", tools: ["test_agent"], timeoutS: null, requirements: "R40.20, R22.12" },
  story_develop: { id: "story_develop", kind: "agent_loop", tools: ["code_agent"], timeoutS: null, requirements: "R38, R40" },
  story_review: { id: "story_review", kind: "agent_loop", tools: ["read_changed_file", "read_diff", "submit_review_verdict"], timeoutS: min(5), requirements: "R40.6-R40.10" },
  story_ask: { id: "story_ask", kind: "wait_user", tools: ["answer_question"], timeoutS: 300, requirements: "R40.11-R40.14" },
  story_run: { id: "story_run", kind: "auto", tools: [], timeoutS: 240, requirements: "R39.9-R39.11" },
  story_checkpoint: { id: "story_checkpoint", kind: "wait_user", tools: [], timeoutS: 240, requirements: "R21, R21.11" },
  verifying: { id: "verifying", kind: "auto", tools: [], timeoutS: min(10), requirements: "R22" },
  regression_check: { id: "regression_check", kind: "auto", tools: [], timeoutS: min(40), requirements: "R22.10" },
  failure_review: { id: "failure_review", kind: "wait_user", tools: [], timeoutS: null, requirements: "R36.6" },
  success: { id: "success", kind: "terminal", tools: [], timeoutS: null, requirements: "R36.5" },
  failed: { id: "failed", kind: "terminal", tools: [], timeoutS: null, requirements: "R36.5" },
  aborted: { id: "aborted", kind: "terminal", tools: [], timeoutS: null, requirements: "R36.5" },
  analysis_only: { id: "analysis_only", kind: "terminal", tools: [], timeoutS: null, requirements: "R36.5, R25" },
  docs_only: { id: "docs_only", kind: "terminal", tools: [], timeoutS: null, requirements: "R36.5, R25" },
};

const gatheringFailed = outcomeIs("failed", "node_timeout");
const unansweredNext = (kind: "source_change" | "api_operation") => and(outcomeIs("unanswered"), nextKindIs(kind));
const unansweredLast = and(outcomeIs("unanswered"), noNextStory);

const e = (id: string, from: NodeId, to: NodeId, guard: Guard, label: string): FlowEdge => ({ id, from, to, guard, label });

/** Non-global edges. Edge ids are unique across the graph. */
export const EDGES: readonly FlowEdge[] = [
  // evidence gathering
  e("reading_done", "reading", "adapter_branch", and(outcomeIs("done"), briefReady), "F2 download and Repo_Brief done"),
  e("reading_failed", "reading", "failure_review", outcomeIs("failed"), "download or Repo_Brief failed"),
  e("adapted_repo", "adapter_branch", "sandbox_start", isAdapted, "Adapted_Repo"),
  e("other_repo", "adapter_branch", "meeting", isOther, "Other_Repo, Analysis only label"),
  e("sandbox_ready", "sandbox_start", "browser_experience", outcomeIs("done"), "F4 baseline ready, reset verified"),
  e("sandbox_unavailable", "sandbox_start", "meeting", gatheringFailed, "start or reset failed or timed out, experienceUnavailable"),
  e("sandbox_judge_end", "sandbox_start", "meeting", outcomeIs("judge_end"), "Judge starts the meeting now, gatheringPartial"),
  e("experience_done", "browser_experience", "meeting", outcomeIs("done"), "F5 experience done"),
  e("experience_unavailable", "browser_experience", "meeting", gatheringFailed, "experience failed or timed out, experienceUnavailable"),
  e("experience_judge_end", "browser_experience", "meeting", outcomeIs("judge_end"), "Judge starts the meeting now, gatheringPartial"),
  // meeting and decision
  e("meeting_summary_valid", "meeting", "deciding", outcomeIs("done"), "F3 meeting summary valid"),
  e("meeting_failed", "meeting", "failure_review", outcomeIs("failed"), "no proposal on the board, or the roles are not configured"),
  e("prototype_requested", "deciding", "prototype", (t) => t.flags.prototypeEnabled && t.outcome === "prototype_requested", "Stretch flag on and Prototype requested"),
  e("prototype_finished", "prototype", "deciding", outcomeIs("done", "failed"), "Prototype done or failed"),
  e("draft_valid", "deciding", "awaiting_confirmation", outcomeIs("done"), "F6 draft schema-valid"),
  e("deciding_failed", "deciding", "failure_review", outcomeIs("failed"), "no valid decision draft"),
  e("send_back", "awaiting_confirmation", "deciding", and(outcomeIs("send_back"), reviewSendBack), "every item reviewed, at least one rejected"),
  e("freeze", "awaiting_confirmation", "frozen", and(outcomeIs("confirmed"), reviewAllAccepted, isFrozen), "every item accepted, exactly one approach"),
  e("end_before_freeze", "awaiting_confirmation", "analysis_only", and(isOther, outcomeIs("judge_end")), "Other_Repo, Judge ends before freeze"),
  // planning and documents
  e("frozen_recorded", "frozen", "planning", isFrozen, "version, hash, who, when recorded"),
  e("backlog_valid", "planning", "plan_review", and(outcomeIs("done"), (t) => t.backlogValid), "F7 plan valid"),
  e("planning_failed", "planning", "failure_review", outcomeIs("failed"), "no valid plan"),
  e("plan_confirmed", "plan_review", "documenting", and(outcomeIs("confirmed"), (t) => t.planConfirmed), "Judge confirms the plan"),
  e("plan_sent_back", "plan_review", "meeting", and(outcomeIs("send_back"), (t) => !!t.planSentBackReason?.trim()), "Judge sends the plan back with a reason"),
  e("documenting_failed", "documenting", "failure_review", outcomeIs("failed"), "no valid documents"),
  e("requirements_written", "documenting", "tech_design", outcomeIs("done"), "requirements written"),
  e("docs_complete", "tech_design", "adapter_branch_2", and(outcomeIs("done"), (t) => t.docsComplete), "F8 Output_Docs complete"),
  e("tech_design_failed", "tech_design", "failure_review", outcomeIs("failed"), "no valid technical design"),
  e("other_docs_only", "adapter_branch_2", "docs_only", isOther, "Other_Repo"),
  e("adapted_execute", "adapter_branch_2", "target_check", isAdapted, "Adapted_Repo"),
  e("check_passed_source", "target_check", "story_develop", and(outcomeIs("done"), (t) => t.targetCheckPassed, nextKindIs("source_change")), "baseline check passed, next story is source change"),
  e("target_unavailable", "target_check", "failure_review", outcomeIs("failed", "node_timeout"), "target baseline cannot start, not executed"),
  // source-change stories
  e("tests_needed", "story_develop", "story_test", outcomeIs("needs_tests"), "the Feature has no tests yet: test first"),
  e("tests_red", "story_test", "story_develop", outcomeIs("done"), "tests written, red before the code"),
  e("tests_failed", "story_test", "failure_review", outcomeIs("failed"), "no valid red tests after one visible retry"),
  e("attempt_finished", "story_develop", "story_review", outcomeIs("done"), "F10 attempt finished, change recorded"),
  e("develop_ask", "story_develop", "story_ask", outcomeIs("question", "retry_limit"), "question, or retry limit reached"),
  e("develop_failed", "story_develop", "failure_review", outcomeIs("failed"), "story budget exceeded or Code_Agent failure"),
  e("approve", "story_review", "story_run", and(outcomeIs("approve"), lastWithDemo), "approve, last Feature of a story with a demo: run the app for the demo"),
  e("approve_feature", "story_review", "verifying", and(outcomeIs("approve"), not(lastWithDemo)), "approve, more Features of the story follow or the story has no demo: verify and merge"),
  e("request_changes", "story_review", "story_develop", and(outcomeIs("request_changes"), belowRetryLimit), "request changes, below retry limit"),
  e("escalate", "story_review", "story_ask", (t) => t.outcome === "escalate" || (t.outcome === "request_changes" && atRetryLimit(t)), "escalate, or request changes at retry limit"),
  e("review_failed", "story_review", "failure_review", outcomeIs("failed"), "no valid Review_Verdict after the visible retries"),
  e("approach_change", "story_review", "deciding", outcomeIs("approach_change"), "approach must change, new version"),
  e("answered", "story_ask", "story_develop", and(outcomeIs("answered"), belowRetryLimit), "answer received, below retry limit"),
  e("answered_at_limit", "story_ask", "story_develop", and(outcomeIs("answered"), atRetryLimit, nextKindIs("source_change")), "answer received at retry limit, story blocked, next story is source change"),
  e("answered_at_limit_last", "story_ask", "failed", and(outcomeIs("answered"), atRetryLimit, noNextStory), "answer received at retry limit, story blocked, no next story"),
  e("unanswered_next", "story_ask", "story_develop", unansweredNext("source_change"), "unanswered, story blocked, next story is source change"),
  e("unanswered_last", "story_ask", "failed", unansweredLast, "unanswered, story blocked, no next story"),
  e("run_healthy", "story_run", "story_checkpoint", outcomeIs("done"), "Run_Environment healthy"),
  e("run_failed", "story_run", "failure_review", outcomeIs("failed", "node_timeout"), "modified target failed to start"),
  e("checkpoint_feedback", "story_checkpoint", "story_develop", and(outcomeIs("feedback"), currentKindIs("source_change"), belowRetryLimit), "Judge feedback, below retry limit"),
  e("checkpoint_feedback_at_limit", "story_checkpoint", "story_ask", and(outcomeIs("feedback"), currentKindIs("source_change"), atRetryLimit), "Judge feedback at retry limit"),
  e("checkpoint_done", "story_checkpoint", "verifying", outcomeIs("confirmed", "unconfirmed"), "confirmed, or no response marked Unconfirmed"),
  e("verified_next_source", "verifying", "story_develop", and(outcomeIs("passed"), nextKindIs("source_change")), "all checks pass, next story is source change"),
  e("verified_last", "verifying", "regression_check", and(outcomeIs("passed"), noNextStory, othersVerified), "all checks pass, last story, every story verified: run the whole suite"),
  e("regression_passed", "regression_check", "success", outcomeIs("passed"), "no regression against the pinned commit"),
  e("regression_failed", "regression_check", "failed", outcomeIs("failed"), "a regression, or the suite could not run"),
  e("verified_last_partial", "verifying", "failed", and(outcomeIs("passed"), noNextStory, not(othersVerified)), "all checks pass, last story, an earlier story not verified"),
  e("verify_failed", "verifying", "failed", outcomeIs("failed"), "mismatch or check failure"),
  // API-operation stories
  // failure review: the Judge decides after an unexpected failure (R36.6)
  ...NODE_IDS.filter((n) => NODES[n].kind !== "terminal" && n !== "failure_review").map((n) =>
    e(`retry_${n}`, "failure_review", n, (t) => t.outcome === "retry" && t.failure?.node === n, `Judge retries ${n}`),
  ),
  e("skip_story_source", "failure_review", "story_develop", and(outcomeIs("skip_story"), (t) => currentStory(t) !== undefined, nextKindIs("source_change")), "Judge skips the story, next story is source change"),
  e("end_task", "failure_review", "failed", outcomeIs("end_task"), "Judge ends the Task"),
];

const isGathering = (n: NodeId) => (GATHERING_NODES as readonly NodeId[]).includes(n);

const g = (id: string, from: NodeId, to: NodeId, guard: Guard, label: string): FlowEdge => ({ id, from, to, guard, label, global: true });

/**
 * Global edges for every non-terminal node (R36.6). A node timeout or an unrecoverable error stops in
 * failure_review for the Judge to decide; inside failure_review an unrecoverable error ends the Task.
 * Gathering nodes handle their own node timeout (edge to meeting). The Task timeout always ends the Task.
 */
export const GLOBAL_EDGES: readonly FlowEdge[] = NODE_IDS.filter((n) => NODES[n].kind !== "terminal").flatMap((n) => {
  const review: NodeId = n === "failure_review" ? "failed" : "failure_review";
  const edges = [
    g("task_timeout", n, "failed", outcomeIs("task_timeout"), "Task timeout"),
    g("unrecoverable_error", n, review, outcomeIs("unrecoverable_error"), "unrecoverable error"),
    g("judge_abort", n, "aborted", outcomeIs("judge_abort"), "Judge aborts"),
  ];
  if (n !== "failure_review" && !isGathering(n)) edges.unshift(g("timeout", n, "failure_review", outcomeIs("node_timeout"), "node timeout"));
  return edges;
});

export const ALL_EDGES: readonly FlowEdge[] = [...EDGES, ...GLOBAL_EDGES];

export function edgesFrom(node: NodeId, opts: { includeGlobal: boolean } = { includeGlobal: true }): FlowEdge[] {
  return (opts.includeGlobal ? ALL_EDGES : EDGES).filter((x) => x.from === node);
}

export function findEdge(from: NodeId, edgeId: string): FlowEdge | undefined {
  return ALL_EDGES.find((x) => x.from === from && x.id === edgeId);
}
