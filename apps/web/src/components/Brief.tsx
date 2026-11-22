// Repo_Brief, reading plan and background index in the Details panel (R10.7-R10.12). Everything shown here
// comes from events: `reading_planned`, `repo_brief` (the record validated on the server), `memo_written` and
// `index_progress`. The brief is an LLM description and labeled so; coverage is computed by Studio code.
import { useState } from "react";
import type { StudioEvent } from "@graftlab/shared";

interface Brief {
  what: { text: string; kind: string; sources: string[] };
  users: { who: string; jobs: string[]; sources: string[] }[];
  howItRuns: { stack: string[]; parts: { name: string; role: string; paths: string[] }[]; entryPoints: string[] };
  concepts: { name: string; meaning: string; paths: string[] }[];
  features: { name: string; userAction: string; paths: string[] }[];
  extensionPoints: { where: string; couldAttach: string; paths: string[] }[];
  unknowns: { question: string; why: string }[];
}
interface BriefRecord {
  brief: Brief;
  coverage: { read: string[]; cut: string[]; noMemo: string[]; mapOnly: number; notReadYet: number; notDownloaded: number };
  planByCode: boolean;
  droppedSources: number;
}

function Sources({ paths, open }: { paths: string[]; open?: (path: string) => void }) {
  const [shown, setShown] = useState(false);
  if (paths.length === 0) return null;
  if (!shown)
    return (
      <button type="button" className="src-toggle" onClick={() => setShown(true)} title={paths.join(", ")}>
        {paths.length === 1 ? "1 source" : `${paths.length} sources`}
      </button>
    );
  return (
    <span className="brief-src">
      {paths.slice(0, 3).map((p) =>
        open && !p.endsWith("/") ? (
          <button key={p} type="button" className="file-link mono" onClick={() => open(p)}>
            {p}
          </button>
        ) : (
          <span key={p} className="mono">{p}</span>
        ),
      )}
      {paths.length > 3 && <span className="muted"> +{paths.length - 3}</span>}
    </span>
  );
}

/** Background index progress, counted from memo_written events after the index started (not map-only ones). */
export function indexProgress(events: StudioEvent[]): { done: number; total: number; state: "running" | "finished" | "stopped" } | null {
  const start = events.findLastIndex((e) => e.type === "index_progress" && e.payload.state === "started");
  if (start < 0) return null;
  const s = events[start]!;
  if (s.type !== "index_progress") return null;
  const end = events.slice(start + 1).find((e) => e.type === "index_progress");
  if (end?.type === "index_progress") return { done: end.payload.done, total: end.payload.total, state: end.payload.state === "finished" ? "finished" : "stopped" };
  const done = events.slice(start + 1).filter((e) => e.type === "memo_written" && !e.payload.mapOnly).length;
  return { done, total: s.payload.total, state: "running" };
}

export function BriefView({ events, open }: { events: StudioEvent[]; open?: (path: string) => void }) {
  const plan = events.findLast((e) => e.type === "reading_planned");
  const briefEvent = events.findLast((e) => e.type === "repo_brief");
  const memos = events.filter((e) => e.type === "memo_written" && e.payload.level === "file" && !e.payload.mapOnly);
  const index = indexProgress(events);
  const rec = briefEvent?.type === "repo_brief" ? (briefEvent.payload.content as BriefRecord) : null;
  if (!plan && !rec) return null;
  const b = rec?.brief;
  return (
    <div className="brief">
      {b && rec && (
        <>
          <h3>
            Repo brief <span className="badge slate">by Reader · LLM description, not evidence</span>
            {briefEvent?.type === "repo_brief" && briefEvent.payload.fromCache && <span className="badge slate">from the cache</span>}
          </h3>
          <p className="brief-what">{b.what.text}</p>
          {b.users.length > 0 && (
            <>
              <h4>Who uses it</h4>
              <ul className="clean brief-list">
                {b.users.map((u) => (
                  <li key={u.who}>
                    <strong>{u.who}</strong>: {u.jobs.join("; ")}
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.features.length > 0 && (
            <>
              <h4>What it does</h4>
              <ul className="clean brief-list">
                {b.features.map((f) => (
                  <li key={f.name}>
                    <strong>{f.name}</strong>: {f.userAction} <Sources paths={f.paths} {...(open ? { open } : {})} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {(b.howItRuns.stack.length > 0 || b.howItRuns.parts.length > 0) && (
            <>
              <h4>How it runs</h4>
              {b.howItRuns.stack.length > 0 && <p className="small">{b.howItRuns.stack.join(" · ")}</p>}
              <ul className="clean brief-list">
                {b.howItRuns.parts.map((p) => (
                  <li key={p.name}>
                    <strong>{p.name}</strong>: {p.role} <Sources paths={p.paths} {...(open ? { open } : {})} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.concepts.length > 0 && (
            <details className="fold">
              <summary>Core concepts ({b.concepts.length})</summary>
              <ul className="clean brief-list">
                {b.concepts.map((c) => (
                  <li key={c.name}>
                    <strong>{c.name}</strong>: {c.meaning} <Sources paths={c.paths} {...(open ? { open } : {})} />
                  </li>
                ))}
              </ul>
            </details>
          )}
          {b.extensionPoints.length > 0 && (
            <>
              <h4>
                Where new behavior could attach <span className="badge amber">LLM assessment, not a guarantee</span>
              </h4>
              <ul className="clean brief-list">
                {b.extensionPoints.map((x) => (
                  <li key={x.where}>
                    <strong>{x.where}</strong>: {x.couldAttach} <Sources paths={x.paths} {...(open ? { open } : {})} />
                  </li>
                ))}
              </ul>
            </>
          )}
          {b.unknowns.length > 0 && (
            <>
              <h4>Open questions</h4>
              <ul className="clean brief-list">
                {b.unknowns.map((u) => (
                  <li key={u.question}>
                    {u.question} <span className="muted small">({u.why})</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small brief-coverage">
            Coverage, counted by Studio code: read {rec.coverage.read.length} files{rec.coverage.cut.length ? ` (${rec.coverage.cut.length} only the beginning)` : ""}
            {rec.coverage.noMemo.length ? `, ${rec.coverage.noMemo.length} without a memo` : ""}; {rec.coverage.mapOnly} tests or generated files from the map only; {rec.coverage.notReadYet} not read yet
            {rec.coverage.notDownloaded ? `; ${rec.coverage.notDownloaded} not downloaded` : ""}.
            {rec.droppedSources ? ` ${rec.droppedSources} source paths the model named were not in the repository and were dropped.` : ""}
          </p>
        </>
      )}
      {!b && <p className="muted small">The Reader is reading the planned files ({memos.length} summarized so far)…</p>}
      {index && (
        <p className="small brief-index">
          Background index: {index.done} of {index.total} {index.state === "running" ? "· running" : index.state === "finished" ? "· finished" : "· stopped"}
        </p>
      )}
      {plan?.type === "reading_planned" && (
        <details className="fold" open={!b}>
          <summary>
            Reading plan: {plan.payload.files.length} files {plan.payload.byCode ? "(by code, the Reader's plan was not usable)" : "(chosen by the Reader)"}
          </summary>
          <ul className="clean small brief-plan">
            {plan.payload.files.map((f) => {
              const done = memos.some((m) => m.type === "memo_written" && m.payload.path === f.path);
              return (
                <li key={f.path}>
                  <span className={done ? "plan-dot on" : "plan-dot"} title={done ? "summarized" : "not summarized yet"} aria-label={done ? "summarized" : "not summarized yet"} />{" "}
                  {open ? (
                    <button type="button" className="file-link mono" onClick={() => open(f.path)}>
                      {f.path}
                    </button>
                  ) : (
                    <span className="mono">{f.path}</span>
                  )}{" "}
                  <span className="muted">{f.why}</span>
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </div>
  );
}
