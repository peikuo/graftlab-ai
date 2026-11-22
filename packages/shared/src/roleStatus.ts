// Role_Status derivation (design.md, "Role_Status derivation"; R2.1-R2.10).
// Pure: the same state and `now` give the same status in Live and in Replay (where `now` is the playhead time).
// Rules are evaluated top to bottom; the first match wins. Working indicators appear only with a recent event.
import type { ActorKey, MessageState, UiState } from "./reducer.ts";

export const DEFAULT_RECENCY_WINDOW_MS = 15_000;

export type RoleStatusKind =
  | "blocked"
  | "waiting_for_answer"
  | "waiting_for_user"
  | "waiting_for_llm"
  | "thinking"
  | "speaking"
  | "waiting_for_tool"
  | "using_browser"
  | "reading"
  | "idle";

export interface RoleStatus {
  kind: RoleStatusKind;
  /** Plain status text; status is never shown by color alone (R8.4). */
  text: string;
  /** True only for reading, using the browser, speaking and thinking, each backed by an event inside the Recency_Window. */
  working: boolean;
  /** Seq of the event that backs the status, when there is one. */
  backedBySeq?: number;
}

const ms = (iso: string) => Date.parse(iso);
const secs = (fromIso: string, now: number) => Math.max(0, Math.floor((now - ms(fromIso)) / 1000));

function latestOpenMessage(state: UiState, actor: ActorKey): MessageState | undefined {
  let best: MessageState | undefined;
  for (const m of Object.values(state.messages)) {
    if (m.actor === actor && m.status === "open" && (!best || m.startedSeq > best.startedSeq)) best = m;
  }
  return best;
}

export function roleStatus(state: UiState, actor: ActorKey, now: number, recencyWindowMs = DEFAULT_RECENCY_WINDOW_MS): RoleStatus {
  const recent = (iso: string | undefined) => iso !== undefined && now - ms(iso) <= recencyWindowMs && ms(iso) <= now;

  // 1. Latest failure for the role is newer than its latest other event.
  const failure = state.lastFailureByActor[actor];
  const other = state.lastOtherByActor[actor];
  if (failure && (!other || failure.seq > other.seq)) {
    return { kind: "blocked", text: `blocked: ${failure.detail}`, working: false, backedBySeq: failure.seq };
  }

  // 2. An open question from the role.
  const question = Object.values(state.questions).find((q) => q.from === actor && !q.answered);
  if (question) {
    const party = question.askedParty === "judge" ? "you" : "Tech_Manager";
    return { kind: "waiting_for_answer", text: `waiting for answer from ${party}, ${secs(question.ts, now)} s`, working: false };
  }

  // 3. An open card opened by the role.
  const card = Object.values(state.cards).find((c) => c.openedBy === actor && !c.answered);
  if (card) return { kind: "waiting_for_user", text: "waiting for you", working: false };

  // 4-7. An open message.
  const m = latestOpenMessage(state, actor);
  if (m) {
    if (m.lastProgressTs === undefined) {
      return { kind: "waiting_for_llm", text: `waiting for LLM, ${secs(m.startedTs, now)} s`, working: false };
    }
    if (recent(m.lastProgressTs) && m.phase === "thinking") {
      return { kind: "thinking", text: "thinking", working: true, backedBySeq: m.startedSeq };
    }
    if (recent(m.lastProgressTs) && (m.phase === "speaking" || m.phase === "tool_call")) {
      return { kind: "speaking", text: "speaking", working: true, backedBySeq: m.startedSeq };
    }
    return { kind: "waiting_for_llm", text: `waiting for LLM, no output for ${secs(m.lastProgressTs, now)} s`, working: false };
  }

  // 8. An open tool call.
  const tool = Object.values(state.openTools).find((t) => t.actor === actor);
  if (tool) return { kind: "waiting_for_tool", text: `waiting for tool ${tool.tool}, ${secs(tool.ts, now)} s`, working: false };

  // 9. A recent browser action or observation (the Browser_Use operator duty).
  const browser = state.lastBrowserByActor[actor];
  if (browser && recent(browser.ts)) return { kind: "using_browser", text: `using the browser: ${browser.what}`, working: true, backedBySeq: browser.seq };

  // 10. A recent file read.
  const read = state.lastFileReadByActor[actor];
  if (read && recent(read.ts)) return { kind: "reading", text: `reading ${read.path}`, working: true, backedBySeq: read.seq };

  return { kind: "idle", text: "idle", working: false };
}
