// The composer (Interjection_Input) (R5.1, R5.2, R6.1-R6.5, R36.8).
import { useState } from "react";
import { ROLE_IDS, type StudioEvent, type UiState } from "@graftlab/shared";
import type { QueueView } from "../api.ts";
import { ACTOR_LABEL } from "../roles.ts";

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
