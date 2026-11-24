// Development whiteboard (R1.10; design.md, "UI design", development whiteboard): one lane per story, one card per
// Feature with its phase track, the agent working on it and that agent's live Role_Status, the attempt, the change
// size and the Verifier badges. Everything is folded from events (featureBoard, roleStatus), so Replay is the same.
import { featureBoard, PHASE_TRACK, roleStatus, type BoardCard, type UiState } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";
const PHASE_LABEL: Record<string, string> = {
  todo: "To do",
  testing: "Tests",
  building: "Build",
  reviewing: "Review",
  running: "Run",
  demo: "Demo",
  verifying: "Verify",
  merged: "Merged",
  failed: "Failed",
  blocked: "Blocked",
};
const PHASE_NOW: Record<string, string> = {
  todo: "waiting for its turn",
  testing: "the Test_Agent writes the tests first",
  building: "the Code_Agent builds it",
  reviewing: "the Reviewer reviews tests and code",
  running: "the changed app is starting",
  demo: "waiting for you to look at the demo",
  verifying: "the Verifier runs the checks",
  merged: "verified and merged into main",
  failed: "stopped",
  blocked: "blocked",
};
function Track({ card }: { card: BoardCard }) {
  const at = card.status === "failed" || card.status === "blocked" ? card.reached : card.status;
  const idx = at ? PHASE_TRACK.indexOf(at as (typeof PHASE_TRACK)[number]) : -1;
  return (
    <ol className="track" aria-label="Phases">
      {PHASE_TRACK.map((p, i) => {
        const cls = i < idx || card.status === "merged" ? "done" : i === idx ? (card.status === "failed" ? "stop-fail" : card.status === "blocked" ? "stop-block" : "now") : "";
        return (
          <li key={p} className={cls} aria-current={i === idx ? "step" : undefined}>
            {PHASE_LABEL[p]}
          </li>
        );
      })}
    </ol>
  );
}
function Card({ card, state, now }: { card: BoardCard; state: UiState; now: number }) {
  const who = card.actor ? ACTOR_LABEL[card.actor] : undefined;
  const st = card.actor && card.actor !== "system" && card.actor !== "judge" ? roleStatus(state, card.actor, now) : null;
  const cls = card.status === "merged" ? "merged" : card.status === "failed" ? "failed" : card.status === "blocked" ? "blocked" : card.status === "todo" ? "todo" : "active";
  const working = st?.working ? " working" : "";
  return (
    <li className={`fcard ${cls}${working}`} aria-label={`${card.featureId} ${card.title}: ${PHASE_LABEL[card.status]}`}>
      <div className="fcard-head">
        <span className="mono muted small">{card.featureId}</span> <strong>{card.title}</strong>
        {card.size && <span className="badge slate">{card.size}</span>}
        <span className={`badge ${cls === "merged" ? "green" : cls === "failed" ? "red" : cls === "blocked" ? "amber" : "slate"}`}>{PHASE_LABEL[card.status]}</span>
      </div>
      {card.status !== "todo" && <Track card={card} />}
      <div className="fcard-now small">
        {who && card.status !== "merged" && card.status !== "failed" && card.status !== "blocked" ? (
          <>
            <span aria-hidden="true">{who.avatar}</span> {who.name} · {st && st.kind !== "idle" ? st.text : PHASE_NOW[card.status]}
            {working && <span className="dot" aria-hidden="true" />}
          </>
        ) : (
          <>{PHASE_NOW[card.status]}</>
        )}
        {card.reason && (card.status === "failed" || card.status === "blocked" || card.status === "testing") && <span className="muted"> · {card.reason}</span>}
      </div>
      <div className="fcard-facts small muted">
        {card.attempt > 0 && <span>attempt {card.attempt}</span>}
        {card.tests && <span>tests: {card.tests.files} files, +{card.tests.added}</span>}
        {card.change && (
          <span>
            code: {card.change.files} files, +{card.change.added} −{card.change.removed}
            {card.change.unplanned > 0 ? ` · ${card.change.unplanned} unplanned` : ""}
          </span>
        )}
      </div>
      {card.checks.length > 0 && (
        <div className="fcard-checks">
          {card.checks.map((c, i) => (
            <span key={`${c.checkId}-${i}`} className={`badge ${c.pass ? "green" : "red"}`} title="Verifier, code, no AI">
              {c.pass ? "✓" : "✕"} {c.checkId}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
export function DevBoard({ state, now }: { state: UiState; now: number }) {
  const b = featureBoard(state);
  if (!b) return null;
  return (
    <div className="devboard">
      <h3>
        Build board <span className="muted small">{b.merged} of {b.total} Features merged{b.failed ? ` · ${b.failed} failed` : ""}{b.blocked ? ` · ${b.blocked} blocked` : ""}</span>
      </h3>
      {b.lanes.map((l) => (
        <div key={l.storyId} className="lane">
          <h4>
            <span className="mono muted small">{l.storyId}</span> {l.title}
          </h4>
          <ul className="clean fcards">
            {l.cards.map((c) => (
              <Card key={c.featureId} card={c} state={state} now={now} />
            ))}
          </ul>
        </div>
      ))}
      <p className="muted small">Each phase comes from a recorded event. Only the Verifier (code, no AI) decides whether a Feature works.</p>
    </div>
  );
}
