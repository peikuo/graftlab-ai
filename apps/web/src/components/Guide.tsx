// Plain-language guidance for people who do not know the flow: a stepper with everyday step names, and a
// "now" bar that says what is happening and whether the Judge has to do something. Derived from the UI state only.
import type { NodeId, UiState } from "@graftlab/shared";

export const STEPS = [
  { id: "read", label: "Read the code", nodes: ["reading", "adapter_branch"] },
  { id: "try", label: "Try the app", nodes: ["sandbox_start", "browser_experience"] },
  { id: "meet", label: "Meeting", nodes: ["meeting", "prototype"] },
  { id: "decide", label: "Decide", nodes: ["deciding", "awaiting_confirmation", "frozen"] },
  { id: "plan", label: "Plan", nodes: ["planning", "plan_review", "documenting", "tech_design", "adapter_branch_2", "target_check"] },
  { id: "build", label: "Build and check", nodes: ["story_test", "story_develop", "story_review", "story_ask", "story_run", "story_checkpoint", "verifying", "regression_check"] },
  { id: "result", label: "Result", nodes: ["success", "failed", "aborted", "analysis_only", "docs_only"] },
] as const satisfies readonly { id: string; label: string; nodes: readonly NodeId[] }[];

/** Short plain names of flow nodes, for the timeline. */
export const NODE_SHORT: Partial<Record<NodeId, string>> = {
  reading: "Reading the code",
  adapter_branch: "Checking what can run here",
  sandbox_start: "Starting the app",
  browser_experience: "Trying the app",
  meeting: "Meeting",
  deciding: "Writing the decision",
  awaiting_confirmation: "Waiting for your review",
  frozen: "Decision locked",
  planning: "Planning stories",
  plan_review: "Waiting for your plan review",
  documenting: "Writing the requirements",
  tech_design: "Technical design",
  adapter_branch_2: "Preparing to build",
  target_check: "Checking the app starts",
  story_test: "Writing the tests first",
  story_develop: "Building",
  story_review: "Reviewing the change",
  story_ask: "Waiting for an answer",
  story_run: "Starting the changed app",
  story_checkpoint: "Showing you the result",
  verifying: "Verifier checking",
  regression_check: "Running the whole test suite",
  failure_review: "Waiting for your decision after a failure",
  success: "Success",
  failed: "Ended without success",
  aborted: "Stopped",
  analysis_only: "Analysis only",
};

export function stepIndex(node: NodeId | null): number {
  if (!node) return -1;
  return STEPS.findIndex((s) => (s.nodes as readonly NodeId[]).includes(node));
}

export function Stepper({ state, unavailable = [] }: { state: UiState; unavailable?: string[] }) {
  // While the Judge decides after a failure, the stepper stays on the step that failed.
  const cur = stepIndex(state.node === "failure_review" ? state.previousNode : state.node);
  // A step counts as done only when the Task was in one of its nodes (a failed Task ends in "Result" without them).
  const reached = (i: number) => STEPS[i]!.nodes.some((n) => (state.visitedNodes as readonly string[]).includes(n));
  // The last step the Task worked in before it ended: reached, but not done unless the Task succeeded.
  const lastWorked = state.terminal ? Math.max(-1, ...STEPS.map((_, i) => (i < STEPS.length - 1 && reached(i) ? i : -1))) : -1;
  const stoppedHere = (i: number) => !!state.terminal && state.terminal !== "success" && i === lastWorked;
  const visited = (i: number) => reached(i) && !stoppedHere(i);
  return (
    <nav className="stepper" aria-label="Progress">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < cur ? (unavailable.includes(s.id) ? "done unavailable" : visited(i) ? "done" : "passed") : i === cur ? "current" : ""} aria-current={i === cur ? "step" : undefined}>
            <span className="num">{i < cur ? (unavailable.includes(s.id) ? "–" : visited(i) ? "✓" : i + 1) : i + 1}</span>
            {s.label}
            {i < cur && unavailable.includes(s.id) && <span className="step-note">unavailable</span>}
            {i < cur && !unavailable.includes(s.id) && !visited(i) && <span className="step-note">{stoppedHere(i) ? "stopped here" : "not reached"}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

const NOW: Partial<Record<NodeId, string>> = {
  reading: "Reading the repository.",
  adapter_branch: "Checking whether this software can also be run here.",
  sandbox_start: "Starting a private copy of the app with test data.",
  browser_experience: "The Explorer is using the app in a browser, like a new user would.",
  meeting: "The meeting is on: three viewpoints discuss how AI could help this software.",
  deciding: "The Facilitator is writing the decision draft for you.",
  awaiting_confirmation: "The decision draft is ready.",
  frozen: "The decision is locked.",
  planning: "The Planner splits the work into stories; Feasibility and Risk assess them; the Facilitator decides.",
  plan_review: "The plan is ready: confirm it, or send it back to the meeting with your reason.",
  documenting: "The Planner is writing the requirements.",
  tech_design: "Technical design: the Planner drafts the architecture and the Features, Feasibility reviews, the Reviewer decides.",
  target_check: "Checking that the app still starts before building.",
  story_test: "The Test_Agent writes the tests of the next Feature before any code; the Verifier checks they fail first.",
  story_develop: "The Code_Agent is changing a private copy of the code until the tests pass.",
  story_review: "The Reviewer checks the change against the story contract.",
  story_ask: "Development stopped to ask a question.",
  story_run: "Starting the changed app.",
  story_checkpoint: "The new feature runs in its own copy of the app.",
  verifying: "The Verifier (code, no AI) is checking the result.",
  regression_check: "The Verifier runs the whole test suite on the changed code and compares it with the original.",
  failure_review: "Something failed. You decide what happens next.",
  success: "Done. The Verifier confirmed every check.",
  failed: "The Task ended without success. The reason is shown in the activity.",
  aborted: "You stopped the Task.",
  analysis_only: "Analysis only: this repository cannot be run here, so the Task ends with the meeting result and the decision draft.",
};

export function NowBar({ state, yourTurn, onGo, detail }: { state: UiState; yourTurn: string | null; onGo?: () => void; detail?: string | null }) {
  const base = state.node ? NOW[state.node] ?? `Working: ${state.node}` : "Nothing is running.";
  const text = detail ? `${base} ${detail}.` : base;
  return (
    <div className={`nowbar${yourTurn ? " turn" : ""}`} role="status" aria-live="polite">
      <span className="now-label">{yourTurn ? "Your turn" : "Now"}</span>
      <span className="now-text">{yourTurn ?? text}</span>
      {yourTurn && onGo && (
        <button type="button" onClick={onGo}>
          Go there
        </button>
      )}
      {!yourTurn && state.node && !["success", "failed", "aborted"].includes(state.node) && <span className="now-hint">Nothing to do. You can send the team a message at any time below.</span>}
    </div>
  );
}
