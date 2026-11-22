// Details panel (Artifact_Area, R4.1-R4.8): segmented tabs for what the team found, the app trial and the
// decision; a new item marks its tab without taking focus; an empty tab says why; Engineering_Details stay
// closed until the Judge opens them.
import { useEffect, useRef, useState } from "react";
import type { StudioEvent, UiState } from "@graftlab/shared";

type Tab = "found" | "app" | "decision";

function tabOf(e: StudioEvent): Tab | null {
  if (e.type === "file_read" || e.type === "finding_recorded" || e.type === "evidence_summary") return "found";
  if (e.type === "browser_action" || e.type === "browser_observation") return "app";
  if (e.type === "decision_doc_version" || e.type === "decision_doc_frozen" || e.type === "artifact_updated") return "decision";
  return null;
}

const LABEL: Record<Tab, string> = { found: "Findings", app: "App trial", decision: "Decision" };

export function ArtifactArea({ state, events }: { state: UiState; events: StudioEvent[] }) {
  const [tab, setTab] = useState<Tab>("found");
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
  const docs = events.filter((e) => e.type === "artifact_updated");
  const tools = events.filter((e) => e.type === "tool_started" || e.type === "tool_finished" || e.type === "node_entered" || e.type === "code_change" || e.type === "review_verdict");

  return (
    <section className="panel details" aria-label="Details">
      <div className="segmented" role="tablist" aria-label="Details">
        {(["found", "app", "decision"] as const).map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => select(t)} className={tab === t ? "active" : ""}>
            {LABEL[t]}
            {unseen.has(t) && <span className="new-dot" aria-label="new" />}
          </button>
        ))}
      </div>
      <div className="details-body" role="tabpanel">
        {tab === "found" &&
          (files.length === 0 && findings.length === 0 ? (
            <p className="empty">Nothing found yet. The Reader starts after the repository is downloaded.</p>
          ) : (
            <>
              {findings.length > 0 && (
                <>
                  <h3>What the team found</h3>
                  <ul className="clean">
                    {findings.map((e) =>
                      e.type === "finding_recorded" ? (
                        <li key={e.seq} className={`finding ${e.payload.evidenceStatus}`}>
                          <span className="finding-mark" aria-hidden="true">{e.payload.evidenceStatus === "passed" ? "✓" : e.payload.evidenceStatus === "unverified" ? "!" : "•"}</span>
                          <div>
                            {e.payload.evidenceStatus === "unverified" && <span className="badge red">Unverified</span>} {e.payload.text}
                            {e.payload.evidence[0] && <div className="mono muted small">{e.payload.evidence[0].path}</div>}
                          </div>
                        </li>
                      ) : null,
                    )}
                  </ul>
                  <p className="muted small">✓ means Studio code found the quoted text in that file.</p>
                </>
              )}
              <details className="fold">
                <summary>Files read ({files.length})</summary>
                <ul className="clean mono small">
                  {files.map((e) => (e.type === "file_read" ? <li key={e.seq}>{e.payload.path}</li> : null))}
                </ul>
              </details>
            </>
          ))}
        {tab === "app" &&
          (browser.length === 0 ? (
            <p className="empty">{state.repo?.repoKind === "other" ? "This repository is analysis only, so the app is not run." : "The Explorer has not tried the app yet."}</p>
          ) : (
            <ol className="trial">
              {browser.map((e) =>
                e.type === "browser_action" ? (
                  <li key={e.seq} className={e.payload.ok ? "" : "fail"}>
                    <span className="trial-mark" aria-hidden="true">{e.payload.ok ? "→" : "✕"}</span>
                    <span>
                      {e.payload.action} {e.payload.target}
                      {!e.payload.ok && <span className="badge red">failed</span>}
                    </span>
                  </li>
                ) : e.type === "browser_observation" ? (
                  <li key={e.seq} className="seen">
                    <span className="trial-mark" aria-hidden="true">👁</span>
                    <span>{e.payload.snapshotSummary}</span>
                  </li>
                ) : null,
              )}
            </ol>
          ))}
        {tab === "decision" &&
          (state.decisionDocs.length === 0 && docs.length === 0 ? (
            <p className="empty">No decision yet. It is written after the meeting.</p>
          ) : (
            <ul className="clean">
              {state.decisionDocs.map((d) => (
                <li key={d.version} className="doc-row">
                  <span aria-hidden="true">{d.frozen ? "🔒" : "📝"}</span> Decision v{d.version} {d.frozen ? "· locked" : "· draft"}
                  <span className="mono muted small"> {d.hash.slice(0, 10)}</span>
                </li>
              ))}
              {docs.map((e) =>
                e.type === "artifact_updated" ? (
                  <li key={e.seq} className="doc-row">
                    <span aria-hidden="true">📄</span> {e.payload.title}
                  </li>
                ) : null,
              )}
            </ul>
          ))}
      </div>
      <details className="engineering" open={engOpen} onToggle={(e) => setEngOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Engineering_Details</summary>
        {engOpen && (
          <ul className="clean mono small">
            {tools.length === 0 && <li>Nothing yet.</li>}
            {tools.map((e) =>
              e.type === "tool_started" ? (
                <li key={e.seq}>→ {e.payload.tool} {e.payload.inputSummary}</li>
              ) : e.type === "tool_finished" ? (
                <li key={e.seq} className={e.payload.ok ? "" : "failure-text"}>
                  ← {e.payload.tool} {e.payload.ok ? "ok" : "failed"} {e.payload.outputSummary}
                </li>
              ) : e.type === "node_entered" ? (
                <li key={e.seq} className="muted">node {e.payload.to} ({e.payload.edgeId})</li>
              ) : e.type === "code_change" ? (
                <li key={e.seq}>changed {e.payload.changedFiles.join(", ")}</li>
              ) : e.type === "review_verdict" ? (
                <li key={e.seq}>review {e.payload.verdict} · {e.payload.label}</li>
              ) : null,
            )}
          </ul>
        )}
      </details>
    </section>
  );
}
