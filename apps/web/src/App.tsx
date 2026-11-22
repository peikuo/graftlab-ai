// Live Studio (design.md, "Web app", "UI design"): the home page until a Task exists, then the Workspace driven
// by the live event stream. The same components as the demo; nothing here is mock data.
import { useCallback, useEffect, useMemo, useState } from "react";
import { EXPECTED_FORM, parseRepoUrl, type StudioEvent } from "@graftlab/shared";
import { api } from "./api.ts";
import { ArtifactArea } from "./components/Artifacts.tsx";
import type { AnswerFn } from "./components/Cards.tsx";
import { InterjectionInput, type SendFn } from "./components/Chrome.tsx";
import { ActivityFeed } from "./components/Feed.tsx";
import { NowBar, Stepper } from "./components/Guide.tsx";
import { PresenceColumn } from "./components/Presence.tsx";
import { useStudio } from "./useStudio.ts";

function Home({ onCreated, status }: { onCreated: () => void; status: Awaited<ReturnType<typeof api.status>> }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parsed = url.trim() ? parseRepoUrl(url) : null;

  const submit = async () => {
    const p = parseRepoUrl(url);
    if (!p.ok) return setError(p.error);
    setBusy(true);
    setError(null);
    const joined = await api.join();
    if (!joined.ok || joined.data.role !== "operator") {
      setBusy(false);
      return setError(joined.ok ? `Someone else is using the Studio. You are in the queue (position ${joined.data.position ?? "?"}).` : joined.error);
    }
    const r = await api.createTask(p.normalized);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onCreated();
  };

  return (
    <div className="home">
      <h1>
        GraftLab <span className="accent">AI</span>
      </h1>
      <p className="home-sub">Paste a GitHub repository. Decide together with an AI team how to make it AI-powered.</p>
      <form
        className="home-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="url">GitHub repository URL</label>
        <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={EXPECTED_FORM} autoFocus />
        <button type="submit" disabled={busy || !url.trim()}>{busy ? "Starting…" : "Start"}</button>
      </form>
      <p className={`home-check ${error ? "home-error" : parsed?.ok ? "ok" : "bad"}`} aria-live="polite">
        {error ?? (parsed ? (parsed.ok ? `✓ ${parsed.owner}/${parsed.repo}` : parsed.error) : `Any public repository, for example https://github.com/sissbruecker/linkding`)}
      </p>
      {status && !status.liveExecution && (
        <p className="home-note">Live execution is not available on this server ({status.reason}). Reading and the meeting still work; building and checking need it.</p>
      )}
      <ol className="home-steps">
        <li>
          <span className="step-icon" aria-hidden="true">🔍</span>
          <strong>Read and try</strong>
          Agents read the code and, for supported software, use the app like a new user.
        </li>
        <li>
          <span className="step-icon" aria-hidden="true">💬</span>
          <strong>Meet and decide</strong>
          Three viewpoints discuss ideas and ask you. You accept the decision item by item.
        </li>
        <li>
          <span className="step-icon" aria-hidden="true">✅</span>
          <strong>Build and check</strong>
          An agent builds it in a private copy. A checker (code, no AI) decides if it works.
        </li>
      </ol>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.status>>>(null);
  const live = useStudio(ready);
  const { state, events } = live;
  const taskId = state.taskId;

  useEffect(() => {
    void api.session().then(() => setReady(true));
    void api.status().then(setStatus);
    const t = setInterval(() => void api.heartbeat(), 30_000);
    const leave = () => {
      void fetch("/api/queue/leave", { method: "POST", keepalive: true, credentials: "same-origin" });
    };
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  const answer: AnswerFn = async (cardId, a) => {
    if (!taskId) return { ok: false, error: "no Task" };
    const r = await api.answer(taskId, cardId, a);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  };
  const send: SendFn = async (to, text) => {
    if (!taskId) return { ok: false, error: "no Task" };
    const r = await api.message(taskId, to, text);
    return r.ok ? { ok: true, clientMsgId: r.data.clientMsgId } : { ok: false, error: r.error };
  };
  const loadFile = useCallback((path: string) => (taskId ? api.fileText(taskId, path) : Promise.resolve(null)), [taskId]);

  const openCard = useMemo(() => Object.values(state.cards).find((c) => !c.answered), [state]);
  // Progress from data only (R7.1): files read out of the planned count announced by the Repo_Reader.
  const planned = useMemo(() => {
    for (const e of events) if (e.type === "finding_recorded" && e.payload.kind === "note") {
      const m = /^Reading (\d+) files/.exec(e.payload.text);
      if (m) return Number(m[1]);
    }
    return null;
  }, [events]);
  const filesRead = state.feed.filter((f) => f.type === "file_read").length;
  const [home, setHome] = useState(true);

  if (!taskId || (home && state.terminal)) return <Home status={status} onCreated={() => setHome(false)} />;

  const isOperator = live.queue?.role === "operator";
  const detail = state.node === "reading" ? readingPhase(events, filesRead, planned) : null;
  const gathering = state.node === "sandbox_start" || state.node === "browser_experience";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">🧪</span> GraftLab <b>AI</b>
        </span>
        {state.repo && <span className="chip mono">{`${state.repo.owner}/${state.repo.repo}`}</span>}
        {state.repo?.repoKind === "other" && <span className="badge">Analysis only</span>}
        <span className="spacer" />
        <span className="muted small">
          {live.queue?.role === "operator" && "You are the operator"}
          {live.queue?.role === "queued" && `Watching · queue position ${live.queue.position}`}
          {live.queue?.role === "watching" && "Watching"}
        </span>
        <span className={`badge ${live.connected ? "green" : ""}`}>{live.connected ? "● LIVE" : "○ reconnecting"}</span>
        {isOperator && !state.terminal && (
          <button type="button" className="stop-btn" onClick={() => taskId && void api.abort(taskId)}>
            Stop the Task
          </button>
        )}
        {state.terminal && (
          <button type="button" onClick={() => setHome(true)}>
            New Task
          </button>
        )}
      </header>
      <Stepper state={state} />
      <NowBar state={state} yourTurn={openCard ? openCard.title : null} detail={detail} onGo={() => openCard && document.getElementById(`card-${openCard.cardId}`)?.scrollIntoView({ behavior: "smooth", block: "center" })} />
      {live.error && <div className="banner failure-text" role="alert">{live.error}</div>}
      {gathering && isOperator && (
        <div className="gather-bar">
          <span>The team is still trying the app. You can skip this and start the meeting with what they have so far.</span>
          <button type="button" onClick={() => taskId && void api.endGathering(taskId)}>Start the meeting now</button>
        </div>
      )}
      <main className="workspace">
        <PresenceColumn state={state} now={live.now} />
        <div className="center">
          <ActivityFeed state={state} events={events} buffers={live.buffers} onAnswer={answer} />
          <InterjectionInput state={state} events={events} queue={live.queue} onSend={send} />
        </div>
        <ArtifactArea state={state} events={events} loadFile={loadFile} />
      </main>
    </div>
  );
}

/** What the reading step is doing right now, from events only (R10.2, R10.8). */
function readingPhase(events: StudioEvent[], filesRead: number, planned: number | null): string | null {
  const plan = events.findLast((e) => e.type === "reading_planned");
  if (plan?.type === "reading_planned") {
    const wanted = new Set(plan.payload.files.map((f) => f.path));
    const done = new Set(events.flatMap((e) => (e.type === "memo_written" && e.payload.level === "file" && wanted.has(e.payload.path) ? [e.payload.path] : [])));
    return done.size < wanted.size ? `The Reader is summarizing the planned files: ${done.size} of ${wanted.size}` : "The Reader is writing the repo brief";
  }
  if (planned !== null && filesRead < planned) return `Downloading files: ${filesRead} of ${planned}`;
  if (planned !== null) return "The Reader is choosing what to read";
  return null;
}
