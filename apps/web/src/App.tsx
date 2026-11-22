// Workspace skeleton (design.md, "Web app", "UI design"; mocks in .kiro/specs/graftlab-ai/ui/).
import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { ArtifactArea } from "./components/Artifacts.tsx";
import type { AnswerFn } from "./components/Cards.tsx";
import { FlowLine, InterjectionInput, TopBar, type SendFn } from "./components/Chrome.tsx";
import { ActivityFeed } from "./components/Feed.tsx";
import { PresenceColumn } from "./components/Presence.tsx";
import { useStudio } from "./useStudio.ts";

function DevBar({ isOperator }: { isOperator: boolean }) {
  const [msg, setMsg] = useState("");
  return (
    <div className="devbar" role="region" aria-label="Development controls">
      <span className="tag">DEV</span>
      <button type="button" onClick={async () => setMsg((await api.join()).ok ? "joined" : "join failed")}>Join queue</button>
      <button
        type="button"
        disabled={!isOperator}
        onClick={async () => {
          const r = await api.playFixture("synthetic-gathering-meeting", 1);
          setMsg(r.ok ? "playing the SYNTHETIC fixture (not a real run)" : `not started: ${r.error}`);
        }}
      >
        Play synthetic fixture
      </button>
      <span className="small" aria-live="polite">{msg}</span>
    </div>
  );
}

export function App() {
  const [ready, setReady] = useState(false);
  const live = useStudio(ready);
  const taskId = live.state.taskId;
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
  useEffect(() => {
    void api.session().then(() => setReady(true));
    const t = setInterval(() => void api.heartbeat(), 30_000);
    // Closing the tab leaves the queue at once instead of after the idle release. While a Task is active the
    // server keeps the lease with its Judge regardless (R28.5).
    const leave = () => {
      void fetch("/api/queue/leave", { method: "POST", keepalive: true, credentials: "same-origin" });
    };
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(t);
      window.removeEventListener("pagehide", leave);
    };
  }, []);

  return (
    <div className="app">
      <TopBar state={live.state} connected={live.connected} queue={live.queue} />
      {import.meta.env.DEV && <DevBar isOperator={live.queue?.role === "operator"} />}
      <FlowLine state={live.state} />
      {live.error && <div className="banner failure-text" role="alert">{live.error}</div>}
      <main className="workspace">
        <PresenceColumn state={live.state} now={live.now} />
        <ActivityFeed state={live.state} events={live.events} buffers={live.buffers} onAnswer={answer} />
        <ArtifactArea state={live.state} events={live.events} />
      </main>
      <InterjectionInput state={live.state} events={live.events} queue={live.queue} onSend={send} />
    </div>
  );
}
