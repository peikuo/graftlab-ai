// Proposal_Board in the Details panel (R11.11-R11.13): the latest board from `board_updated` or the final one
// from `meeting_summary`, in plain words. One row per perspective; quotes behind "why we think so".
import type { Proposal, StudioEvent } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";
import { EvidenceFold } from "./Evidence.tsx";

const PURPOSE: Record<string, string> = { A: "AI takes over a step people do now", B: "AI makes a feature stronger or new", unclear: "not yet clear which kind" };
const STANCE: Record<string, { text: string; cls: string }> = { support: { text: "supports", cls: "green" }, against: { text: "against", cls: "red" }, conditional: { text: "only if", cls: "amber" } };
const ROLES = ["user_value", "feasibility", "risk"] as const;

const VERDICT: Record<string, { text: (rank?: number) => string; cls: string }> = {
  recommend: { text: (rank) => (rank ? `Recommended · #${rank}` : "Recommended"), cls: "green" },
  park: { text: () => "Left for you to decide", cls: "amber" },
  drop: { text: () => "Dropped", cls: "slate" },
};
function ProposalCard({ p }: { p: Proposal }) {
  const v = p.verdict;
  return (
    <li className={`proposal${v ? ` v-${v.verdict}` : ""}`}>
      <div className="proposal-head">
        <strong>{p.title}</strong>
        <span className="badge slate">{PURPOSE[p.purpose]}</span>
      </div>
      {v && (
        <div className="verdict">
          <span className={`badge ${VERDICT[v.verdict]!.cls}`}>{VERDICT[v.verdict]!.text(v.rank)}</span> <span className="small">{v.reason}</span>
          {v.conditions.length > 0 && (
            <ul className="clean small verdict-conditions">
              {v.conditions.map((c) => (
                <li key={c}>Only if {c.charAt(0).toLowerCase() + c.slice(1).replace(/\.$/, "")}</li>
              ))}
            </ul>
          )}
        </div>
      )}
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
                  {s.effort && <span className={`badge ${s.effort === "large" ? "red" : "slate"}`}>{s.effort === "large" ? "large change · engineering risk" : `${s.effort} change`}</span>}
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
  // After the close: recommended by rank, then the ones left for the Judge, then the dropped ones.
  const order = (p: Proposal) => (p.verdict?.verdict === "recommend" ? (p.verdict.rank ?? 50) : p.verdict?.verdict === "park" ? 100 : p.verdict ? 200 : 150);
  const sorted = [...proposals].sort((a, b) => order(a) - order(b));
  return (
    <div className="brief board">
      <h3>
        {final ? "Meeting result" : "Proposals on the table"} <span className="badge slate">{final ? "Facilitator's recommendation · LLM judgment" : "LLM judgment"}</span>
      </h3>
      <p className="muted small">
        {proposals.length} {proposals.length === 1 ? "proposal" : "proposals"}; {complete} with a view from all three perspectives.
        {final ? " You accept or reject each one in the next step." : ""}
      </p>
      {(["new", "improve"] as const).map((kind) => {
        const group = sorted.filter((p) => p.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind}>
            <h4>{kind === "new" ? "New with AI: what the software cannot do today" : "Better with AI: what the software already does"}</h4>
            <ul className="clean proposals">
              {group.map((p) => (
                <ProposalCard key={p.id} p={p} />
              ))}
            </ul>
          </div>
        );
      })}
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
