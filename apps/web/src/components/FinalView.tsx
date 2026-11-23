// Final view (R23.3, R25.1, R25.2, R26.1, R26.5): the Task's result from `terminal_reached`, the same in Live and
// Replay. Success comes only from the Verifier; failures are counted per Failure_Class; labels stay visible.
import type { StudioEvent } from "@graftlab/shared";

const RESULT: Record<string, { title: string; cls: string; text: string }> = {
  success: { title: "Success", cls: "green", text: "The Verifier (code, no AI) confirmed every check." },
  failed: { title: "Ended without success", cls: "red", text: "The Task stopped before the Verifier confirmed a result." },
  aborted: { title: "Stopped", cls: "slate", text: "You stopped the Task." },
  analysis_only: { title: "Analysis only", cls: "amber", text: "This repository cannot be run here. The result is the meeting and the decision draft." },
  docs_only: { title: "Documents only", cls: "amber", text: "The plan and documents were written; nothing was built." },
};

export function FinalView({ events, replayHref }: { events: StudioEvent[]; replayHref?: string }) {
  const t = events.findLast((e) => e.type === "terminal_reached");
  if (t?.type !== "terminal_reached") return null;
  const r = RESULT[t.payload.terminal] ?? { title: t.payload.terminal, cls: "slate", text: "" };
  const s = t.payload.summary;
  const failures = Object.entries(s.failuresByClass).filter(([, n]) => (n ?? 0) > 0);
  const frozen = events.findLast((e) => e.type === "decision_doc_frozen");
  const summary = events.findLast((e) => e.type === "meeting_summary");
  const recommended =
    summary?.type === "meeting_summary"
      ? summary.payload.proposals.filter((p) => p.verdict?.verdict === "recommend").sort((a, b) => (a.verdict?.rank ?? 99) - (b.verdict?.rank ?? 99))
      : [];
  return (
    <section className={`final final-${r.cls}`} aria-label="Result">
      <h2>
        <span className={`badge ${r.cls}`}>{r.title}</span> {s.label && s.label !== r.title ? <span className="muted small">{s.label}</span> : null}
      </h2>
      <p>{r.text}</p>
      <ul className="clean small final-facts">
        <li>Verifier: {s.verifierPassed + s.verifierFailed === 0 ? "no checks were run" : `${s.verifierPassed} passed, ${s.verifierFailed} failed`}</li>
        {frozen?.type === "decision_doc_frozen" && (
          <li>
            Decision: version {frozen.payload.version} locked, fingerprint {frozen.payload.hash.slice(0, 12)}
          </li>
        )}
        {recommended.length > 0 && <li>Recommended by the meeting: {recommended.map((p) => p.title).join(" · ")}</li>}
        {failures.length > 0 && <li>Problems on the way: {failures.map(([k, n]) => `${n} × ${k}`).join(", ")}</li>}
        {s.unconfirmed.length > 0 && <li className="failure-text">Not confirmed: {s.unconfirmed.join(", ")}</li>}
      </ul>
      {replayHref && (
        <a className="btn" href={replayHref}>
          ▶ Watch the Replay
        </a>
      )}
    </section>
  );
}
