// Checks for publishing Replay_Files on the public front end (task 17.6; R27.13, R26.8). Pure functions, used by
// scripts/replay-publish.ts and tested next to it. A Replay is published only when it is a labeled Replay of the
// named Task and contains no secret pattern and no private fact (local paths, private addresses, given values).
import { findSecretPatterns } from "@graftlab/shared";

export interface PublishEntry {
  taskId: string;
  repo: string;
  terminal: string;
  createdAt: string;
}
export type ReplayCheck = { ok: true; entry: PublishEntry; shots: string[] } | { ok: false; problems: string[] };

// Private facts that must never be on the public site. Only the rule names are reported, never the matched text.
const PRIVATE_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Windows drive path", re: /\b[A-Za-z]:\\\\/ },
  { name: "macOS home path", re: /\/Users\/[A-Za-z0-9._-]+/ },
  { name: "Linux home path", re: /\/home\/[A-Za-z0-9._-]+\// },
  { name: "private VPN address (100.64.0.0/10)", re: /\b100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/ },
  { name: "e-mail address", re: /\b[A-Za-z0-9._%+-]+@(outlook|gmail|qq|163|hotmail|icloud)\.com\b/i },
];

/** Values of `KEY=VALUE` lines of a private-values file; comments and short values are ignored. */
export function siteValues(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.slice(l.indexOf("=") + 1).trim())
    .filter((v) => v.length >= 6);
}

/** Problem names in a Replay text: secret patterns, private patterns and site values (named by position only). */
export function privacyProblems(text: string, site: readonly string[]): string[] {
  return [
    ...findSecretPatterns(text).map((n) => `secret pattern: ${n}`),
    ...PRIVATE_PATTERNS.filter((p) => p.re.test(text)).map((p) => `private: ${p.name}`),
    ...site.flatMap((v, i) => (text.includes(v) ? [`private: site value ${i + 1}`] : [])),
  ];
}

/** Checks one Replay_File's text for publishing and lists the screenshots its events name. */
export function checkReplay(taskId: string, text: string, site: readonly string[]): ReplayCheck {
  let file: { header?: { label?: string; taskId?: string; repo?: string; createdAt?: string }; events?: { type?: string; payload?: Record<string, unknown> }[] };
  try {
    file = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["not JSON"] };
  }
  const h = file.header;
  const problems: string[] = [];
  if (h?.label !== "Replay") problems.push('header label is not "Replay"');
  if (h?.taskId !== taskId) problems.push("header taskId does not match the file name");
  if (!Array.isArray(file.events) || file.events.length === 0) problems.push("no events");
  problems.push(...privacyProblems(text, site));
  if (problems.length > 0) return { ok: false, problems };
  const events = file.events!;
  const terminal = events.findLast((e) => e.type === "terminal_reached")?.payload?.terminal;
  const refs = events.flatMap((e) => {
    const p = e.payload ?? {};
    if (e.type === "browser_observation" && typeof p.screenshotRef === "string") return [p.screenshotRef];
    if (e.type === "artifact_updated" && p.artifactKind === "screenshot" && typeof p.ref === "string") return [p.ref];
    return [];
  });
  const shots = [...new Set(refs.map((r) => r.split("/").pop() ?? "").filter((n) => /^[A-Za-z0-9_-]{1,80}\.jpg$/.test(n)))];
  return { ok: true, entry: { taskId, repo: h!.repo ?? "unknown", terminal: typeof terminal === "string" ? terminal : "unknown", createdAt: h!.createdAt ?? "" }, shots };
}
