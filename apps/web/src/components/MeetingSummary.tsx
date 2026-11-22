// The Facilitator's meeting summary in the Details panel (R11.5-R11.7, R15.1). From the `meeting_summary` event;
// the evidence marks come from the Studio's evidence checker, the content is an LLM judgment.
import type { StudioEvent } from "@graftlab/shared";

const PURPOSE: Record<string, string> = { A: "A · AI takes over a step", B: "B · AI makes it stronger or new", unclear: "A or B unclear" };

export function MeetingSummaryView({ events }: { events: StudioEvent[] }) {
  const e = events.findLast((x) => x.type === "meeting_summary");
  if (e?.type !== "meeting_summary") return null;
  const s = e.payload;
  const passed = s.findings.filter((f) => f.evidenceStatus === "passed").length;
  return (
    <div className="brief">
      <h3>
        Meeting summary <span className="badge slate">by Facilitator · LLM judgment</span>
      </h3>
      {s.workflows.length > 0 && (
        <>
          <h4>Candidate changes</h4>
          <ul className="clean brief-list">
            {s.workflows.map((w) => (
              <li key={w.name}>
                <span className={`badge ${w.purpose === "unclear" ? "amber" : "green"}`}>{PURPOSE[w.purpose]}</span> <strong>{w.name}</strong>
                {w.evidenceStatus === "unverified" && <span className="badge red">Unverified</span>}
                <div className="small">{w.description}</div>
              </li>
            ))}
          </ul>
        </>
      )}
      {s.openQuestions.length > 0 && (
        <>
          <h4>Open questions for you</h4>
          <ul className="clean brief-list">
            {s.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </>
      )}
      <p className="muted small brief-coverage">
        {s.findings.length} findings: {passed} with a quote found in the file by Studio code, {s.findings.length - passed} Unverified. A found quote proves only that the text exists.
      </p>
    </div>
  );
}
