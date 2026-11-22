// Team panel (R1.2, R2.1-R2.10, R8.4). Status is always text; the activity effect (soft colored row and a
// pulsing dot) appears only for a working status, which roleStatus() derives from a recent event (R1.7, R2.9).
// Meeting_Perspectives are listed only while the meeting or the decision runs; otherwise they fold into one line.
import { roleStatus, type NodeId, type UiState } from "@graftlab/shared";
import { ROLE_CARDS, type RoleCard } from "../roles.ts";

const MEETING_NODES: readonly NodeId[] = ["meeting", "prototype", "deciding", "awaiting_confirmation"];

function verifierSummary(state: UiState): string {
  const items = state.verifierResults.flatMap((r) => r.items);
  if (items.length === 0) return "no checks yet";
  return `${items.filter((i) => i.pass).length} of ${items.length} checks passed`;
}

function VerifierCard({ card, state }: { card: RoleCard; state: UiState }) {
  const items = state.verifierResults.flatMap((r) => r.items);
  const summary = verifierSummary(state);
  return (
    <li className="agent verifier" aria-label={`${card.name}: ${summary}`}>
      <span className="agent-avatar" aria-hidden="true">{card.avatar}</span>
      <div className="agent-body">
        <div className="agent-name">
          Verifier <span className="badge slate">code, no AI</span>
        </div>
        <div className="agent-status">{summary}</div>
        {items.length > 0 && (
          <ul className="vchecks">
            {items.map((i, n) => (
              <li key={n} className={i.pass ? "pass" : "fail"}>
                <span aria-hidden="true">{i.pass ? "✓" : "✕"}</span> {i.item}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

export function PresenceCard({ card, state, now }: { card: RoleCard; state: UiState; now: number }) {
  if (card.kind === "verifier") return <VerifierCard card={card} state={state} />;
  const st = roleStatus(state, card.key, now);
  return (
    <li className={`agent s-${st.kind}${st.working ? " working" : ""}`} aria-label={`${card.name}: ${st.text}`} title={card.job}>
      <span className="agent-avatar" aria-hidden="true">{card.avatar}</span>
      <div className="agent-body">
        <div className="agent-name">{card.name}</div>
        <div className="agent-status">
          <span className="dot" aria-hidden="true" />
          <span className="agent-status-text">{st.kind === "idle" ? card.job : st.text}</span>
        </div>
      </div>
    </li>
  );
}

export function PresenceColumn({ state, now }: { state: UiState; now: number }) {
  const inMeeting = state.node !== null && MEETING_NODES.includes(state.node);
  const work = ROLE_CARDS.filter((c) => c.group === "work");
  const meeting = ROLE_CARDS.filter((c) => c.group === "meeting");
  const checker = ROLE_CARDS.filter((c) => c.group === "checker");
  return (
    <section className="panel team" aria-label="Team">
      <h2 className="panel-title">Team</h2>
      <ul className="agents">
        {work.map((c) => (
          <PresenceCard key={c.key} card={c} state={state} now={now} />
        ))}
      </ul>
      <h3 className="group-title">In the meeting</h3>
      {inMeeting ? (
        <ul className="agents">
          {meeting.map((c) => (
            <PresenceCard key={c.key} card={c} state={state} now={now} />
          ))}
        </ul>
      ) : (
        <p className="group-folded">
          <span aria-hidden="true">{meeting.map((c) => c.avatar).join(" ")}</span> {meeting.map((c) => c.name).join(", ")} join when the meeting starts
        </p>
      )}
      <h3 className="group-title">Checker</h3>
      <ul className="agents">
        {checker.map((c) => (
          <PresenceCard key={c.key} card={c} state={state} now={now} />
        ))}
      </ul>
    </section>
  );
}
