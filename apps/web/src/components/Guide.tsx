// Plain-language guidance for people who do not know the flow: a stepper with everyday step names, and a
// "now" bar that says what is happening and whether the Judge has to do something. Derived from the UI state only.
import type { NodeId, UiState } from "@graftlab/shared";

export const STEPS = [
  { id: "read", label: "Read the code", nodes: ["reading", "adapter_branch"] },
  { id: "try", label: "Try the app", nodes: ["sandbox_start", "browser_experience"] },
  { id: "meet", label: "Meeting", nodes: ["meeting", "prototype"] },
  { id: "decide", label: "Decide", nodes: ["deciding", "awaiting_confirmation", "frozen"] },
  { id: "plan", label: "Plan", nodes: ["planning", "documenting", "adapter_branch_2", "target_check"] },
  { id: "build", label: "Build and check", nodes: ["story_develop", "story_review", "story_ask", "story_run", "story_checkpoint", "verifying", "api_read", "api_plan", "api_suggest", "api_confirm", "api_try_one", "api_write_batch", "api_read_back"] },
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
  documenting: "Writing documents",
  adapter_branch_2: "Preparing to build",
  target_check: "Checking the app starts",
  story_develop: "Building",
  story_review: "Reviewing the change",
  story_ask: "Waiting for an answer",
  story_run: "Starting the changed app",
  story_checkpoint: "Showing you the result",
  verifying: "Verifier checking",
  failure_review: "Waiting for your decision after a failure",
  success: "Success",
  failed: "Ended without success",
  aborted: "Stopped",
};

export function stepIndex(node: NodeId | null): number {
  if (!node) return -1;
  return STEPS.findIndex((s) => (s.nodes as readonly NodeId[]).includes(node));
}

export function Stepper({ state, unavailable = [] }: { state: UiState; unavailable?: string[] }) {
  // While the Judge decides after a failure, the stepper stays on the step that failed.
  const cur = stepIndex(state.node === "failure_review" ? state.previousNode : state.node);
  return (
    <nav className="stepper" aria-label="Progress">
      <ol>
        {STEPS.map((s, i) => (
          <li key={s.id} className={i < cur ? (unavailable.includes(s.id) ? "done unavailable" : "done") : i === cur ? "current" : ""} aria-current={i === cur ? "step" : undefined}>
            <span className="num">{i < cur ? (unavailable.includes(s.id) ? "–" : "✓") : i + 1}</span>
            {s.label}
            {i < cur && unavailable.includes(s.id) && <span className="step-note">unavailable</span>}
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
  planning: "The Planner is splitting the work into small stories.",
  documenting: "The Planner is writing the requirements, design and task documents.",
  target_check: "Checking that the app still starts before building.",
  story_develop: "The Code_Agent is changing a private copy of the code.",
  story_review: "The Reviewer checks the change against the story contract.",
  story_ask: "Development stopped to ask a question.",
  story_run: "Starting the changed app.",
  story_checkpoint: "The new feature is ready to look at.",
  verifying: "The Verifier (code, no AI) is checking the result.",
  failure_review: "Something failed. You decide what happens next.",
  success: "Done. The Verifier confirmed every check.",
  failed: "The Task ended without success. The reason is shown in the activity.",
  aborted: "You stopped the Task.",
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
