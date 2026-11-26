// Replay player (design.md, "Replay_File", "Web app"; R1.5, R7.4, R7.5, R26.2-R26.4, R26.9, R27.2, R27.3, R27.8).
// The same Workspace components as Live, driven by the stored events up to the playhead; `now` is the playhead,
// so role status and timers match what was true at that moment. Nothing here can send a command.
import { useEffect, useMemo, useState } from "react";
import { foldEvents, type StudioEvent } from "@graftlab/shared";
import { ArtifactArea } from "../components/Artifacts.tsx";
import { DecisionReview } from "../components/DecisionReview.tsx";
import { ActivityFeed } from "../components/Feed.tsx";
import { FinalView } from "../components/FinalView.tsx";
import { NowBar, Stepper } from "../components/Guide.tsx";
import { PresenceColumn } from "../components/Presence.tsx";
import { deriveDecision } from "../liveDecision.ts";
import { demoNow, DemoSteps } from "../components/DemoSteps.tsx";
import { parsePlan, PlanStories } from "../components/Plan.tsx";

interface ReplayFile {
  header: { schemaVersion: number; taskId: string; repo: string; createdAt: string; label: string };
  events: StudioEvent[];
}
const SPEEDS = [1, 2, 4, 8, 16];
const TICK_MS = 100;
const GAP_MS = 30_000; // a longer stretch without events ...
const GAP_PLAY_MS = 3_000; // ... plays this long
/** Replay time to recorded time: idle gaps are compressed, everything else plays as recorded. */
interface Segment {
  replayStart: number;
  replayLen: number;
  realStart: number;
  realLen: number;
  skipped: boolean;
}
function timeMap(events: StudioEvent[]): { segments: Segment[]; duration: number } {
  const segments: Segment[] = [];
  let replay = 0;
  for (let i = 1; i < events.length; i++) {
    const a = Date.parse(events[i - 1]!.ts);
    const b = Date.parse(events[i]!.ts);
    const real = Math.max(0, b - a);
    const skipped = real > GAP_MS;
    const len = skipped ? GAP_PLAY_MS : real;
    segments.push({ replayStart: replay, replayLen: len, realStart: a, realLen: real, skipped });
    replay += len;
  }
  return { segments, duration: replay };
}
function toReal(map: { segments: Segment[] }, first: number, pos: number): { clock: number; skipping: Segment | null } {
  for (const s of map.segments) {
    if (pos <= s.replayStart + s.replayLen) {
      const f = s.replayLen === 0 ? 1 : (pos - s.replayStart) / s.replayLen;
      return { clock: s.realStart + f * s.realLen, skipping: s.skipped && f < 1 ? s : null };
    }
  }
  const last = map.segments.at(-1);
  return { clock: last ? last.realStart + last.realLen : first, skipping: null };
}
const fmt = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function ReplayApp({ taskId }: { taskId: string }) {
  const [file, setFile] = useState<ReplayFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState(0); // ms since the first event
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(4);
  useEffect(() => {
    fetch(`/replays/${encodeURIComponent(taskId)}.json`)
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "This Replay does not exist." : `The Replay could not be loaded (HTTP ${r.status}).`);
        const f = (await r.json()) as ReplayFile;
        if (f.header?.label !== "Replay" || !Array.isArray(f.events)) throw new Error("This file is not a Replay_File.");
        setFile(f);
      })
      .catch((e: unknown) => setError((e as Error).message));
  }, [taskId]);
  const start = file?.events[0] ? Date.parse(file.events[0].ts) : 0;
  const map = useMemo(() => timeMap(file?.events ?? []), [file]);
  const duration = map.duration;
  const recorded = file?.events.length ? Date.parse(file.events.at(-1)!.ts) - start : 0;
  useEffect(() => {
    if (!playing || !file) return;
    const t = setInterval(() => setPos((p) => Math.min(duration, p + TICK_MS * speed)), TICK_MS);
    return () => clearInterval(t);
  }, [playing, speed, file, duration]);
  useEffect(() => {
    if (pos >= duration && duration > 0) setPlaying(false);
  }, [pos, duration]);
  const { clock, skipping } = toReal(map, start, pos);
  const events = useMemo(() => (file ? file.events.filter((e) => Date.parse(e.ts) <= clock) : []), [file, clock]);
  const state = useMemo(() => foldEvents(events), [events]);
  const decision = useMemo(() => deriveDecision(events), [events]);
  if (error) return <div className="home"><h1>Replay</h1><p className="home-error">{error}</p><a href="/">Back to the Studio</a></div>;
  if (!file) return <div className="home"><h1>Replay</h1><p className="muted">Loading…</p></div>;
  const none = async () => ({ ok: false as const, error: "This is a Replay; nothing can be changed." });
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">🧪</span> GraftLab <b>AI</b>
        </span>
        <span className="chip mono">{file.header.repo}</span>
        {state.repo?.repoKind === "other" && (events.some((e) => e.type === "node_entered" && e.payload.to === "target_check") ? <span className="badge">No Adapter · tests only</span> : <span className="badge">Analysis only</span>)}
        <span className="spacer" />
        <span className="badge slate replay-badge">▶ Replay · recorded {new Date(file.header.createdAt).toLocaleString()}</span>
        <a className="btn" href="/">Back to the Studio</a>
      </header>
      <div className="replay-bar" role="group" aria-label="Replay controls">
        <span className="replay-label">REPLAY</span>
        <button type="button" onClick={() => (pos >= duration ? (setPos(0), setPlaying(true)) : setPlaying((p) => !p))}>{playing ? "❚❚ Pause" : pos >= duration ? "↺ Again" : "▶ Play"}</button>
        <label className="sr-only" htmlFor="replay-seek">Position</label>
        <input id="replay-seek" type="range" min={0} max={duration} step={1000} value={pos} onChange={(e) => setPos(Number(e.target.value))} />
        <span className="mono small" title={`recorded length ${fmt(recorded)}`}>
          {fmt(clock - start)} / {fmt(recorded)}
        </span>
        <label className="sr-only" htmlFor="replay-speed">Speed</label>
        <select id="replay-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
        <span className="muted small">
          {skipping ? <b>Skipping {Math.max(1, Math.round(skipping.realLen / 60_000))} min with no activity</b> : "Typing speed is simulated; idle stretches over 30 s are shortened; the order is as recorded."}
        </span>
      </div>
      <Stepper state={state} unavailable={events.some((e) => e.type === "evidence_summary" && e.payload.experienceUnavailable) ? ["try"] : []} />
      <NowBar state={state} yourTurn={null} detail={demoNow(state)} />
      <main className="workspace">
        <PresenceColumn state={state} now={clock} />
        <div className="center">
          <ActivityFeed
            state={state}
            events={events}
            buffers={{}}
            onAnswer={none}
            clock={clock}
            cardExtra={(cardId) => {
              const opened = events.find((e) => e.type === "card_opened" && e.payload.cardId === cardId);
              const plan = opened?.node === "plan_review" ? parsePlan(state.plan?.content) : null;
              if (plan) return <PlanStories plan={plan} />;
              return opened?.node === "story_checkpoint" ? <DemoSteps events={events} cardId={cardId} taskId={file.header.taskId} replay /> : null;
            }}
            inline={
              <>
                {decision.draft && (state.node === "awaiting_confirmation" || state.node === "deciding") ? (
                  <DecisionReview draft={decision.draft} verdicts={decision.verdicts} selected={decision.selected} history={decision.history} busy onSelect={() => {}} onReview={() => {}} onSendBack={() => {}} onFreeze={() => {}} />
                ) : null}
                <FinalView events={events} />
              </>
            }
          />
        </div>
        <ArtifactArea state={state} events={events} now={clock} replay />
      </main>
    </div>
  );
}

type ReplayEntry = { taskId: string; repo: string; terminal: string; createdAt: string };
const listOf = (url: string): Promise<ReplayEntry[]> =>
  fetch(url)
    .then((r) => (r.ok ? r.json() : []))
    .then((x: unknown) => (Array.isArray(x) ? (x as ReplayEntry[]) : []))
    .catch(() => []);
/** The Replays for the home page: the static ones (index.json) and the automatically published ones (R27.15). */
export function ReplayList() {
  const [list, setList] = useState<ReplayEntry[] | null>(null);
  useEffect(() => {
    void Promise.all([listOf("/replays/index.json"), listOf("/api/replays")]).then(([a, b]) => {
      const seen = new Set<string>();
      setList([...b, ...a].filter((r) => (seen.has(r.taskId) ? false : (seen.add(r.taskId), true))).sort((x, y) => y.createdAt.localeCompare(x.createdAt)));
    });
  }, []);
  if (!list || list.length === 0) return null;
  return (
    <div className="replay-list">
      <h3 className="small muted">Watch a recorded Task (Replay)</h3>
      <ul className="clean small">
        {list.slice(0, 6).map((r) => (
          <li key={r.taskId}>
            <a href={`/replay/${encodeURIComponent(r.taskId)}`}>▶ {r.repo}</a> <span className="muted">· {r.terminal.replace("_", " ")} · {new Date(r.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
