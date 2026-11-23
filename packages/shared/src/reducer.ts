// UI reducer (design.md, "packages/shared", "Web app"; R26.7, R27.3, R27.14, R36.8).
// The UI state is a pure function of the event list. Live, reconnect and Replay all fold through reduce(),
// which ignores events at or below the last applied seq, so duplicates and resends are harmless.
// roleStatus() (R2) is added with the Workspace milestone; this state keeps the facts it needs.
import type { Actor, FailureClass, PayloadOf, RoleId, StudioEvent } from "./events.ts";
import type { NodeId, TerminalId } from "./flow/ids.ts";

export type ActorKey = "judge" | "system" | "verifier" | "code_agent" | RoleId;

export function actorKey(a: Actor): ActorKey {
  return a.kind === "role" ? a.roleId : a.kind;
}

export interface FeedEntry {
  seq: number;
  ts: string;
  actor: ActorKey;
  type: StudioEvent["type"];
  text: string;
  path?: string; // source file path for file_read and evidence-carrying events (R3.5)
  failure?: boolean;
  /** messageId for message entries, clientMsgId for Judge messages, cardId for cards. */
  ref?: string;
}

export interface MessageState {
  messageId: string;
  actor: ActorKey;
  startedSeq: number;
  startedTs: string;
  purpose: string;
  status: "open" | "complete" | "incomplete";
  phase?: "waiting" | "thinking" | "speaking" | "tool_call";
  lastProgressTs?: string;
  text?: string;
  reasoning?: string;
  reason?: string;
}

export interface CardState {
  cardId: string;
  kind: string;
  title: string;
  openedBy: ActorKey;
  openedSeq: number;
  answered: boolean;
  /** No answer within the wait (card_expired); the meeting continued. */
  expired?: boolean;
  /** false for a meeting question: the asking role keeps working (R5.3). */
  blocking: boolean;
}

export interface UiState {
  lastSeq: number;
  taskId?: string;
  repo?: { url: string; owner: string; repo: string; repoKind: "adapted" | "other" };
  node: NodeId | null;
  terminal?: TerminalId;
  feed: FeedEntry[];
  messages: Record<string, MessageState>;
  artifacts: Record<string, { kind: string; title: string; seq: number }>;
  cards: Record<string, CardState>;
  failuresByClass: Partial<Record<FailureClass, number>>;
  lastEventByActor: Partial<Record<ActorKey, { seq: number; ts: string; type: StudioEvent["type"] }>>;
  openTools: Record<string, { actor: ActorKey; tool: string; ts: string }>;
  decisionDocs: { version: number; hash: string; frozen: boolean }[];
  /** Each perspective's signal in the latest speaking round (R11.1); absent for the role that just spoke. */
  signals: Partial<Record<ActorKey, { speak: boolean; kind?: string; intent?: string; seq: number }>>;
  questions: Record<string, { questionId: string; from: ActorKey; askedParty: "reviewer" | "judge"; ts: string; answered: boolean }>;
  /** Latest failure and latest other event per actor, for the "blocked" Role_Status rule. */
  lastFailureByActor: Partial<Record<ActorKey, { seq: number; ts: string; detail: string }>>;
  lastOtherByActor: Partial<Record<ActorKey, { seq: number; ts: string }>>;
  lastFileReadByActor: Partial<Record<ActorKey, { seq: number; ts: string; path: string }>>;
  lastBrowserByActor: Partial<Record<ActorKey, { seq: number; ts: string; what: string }>>;
  verifierResults: { seq: number; storyId: string; checkId: string; pass: boolean; items: { item: string; pass: boolean; expected: string; actual: string }[] }[];
  /** Flow nodes entered so far, in first-entry order (for showing elements once their step has started). */
  visitedNodes: NodeId[];
  /** The node left by the latest transition (for example the step that failed before failure_review). */
  previousNode: NodeId | null;
}

export const initialUiState: UiState = {
  lastSeq: 0,
  node: null,
  feed: [],
  messages: {},
  artifacts: {},
  cards: {},
  failuresByClass: {},
  lastEventByActor: {},
  openTools: {},
  decisionDocs: [],
  signals: {},
  questions: {},
  lastFailureByActor: {},
  lastOtherByActor: {},
  lastFileReadByActor: {},
  lastBrowserByActor: {},
  verifierResults: [],
  visitedNodes: [],
  previousNode: null,
};

/** Event types that always produce exactly one Activity_Feed entry (Property 5). */
export const ALWAYS_NARRATED: ReadonlySet<StudioEvent["type"]> = new Set([
  "task_created", "node_entered", "transition_rejected", "file_read", "finding_recorded", "message_completed",
  "message_incomplete", "tool_started", "judge_message", "card_opened", "card_answered", "decision_doc_frozen",
  "decision_item_reviewed", "browser_action", "code_change", "memo_written", "reading_planned", "repo_brief", "index_progress", "card_expired", "decision_draft", "decision_approach_selected", "statement_submitted", "signals_collected", "meeting_summary", "review_verdict", "question_opened", "question_answered",
  "verifier_result", "failure", "terminal_reached",
]);

const ROLE_PLAIN: Record<string, string> = { facilitator: "Facilitator", user_value: "User_Value", feasibility: "Feasibility", risk: "Risk", judge: "you" };
const KIND_PLAIN: Record<string, string> = { disagree: "wants to disagree", answer: "wants to answer", add: "wants to add something", agree: "wants to agree" };
/** One speaking round in plain words (R11.13): who wants to speak and why, and who speaks next. */
export function signalsText(p: PayloadOf<"signals_collected">): string {
  const wanting = p.signals.filter((s) => s.speak).map((s) => `${ROLE_PLAIN[s.roleId]} ${KIND_PLAIN[s.kind ?? "add"]}`);
  const head = wanting.length ? wanting.join(", ") : "Nobody asked to speak";
  return p.next ? `${head}. ${ROLE_PLAIN[p.next]} speaks next${p.reason ? ` (${p.reason})` : ""}.` : `${head}. ${p.reason}`;
}
/** The Reader's submit tools in plain words (their arguments stay in Engineering_Details). */
const SUBMIT_PLAIN: Record<string, string> = {
  submit_reading_plan: "Submitted the reading plan",
  submit_file_memos: "Submitted file summaries",
  submit_repo_brief: "Submitted the repo brief",
  submit_directory_memo: "Submitted a folder summary",
  submit_statement: "Submitted the statement",
  submit_meeting_summary: "Submitted the meeting summary",
  submit_position: "Submitted the position",
  submit_turn: "Changed the proposal board",
  submit_signal: "Said whether it wants to speak",
  submit_close: "Closed the meeting",
  ask_judge: "Asked you a question",
};
function refOf(e: StudioEvent): string | undefined {
  switch (e.type) {
    case "message_completed":
    case "message_incomplete":
      return e.payload.messageId;
    case "judge_message":
      return e.payload.clientMsgId;
    case "card_opened":
    case "card_answered":
      return e.payload.cardId;
    default:
      return undefined;
  }
}

export function narrate(e: StudioEvent): { text: string; path?: string; failure?: boolean } | null {
  switch (e.type) {
    case "task_created":
      return { text: `Task created for ${e.payload.owner}/${e.payload.repo}` };
    case "node_entered":
      return { text: `Entered ${e.payload.to}` };
    case "transition_rejected":
      return { text: `Transition "${e.payload.requestedEdgeId}" rejected: ${e.payload.reason}`, failure: true };
    case "file_read":
      return { text: `Read ${e.payload.path}`, path: e.payload.path };
    case "finding_recorded": {
      const path = e.payload.evidence[0]?.path;
      return path === undefined ? { text: e.payload.text } : { text: e.payload.text, path };
    }
    case "decision_draft":
      return { text: `Decision draft ${e.payload.number} is ready for your review` };
    case "decision_approach_selected":
      return { text: "You chose an approach" };
    case "card_expired":
      return { text: `The question was closed without an answer after ${e.payload.waitedS} s; it is listed as an open question` };
    case "statement_submitted":
      return { text: e.payload.changes.length ? e.payload.changes.join(" · ") : "Spoke without changing the proposals" };
    case "signals_collected":
      return { text: signalsText(e.payload) };
    case "meeting_summary":
      return { text: `Meeting summary: ${e.payload.proposals.length} proposals, ${e.payload.openQuestions.length} open questions` };
    case "repo_brief":
      return { text: e.payload.fromCache ? "Repo brief loaded from the cache (same commit)" : "Wrote the repo brief" };
    case "index_progress":
      return { text: e.payload.state === "started" ? `Background index started: ${e.payload.total} files` : e.payload.state === "finished" ? `Background index finished: ${e.payload.done} of ${e.payload.total} files` : e.payload.state === "paused" ? `Background index paused for the meeting at ${e.payload.done} of ${e.payload.total}` : `Background index stopped at ${e.payload.done} of ${e.payload.total} files` };
    case "reading_planned":
      return { text: `Planned to read ${e.payload.files.length} files${e.payload.byCode ? " (plan by code)" : ""}` };
    case "memo_written": {
      const where = e.payload.path === "" ? "the whole repository" : e.payload.path;
      const how = e.payload.mapOnly ? " (map only)" : e.payload.fromCache ? " (from the cache)" : "";
      return { text: `Summarized ${where}${how}`, ...(e.payload.path ? { path: e.payload.path } : {}) };
    }
    case "message_completed":
      return { text: e.payload.text };
    case "message_incomplete":
      return { text: `${e.payload.partialText} [incomplete: ${e.payload.reason}]`, failure: true };
    case "tool_started":
      return SUBMIT_PLAIN[e.payload.tool] ? { text: SUBMIT_PLAIN[e.payload.tool]! } : { text: `${e.payload.tool} ${e.payload.inputSummary}`.trim() };
    case "tool_finished":
      if (e.payload.ok) return null;
      return SUBMIT_PLAIN[e.payload.tool]
        ? { text: `The submission was not accepted (${e.payload.outputSummary.replace(/\s*Submit again\.?$/, "").replace(/^Not accepted:\s*/, "").replace(/\.$/, "")}); it is corrected and sent again`, failure: true }
        : { text: `${e.payload.tool} failed: ${e.payload.outputSummary}`, failure: true };
    case "judge_message":
      return { text: e.payload.status === "queued" && e.node !== "meeting" ? `${e.payload.text} (queued until the meeting starts)` : e.payload.text };
    case "card_opened":
      return { text: e.payload.title };
    case "card_answered":
      return { text: e.payload.text ?? `Answered ${e.payload.optionId ?? ""}`.trim() };
    case "decision_doc_frozen":
      return { text: `Decision_Doc v${e.payload.version} frozen` };
    case "decision_item_reviewed":
      return { text: `${e.payload.verdict === "accept" ? "Accepted" : "Rejected"} item ${e.payload.itemId}${e.payload.reason ? `: ${e.payload.reason}` : ""}` };
    case "browser_action":
      return { text: `${e.payload.action} ${e.payload.target}`.trim(), failure: !e.payload.ok };
    case "code_change":
      return { text: `Changed ${e.payload.changedFiles.length} files (attempt ${e.payload.attempt})` };
    case "review_verdict":
      return { text: `Review: ${e.payload.verdict.replace("_", " ")}` };
    case "question_opened":
      return { text: e.payload.text };
    case "question_answered":
      return { text: e.payload.answer };
    case "verifier_result":
      return { text: `Verifier ${e.payload.checkId}: ${e.payload.pass ? "pass" : "fail"}`, failure: !e.payload.pass };
    case "failure":
      return { text: `${e.payload.failureClass}: ${e.payload.detail}`, failure: true };
    case "terminal_reached":
      return { text: `Task ended: ${e.payload.terminal}` };
    default:
      return null;
  }
}

export function reduce(state: UiState, e: StudioEvent): UiState {
  if (e.seq <= state.lastSeq) return state;
  const actor = actorKey(e.actor);
  const s: UiState = {
    ...state,
    lastSeq: e.seq,
    lastEventByActor: { ...state.lastEventByActor, [actor]: { seq: e.seq, ts: e.ts, type: e.type } },
  };

  const entry = narrate(e);
  if (entry) {
    const ref = refOf(e);
    s.feed = [...state.feed, { seq: e.seq, ts: e.ts, actor, type: e.type, ...entry, ...(ref === undefined ? {} : { ref }) }];
  }

  if (e.type === "failure") {
    s.lastFailureByActor = { ...state.lastFailureByActor, [actor]: { seq: e.seq, ts: e.ts, detail: e.payload.detail } };
  } else {
    s.lastOtherByActor = { ...state.lastOtherByActor, [actor]: { seq: e.seq, ts: e.ts } };
  }

  switch (e.type) {
    case "task_created": {
      const { url, owner, repo, repoKind } = e.payload;
      s.taskId = e.taskId;
      s.repo = { url, owner, repo, repoKind };
      s.node = e.node;
      break;
    }
    case "node_entered":
      s.node = e.payload.to;
      s.previousNode = e.payload.from;
      if (!state.visitedNodes.includes(e.payload.to)) s.visitedNodes = [...state.visitedNodes, e.payload.to];
      break;
    case "message_started":
      s.messages = {
        ...state.messages,
        [e.payload.messageId]: { messageId: e.payload.messageId, actor, startedSeq: e.seq, startedTs: e.ts, purpose: e.payload.purpose, status: "open" },
      };
      break;
    case "message_progress": {
      // Progress counts only from the message's own actor, so no role can look active because of another's event (R2.1).
      const m = state.messages[e.payload.messageId];
      if (m && m.status === "open" && m.actor === actor)
        s.messages = { ...state.messages, [m.messageId]: { ...m, phase: e.payload.phase, lastProgressTs: e.ts } };
      break;
    }
    case "message_completed": {
      const m = state.messages[e.payload.messageId];
      if (m) {
        const done: MessageState = { ...m, status: "complete", text: e.payload.text };
        if (e.payload.reasoning !== undefined) done.reasoning = e.payload.reasoning;
        s.messages = { ...state.messages, [m.messageId]: done };
      }
      break;
    }
    case "message_incomplete": {
      const m = state.messages[e.payload.messageId];
      if (m)
        s.messages = {
          ...state.messages,
          [m.messageId]: { ...m, status: "incomplete", text: e.payload.partialText, reason: e.payload.reason },
        };
      break;
    }
    case "tool_started":
      s.openTools = { ...state.openTools, [e.payload.callId]: { actor, tool: e.payload.tool, ts: e.ts } };
      break;
    case "tool_finished": {
      const { [e.payload.callId]: _closed, ...rest } = state.openTools;
      s.openTools = rest;
      break;
    }
    case "file_read":
      s.lastFileReadByActor = { ...state.lastFileReadByActor, [actor]: { seq: e.seq, ts: e.ts, path: e.payload.path } };
      break;
    case "verifier_result":
      s.verifierResults = [...state.verifierResults, { seq: e.seq, ...e.payload }];
      break;
    case "browser_action":
      s.lastBrowserByActor = { ...state.lastBrowserByActor, [actor]: { seq: e.seq, ts: e.ts, what: `${e.payload.action} ${e.payload.target}`.trim() } };
      break;
    case "browser_observation":
      s.lastBrowserByActor = { ...state.lastBrowserByActor, [actor]: { seq: e.seq, ts: e.ts, what: "looking at the page" } };
      break;
    case "question_opened": {
      const from: ActorKey = e.payload.from;
      s.questions = {
        ...state.questions,
        [e.payload.questionId]: { questionId: e.payload.questionId, from, askedParty: e.payload.askedParty, ts: e.ts, answered: false },
      };
      break;
    }
    case "question_answered": {
      const q = state.questions[e.payload.questionId];
      if (q) s.questions = { ...state.questions, [q.questionId]: { ...q, answered: true } };
      break;
    }
    case "artifact_updated":
      s.artifacts = { ...state.artifacts, [e.payload.ref]: { kind: e.payload.artifactKind, title: e.payload.title, seq: e.seq } };
      break;
    case "card_opened":
      s.cards = {
        ...state.cards,
        [e.payload.cardId]: { cardId: e.payload.cardId, kind: e.payload.kind, title: e.payload.title, openedBy: actor, openedSeq: e.seq, answered: false, blocking: e.payload.blocking !== false },
      };
      break;
    case "card_answered": {
      const c = state.cards[e.payload.cardId];
      if (c) s.cards = { ...state.cards, [c.cardId]: { ...c, answered: true } };
      break;
    }
    case "signals_collected":
      s.signals = Object.fromEntries(e.payload.signals.map((x) => [x.roleId, { speak: x.speak, ...(x.kind ? { kind: x.kind } : {}), ...(x.intent ? { intent: x.intent } : {}), seq: e.seq }]));
      break;
    case "card_expired": {
      const c = state.cards[e.payload.cardId];
      if (c) s.cards = { ...state.cards, [c.cardId]: { ...c, expired: true } };
      break;
    }
    case "decision_doc_version":
      s.decisionDocs = [...state.decisionDocs, { version: e.payload.version, hash: e.payload.hash, frozen: false }];
      break;
    case "decision_doc_frozen":
      s.decisionDocs = state.decisionDocs.map((d) => (d.version === e.payload.version ? { ...d, frozen: true } : d));
      break;
    case "failure":
      s.failuresByClass = {
        ...state.failuresByClass,
        [e.payload.failureClass]: (state.failuresByClass[e.payload.failureClass] ?? 0) + 1,
      };
      break;
    case "terminal_reached":
      s.terminal = e.payload.terminal;
      s.node = e.payload.terminal;
      break;
    default:
      break;
  }
  return s;
}

export function foldEvents(events: Iterable<StudioEvent>, from: UiState = initialUiState): UiState {
  let s = from;
  for (const e of events) s = reduce(s, e);
  return s;
}
