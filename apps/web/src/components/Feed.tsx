// Timeline (Activity_Feed, R3.1-R3.13) in a low-density layout (design.md, "UI design"): step changes are
// dividers, consecutive steps of the same kind by the same agent fold into one expandable line, messages are
// chat bubbles that stream with a caret and are replaced by the persisted Complete_Message, and reasoning is
// collapsed and labeled. Every row still maps to its events (Property 5 holds on the reducer's feed).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { stripIds, type FeedEntry, type MessageState, type StudioEvent, type UiState } from "@graftlab/shared";
import { EvidenceFold } from "./Evidence.tsx";
import { ACTOR_LABEL } from "../roles.ts";
import type { LiveBuffer } from "../useStudio.ts";
import { CardView, type AnswerFn } from "./Cards.tsx";
import { NODE_SHORT, STEPS, stepIndex } from "./Guide.tsx";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const who = (actor: string) => ACTOR_LABEL[actor] ?? { name: actor, avatar: "•" };

/** Entries of these kinds fold together when they follow each other with the same actor. */
type FoldKey = StudioEvent["type"] | "file_download" | "memo_map";
const FOLD: Partial<Record<FoldKey, { one: string; many: (n: number) => string }>> = {
  file_read: { one: "Read a file", many: (n) => `Read ${n} files` },
  // Studio code downloads files before any agent reads them (milestone 5); said plainly, not as an agent's reading.
  file_download: { one: "Downloaded a file", many: (n) => `Downloaded ${n} files` },
  finding_recorded: { one: "Noted a finding", many: (n) => `Noted ${n} findings` },
  memo_written: { one: "Summarized a file", many: (n) => `Summarized ${n} files` },
  // Tests, vendored and generated files get a code-built map entry, no LLM summary.
  memo_map: { one: "Listed a file from the map only", many: (n) => `Listed ${n} files from the map only` },
  browser_action: { one: "Did a step in the app", many: (n) => `Did ${n} steps in the app` },
  tool_started: { one: "Ran a step", many: (n) => `Ran ${n} steps` },
  decision_item_reviewed: { one: "Reviewed an item", many: (n) => `Reviewed ${n} items` },
  verifier_result: { one: "Ran a check", many: (n) => `Ran ${n} checks` },
};

/** Plain names for Studio tool steps shown in the timeline. */
const TOOL_PLAIN: Record<string, string> = {
  sandbox_start: "Started a private copy of the app",
  target_check: "Checked that the app starts",
  "start changed app": "Started the changed app",
};

type Row =
  | { kind: "divider"; key: string; label: string; ts: string }
  | { kind: "node"; key: string; label: string; ts: string }
  | { kind: "message"; key: string; entry: FeedEntry }
  | { kind: "card"; key: string; entry: FeedEntry }
  | { kind: "judge"; key: string; entry: FeedEntry }
  | { kind: "group"; key: string; actor: string; type: FoldKey; entries: FeedEntry[] }
  | { kind: "background"; key: string; entries: FeedEntry[] }
  | { kind: "statement"; key: string; entry: FeedEntry }
  | { kind: "line"; key: string; entry: FeedEntry };

function toRows(feed: FeedEntry[], events: StudioEvent[]): Row[] {
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  const rows: Row[] = [];
  let step = -1;
  // The background Repo_Index (Reader events after the reading step) is one row, so the meeting stays readable.
  let background: Extract<Row, { kind: "background" }> | null = null;
  for (let i = 0; i < feed.length; i++) {
    const entry = feed[i]!;
    const e = bySeq.get(entry.seq);
    const next = feed[i + 1];
    // A failed browser step is followed by its failure event: show it once, as the failure.
    if (entry.type === "browser_action" && entry.failure && next?.type === "failure" && next.actor === entry.actor) continue;
    if (entry.type === "card_answered" || entry.type === "task_created") continue;
    // Speaking signals are summed up in one line per round (signals_collected); their tool calls stay in Engineering_Details.
    if (e?.type === "tool_started" && e.payload.tool === "submit_signal") continue;
    if (entry.actor === "reader" && e && e.node !== "reading" && !entry.failure) {
      if (!background) {
        background = { kind: "background", key: `bg${entry.seq}`, entries: [] };
        rows.push(background);
      }
      background.entries.push(entry);
      continue;
    }
    if (entry.type === "node_entered" && e?.type === "node_entered") {
      const idx = stepIndex(e.payload.to);
      if (idx !== step && idx >= 0) {
        step = idx;
        rows.push({ kind: "divider", key: `d${entry.seq}`, label: STEPS[idx]!.label, ts: entry.ts });
      } else {
        rows.push({ kind: "node", key: `n${entry.seq}`, label: NODE_SHORT[e.payload.to] ?? e.payload.to, ts: entry.ts });
      }
      continue;
    }
    if (entry.type === "message_completed" || entry.type === "message_incomplete") {
      rows.push({ kind: "message", key: `m${entry.seq}`, entry });
      continue;
    }
    if (entry.type === "card_opened") {
      rows.push({ kind: "card", key: `c${entry.seq}`, entry });
      continue;
    }
    if (entry.type === "statement_submitted") {
      rows.push({ kind: "statement", key: `s${entry.seq}`, entry });
      continue;
    }
    if (entry.type === "judge_message") {
      rows.push({ kind: "judge", key: `j${entry.seq}`, entry });
      continue;
    }
    // Studio notes (plan, skipped parts) stay single lines; Studio file reads are downloads.
    const e2 = bySeq.get(entry.seq);
    const foldType: FoldKey = entry.type === "file_read" && entry.actor === "system" ? "file_download" : e2?.type === "memo_written" && e2.payload.mapOnly ? "memo_map" : entry.type;
    const fold = entry.type === "finding_recorded" && entry.actor === "system" ? undefined : FOLD[foldType];
    const last = rows.at(-1);
    if (fold && !entry.failure && last?.kind === "group" && last.actor === entry.actor && last.type === foldType) {
      last.entries.push(entry);
      continue;
    }
    if (fold && !entry.failure) {
      rows.push({ kind: "group", key: `g${entry.seq}`, actor: entry.actor, type: foldType, entries: [entry] });
      continue;
    }
    rows.push({ kind: "line", key: `l${entry.seq}`, entry });
  }
  return rows;
}

function Reasoning({ text, seconds, live }: { text: string | undefined; seconds: number; live: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text) return seconds > 0 ? <div className="thinking-chip">Thinking · {seconds} s</div> : null;
  return (
    <div className="reasoning">
      <button type="button" className="thinking-chip" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span> model-provided reasoning{live ? " · live" : ""} · {seconds} s
      </button>
      {open && <p className="reasoning-text">{text}</p>}
    </div>
  );
}

function MessageBubble({ m, live, events }: { m: MessageState; live?: LiveBuffer; events: StudioEvent[] }) {
  const w = who(m.actor);
  const endEvent = events.find((e) => (e.type === "message_completed" || e.type === "message_incomplete") && e.payload.messageId === m.messageId);
  const end = m.status === "open" ? Date.now() : Date.parse(endEvent?.ts ?? m.startedTs);
  const seconds = Math.max(0, Math.round((end - Date.parse(m.startedTs)) / 1000));
  // Statements are for the Judge: internal evidence ids are removed (R11.13).
  const raw = m.status === "open" ? (live?.text ?? "") : (m.text ?? "");
  const text = m.purpose === "statement" ? stripIds(raw).text : raw;
  const reasoning = m.status === "open" ? live?.reasoning : m.reasoning;
  // Speaking signals are shown as one line per round (signals_collected), not as messages.
  if (m.purpose === "signal") return null;
  // Summary calls answer only through a submit tool: no speech bubble, one compact line with the real timing.
  if (m.purpose === "memo" && !text) {
    return (
      <div className={`msg memo ${m.status}`} title={time(m.startedTs)}>
        <span className="msg-avatar" aria-hidden="true">{w.avatar}</span>
        <div className="msg-main">
          <div className="msg-head">
            <strong>{w.name}</strong>
            <span className="muted small">{m.status === "open" ? "is summarizing files" : "summarized files"}</span>
            {m.status === "open" && <span className="live-pill">● live</span>}
            {m.status === "incomplete" && <span className="fail-pill">incomplete: {m.reason}</span>}
          </div>
          <Reasoning text={reasoning} seconds={seconds} live={m.status === "open"} />
        </div>
      </div>
    );
  }
  return (
    <div className={`msg ${m.status}`} title={time(m.startedTs)}>
      <span className="msg-avatar" aria-hidden="true">{w.avatar}</span>
      <div className="msg-main">
        <div className="msg-head">
          <strong>{w.name}</strong>
          {m.status === "open" && <span className="live-pill">● live</span>}
          {m.status === "incomplete" && <span className="fail-pill">incomplete: {m.reason}</span>}
        </div>
        <Reasoning text={reasoning} seconds={reasoning || m.status !== "open" ? seconds : 0} live={m.status === "open"} />
        {(text || m.status !== "complete") && <div className="msg-bubble">
          {text ? (
            <p>
              {text}
              {m.status === "open" && <span className="caret" aria-hidden="true" />}
            </p>
          ) : m.status === "open" ? (
            <p className="msg-wait">
              <span className="typing" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>{" "}
              waiting for the first words
            </p>
          ) : null}
        </div>}
      </div>
    </div>
  );
}

/** What a statement changed on the Proposal_Board, in words written by code, and the quotes behind it. */
function StatementRow({ entry, event }: { entry: FeedEntry; event: StudioEvent | undefined }) {
  if (event?.type !== "statement_submitted") return null;
  const p = event.payload;
  if (p.changes.length === 0) return null;
  return (
    <div className="step board-change" title={time(entry.ts)}>
      <span className="step-avatar" aria-hidden="true">📋</span>
      <div className="step-main">
        <ul className="clean small changes">
          {p.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
        {p.evidence.length > 0 && <EvidenceFold evidence={p.evidence} />}
      </div>
    </div>
  );
}
function BackgroundRow({ row, events }: { row: Extract<Row, { kind: "background" }>; events: StudioEvent[] }) {
  const [open, setOpen] = useState(false);
  const w = who("reader");
  const seqs = new Set(row.entries.map((x) => x.seq));
  const mine = events.filter((e) => seqs.has(e.seq));
  const files = mine.filter((e) => e.type === "memo_written" && e.payload.level === "file").length;
  const folders = mine.filter((e) => e.type === "memo_written" && e.payload.level === "directory").length;
  const end = mine.findLast((e) => e.type === "index_progress" && e.payload.state !== "started");
  const state = end?.type === "index_progress" ? (end.payload.state === "finished" ? "finished" : "stopped") : "running";
  const lines = row.entries.filter((x) => x.type === "memo_written");
  return (
    <div className="step" title={time(row.entries[0]!.ts)}>
      <span className="step-avatar" aria-hidden="true">{w.avatar}</span>
      <div className="step-main">
        <button type="button" className="step-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={lines.length === 0}>
          <span className="step-who">{w.name}</span> Background index {state}: {files} files and {folders} folders summarized
          {lines.length > 0 && <span className="step-caret">{open ? "Hide" : "Show"}</span>}
        </button>
        {open && (
          <ul className="step-items">
            {lines.map((x) => (
              <li key={x.seq}>
                {x.text}
                {x.path && <span className="mono muted"> · {x.path}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
function GroupRow({ row }: { row: Extract<Row, { kind: "group" }> }) {
  const [open, setOpen] = useState(false);
  const w = who(row.actor);
  const fold = FOLD[row.type]!;
  const n = row.entries.length;
  const first = row.entries[0]!;
  const plain = row.type === "tool_started" ? TOOL_PLAIN[first.text.split(" ")[0] ?? ""] ?? TOOL_PLAIN[first.text] : undefined;
  const single = row.type === "file_download" ? first.text.replace(/^Read /, "Downloaded ") : first.text;
  const title = n === 1 ? (plain ?? single) : fold.many(n);
  return (
    <div className="step" title={time(first.ts)}>
      <span className="step-avatar" aria-hidden="true">{w.avatar}</span>
      <div className="step-main">
        <button type="button" className="step-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} disabled={n === 1 && !first.path}>
          <span className="step-who">{w.name}</span> {title}
          {(n > 1 || first.path) && <span className="step-caret">{open ? "Hide" : "Show"}</span>}
        </button>
        {open && (
          <ul className="step-items">
            {row.entries.map((x) => (
              <li key={x.seq}>
                {x.type === "file_read" ? <span className="mono">{x.path}</span> : x.text}
                {x.type !== "file_read" && x.path && <span className="mono muted"> · {x.path}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Plain names for Failure_Classes; the class itself stays visible as a small badge (R23.2). */
const FAILURE_PLAIN: Record<string, string> = {
  interface_call_failure: "a call failed",
  readback_mismatch: "the result did not match",
  llm_output_format_invalid: "the model answered in the wrong format",
  rejected_by_safety_rule: "blocked by a safety rule",
  budget_exceeded: "out of time or budget",
  blocked_unanswered_question: "a question was not answered",
};


function LineRow({ entry, event }: { entry: FeedEntry; event: StudioEvent | undefined }) {
  const w = who(entry.actor);
  const [open, setOpen] = useState(false);
  let text = entry.text;
  let badge: string | null = null;
  if (event?.type === "failure") {
    text = event.payload.detail.charAt(0).toUpperCase() + event.payload.detail.slice(1);
    // A step that does not exist yet in this version is not a failed call; say so plainly.
    const notBuilt = /is not built yet in this version/.test(event.payload.detail);
    badge = notBuilt ? "not built yet" : `${FAILURE_PLAIN[event.payload.failureClass] ?? ""} · ${event.payload.failureClass}`;
  }
  // Long notes (for example a skipped-files list) are cut at the first ":" or at 90 characters.
  const colon = text.indexOf(":");
  const cut = colon > 0 && colon < 90 ? colon : 90;
  const long = !entry.failure && text.length > 120;
  return (
    <div className={`step${entry.failure ? " step-fail" : ""}`} title={time(entry.ts)}>
      <span className="step-avatar" aria-hidden="true">{entry.failure ? "⚠" : w.avatar}</span>
      <div className="step-main">
        <span className="step-text">
          {entry.failure && <span className="sr-only">Failure: </span>}
          <span className="step-who">{w.name}</span> {long && !open ? `${text.slice(0, cut)}…` : text}
          {long && (
            <button type="button" className="step-toggle step-caret" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
              {open ? "Hide" : "Show"}
            </button>
          )}
          {entry.path && <span className="mono muted"> · {entry.path}</span>}
          {badge && <span className="badge red fail-class">{badge}</span>}
        </span>
      </div>
    </div>
  );
}

interface FeedProps {
  state: UiState;
  events: StudioEvent[];
  buffers: Record<string, LiveBuffer>;
  onAnswer: AnswerFn;
  cardExtra?: (cardId: string) => ReactNode;
  /** Extra content placed after the entries, for example the decision review. */
  inline?: ReactNode;
}

export function ActivityFeed({ state, events, buffers, onAnswer, cardExtra, inline }: FeedProps) {
  const end = useRef<HTMLDivElement>(null);
  const open = Object.values(state.messages)
    // Background index calls are counted in their one row; their live bubbles would drown the meeting.
    .filter((m) => m.status === "open" && !(m.purpose === "memo" && state.node !== "reading"))
    .sort((a, b) => a.startedSeq - b.startedSeq);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (follow) end.current?.scrollIntoView?.({ block: "end" });
  });
  const rows = toRows(state.feed, events);
  const bySeq = new Map(events.map((e) => [e.seq, e]));
  return (
    <section className="panel timeline" aria-label="Activity">
      <div
        className="timeline-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        }}
      >
        {rows.length === 0 && <p className="empty">Nothing yet. When a Task starts, every step of the team shows up here.</p>}
        {rows.map((r) => {
          switch (r.kind) {
            case "divider":
              return (
                <div key={r.key} className="divider" title={time(r.ts)}>
                  <span>{r.label}</span>
                </div>
              );
            case "node":
              return (
                <div key={r.key} className="node-line" title={time(r.ts)}>
                  {r.label}
                </div>
              );
            case "message": {
              const m = r.entry.ref ? state.messages[r.entry.ref] : undefined;
              return m ? <MessageBubble key={r.key} m={m} events={events} /> : <LineRow key={r.key} entry={r.entry} event={bySeq.get(r.entry.seq)} />;
            }
            case "card": {
              const opened = events.find((e) => e.seq === r.entry.seq);
              if (opened?.type !== "card_opened" || !r.entry.ref) return null;
              return <CardView key={r.key} event={opened} answered={state.cards[r.entry.ref]?.answered ?? false} expired={state.cards[r.entry.ref]?.expired ?? false} events={events} onAnswer={onAnswer} extra={cardExtra?.(r.entry.ref)} />;
            }
            case "judge":
              return (
                <div key={r.key} className="msg mine" title={time(r.entry.ts)}>
                  <div className="msg-main">
                    <div className="msg-bubble">
                      <p>{r.entry.text}</p>
                    </div>
                  </div>
                </div>
              );
            case "group":
              return <GroupRow key={r.key} row={r} />;
            case "statement":
              return <StatementRow key={r.key} entry={r.entry} event={bySeq.get(r.entry.seq)} />;
            case "background":
              return <BackgroundRow key={r.key} row={r} events={events} />;
            case "line":
              return <LineRow key={r.key} entry={r.entry} event={bySeq.get(r.entry.seq)} />;
          }
        })}
        {open.map((m) => (
          <MessageBubble key={m.messageId} m={m} live={buffers[m.messageId]} events={events} />
        ))}
        {inline}
        <div ref={end} />
      </div>
    </section>
  );
}
