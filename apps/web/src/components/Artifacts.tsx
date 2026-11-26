// Details panel (Artifact_Area, R4.1-R4.8): segmented tabs for what the team found, the app trial and the
// decision; a new item marks its tab without taking focus; an empty tab says why; Engineering_Details stay
// closed until the Judge opens them.
import { useEffect, useRef, useState } from "react";
import type { StudioEvent, UiState } from "@graftlab/shared";
import { BriefView } from "./Brief.tsx";
import { BoardView } from "./Board.tsx";
import { DocsList, parsePlan, PlanStories } from "./Plan.tsx";
import { DevBoard } from "./DevBoard.tsx";
import { CodeChanges, UsageView } from "./Changes.tsx";

type Tab = "found" | "app" | "decision" | "plan" | "board";

function tabOf(e: StudioEvent): Tab | null {
  if (e.type === "file_read" || e.type === "finding_recorded" || e.type === "evidence_summary" || e.type === "reading_planned" || e.type === "repo_brief" || e.type === "meeting_summary" || e.type === "board_updated") return "found";
  if ((e.type === "browser_action" || e.type === "browser_observation") && e.actor.kind !== "verifier") return "app";
  if (e.type === "decision_doc_version" || e.type === "decision_doc_frozen" || e.type === "artifact_updated") return "decision";
  if (e.type === "plan_proposed" || e.type === "output_doc") return "plan";
  if (e.type === "feature_status" || e.type === "regression_result") return "board";
  return null;
}

/** A screenshot of the Task (artifacts/shots/<name>.jpg): live through the read-only route, in Replay next to the Replay_File. */
export const shotUrl = (taskId: string, ref: string, replay = false) => {
  const name = encodeURIComponent(ref.split("/").pop() ?? "");
  return replay ? `/replays/${encodeURIComponent(taskId)}/shots/${name}` : `/api/tasks/${encodeURIComponent(taskId)}/shots/${name}`;
};
const LABEL: Record<Tab, string> = { found: "Findings", app: "App trial", decision: "Decision", plan: "Plan and documents", board: "Build board" };

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

export function ArtifactArea({ state, events, loadFile, now, replay }: { state: UiState; events: StudioEvent[]; loadFile?: (path: string) => Promise<string | null>; now?: number; replay?: boolean }) {
  const [tab, setTab] = useState<Tab>("found");
  const [picked, setPicked] = useState<string | null>(null);
  const [unseen, setUnseen] = useState<Set<Tab>>(new Set());
  const [engOpen, setEngOpen] = useState(false);
  const seen = useRef(0);
  // The whiteboard is selected once, when development starts (design.md, development whiteboard).
  const boardShown = useRef(false);
  const hasBoard = Object.keys(state.featureStatus).length > 0;
  useEffect(() => {
    if (hasBoard && !boardShown.current) {
      boardShown.current = true;
      setTab("board");
    }
  }, [hasBoard]);

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
  // The App trial is the Explorer's; the Verifier's demonstration steps are shown in the confirm card (R21.11).
  const browser = events.filter((e) => (e.type === "browser_action" || e.type === "browser_observation") && e.actor.kind !== "verifier");
  const docs = events.filter((e) => e.type === "artifact_updated");
  const tools = events.filter((e) => e.type === "tool_started" || e.type === "tool_finished" || e.type === "code_change" || e.type === "review_verdict");
  const lastTs = events.at(-1)?.ts;
  const boardNow = now ?? (lastTs ? Date.parse(lastTs) : 0);
  const summary = events.find((e) => e.type === "evidence_summary");
  const unavailable = summary?.type === "evidence_summary" ? summary.payload.experienceUnavailable : undefined;

  // A tab exists only once it has content (R1.9); the app trial also when it was due but failed (R4.6).
  const tabs = (["found", "app", "decision", "plan", "board"] as const).filter((t) =>
    t === "board"
      ? hasBoard
      : t === "found"
      ? files.length + findings.length + events.filter((e) => e.type === "reading_planned" || e.type === "repo_brief").length > 0
      : t === "app"
        ? browser.length > 0 || unavailable !== undefined
        : t === "plan"
          ? !!state.plan || Object.keys(state.outputDocs).length > 0
          : state.decisionDocs.length + docs.length > 0,
  );
  const plan = parsePlan(state.plan?.content);
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
            <>
            {(() => {
              const last = browser.findLast((e) => e.type === "browser_observation" && e.payload.screenshotRef);
              const ref = last?.type === "browser_observation" ? last.payload.screenshotRef : undefined;
              return ref && state.taskId ? (
                <figure className="trial-live">
                  <img src={shotUrl(state.taskId, ref, replay)} alt={`The app as the Explorer sees it: ${last?.type === "browser_observation" ? last.payload.snapshotSummary : ""}`} />
                  <figcaption className="muted small">{state.node === "browser_experience" ? "Live: the latest screenshot of the app trial" : "The last screenshot of the app trial"}</figcaption>
                </figure>
              ) : null;
            })()}
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
                    {e.payload.screenshotRef && state.taskId && (
                      <a href={shotUrl(state.taskId, e.payload.screenshotRef, replay)} target="_blank" rel="noreferrer" className="trial-thumb">
                        <img src={shotUrl(state.taskId, e.payload.screenshotRef, replay)} alt="" loading="lazy" />
                      </a>
                    )}
                  </li>
                ) : null,
              )}
            </ol>
            </>
          ))}
        {active === "decision" && (
            <ul className="clean">
              {state.decisionDocs.map((d) => {
                const f = events.findLast((e) => e.type === "decision_doc_frozen" && e.payload.version === d.version);
                return (
                  <li key={d.version} className="doc-row">
                    <span aria-hidden="true">{d.frozen ? "🔒" : "📝"}</span> Decision version {d.version} {d.frozen ? "· locked" : ""}
                    <div className="muted small">
                      Fingerprint <span className="mono" title={d.hash}>{d.hash.slice(0, 12)}</span>
                      {f?.type === "decision_doc_frozen" ? ` · confirmed ${new Date(f.payload.confirmedAt).toLocaleString()}` : ""}
                    </div>
                  </li>
                );
              })}
              {docs.map((e) =>
                e.type === "artifact_updated" ? (
                  <li key={e.seq} className="doc-row">
                    <span aria-hidden="true">📄</span> {e.payload.title}
                  </li>
                ) : null,
              )}
            </ul>
          )}
        {active === "board" && (
          <>
            <DevBoard state={state} now={boardNow} />
            {state.regression && (
              <div className="regression">
                <h4>
                  Whole test suite <span className={`badge ${state.regression.pass ? "green" : "red"}`}>{state.regression.pass ? "no regression" : "regression found"}</span> <span className="badge slate">Verifier, code, no AI</span>
                </h4>
                <table className="ftable small">
                  <tbody>
                    <tr><td>At the pinned commit{state.regression.cached ? " (cached)" : ""}</td><td className="num">{state.regression.baseline.ran} tests</td><td className="num">{state.regression.baseline.failed.length} failing</td></tr>
                    <tr><td>On the changed code</td><td className="num">{state.regression.main.ran} tests</td><td className="num">{state.regression.main.failed.length} failing</td></tr>
                    <tr><td>New tests</td><td className="num">{state.regression.newTests}</td><td /></tr>
                  </tbody>
                </table>
                {state.regression.regressions.length > 0 && <p className="failure-text small">Passed before, fail now: {state.regression.regressions.join(", ")}</p>}
                {state.regression.newFailing.length > 0 && <p className="failure-text small">New tests that fail: {state.regression.newFailing.join(", ")}</p>}
              </div>
            )}
            <UsageView state={state} />
          </>
        )}
        {active === "plan" && (
          <>
            {plan && (
              <>
                <h3>
                  Plan {state.plan!.number}{" "}
                  <span className={`badge ${state.plan!.status === "confirmed" ? "green" : state.plan!.status === "sent_back" ? "amber" : ""}`}>
                    {state.plan!.status === "confirmed" ? "confirmed by you" : state.plan!.status === "sent_back" ? "sent back to the meeting" : "waiting for you"}
                  </span>
                </h3>
                {state.plan!.reason && <p className="small">Your reason: {state.plan!.reason}</p>}
                <PlanStories plan={plan} />
              </>
            )}
            <h3>Documents</h3>
            <DocsList state={state} />
            {Object.keys(state.outputDocs).length === 0 && <p className="empty">The documents are written after you confirm the plan.</p>}
          </>
        )}
      </div>
      {tools.length > 0 && (
      <details className="engineering" open={engOpen} onToggle={(e) => setEngOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Engineering_Details</summary>
        {engOpen && <CodeChanges state={state} />}
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
                <li key={e.seq}>{e.payload.by === "test_agent" ? "tests" : "changed"} {e.payload.changedFiles.join(", ")}</li>
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
