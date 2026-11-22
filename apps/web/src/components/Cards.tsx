// Interaction_Cards (R5.3, R5.4, R5.6, R5.8, R6.5, R8.2): options plus free text, feature words only (the card
// content comes from the event); keyboard operable with visible focus. The answer state is shown next to the card.
import { useState, type ReactNode } from "react";
import type { StudioEvent } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";

type CardEvent = Extract<StudioEvent, { type: "card_opened" }>;
export type AnswerFn = (cardId: string, answer: { optionId?: string; text?: string }) => Promise<{ ok: true } | { ok: false; error: string }>;

export function CardView({ event, answered, events, onAnswer, extra }: { event: CardEvent; answered: boolean; events: StudioEvent[]; onAnswer: AnswerFn; extra?: ReactNode }) {
  const p = event.payload;
  const [text, setText] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "sending" | "received" | "failed"; detail?: string }>({ kind: "idle" });
  const who = ACTOR_LABEL[event.actor.kind === "role" ? event.actor.roleId : event.actor.kind] ?? { name: "Studio", avatar: "⚙" };
  const answer = events.find((e) => e.type === "card_answered" && e.payload.cardId === p.cardId);

  const send = async (a: { optionId?: string; text?: string }) => {
    setStatus({ kind: "sending" });
    const r = await onAnswer(p.cardId, a);
    setStatus(r.ok ? { kind: "received" } : { kind: "failed", detail: r.error });
  };

  return (
    <div id={`card-${p.cardId}`} className={`icard kind-${p.kind}${answered ? " answered" : " pending"}`} role="group" aria-label={`${who.name} asks: ${p.title}`}>
      <div className="icard-head">
        <span aria-hidden="true">{who.avatar}</span> {who.name} {p.kind === "question" ? "asks you" : p.kind === "checkpoint" ? "shows you the result" : "needs your confirmation"}
        {!answered && <span className="your-turn">your turn</span>}
      </div>
      <p className="icard-title">{p.title}</p>
      {p.body && <p className="icard-body">{p.body}</p>}
      {extra}
      {answered && answer?.type === "card_answered" ? (
        <p className="icard-answer">
          Answered: {p.options.find((o) => o.id === answer.payload.optionId)?.label ?? answer.payload.text}
        </p>
      ) : (
        <>
          <div className="icard-options">
            {p.options.map((o) => (
              <button key={o.id} type="button" disabled={status.kind === "sending"} onClick={() => send({ optionId: o.id })}>
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
              <input id={`free-${p.cardId}`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Or type your own answer…" />
              <button type="submit" disabled={!text.trim() || status.kind === "sending"}>Send</button>
            </form>
          )}
          <p className="icard-status" aria-live="polite">
            {status.kind === "sending" && "sending…"}
            {status.kind === "received" && "received"}
            {status.kind === "failed" && <span className="failure-text">not sent: {status.detail}</span>}
          </p>
        </>
      )}
    </div>
  );
}
