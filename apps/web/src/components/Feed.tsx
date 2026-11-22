// Activity_Feed (R3.1-R3.13): one entry per narrated event with role, time and source path; messages stream
// with a "live" marker and are replaced by the persisted Complete_Message; reasoning is collapsible and labeled.
// Interaction_Cards appear inline where the work happens (design.md, "UI design").
import { useEffect, useRef, useState } from "react";
import type { FeedEntry, MessageState, StudioEvent, UiState } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";
import type { LiveBuffer } from "../useStudio.ts";
import { CardView } from "./Cards.tsx";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

function Reasoning({ text, seconds, live }: { text: string | undefined; seconds: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return seconds > 0 ? <div className="reasoning-none">thinking, {seconds} s</div> : null;
  return (
    <div className="reasoning">
      <button type="button" className="reasoning-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? "▾" : "▸"} model-provided reasoning{live ? " · live" : ""} · {seconds} s
      </button>
      {open && <p className="reasoning-text">{text}</p>}
    </div>
  );
}

function MessageBubble({ m, live, events }: { m: MessageState; live?: LiveBuffer; events: StudioEvent[] }) {
  const who = ACTOR_LABEL[m.actor] ?? { name: m.actor, avatar: "•" };
  const end = m.status === "open" ? Date.now() : Date.parse(events.find((e) => (e.type === "message_completed" || e.type === "message_incomplete") && e.payload.messageId === m.messageId)?.ts ?? m.startedTs);
  const seconds = Math.max(0, Math.round((end - Date.parse(m.startedTs)) / 1000));
  const text = m.status === "open" ? live?.text ?? "" : m.text ?? "";
  const reasoning = m.status === "open" ? live?.reasoning : m.reasoning;
  return (
    <div className={`bubble ${m.status}`}>
      <div className="bubble-head">
        <span aria-hidden="true">{who.avatar}</span> <strong>{who.name}</strong>
        {m.status === "open" && <span className="live-mark">● live</span>}
        {m.status === "incomplete" && <span className="incomplete-mark">incomplete: {m.reason}</span>}
      </div>
      <Reasoning text={reasoning} seconds={reasoning || m.status !== "open" ? seconds : 0} live={m.status === "open"} />
      {text ? (
        <p className="bubble-text">
          {text}
          {m.status === "open" && <span className="caret" aria-hidden="true">▍</span>}
        </p>
      ) : m.status === "open" ? (
        <p className="bubble-wait">waiting for the first words…</p>
      ) : null}
    </div>
  );
}

function Entry({ entry, state, events, taskId }: { entry: FeedEntry; state: UiState; events: StudioEvent[]; taskId: string | undefined }) {
  if ((entry.type === "message_completed" || entry.type === "message_incomplete") && entry.ref) {
    const m = state.messages[entry.ref];
    if (m) return <MessageBubble m={m} events={events} />;
  }
  if (entry.type === "card_opened" && entry.ref) {
    const opened = events.find((e) => e.seq === entry.seq);
    if (opened?.type === "card_opened") return <CardView event={opened} answered={state.cards[entry.ref]?.answered ?? false} taskId={taskId} events={events} />;
  }
  if (entry.type === "card_answered" || entry.type === "message_completed") return null;
  const who = ACTOR_LABEL[entry.actor] ?? { name: entry.actor, avatar: "•" };
  return (
    <div className={`entry${entry.failure ? " failure" : ""}${entry.type === "judge_message" ? " judge" : ""}`}>
      <time className="ts" dateTime={entry.ts}>{time(entry.ts)}</time>
      <span className="who" aria-hidden="true">{who.avatar}</span>
      <span className="what">
        {entry.failure && <span className="sr-only">Failure: </span>}
        {entry.failure ? "✗ " : ""}
        <span className="actor">{who.name}</span> {entry.text}
        {entry.path && entry.type !== "file_read" && <span className="path mono"> · {entry.path}</span>}
      </span>
    </div>
  );
}

export function ActivityFeed({ state, events, buffers }: { state: UiState; events: StudioEvent[]; buffers: Record<string, LiveBuffer> }) {
  const end = useRef<HTMLDivElement>(null);
  const open = Object.values(state.messages).filter((m) => m.status === "open").sort((a, b) => a.startedSeq - b.startedSeq);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView?.({ block: "end" });
  });
  return (
    <section className="feed" aria-label="Activity">
      <h2 className="area-title">Activity</h2>
      <div className="feed-scroll" onScroll={(e) => {
        const el = e.currentTarget;
        setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
      }}>
        {state.feed.length === 0 && <p className="empty">No Task yet. Paste a repository on the home page, or play a fixture in development.</p>}
        {state.feed.map((entry) => (
          <Entry key={entry.seq} entry={entry} state={state} events={events} taskId={state.taskId} />
        ))}
        {open.map((m) => (
          <MessageBubble key={m.messageId} m={m} live={buffers[m.messageId]} events={events} />
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}
