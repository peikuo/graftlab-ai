// Proposal_Board in the Details panel (R11.11-R11.13): the latest board from `board_updated` or the final one
// from `meeting_summary`, in plain words. One row per perspective; quotes behind "why we think so".
import type { Proposal, StudioEvent } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";
import { EvidenceFold } from "./Evidence.tsx";

const PURPOSE: Record<string, string> = { A: "AI takes over a step people do now", B: "AI makes a feature stronger or new", unclear: "not yet clear which kind" };
const STANCE: Record<string, { text: string; cls: string }> = { support: { text: "supports", cls: "green" }, against: { text: "against", cls: "red" }, conditional: { text: "only if", cls: "amber" } };
const ROLES = ["user_value", "feasibility", "risk"] as const;

function ProposalCard({ p }: { p: Proposal }) {
  return (
    <li className="proposal">
      <div className="proposal-head">
        <strong>{p.title}</strong>
        <span className="badge slate">{PURPOSE[p.purpose]}</span>
      </div>
      <p className="small">{p.userChange}</p>
      <ul className="clean stances">
        {ROLES.map((r) => {
          const s = p.stances[r];
          const who = ACTOR_LABEL[r] ?? { name: r, avatar: "•" };
          return (
            <li key={r} className={s ? `stance s-${s.stance}` : "stance s-none"}>
              <span className="stance-who" title={who.name}>
                <span aria-hidden="true">{who.avatar}</span> {who.name}
              </span>
              {s ? (
                <span className="stance-body">
                  <span className={`badge ${STANCE[s.stance]!.cls}`}>{STANCE[s.stance]!.text}</span>
                  {s.stance === "conditional" && s.conditions ? <strong> {s.conditions}</strong> : null} {s.reason}
                  {s.evidenceStatus === "unverified" && <span className="badge red">Unverified</span>}
                  {s.evidence.length > 0 && <EvidenceFold evidence={s.evidence} />}
                </span>
              ) : (
                <span className="muted small">no view yet</span>
              )}
            </li>
          );
        })}
      </ul>
      {p.evidence.length > 0 && <EvidenceFold evidence={p.evidence} label="Why this was proposed" />}
    </li>
  );
}

export function BoardView({ events }: { events: StudioEvent[] }) {
  const final = events.findLast((e) => e.type === "meeting_summary");
  const latest = events.findLast((e) => e.type === "board_updated");
  const proposals = final?.type === "meeting_summary" ? final.payload.proposals : latest?.type === "board_updated" ? latest.payload.proposals : null;
  if (!proposals) return null;
  const open = final?.type === "meeting_summary" ? final.payload.openQuestions : [];
  const complete = proposals.filter((p) => ROLES.every((r) => p.stances[r])).length;
  return (
    <div className="brief board">
      <h3>
        {final ? "Meeting result" : "Proposals on the table"} <span className="badge slate">LLM judgment</span>
      </h3>
      <p className="muted small">
        {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}; {complete} with a view from all three perspectives.
      </p>
      <ul className="clean proposals">
        {proposals.map((p) => (
          <ProposalCard key={p.id} p={p} />
        ))}
      </ul>
      {open.length > 0 && (
        <>
          <h4>Open questions for you</h4>
          <ul className="clean brief-list">
            {open.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
