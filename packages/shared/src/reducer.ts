// UI reducer (design.md, "packages/shared", "Web app"; R26.7, R27.3, R27.14, R36.8).
// The UI state is a pure function of the event list. Live, reconnect and Replay all fold through reduce(),
// which ignores events at or below the last applied seq, so duplicates and resends are harmless.
// roleStatus() (R2) is added with the Workspace milestone; this state keeps the facts it needs.
import type { Actor, FailureClass, RoleId, StudioEvent } from "./events.ts";
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
  questions: Record<string, { questionId: string; from: ActorKey; askedParty: "reviewer" | "judge"; ts: string; answered: boolean }>;
  /** Latest failure and latest other event per actor, for the "blocked" Role_Status rule. */
  lastFailureByActor: Partial<Record<ActorKey, { seq: number; ts: string; detail: string }>>;
  lastOtherByActor: Partial<Record<ActorKey, { seq: number; ts: string }>>;
  lastFileReadByActor: Partial<Record<ActorKey, { seq: number; ts: string; path: string }>>;
  lastBrowserByActor: Partial<Record<ActorKey, { seq: number; ts: string; what: string }>>;
  verifierResults: { seq: number; storyId: string; checkId: string; pass: boolean; items: { item: string; pass: boolean; expected: string; actual: string }[] }[];
  /** Flow nodes entered so far, in first-entry order (for showing elements once their step has started). */
  visitedNodes: NodeId[];
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
  questions: {},
  lastFailureByActor: {},
  lastOtherByActor: {},
  lastFileReadByActor: {},
  lastBrowserByActor: {},
  verifierResults: [],
  visitedNodes: [],
};

/** Event types that always produce exactly one Activity_Feed entry (Property 5). */
export const ALWAYS_NARRATED: ReadonlySet<StudioEvent["type"]> = new Set([
  "task_created", "node_entered", "transition_rejected", "file_read", "finding_recorded", "message_completed",
  "message_incomplete", "tool_started", "judge_message", "card_opened", "card_answered", "decision_doc_frozen",
  "decision_item_reviewed", "browser_action", "code_change", "review_verdict", "question_opened", "question_answered",
  "verifier_result", "failure", "terminal_reached",
]);

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
    case "message_completed":
      return { text: e.payload.text };
    case "message_incomplete":
      return { text: `${e.payload.partialText} [incomplete: ${e.payload.reason}]`, failure: true };
    case "tool_started":
      return { text: `${e.payload.tool} ${e.payload.inputSummary}`.trim() };
    case "tool_finished":
      return e.payload.ok ? null : { text: `${e.payload.tool} failed: ${e.payload.outputSummary}`, failure: true };
    case "judge_message":
      return { text: e.payload.status === "queued" ? `${e.payload.text} (queued until the meeting starts)` : e.payload.text };
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
      if (!state.visitedNodes.includes(e.payload.to)) s.visitedNodes = [...state.visitedNodes, e.payload.to];
      break;
    case "message_started":
      s.messages = {
        ...state.messages,
        [e.payload.messageId]: { messageId: e.payload.messageId, actor, startedSeq: e.seq, startedTs: e.ts, status: "open" },
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
        [e.payload.cardId]: { cardId: e.payload.cardId, kind: e.payload.kind, title: e.payload.title, openedBy: actor, openedSeq: e.seq, answered: false },
      };
      break;
    case "card_answered": {
      const c = state.cards[e.payload.cardId];
      if (c) s.cards = { ...state.cards, [c.cardId]: { ...c, answered: true } };
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
