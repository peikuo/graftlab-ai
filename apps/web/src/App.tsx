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
import { DecisionReview } from "./components/DecisionReview.tsx";
import { deriveDecision } from "./liveDecision.ts";
import { PresenceColumn } from "./components/Presence.tsx";
import { useStudio } from "./useStudio.ts";
import { parsePlan, PlanStories } from "./components/Plan.tsx";
import { FinalView } from "./components/FinalView.tsx";
import { ReplayList } from "./replay/ReplayApp.tsx";
import { BackendBanner, useBackendDown } from "./backend.tsx";
import { demoNow, DemoSteps } from "./components/DemoSteps.tsx";

function Home({ onCreated, status, down }: { onCreated: () => void; status: Awaited<ReturnType<typeof api.status>>; down: number | null }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const parsed = url.trim() ? parseRepoUrl(url) : null;
  // R28.7: watching is free; operating on the public site needs an access code.
  const needsCode = !!status?.access?.required && !status.access.unlocked && !unlocked;

  const submit = async () => {
    const p = parseRepoUrl(url);
    if (!p.ok) return setError(p.error);
    if (needsCode && !code.trim()) return setError("Enter your access code to start a Task. Without one you can watch the current Task and the Replays.");
    setBusy(true);
    setError(null);
    if (needsCode) {
      const a = await api.access(code.trim());
      if (!a.ok) {
        setBusy(false);
        return setError(a.error);
      }
      setUnlocked(true);
    }
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
      <BackendBanner seconds={down} />
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
        {needsCode && (
          <>
            <label className="sr-only" htmlFor="access-code">Access code</label>
            <input id="access-code" className="home-code" type="password" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Access code" />
          </>
        )}
        <button type="submit" disabled={busy || !url.trim()}>{busy ? "Starting…" : "Start"}</button>
      </form>
      <p className={`home-check ${error ? "home-error" : parsed?.ok ? "ok" : "bad"}`} aria-live="polite">
        {error ?? (parsed ? (parsed.ok ? `✓ ${parsed.owner}/${parsed.repo}` : parsed.error) : `Any public repository, for example https://github.com/sissbruecker/linkding`)}
      </p>
      {needsCode && <p className="home-note">Starting a Task needs an access code (the Judges' codes are in the submission's testing instructions). Watching the current Task and the Replays below needs none.</p>}
      {status && !status.liveExecution && (
        <p className="home-note">Live execution is not available on this server ({status.reason}). Reading and the meeting still work; building and checking need it.</p>
      )}
      <ReplayList />
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
  const down = useBackendDown(live.connected, live.now);
  const taskId = state.taskId;

  useEffect(() => {
    // The session and status are fetched again until they succeed, so a backend that comes back is picked up.
    let stop = false;
    const start = async () => {
      const r = await api.session();
      setReady(true);
      setStatus(await api.status());
      if (!r.ok && !stop) setTimeout(() => void start(), 5000);
    };
    void start();
    const t = setInterval(() => void api.heartbeat(), 30_000);
    const leave = () => {
      void fetch("/api/queue/leave", { method: "POST", keepalive: true, credentials: "same-origin" });
    };
    window.addEventListener("pagehide", leave);
    return () => {
      stop = true;
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

  const openCard = useMemo(() => Object.values(state.cards).find((c) => !c.answered && !c.expired), [state]);
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
  const decision = useMemo(() => deriveDecision(events), [events]);
  const [deciding, setDeciding] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  if (!taskId || (home && state.terminal)) return <Home status={status} down={down} onCreated={() => setHome(false)} />;

  const isOperator = live.queue?.role === "operator";
  const reviewing = state.node === "awaiting_confirmation" && !!decision.draft;
  const act = async (action: "review" | "select" | "send-back" | "freeze" | "end", body: Record<string, string>) => {
    if (!taskId || !decision.draft) return;
    setDeciding(true);
    setDecisionError(null);
    const r = await api.decision(taskId, action, { draftId: decision.draft.draftId, ...body });
    setDeciding(false);
    if (!r.ok) setDecisionError(r.error);
  };
  const detail = state.node === "reading" ? readingPhase(events, filesRead, planned) : demoNow(state);
  const gathering = state.node === "sandbox_start" || state.node === "browser_experience";

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">🧪</span> GraftLab <b>AI</b>
        </span>
        {state.repo && <span className="chip mono">{`${state.repo.owner}/${state.repo.repo}`}</span>}
        {state.repo?.repoKind === "other" && (events.some((e) => e.type === "node_entered" && e.payload.to === "target_check") ? <span className="badge">No Adapter · tests only</span> : <span className="badge">Analysis only</span>)}
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
      <Stepper state={state} unavailable={events.some((e) => e.type === "evidence_summary" && e.payload.experienceUnavailable) ? ["try"] : []} />
      <NowBar
        state={state}
        yourTurn={openCard ? openCard.title : reviewing ? "The decision draft is ready: accept or reject each item, then freeze it." : null}
        detail={detail}
        onGo={() => document.getElementById(openCard ? `card-${openCard.cardId}` : "decision-review")?.scrollIntoView({ behavior: "smooth", block: "center" })}
      />
      <BackendBanner seconds={down} />
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
          <ActivityFeed
            state={state}
            events={events}
            buffers={live.buffers}
            onAnswer={answer}
            cardExtra={(cardId) => {
              // The plan review card (R19.11) shows the stories in feature words.
              const opened = events.find((e) => e.type === "card_opened" && e.payload.cardId === cardId);
              const plan = opened?.node === "plan_review" ? parsePlan(state.plan?.content) : null;
              if (plan) return <PlanStories plan={plan} />;
              // R21.11: the confirmation point shows the Verifier's browser-check steps with their screenshots.
              return opened?.node === "story_checkpoint" && taskId ? <DemoSteps events={events} cardId={cardId} taskId={taskId} /> : null;
            }}
            inline={
              state.terminal ? (
                <FinalView events={events} {...(taskId ? { replayHref: `/replay/${encodeURIComponent(taskId)}` } : {})} />
              ) : decision.draft && (reviewing || state.node === "deciding") ? (
                <DecisionReview
                  draft={decision.draft}
                  verdicts={decision.verdicts}
                  selected={decision.selected}
                  history={decision.history}
                  busy={!reviewing || !isOperator || deciding}
                  error={decisionError}
                  onSelect={(optionId) => act("select", { optionId })}
                  onReview={(item, verdict, reason) => act("review", { itemId: item.id, itemHash: item.hash, verdict, ...(reason ? { reason } : {}) })}
                  onSendBack={() => act("send-back", {})}
                  onFreeze={() => act("freeze", {})}
                  {...(state.repo?.repoKind === "other" ? { onEnd: () => act("end", {}) } : {})}
                />
              ) : null
            }
          />
          <InterjectionInput state={state} events={events} queue={live.queue} onSend={send} />
        </div>
        <ArtifactArea state={state} events={events} loadFile={loadFile} now={live.now} />
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
