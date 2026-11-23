// Interaction_Cards (R5.3, R5.4, R5.6, R5.8, R6.5, R8.2): the most visible element while they wait. Options
// are large buttons plus free text, in feature words only (the content comes from the event); keyboard
// operable with visible focus; the answer state is shown on the card.
import { useState, type ReactNode } from "react";
import type { StudioEvent } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";

type CardEvent = Extract<StudioEvent, { type: "card_opened" }>;
export type AnswerFn = (cardId: string, answer: { optionId?: string; text?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

const HEAD: Record<string, string> = {
  question: "asks you",
  confirm: "needs your confirmation",
  checkpoint: "shows you the result",
  reminder: "reminds you",
  new_version: "needs a new decision",
};

export function CardView({ event, answered, expired = false, events, onAnswer, extra }: { event: CardEvent; answered: boolean; expired?: boolean; events: StudioEvent[]; onAnswer: AnswerFn; extra?: ReactNode }) {
  const p = event.payload;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "received" | "failed"; detail?: string }>({ kind: "idle" });
  const w = ACTOR_LABEL[event.actor.kind === "role" ? event.actor.roleId : event.actor.kind] ?? { name: "Studio", avatar: "⚙" };
  const answer = events.find((e) => e.type === "card_answered" && e.payload.cardId === p.cardId);

  const send = async (a: { optionId?: string; text?: string }) => {
    setStatus({ kind: "sending" });
    const r = await onAnswer(p.cardId, a);
    setStatus(r.ok ? { kind: "received" } : { kind: "failed", detail: r.error });
  };

  return (
    <div id={`card-${p.cardId}`} className={`icard kind-${p.kind}${answered ? " answered" : " pending"}`} role="group" aria-label={`${w.name} asks: ${p.title}`}>
      <div className="icard-head">
        <span className="icard-avatar" aria-hidden="true">{w.avatar}</span>
        <span>
          {w.name} {HEAD[p.kind] ?? "asks you"}
        </span>
        {!answered && !expired && <span className="badge amber">{p.blocking === false ? "Your turn · the team keeps talking" : "Your turn"}</span>}
        {expired && <span className="badge slate">closed</span>}
      </div>
      <p className="icard-title">{p.title}</p>
      {p.body && <p className="icard-body">{p.body}</p>}
      {extra}
      {expired ? (
        <p className="icard-body">{p.kind === "question" ? "Closed without an answer; it is listed as an open question." : "Closed without an answer: the Task ended first."}</p>
      ) : answered && answer?.type === "card_answered" ? (
        <p className="icard-answer">
          <span aria-hidden="true">✓</span> You answered: {p.options.find((o) => o.id === answer.payload.optionId)?.label ?? answer.payload.text}
        </p>
      ) : (
        <>
          <div className="icard-options">
            {p.options.map((o, i) => (
              <button key={o.id} type="button" className={i === 0 ? "btn primary" : "btn"} disabled={status.kind === "sending"} onClick={() => send({ optionId: o.id })}>
                {o.label}
              </button>
            ))}
          </div>
          {p.allowFreeText && (
            <form
              className="icard-free"
              onSubmit={(e) => {
                e.preventDefault();
                if (text.trim()) void send({ text: text.trim() });
              }}
            >
              <label className="sr-only" htmlFor={`free-${p.cardId}`}>Your own answer</label>
              <input id={`free-${p.cardId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or answer in your own words" />
              <button type="submit" className="btn" disabled={!text.trim() || status.kind === "sending"}>
                Send
              </button>
            </form>
          )}
          <p className="icard-status" aria-live="polite">
            {status.kind === "sending" && "Sending…"}
            {status.kind === "received" && "Received"}
            {status.kind === "failed" && <span className="failure-text">Not sent: {status.detail}</span>}
          </p>
        </>
      )}
    </div>
  );
}
