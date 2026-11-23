// Details panel (Artifact_Area, R4.1-R4.8): segmented tabs for what the team found, the app trial and the
// decision; a new item marks its tab without taking focus; an empty tab says why; Engineering_Details stay
// closed until the Judge opens them.
import { useEffect, useRef, useState } from "react";
import type { StudioEvent, UiState } from "@graftlab/shared";
import { BriefView } from "./Brief.tsx";
import { BoardView } from "./Board.tsx";

type Tab = "found" | "app" | "decision";

function tabOf(e: StudioEvent): Tab | null {
  if (e.type === "file_read" || e.type === "finding_recorded" || e.type === "evidence_summary" || e.type === "reading_planned" || e.type === "repo_brief" || e.type === "meeting_summary" || e.type === "board_updated") return "found";
  if (e.type === "browser_action" || e.type === "browser_observation") return "app";
  if (e.type === "decision_doc_version" || e.type === "decision_doc_frozen" || e.type === "artifact_updated") return "decision";
  return null;
}

const LABEL: Record<Tab, string> = { found: "Findings", app: "App trial", decision: "Decision" };

/** File preview (R4.4): the latest file while reading, or a file the Judge picked. */
function FilePreview({ path, load }: { path: string; load: (path: string) => Promise<string | null> }) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setText(undefined);
    void load(path).then((t) => live && setText(t));
    return () => {
      live = false;
    };
  }, [path, load]);
  return (
    <div className="preview">
      <div className="preview-head mono">{path}</div>
      {text === undefined ? <p className="muted small">Loading…</p> : text === null ? <p className="muted small">This file is not available.</p> : <pre className="preview-text">{text.slice(0, 4000)}{text.length > 4000 ? "\n…" : ""}</pre>}
    </div>
  );
}

export function ArtifactArea({ state, events, loadFile }: { state: UiState; events: StudioEvent[]; loadFile?: (path: string) => Promise<string | null> }) {
  const [tab, setTab] = useState<Tab>("found");
  const [picked, setPicked] = useState<string | null>(null);
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
  // Studio notes about the download (plan, skipped parts) are not findings of the team.
  const studioNotes = findings.filter((e) => e.actor.kind === "system");
  const agentFindings = findings.filter((e) => e.actor.kind !== "system");
  const browser = events.filter((e) => e.type === "browser_action" || e.type === "browser_observation");
  const docs = events.filter((e) => e.type === "artifact_updated");
  const tools = events.filter((e) => e.type === "tool_started" || e.type === "tool_finished" || e.type === "code_change" || e.type === "review_verdict");
  const summary = events.find((e) => e.type === "evidence_summary");
  const unavailable = summary?.type === "evidence_summary" ? summary.payload.experienceUnavailable : undefined;

  // A tab exists only once it has content (R1.9); the app trial also when it was due but failed (R4.6).
  const tabs = (["found", "app", "decision"] as const).filter((t) =>
    t === "found" ? files.length + findings.length + events.filter((e) => e.type === "reading_planned" || e.type === "repo_brief").length > 0 : t === "app" ? browser.length > 0 || unavailable !== undefined : state.decisionDocs.length + docs.length > 0,
  );
  const active: Tab | undefined = tabs.includes(tab) ? tab : tabs[0];
  if (!active) return null;

  return (
    <section className="panel details" aria-label="Details">
      <div className="segmented" role="tablist" aria-label="Details">
        {tabs.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={active === t} onClick={() => select(t)} className={active === t ? "active" : ""}>
            {LABEL[t]}
            {unseen.has(t) && <span className="new-dot" aria-label="new" />}
          </button>
        ))}
      </div>
      <div className="details-body" role="tabpanel">
        {active === "found" && (
            <>
              <BoardView events={events} />
              <BriefView events={events} {...(loadFile ? { open: (p: string) => setPicked(p) } : {})} />
              {studioNotes.length > 0 && (
                <>
                  <h3>Download</h3>
                  <ul className="clean small notes">
                    {studioNotes.map((e) => (e.type === "finding_recorded" ? <li key={e.seq}>{e.payload.text}</li> : null))}
                  </ul>
                </>
              )}
              {agentFindings.length > 0 && (
                <>
                  <h3>What the team found</h3>
                  <ul className="clean">
                    {agentFindings.map((e) =>
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
              {loadFile && files.length > 0 && (() => {
                const latest = files.at(-1);
                const path = picked ?? (state.node === "reading" && latest?.type === "file_read" ? latest.payload.path : null);
                return path ? <FilePreview path={path} load={loadFile} /> : null;
              })()}
              {files.length > 0 && (
                <details className="fold" open={!!loadFile}>
                  <summary>Files read ({files.length})</summary>
                  <ul className="clean mono small files">
                    {files.map((e) =>
                      e.type === "file_read" ? (
                        <li key={e.seq}>
                          {loadFile ? (
                            <button type="button" className={`file-link${picked === e.payload.path ? " on" : ""}`} onClick={() => setPicked(e.payload.path)}>
                              {e.payload.path}
                            </button>
                          ) : (
                            e.payload.path
                          )}
                        </li>
                      ) : null,
                    )}
                  </ul>
                </details>
              )}
            </>
          )}
        {active === "app" &&
          (browser.length === 0 ? (
            <p className="empty">The app could not be tried: {unavailable}</p>
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
        {active === "decision" && (
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
          )}
      </div>
      {tools.length > 0 && (
      <details className="engineering" open={engOpen} onToggle={(e) => setEngOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Engineering_Details</summary>
        {engOpen && (
          <ul className="clean mono small">
            {tools.map((e) =>
              e.type === "tool_started" ? (
                <li key={e.seq}>→ {e.payload.tool} {e.payload.inputSummary}</li>
              ) : e.type === "tool_finished" ? (
                <li key={e.seq} className={e.payload.ok ? "" : "failure-text"}>
                  ← {e.payload.tool} {e.payload.ok ? "ok" : "failed"} {e.payload.outputSummary}
                </li>
              ) : e.type === "code_change" ? (
                <li key={e.seq}>changed {e.payload.changedFiles.join(", ")}</li>
              ) : e.type === "review_verdict" ? (
                <li key={e.seq}>review {e.payload.verdict} · {e.payload.label}</li>
              ) : null,
            )}
          </ul>
        )}
      </details>
      )}
    </section>
  );
}
