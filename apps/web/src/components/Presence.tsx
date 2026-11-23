// Team panel (R1.2, R2.1-R2.10, R8.4). Status is always text; the activity effect (soft colored row and a
// pulsing dot) appears only for a working status, which roleStatus() derives from a recent event (R1.7, R2.9).
// Cards appear only once they are useful (R1.9): an agent with its first event, the Meeting_Perspectives
// when the meeting starts. The panel itself appears with its first card.
import { roleStatus, type UiState } from "@graftlab/shared";
import { ROLE_CARDS, type RoleCard } from "../roles.ts";

const SIGNAL_PLAIN: Record<string, string> = { disagree: "wants to disagree", answer: "wants to answer", add: "wants to add something", agree: "wants to agree" };
function verifierSummary(state: UiState): string {
  const items = state.verifierResults.flatMap((r) => r.items);
  if (items.length === 0) return "checking…";
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
  // In the discussion, an idle perspective shows its latest speaking signal in words (from signals_collected).
  const sig = state.node === "meeting" && st.kind === "idle" ? state.signals[card.key] : undefined;
  const sigText = sig ? (sig.speak ? `${SIGNAL_PLAIN[sig.kind ?? "add"]}${sig.intent ? `: ${sig.intent}` : ""}` : "listening") : null;
  return (
    <li className={`agent s-${st.kind}${st.working ? " working" : ""}`} aria-label={`${card.name}: ${st.text}`} title={card.job}>
      <span className="agent-avatar" aria-hidden="true">{card.avatar}</span>
      <div className="agent-body">
        <div className="agent-name">{card.name}</div>
        <div className="agent-status">
          <span className="dot" aria-hidden="true" />
          <span className="agent-status-text">{st.kind === "idle" ? (sigText ?? card.job) : st.text}</span>
        </div>
      </div>
    </li>
  );
}

/**
 * Cards shown now (R1.2, R1.9): an agent appears with its first event; the Meeting_Perspectives appear
 * together when the meeting starts. Nothing is shown in advance.
 */
export function visibleCards(state: UiState): RoleCard[] {
  const started = (c: RoleCard) => state.lastEventByActor[c.key] !== undefined;
  const meetingStarted = state.visitedNodes.includes("meeting") || ROLE_CARDS.some((c) => c.group === "meeting" && started(c));
  return ROLE_CARDS.filter((c) => (c.group === "meeting" ? meetingStarted : started(c)));
}

export function PresenceColumn({ state, now }: { state: UiState; now: number }) {
  const shown = visibleCards(state);
  if (shown.length === 0) return null;
  const groups: { title: string | null; cards: RoleCard[] }[] = [
    { title: null, cards: shown.filter((c) => c.group === "work") },
    { title: "In the meeting", cards: shown.filter((c) => c.group === "meeting") },
    { title: "Checker", cards: shown.filter((c) => c.group === "checker") },
  ];
  return (
    <section className="panel team" aria-label="Team">
      <h2 className="panel-title">Team</h2>
      {groups
        .filter((g) => g.cards.length > 0)
        .map((g) => (
          <div key={g.title ?? "work"}>
            {g.title && <h3 className="group-title">{g.title}</h3>}
            <ul className="agents">
              {g.cards.map((c) => (
                <PresenceCard key={c.key} card={c} state={state} now={now} />
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
