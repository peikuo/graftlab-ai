// Presence_Cards (R1.2, R2.1-R2.10, R8.4). Status always has text; the glow appears only for a working status,
// which roleStatus() derives from a recent event (R1.7, R2.9). The Verifier card is visibly different.
import { roleStatus, type UiState } from "@graftlab/shared";
import { ROLE_CARDS, type RoleCard } from "../roles.ts";

function verifierSummary(state: UiState): string {
  const items = state.verifierResults.flatMap((r) => r.items);
  if (items.length === 0) return "no checks yet";
  const passed = items.filter((i) => i.pass).length;
  return `${passed} of ${items.length} checks passed`;
}

function VerifierChecks({ state }: { state: UiState }) {
  const items = state.verifierResults.flatMap((r) => r.items);
  if (items.length === 0) return null;
  return (
    <ul className="vchecks mono">
      {items.map((i, n) => (
        <li key={n} className={i.pass ? "" : "failure-text"}>
          {i.pass ? "☑" : "☒"} {i.item}
        </li>
      ))}
    </ul>
  );
}

export function PresenceCard({ card, state, now }: { card: RoleCard; state: UiState; now: number }) {
  if (card.kind === "verifier") {
    return (
      <li className="card verifier" aria-label={`${card.name}: ${verifierSummary(state)}`}>
        <span className="avatar" aria-hidden="true">{card.avatar}</span>
        <div className="who">
          <div className="name mono">Verifier · code, no LLM</div>
          <div className="status mono">{verifierSummary(state)}</div>
          <VerifierChecks state={state} />
        </div>
      </li>
    );
  }
  const st = roleStatus(state, card.key, now);
  return (
    <li className={`card status-${st.kind}${st.working ? " working" : ""}`} aria-label={`${card.name}: ${st.text}`} title={card.description}>
      <span className="avatar" aria-hidden="true">{card.avatar}</span>
      <div className="who">
        <div className="name">{card.name}</div>
        <div className="status">
          <span className="dot" aria-hidden="true" />
          {st.text}
        </div>
        {/* The description is shown for active roles; idle cards stay compact so the whole team fits. */}
        {st.kind !== "idle" && <div className="desc">{card.description}</div>}
      </div>
    </li>
  );
}

export function PresenceColumn({ state, now }: { state: UiState; now: number }) {
  return (
    <section className="presence" aria-label="Team">
      <h2 className="area-title">Team</h2>
      <ul>
        {ROLE_CARDS.map((c) => (
          <PresenceCard key={c.key} card={c} state={state} now={now} />
        ))}
      </ul>
    </section>
  );
}
