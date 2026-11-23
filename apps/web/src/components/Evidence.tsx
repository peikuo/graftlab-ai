// "Why we think so" (R11.13, R24.6): the quoted lines behind a statement or a stance, with the file and the
// Studio check in words. Internal evidence ids are never shown.
import type { EvidenceRef } from "@graftlab/shared";

const REASON: Record<string, string> = {
  snippet_absent: "this text is not in the file",
  file_missing: "there is no such file in the repository",
  not_downloaded: "the file was not downloaded (size or read limit)",
  snippet_too_short: "the quote is too short to check",
};
const fileName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

export function EvidenceFold({ evidence, label = "Why we think so" }: { evidence: EvidenceRef[]; label?: string }) {
  if (evidence.length === 0) return <p className="muted small evidence-none">No quote from the code yet, so this is Unverified.</p>;
  const found = evidence.filter((e) => e.status === "passed").length;
  return (
    <details className="evidence">
      <summary>
        {label} · {evidence.length === 1 ? "1 quote" : `${evidence.length} quotes`}
        {found < evidence.length && <span className="badge red">{evidence.length - found} not found</span>}
      </summary>
      <ul className="clean">
        {evidence.map((e, i) => (
          <li key={i} className={e.status === "passed" ? "ev ok" : "ev bad"}>
            <blockquote>{e.snippet.trim().slice(0, 400)}</blockquote>
            <div className="small">
              <span className="mono" title={e.path}>{fileName(e.path)}</span>
              {e.line ? <span className="muted">, line {e.line}</span> : null}
              {" · "}
              {e.status === "passed" ? <span className="ev-ok">✓ found in the file by Studio code</span> : <span className="failure-text">Unverified: {REASON[e.reason ?? ""] ?? "not checked"}</span>}
            </div>
          </li>
        ))}
      </ul>
      <p className="muted small">A found quote proves only that this text exists in the file, not that the conclusion is right.</p>
    </details>
  );
}
