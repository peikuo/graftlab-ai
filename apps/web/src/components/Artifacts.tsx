// Artifact_Area (R4.1-R4.8): tabs for evidence, browser and the Decision_Doc; a new artifact marks its tab
// without taking focus; a missing artifact shows why; Engineering details are closed until the Judge opens them.
import { useEffect, useRef, useState } from "react";
import type { StudioEvent, UiState } from "@graftlab/shared";

type Tab = "evidence" | "browser" | "decision";

function tabOf(e: StudioEvent): Tab | null {
  if (e.type === "file_read" || e.type === "finding_recorded" || e.type === "evidence_summary") return "evidence";
  if (e.type === "browser_action" || e.type === "browser_observation") return "browser";
  if (e.type === "decision_doc_version" || e.type === "decision_doc_frozen") return "decision";
  return null;
}

export function ArtifactArea({ state, events }: { state: UiState; events: StudioEvent[] }) {
  const [tab, setTab] = useState<Tab>("evidence");
  const [unseen, setUnseen] = useState<Set<Tab>>(new Set());
  const [engOpen, setEngOpen] = useState(false);
  const seen = useRef(0);

  useEffect(() => {
    const fresh = events.slice(seen.current);
    seen.current = events.length;
    const tabs = new Set(fresh.map(tabOf).filter((t): t is Tab => t !== null && t !== tab));
    if (tabs.size > 0) setUnseen((u) => new Set([...u, ...tabs]));
  }, [events, tab]);

  const select = (t: Tab) => {
    setTab(t);
    setUnseen((u) => {
      const n = new Set(u);
      n.delete(t);
      return n;
    });
  };

  const files = events.filter((e) => e.type === "file_read");
  const findings = events.filter((e) => e.type === "finding_recorded");
  const browser = events.filter((e) => e.type === "browser_action" || e.type === "browser_observation");
  const tools = events.filter((e) => e.type === "tool_started" || e.type === "tool_finished");

  return (
    <section className="artifacts" aria-label="Artifacts">
      <div className="tabs" role="tablist">
        {(["evidence", "browser", "decision"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => select(t)} className={tab === t ? "active" : ""}>
            {t === "evidence" ? "Evidence" : t === "browser" ? "Browser" : "Decision_Doc"}
            {unseen.has(t) && <span className="badge" aria-label="new"> •</span>}
          </button>
        ))}
      </div>
      <div className="tab-body" role="tabpanel">
        {tab === "evidence" &&
          (files.length === 0 && findings.length === 0 ? (
            <p className="unavailable">Nothing read yet: the repository has not been downloaded.</p>
          ) : (
            <>
              <h3>Claims checked by code</h3>
              <ul className="plain">
                {findings.map((e) =>
                  e.type === "finding_recorded" ? (
                    <li key={e.seq} className={e.payload.evidenceStatus === "unverified" ? "failure-text" : ""}>
                      {e.payload.evidenceStatus === "passed" ? "✓" : e.payload.evidenceStatus === "unverified" ? "✗ Unverified:" : "•"} {e.payload.text}
                      {e.payload.evidence[0] && <span className="path mono"> · {e.payload.evidence[0].path}</span>}
                    </li>
                  ) : null,
                )}
              </ul>
              <h3>Files read ({files.length})</h3>
              <ul className="plain mono small">
                {files.map((e) => (e.type === "file_read" ? <li key={e.seq}>{e.payload.path} · {e.payload.bytes} bytes</li> : null))}
              </ul>
            </>
          ))}
        {tab === "browser" &&
          (browser.length === 0 ? (
            <p className="unavailable">No browser experience yet{state.repo?.repoKind === "other" ? ": this repository is analysis only" : ""}.</p>
          ) : (
            <ol className="plain">
              {browser.map((e) =>
                e.type === "browser_action" ? (
                  <li key={e.seq} className={e.payload.ok ? "" : "failure-text"}>
                    {e.payload.ok ? "▸" : "✗"} {e.payload.action} {e.payload.target}
                  </li>
                ) : e.type === "browser_observation" ? (
                  <li key={e.seq} className="observation">
                    👁 {e.payload.snapshotSummary}
                    <span className="unavailable small"> · screenshot {e.payload.screenshotRef ?? "none"} (images are served from milestone 5 on)</span>
                  </li>
                ) : null,
              )}
            </ol>
          ))}
        {tab === "decision" &&
          (state.decisionDocs.length === 0 ? (
            <p className="unavailable">No Decision_Doc yet: the decision step has not started.</p>
          ) : (
            <ul className="plain">
              {state.decisionDocs.map((d) => (
                <li key={d.version}>
                  v{d.version} {d.frozen ? "🔒 frozen" : "draft"} · <span className="mono small">{d.hash.slice(0, 12)}</span>
                </li>
              ))}
            </ul>
          ))}
      </div>
      <details className="engineering" open={engOpen} onToggle={(e) => setEngOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Engineering_Details</summary>
        {engOpen && (
          <ul className="plain mono small">
            {tools.length === 0 && <li>No tool calls yet.</li>}
            {tools.map((e) =>
              e.type === "tool_started" ? (
                <li key={e.seq}>→ {e.payload.tool} {e.payload.inputSummary}</li>
              ) : e.type === "tool_finished" ? (
                <li key={e.seq} className={e.payload.ok ? "" : "failure-text"}>← {e.payload.tool} {e.payload.ok ? "ok" : "failed"} {e.payload.outputSummary}</li>
              ) : null,
            )}
          </ul>
        )}
      </details>
    </section>
  );
}
