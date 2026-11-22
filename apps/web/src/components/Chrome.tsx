// Top bar, Flow_Graph line and the Interjection_Input (R1.3, R5.1, R5.2, R6.1-R6.5, R7.1-R7.3, R36.8).
import { useState } from "react";
import { ROLE_IDS, type StudioEvent, type UiState } from "@graftlab/shared";
import type { QueueView } from "../api.ts";
import { ACTOR_LABEL } from "../roles.ts";

const MAIN_FLOW = ["reading", "adapter_branch", "sandbox_start", "browser_experience", "meeting", "deciding", "awaiting_confirmation", "frozen", "planning", "documenting", "target_check"] as const;

export function TopBar({ state, connected, queue }: { state: UiState; connected: boolean; queue: QueueView | null }) {
  return (
    <header className="topbar">
      <span className="brand">🧪 GraftLab AI</span>
      <span className="repo mono">{state.repo ? `${state.repo.owner}/${state.repo.repo}` : "no Task"}</span>
      {state.repo?.repoKind === "other" && <span className="tag">Analysis only</span>}
      <span className="spacer" />
      <span className="queue">
        {queue?.role === "operator" && "you are the operator"}
        {queue?.role === "queued" && `queued: position ${queue.position}`}
        {queue?.role === "watching" && "watching"}
      </span>
      <span className={`live ${connected ? "on" : "off"}`}>{connected ? "● LIVE" : "○ reconnecting"}</span>
    </header>
  );
}

export function FlowLine({ state }: { state: UiState }) {
  const node = state.node;
  const idx = node ? MAIN_FLOW.indexOf(node as (typeof MAIN_FLOW)[number]) : -1;
  const filesRead = state.feed.filter((f) => f.type === "file_read").length;
  return (
    <nav className="flowline" aria-label="Flow">
      <ol>
        {MAIN_FLOW.map((n, i) => (
          <li key={n} className={n === node ? "current" : idx > i ? "done" : ""} aria-current={n === node ? "step" : undefined}>
            {idx > i ? "✓ " : n === node ? "▶ " : ""}
            {n}
          </li>
        ))}
        {node && idx < 0 && <li className="current" aria-current="step">▶ {node}</li>}
      </ol>
      <div className="progress" aria-live="polite">
        {/* A number only when it comes from data (R7.1-R7.3). */}
        {node === "reading" ? `${filesRead} files read` : node ? <span className="indeterminate">in progress: {node}</span> : "idle"}
      </div>
    </nav>
  );
}

export type SendFn = (to: string, text: string) => Promise<{ ok: true; clientMsgId: string } | { ok: false; error: string }>;

export function InterjectionInput({ state, events, queue, onSend }: { state: UiState; events: StudioEvent[]; queue: QueueView | null; onSend: SendFn }) {
  const [to, setTo] = useState<string>("all");
  const [text, setText] = useState("");
  const [sent, setSent] = useState<{ id?: string; state: "sending" | "received" | "failed"; error?: string } | null>(null);
  const canOperate = queue?.role === "operator" && !!state.taskId && !state.terminal;

  const record = sent?.id ? events.find((e) => e.type === "judge_message" && e.payload.clientMsgId === sent.id) : undefined;
  const delivered = sent?.id ? events.some((e) => e.type === "judge_message_delivered" && e.payload.clientMsgIds.includes(sent.id!)) : false;
  const statusText = !sent
    ? ""
    : sent.state === "sending"
      ? "sending…"
      : sent.state === "failed"
        ? `not sent: ${sent.error}`
        : delivered || (record?.type === "judge_message" && record.payload.status === "delivered")
          ? "delivered"
          : record?.type === "judge_message" && record.payload.status === "queued"
            ? "received, delivered when the team can take it"
            : "received";

  const submit = async () => {
    if (!state.taskId || !text.trim()) return;
    setSent({ state: "sending" });
    const r = await onSend(to, text.trim());
    if (r.ok) {
      setSent({ id: r.clientMsgId, state: "received" });
      setText("");
    } else setSent({ state: "failed", error: r.error });
  };

  return (
    <form
      className="interject"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="sr-only" htmlFor="to">Addressee</label>
      <select id="to" value={to} onChange={(e) => setTo(e.target.value)} disabled={!canOperate}>
        <option value="all">To: everyone</option>
        {ROLE_IDS.map((r) => (
          <option key={r} value={r}>
            To: {ACTOR_LABEL[r]?.name ?? r}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="msg">Message to the team</label>
      <input
        id="msg"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={!canOperate}
        placeholder={
          state.terminal
            ? "The Task has ended."
            : canOperate
              ? "Message the team at any time…"
              : queue?.role === "queued"
                ? `You are watching (queue position ${queue.position}).`
                : "Join the queue to talk to the team."
        }
      />
      <button type="submit" disabled={!canOperate || !text.trim()}>Send</button>
      <span className={`send-status${sent?.state === "failed" ? " failure-text" : ""}`} aria-live="polite">{statusText}</span>
    </form>
  );
}
