// UI demo on MOCK DATA (/demo): the same components and reducer as the live Workspace, driven by the demo
// engine instead of the server. Labeled "DEMO · mock data" on every screen.
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArtifactArea } from "../components/Artifacts.tsx";
import { InterjectionInput } from "../components/Chrome.tsx";
import { DecisionReview } from "../components/DecisionReview.tsx";
import { ActivityFeed } from "../components/Feed.tsx";
import { NowBar, Stepper } from "../components/Guide.tsx";
import { PresenceColumn } from "../components/Presence.tsx";
import { DecisionDesk } from "./decision.ts";
import { DemoEngine } from "./engine.ts";
import { MockAddForm } from "./MockScreens.tsx";
import { runDemo } from "./script.ts";

const GITHUB = /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+\/?(\.git)?$/i;

function Home({ onStart }: { onStart: (url: string) => void }) {
  const [url, setUrl] = useState("https://github.com/sissbruecker/linkding");
  const valid = GITHUB.test(url.trim());
  const linkding = /sissbruecker\/linkding/i.test(url);
  return (
    <div className="home">
      <span className="demo-flag">DEMO · mock data, not a real run</span>
      <h1>
        GraftLab <span className="accent">AI</span>
      </h1>
      <p className="home-sub">Paste a GitHub repository. Decide together with an AI team how to make it AI-powered.</p>
      <form
        className="home-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && linkding) onStart(url.trim());
        }}
      >
        <label className="sr-only" htmlFor="url">GitHub repository URL</label>
        <input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/owner/repository" autoFocus />
        <button type="submit" disabled={!valid || !linkding}>Start</button>
      </form>
      <p className={`home-check ${valid ? (linkding ? "ok" : "warn") : "bad"}`} aria-live="polite">
        {!valid
          ? "Enter a GitHub repository address, for example https://github.com/sissbruecker/linkding"
          : linkding
            ? "✓ linkding is fully supported: read, try, build and check."
            : "This demo plays the linkding story only."}
      </p>
      <ol className="home-steps">
        <li>
          <span className="step-icon" aria-hidden="true">🔍</span>
          <strong>Read and try</strong>
          Agents read the code and use the app like a new user. You watch every step.
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

export function DemoApp() {
  const [url, setUrl] = useState<string | null>(null);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const engineRef = useRef<DemoEngine | null>(null);
  const deskRef = useRef<DecisionDesk | null>(null);
  const [speed, setSpeed] = useState(1);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!url) return;
    const engine = new DemoEngine();
    const desk = new DecisionDesk(engine, force);
    engine.speed = speed;
    engineRef.current = engine;
    deskRef.current = desk;
    const unsub = engine.subscribe(force);
    void runDemo(engine, desk, url).catch((e) => {
      if ((e as Error).message !== "stopped") console.error(e);
    });
    return () => {
      engine.stop();
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    if (engineRef.current) engineRef.current.speed = speed;
  }, [speed]);

  const engine = engineRef.current;
  const desk = deskRef.current;
  const snap = engine?.snapshot();
  const state = snap?.state;

  const openCard = useMemo(() => (state ? Object.values(state.cards).find((c) => !c.answered) : undefined), [state]);

  if (!url || !engine || !desk || !snap || !state) return <Home onStart={setUrl} />;

  const reviewing = state.node === "awaiting_confirmation" && desk.draft;
  const yourTurn = openCard ? openCard.title : reviewing ? "Review the decision draft: accept or reject each item, then freeze it." : null;
  const goThere = () => document.getElementById(openCard ? `card-${openCard.cardId}` : "decision-review")?.scrollIntoView({ behavior: "smooth", block: "center" });
  const gathering = state.node === "sandbox_start" || state.node === "browser_experience";
  const answerChoice = snap.events.find((e) => e.type === "card_answered" && e.payload.cardId === "q1");
  const confirmMode = !(answerChoice?.type === "card_answered" && answerChoice.payload.optionId === "auto");

  return (
    <div className="app demo">
      <header className="topbar">
        <span className="brand">
          <span className="brand-mark" aria-hidden="true">🧪</span> GraftLab <b>AI</b>
        </span>
        <span className="chip mono">sissbruecker/linkding</span>
        <span className="demo-flag">DEMO · mock data</span>
        <span className="spacer" />
        <span className="speed" role="group" aria-label="Demo speed">
          {[1, 2, 4].map((s) => (
            <button key={s} type="button" className={speed === s ? "active" : ""} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </span>
        <button type="button" onClick={() => setUrl(null)}>Start over</button>
      </header>
      <Stepper state={state} />
      <NowBar state={state} yourTurn={yourTurn} onGo={goThere} />
      {gathering && (
        <div className="gather-bar">
          <span>The team is still trying the app. You can skip this and start the meeting with what they have so far.</span>
          <button type="button" onClick={() => engine.signal("start_meeting")}>Start the meeting now</button>
        </div>
      )}
      {state.node === "success" && (
        <div className="result-bar" role="status">
          ✓ The Verifier (code, no AI) confirmed all {state.verifierResults.reduce((n, r) => n + r.items.length, 0)} checks. Demo ends here (story S1 only, mock data).
        </div>
      )}
      <main className="workspace">
        <PresenceColumn state={state} now={snap.now} />
        <div className="center">
        <ActivityFeed
          state={state}
          events={snap.events}
          buffers={snap.buffers}
          onAnswer={(id, a) => engine.answer(id, a)}
          cardExtra={(id) => (id.startsWith("c") ? <MockAddForm confirmMode={confirmMode} /> : null)}
          inline={
            reviewing && desk.draft ? (
              <DecisionReview
                draft={desk.draft}
                verdicts={desk.verdicts}
                selected={desk.selected}
                history={desk.history}
                busy={desk.busy}
                onSelect={(o) => desk.select(o)}
                onReview={(i, v, r) => desk.review(i, v, r)}
                onSendBack={() => desk.sendBack()}
                onFreeze={() => desk.freeze()}
              />
            ) : null
          }
        />
        <InterjectionInput state={state} events={snap.events} queue={{ role: "operator", queueLength: 0, open: true }} onSend={(to, text) => engine.message(to, text)} />
        </div>
        <ArtifactArea state={state} events={snap.events} />
      </main>
    </div>
  );
}
