// Header, Flow line (live app) and the composer (Interjection_Input) (R1.3, R5.1, R5.2, R6.1-R6.5, R7.1-R7.3, R36.8).
import { useState } from "react";
import { ROLE_IDS, type StudioEvent, type UiState } from "@graftlab/shared";
import type { QueueView } from "../api.ts";
import { ACTOR_LABEL } from "../roles.ts";
import { NODE_SHORT } from "./Guide.tsx";

export function TopBar({ state, connected, queue }: { state: UiState; connected: boolean; queue: QueueView | null }) {
  return (
    <header className="topbar">
      <span className="brand">
        <span className="brand-mark" aria-hidden="true">🧪</span> GraftLab <b>AI</b>
      </span>
      {state.repo && <span className="chip mono">{`${state.repo.owner}/${state.repo.repo}`}</span>}
      {state.repo?.repoKind === "other" && <span className="badge">Analysis only</span>}
      <span className="spacer" />
      <span className="muted small">
        {queue?.role === "operator" && "You are the operator"}
        {queue?.role === "queued" && `Queued: position ${queue.position}`}
        {queue?.role === "watching" && "Watching"}
      </span>
      <span className={`badge ${connected ? "green" : ""}`}>{connected ? "● LIVE" : "○ reconnecting"}</span>
    </header>
  );
}

/** A compact current-step line for the live app; progress is a number only when it comes from data (R7.1-R7.3). */
export function FlowLine({ state }: { state: UiState }) {
  const node = state.node;
  const filesRead = state.feed.filter((f) => f.type === "file_read").length;
  return (
    <div className="flowline" aria-live="polite">
      <span className="muted small">Current step</span>
      <strong>{node ? (NODE_SHORT[node] ?? node) : "Nothing running"}</strong>
      {node === "reading" && <span className="muted small">{filesRead} files read</span>}
      {node && node !== "reading" && !state.terminal && <span className="indeterminate" aria-hidden="true" />}
    </div>
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
      ? "Sending…"
      : sent.state === "failed"
        ? `Not sent: ${sent.error}`
        : delivered || (record?.type === "judge_message" && record.payload.status === "delivered")
          ? "Delivered to the team"
          : record?.type === "judge_message" && record.payload.status === "queued"
            ? record.node === "meeting"
              ? "Received. The team hears it before the next statement."
              : "Received. The team reads it when the meeting starts."
            : "Received";

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
    <div className="composer-wrap">
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="to">Send to</label>
        <select id="to" className="composer-to" value={to} onChange={(e) => setTo(e.target.value)} disabled={!canOperate}>
          <option value="all">Everyone</option>
          {ROLE_IDS.map((r) => (
            <option key={r} value={r}>
              {ACTOR_LABEL[r]?.name ?? r}
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
                ? "Tell the team something at any time…"
                : queue?.role === "queued"
                  ? `You are watching (queue position ${queue.position}).`
                  : "Join the queue to talk to the team."
          }
        />
        <button type="submit" className="composer-send" disabled={!canOperate || !text.trim()} aria-label="Send">
          ↑
        </button>
      </form>
      <span className={`composer-status${sent?.state === "failed" ? " failure-text" : ""}`} aria-live="polite">
        {statusText}
      </span>
    </div>
  );
}
