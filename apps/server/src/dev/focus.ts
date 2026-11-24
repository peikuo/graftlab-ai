// The focus pack of one Feature (design.md, "PiCodeRuntime"; R40.19). Built by code at the Feature's start from the
// Repo_Memo and the current `main`: a map of where to look, not the code. The Code_Agent reads the code itself.
// It reaches the agent through pi's own context-file mechanism (the runner returns it as the project context).
import { languageOf, symbolsOf } from "../reader/map.ts";
import type { MemoRecord, MemoTree } from "../reader/memo.ts";
import type { Feature, TechDesign } from "@graftlab/shared";

export interface FocusInput {
  feature: Feature;
  design: TechDesign;
  memo: MemoTree | null;
  /** File texts of the current `main` (path -> text); planned files that do not exist yet are absent. */
  read: (path: string) => string | undefined;
  /** Every file path of the repository at the current `main`. */
  paths: string[];
  /** Files `main` changed since the pinned commit (earlier Features): their summaries may be outdated. */
  changedSincePinned: string[];
  maxBytes?: number;
}

export interface FocusPack {
  text: string;
  /** The files the pack points at (planned, neighbors, example test), for the focus measurement. */
  files: string[];
}

const fileMemo = (memo: MemoTree | null, path: string) => {
  const r = memo?.records[path] as MemoRecord | undefined;
  return r && r.level === "file" ? r : undefined;
};

/** Repository paths a file imports (Python and JavaScript/TypeScript forms), resolved against the known paths. */
export function importsOf(path: string, text: string, paths: Set<string>): string[] {
  const out = new Set<string>();
  const lang = languageOf(path);
  if (lang === "python") {
    for (const m of text.matchAll(/^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] ?? m[2] ?? "").replace(/^\.+/, "");
      if (!mod) continue;
      const base = mod.split(".").join("/");
      for (const c of [`${base}.py`, `${base}/__init__.py`]) if (paths.has(c)) out.add(c);
    }
  } else if (lang === "javascript" || lang === "typescript") {
    const dir = path.split("/").slice(0, -1);
    for (const m of text.matchAll(/(?:import[^'"]*from\s*|import\s*\(|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const parts = [...dir];
      for (const seg of m[1]!.split("/")) {
        if (seg === "..") parts.pop();
        else if (seg !== ".") parts.push(seg);
      }
      const base = parts.join("/");
      for (const c of [base, `${base}.js`, `${base}.ts`, `${base}.tsx`, `${base}/index.js`, `${base}/index.ts`]) if (paths.has(c)) out.add(c);
    }
  }
  out.delete(path);
  return [...out].sort();
}

/** An existing test file next to the planned ones, as an example of the project's test style. */
export function exampleTest(planned: string[], paths: string[], size: (p: string) => number = () => 0): string | undefined {
  const dirs = new Set(planned.map((p) => p.split("/").slice(0, -1).join("/")));
  const plannedSet = new Set(planned);
  const candidates = paths.filter((p) => dirs.has(p.split("/").slice(0, -1).join("/")) && !plannedSet.has(p) && /(^|\/)(test_[^/]+\.py|[^/]+\.test\.[jt]sx?|[^/]+_test\.py)$/.test(p));
  // Prefer the one whose name shares the most words with a planned test.
  const words = (p: string) => new Set(p.split("/").pop()!.replace(/\.[^.]+$/, "").split(/[_.-]+/));
  const score = (c: string) => Math.max(0, ...planned.map((p) => [...words(c)].filter((w) => words(p).has(w) && w !== "test").length));
  // Ties: the larger file shows more of the project's test style.
  return candidates.sort((a, b) => score(b) - score(a) || size(b) - size(a) || a.localeCompare(b))[0];
}

export function buildFocusPack(i: FocusInput): FocusPack {
  const f = i.feature;
  const max = i.maxBytes ?? 30_000;
  const paths = new Set(i.paths);
  const outdated = new Set(i.changedSincePinned);
  const planned = [...new Set([...f.scope.files, ...f.tests.files])];
  const lines: string[] = [`# Focus for Feature ${f.id}: ${f.title}`, "A map built by Studio code from the repository summaries and the current code. Read the files themselves before you change them; summaries can be wrong."];
  const describe = (p: string, withOutline: boolean) => {
    const m = fileMemo(i.memo, p);
    const text = i.read(p);
    const head = `- \`${p}\`${text === undefined ? " (does not exist yet)" : ""}${outdated.has(p) ? " (changed by an earlier Feature; the summary may be outdated)" : ""}`;
    const memo = m && m.source === "llm" ? `\n  ${m.purpose}${m.keySymbols.length ? ` Key parts: ${m.keySymbols.join(", ")}.` : ""}` : "";
    const outline = withOutline && text !== undefined ? symbolsOf(languageOf(p), text, 25) : [];
    return `${head}${memo}${outline.length ? `\n  Outline: ${outline.join(", ")}` : ""}`;
  };
  lines.push("## Planned files", ...planned.map((p) => describe(p, true)));
  // One hop: what the planned files import, and what the summaries relate them to.
  const neighbors = new Set<string>();
  for (const p of planned) {
    const text = i.read(p);
    if (text !== undefined) for (const n of importsOf(p, text, paths)) neighbors.add(n);
    for (const r of fileMemo(i.memo, p)?.relatesTo ?? []) if (paths.has(r)) neighbors.add(r);
  }
  for (const p of planned) neighbors.delete(p);
  const near = [...neighbors].sort().slice(0, 12);
  if (near.length) lines.push("## Direct neighbors (imported or related)", ...near.map((p) => describe(p, false)));
  const quotes = i.design.architecture.affected.flatMap((a) => a.quotes.filter((q) => q.status === "passed").map((q) => `- ${a.part}: \`${q.path}${q.line ? `:${q.line}` : ""}\` — \`${q.snippet.trim().slice(0, 160)}\``));
  if (quotes.length) lines.push("## Where the behavior lives today (quotes checked by Studio code)", ...quotes.slice(0, 10));
  const ex = exampleTest(f.tests.files, i.paths, (p) => i.read(p)?.length ?? 0);
  if (ex) {
    const t = (i.read(ex) ?? "").split("\n").slice(0, 60).join("\n");
    lines.push(`## An existing test next to yours: \`${ex}\` (first lines; follow its style)`, "```", t, "```");
  }
  let text = `${lines.join("\n\n")}\n`;
  if (text.length > max) text = `${text.slice(0, max)}\n… (the focus pack was cut at ${max} characters)\n`;
  return { text, files: [...planned, ...near, ...(ex ? [ex] : [])] };
}

/** Paths the Code_Agent read, from the runner's tool inputs (read, grep, find, ls), for the focus measurement. */
export function readPaths(toolInputs: { tool: string; inputSummary: string }[]): string[] {
  const out = new Set<string>();
  for (const t of toolInputs) {
    if (t.tool !== "read") continue;
    const m = /"path"\s*:\s*"([^"]+)"/.exec(t.inputSummary);
    if (m) out.add(m[1]!.replace(/^\/work\//, ""));
  }
  return [...out];
}
