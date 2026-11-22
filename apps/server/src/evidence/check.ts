// Evidence checker (design.md, "Evidence checker"; R24.1-R24.6). Studio code, no LLM: a reference passes when
// the cited file was downloaded and its whitespace-normalized text contains the whitespace-normalized snippet of
// at least 8 non-whitespace characters. A conclusion passes when at least one reference passes. The model never
// sets `status` or `reason`; a passed check proves only that the file and snippet exist (R24.6).
import type { EvidenceRef } from "@graftlab/shared";

export type EvidenceReason = "file_missing" | "not_downloaded" | "snippet_absent" | "snippet_too_short";
export const MIN_SNIPPET_CHARS = 8;
export interface EvidenceFiles {
  /** Downloaded file text by path. */
  text(path: string): string | undefined;
  /** True for a repository path that exists but was skipped by the read limit (binary, too large, over the limit). */
  skipped(path: string): boolean;
}
export const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const nonWhitespace = (s: string) => s.replace(/\s/g, "").length;

export function checkRef(ref: Pick<EvidenceRef, "path" | "line" | "snippet">, files: EvidenceFiles): EvidenceRef {
  const base: EvidenceRef = { path: ref.path, snippet: ref.snippet, ...(ref.line !== undefined ? { line: ref.line } : {}) };
  const text = files.text(ref.path);
  if (text === undefined) return { ...base, status: "unverified", reason: files.skipped(ref.path) ? "not_downloaded" : "file_missing" };
  if (nonWhitespace(ref.snippet) < MIN_SNIPPET_CHARS) return { ...base, status: "unverified", reason: "snippet_too_short" };
  if (!normalize(text).includes(normalize(ref.snippet))) return { ...base, status: "unverified", reason: "snippet_absent" };
  return { ...base, status: "passed" };
}

/** R24.5: passed iff at least one reference passed; no reference at all is Unverified. */
export function checkConclusion(refs: Pick<EvidenceRef, "path" | "line" | "snippet">[], files: EvidenceFiles): { evidence: EvidenceRef[]; status: "passed" | "unverified" } {
  const evidence = refs.map((r) => checkRef(r, files));
  return { evidence, status: evidence.some((r) => r.status === "passed") ? "passed" : "unverified" };
}

export function filesFrom(texts: Map<string, string>, skipped: Iterable<string> = []): EvidenceFiles {
  const s = new Set(skipped);
  return { text: (p) => texts.get(p), skipped: (p) => s.has(p) };
}
