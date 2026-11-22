// Repo_Brief: the foreground part of the Repo_Memo that the meeting waits for (design.md, "Repo_Memo: brief
// first, index in the background"; R10.7-R10.11). Code ranks the files and outlines the docs; the Reader plans
// a bounded set of files (caps enforced here), writes file memos for them, then one brief in a generic format.
// Coverage is computed here, never by the model; source paths the model names must exist in the Repo_Map.
import { z } from "zod";
import type { MapEntry, RepoMap } from "./map.ts";
import { batchesFor, memoizeBatch, renderMemo, type MemoEvents, type MemoRecord, type MemoWriter } from "./memo.ts";

const short = z.string().trim().min(1).max(400);
const label = z.string().trim().min(1).max(120);
const paths = z.array(z.string().trim().min(1).max(300)).max(8);
const items = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max);

export const ReadingPlanSchema = z.object({ files: z.array(z.object({ path: z.string().trim().min(1).max(300), why: short })).min(1).max(80) });
export type ReadingPlan = z.infer<typeof ReadingPlanSchema>;

export const BRIEF_KINDS = ["web_app", "service", "library", "cli", "desktop_app", "mobile_app", "framework", "other"] as const;
/** One format for every repository; a field that does not apply says so, unknowns go to `unknowns`. */
export const RepoBriefSchema = z.object({
  what: z.object({ text: short, kind: z.enum(BRIEF_KINDS), sources: paths }),
  users: z.array(z.object({ who: label, jobs: items(8), sources: paths })).min(1).max(6),
  howItRuns: z.object({ stack: items(12), parts: z.array(z.object({ name: label, role: short, paths })).max(10), entryPoints: items(6), sources: paths }),
  concepts: z.array(z.object({ name: label, meaning: short, paths })).max(12),
  features: z.array(z.object({ name: label, userAction: short, paths })).max(16),
  extensionPoints: z.array(z.object({ where: short, couldAttach: short, paths })).max(8),
  unknowns: z.array(z.object({ question: short, why: short })).max(8),
});
export type RepoBrief = z.infer<typeof RepoBriefSchema>;

export interface Coverage {
  /** README, docs pages and planned files whose text was given to the Reader (cut ones are listed in `cut`). */
  read: string[];
  cut: string[];
  /** Planned files the model did not describe (visible "no memo" marks). */
  noMemo: string[];
  mapOnly: number;
  /** Files left for the background Repo_Index. */
  notReadYet: number;
  notDownloaded: number;
}
export interface PlannedFile {
  path: string;
  why: string;
}
export interface BriefRecord {
  brief: RepoBrief;
  coverage: Coverage;
  plan: PlannedFile[];
  planByCode: boolean;
  /** Source paths the model named that are not in the Repo_Map; dropped and counted. */
  droppedSources: number;
}
export interface BriefWriter {
  plan(prompt: string, signal: AbortSignal): Promise<ReadingPlan>;
  brief(prompt: string, signal: AbortSignal): Promise<RepoBrief>;
}
export interface BriefEvents extends MemoEvents {
  planned(plan: PlannedFile[], info: { byCode: boolean; dropped: number }): Promise<void>;
}
export interface BriefCaps {
  maxFiles: number; // GL_BRIEF_FILES, default 30
  maxBytes: number; // GL_BRIEF_KB, default 160 KB
}
export const DEFAULT_CAPS: BriefCaps = { maxFiles: 30, maxBytes: 160 * 1024 };
const README_BYTES = 32 * 1024;
const DOCS_FULL_BYTES = 48 * 1024;

// ---- code ranking and docs outline (no LLM) ----
const MANIFEST = /^(package\.json|pyproject\.toml|setup\.py|setup\.cfg|requirements\.txt|go\.mod|cargo\.toml|pom\.xml|build\.gradle(\.kts)?|gemfile|composer\.json|(docker-)?compose\.ya?ml|dockerfile)$/i;
const ENTRY = /^(main|app|index|server|cli|__main__|manage|wsgi|asgi|urls|routes?|router|settings|config)\.[a-z]+$/i;
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const depth = (p: string) => p.split("/").length - 1;
export const isReadme = (p: string) => /^readme(\.[a-z]+)?$/i.test(p);
export const isDocPage = (e: MapEntry) => e.language === "docs" && !e.mapOnly && !isReadme(e.path) && /(^|\/)(docs?|documentation|guides?)\//i.test(e.path);

export interface RankedFile {
  entry: MapEntry;
  importedBy: number;
  reason: string;
}
/** Source files by code: manifests, then entry points and routes, then by how many files import them. */
export function rankFiles(map: RepoMap): RankedFile[] {
  const indeg = new Map<string, number>();
  for (const e of map.entries) for (const i of e.imports) indeg.set(i, (indeg.get(i) ?? 0) + 1);
  const tier = (e: MapEntry) => (MANIFEST.test(base(e.path)) && depth(e.path) <= 1 ? 0 : ENTRY.test(base(e.path)) && depth(e.path) <= 3 ? 1 : 2);
  return map.entries
    .filter((e) => !e.mapOnly && !isReadme(e.path) && !isDocPage(e))
    .map((e) => {
      const n = indeg.get(e.path) ?? 0;
      const t = tier(e);
      return { entry: e, importedBy: n, reason: t === 0 ? "manifest" : t === 1 ? "entry point or routes" : n > 0 ? `imported by ${n} files` : "other", t };
    })
    .sort((a, b) => a.t - b.t || b.importedBy - a.importedBy || depth(a.entry.path) - depth(b.entry.path) || a.entry.path.localeCompare(b.entry.path))
    .map(({ entry, importedBy, reason }) => ({ entry, importedBy, reason }));
}

export interface DocPage {
  path: string;
  title: string;
  summary: string;
}
/** Title and first paragraph of every docs page (front matter title and description when present). */
export function docsOutline(map: RepoMap, files: Map<string, string>, max = 80): DocPage[] {
  return map.entries
    .filter(isDocPage)
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((e) => {
      let text = files.get(e.path) ?? "";
      let title = "";
      let summary = "";
      const fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
      if (fm) {
        title = fm[1]!.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? "";
        summary = fm[1]!.match(/^description:\s*["']?(.+?)["']?\s*$/m)?.[1] ?? "";
        text = text.slice(fm[0].length);
      }
      if (!title) title = text.match(/^#{1,2}\s+(.+?)\s*$/m)?.[1] ?? base(e.path);
      if (!summary) {
        const para = text.split(/\n\s*\n/).map((b) => b.trim()).find((b) => b && !b.startsWith("#") && !b.startsWith("import ") && !b.startsWith("<") && !b.startsWith("```"));
        summary = (para ?? "").replace(/\s+/g, " ");
      }
      return { path: e.path, title: title.slice(0, 120), summary: summary.slice(0, 200) };
    });
}

// ---- the reading plan: checked by code, with a labeled fallback ----
const cost = (e: MapEntry, batchBytes: number) => Math.min(e.bytes, batchBytes);
export function checkPlan(plan: ReadingPlan, map: RepoMap, caps: BriefCaps, batchBytes = 48 * 1024): { files: PlannedFile[]; dropped: number } {
  const out: PlannedFile[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  let dropped = 0;
  for (const f of plan.files) {
    const e = map.byPath.get(f.path);
    if (!e || e.mapOnly || isReadme(f.path) || seen.has(f.path) || out.length >= caps.maxFiles || bytes + cost(e, batchBytes) > caps.maxBytes) {
      dropped++;
      continue;
    }
    seen.add(f.path);
    out.push({ path: f.path, why: f.why });
    bytes += cost(e, batchBytes);
  }
  return { files: out, dropped };
}
/** Used when the plan call fails or names no usable file: docs pages first (at most 6), then the code ranking. */
export function planByCode(map: RepoMap, ranked: RankedFile[], outline: DocPage[], caps: BriefCaps, batchBytes = 48 * 1024): PlannedFile[] {
  const wish = [...outline.slice(0, 6).map((d) => ({ path: d.path, why: "docs page (code ranking)" })), ...ranked.map((r) => ({ path: r.entry.path, why: `${r.reason} (code ranking)` }))];
  return checkPlan({ files: wish }, map, caps, batchBytes).files;
}

// ---- prompts (deterministic; the variable part only) ----
function cutText(text: string, max: number): { text: string; cut: boolean } {
  if (Buffer.byteLength(text, "utf8") <= max) return { text, cut: false };
  let b = 0;
  const kept: string[] = [];
  for (const l of text.split("\n")) {
    b += Buffer.byteLength(l, "utf8") + 1;
    if (b > max) break;
    kept.push(l);
  }
  return { text: kept.join("\n"), cut: true };
}
function mapOverview(map: RepoMap): string {
  const mapOnly = map.entries.filter((e) => e.mapOnly).length;
  const langs = new Map<string, number>();
  for (const e of map.entries) langs.set(e.language, (langs.get(e.language) ?? 0) + 1);
  const top = map.dirs.get("")!;
  const count = (d: string) => map.entries.filter((e) => e.path.startsWith(`${d}/`)).length;
  return [
    `${map.entries.length} files (${mapOnly} tests, vendored or generated: map only). Languages: ${[...langs].sort((a, b) => b[1] - a[1]).map(([l, n]) => `${l} ${n}`).join(", ")}.`,
    `Top-level folders: ${top.subdirs.map((d) => `${d}/ (${count(d)})`).join(", ") || "none"}.`,
    `Top-level files: ${top.files.join(", ") || "none"}.`,
  ].join("\n");
}
function readmeOf(map: RepoMap, files: Map<string, string>): { path: string; text: string; cut: boolean } | null {
  const p = map.dirs.get("")!.files.find(isReadme);
  if (!p) return null;
  return { path: p, ...cutText(files.get(p) ?? "", README_BYTES) };
}
export function planPrompt(map: RepoMap, files: Map<string, string>, ranked: RankedFile[], outline: DocPage[], caps: BriefCaps): string {
  const readme = readmeOf(map, files);
  const rankedLines = ranked.slice(0, 150).map((r) => {
    const e = r.entry;
    return `- ${e.path} (${e.language}, ${Math.ceil(e.bytes / 1024)} KB, ${r.reason}${e.symbols.length ? `; ${e.symbols.slice(0, 6).join(", ")}` : ""})`;
  });
  return [
    `Reading plan. Choose the files to read so that you can write the Repo_Brief: at most ${caps.maxFiles} files and ${Math.floor(caps.maxBytes / 1024)} KB in total (code enforces both). The README is given in full and does not count. Submit with submit_reading_plan.`,
    `## Map (code)\n${mapOverview(map)}`,
    `## Docs pages (title and first paragraph)\n${outline.map((d) => `- ${d.path}: ${d.title}${d.summary ? ` — ${d.summary}` : ""}`).join("\n") || "none"}`,
    `## Source files, ranked by code (manifests, entry points, then by how many files import them)\n${rankedLines.join("\n") || "none"}${ranked.length > 150 ? `\n(${ranked.length - 150} more not listed)` : ""}`,
    readme ? `## ${readme.path}${readme.cut ? " (cut: only the beginning)" : ""}\n\`\`\`\n${readme.text}\n\`\`\`` : "## README\nnone",
  ].join("\n\n");
}
export function briefPrompt(map: RepoMap, files: Map<string, string>, plan: PlannedFile[], records: Record<string, MemoRecord>): { prompt: string; fullDocs: string[] } {
  const readme = readmeOf(map, files);
  const docs: string[] = [];
  const fullDocs: string[] = [];
  let docBytes = 0;
  const memoLines: string[] = [];
  for (const f of plan) {
    const e = map.byPath.get(f.path)!;
    if (isDocPage(e) && docBytes + e.bytes <= DOCS_FULL_BYTES) {
      docBytes += e.bytes;
      fullDocs.push(f.path);
      docs.push(`### ${f.path}\n\`\`\`\n${files.get(f.path) ?? ""}\n\`\`\``);
    } else memoLines.push(records[f.path] ? renderMemo({ commit: "", promptVersion: "", records }, f.path) : `## ${f.path}\n(no memo)`);
  }
  const prompt = [
    "Repo_Brief for the whole repository. Use only what is given here; list what you do not know under `unknowns`. Every claim names its source paths. Submit with submit_repo_brief.",
    `## Map (code)\n${mapOverview(map)}`,
    readme ? `## ${readme.path}${readme.cut ? " (cut: only the beginning)" : ""}\n\`\`\`\n${readme.text}\n\`\`\`` : "## README\nnone",
    `## Docs pages read in full\n${docs.join("\n\n") || "none"}`,
    `## Memos of the other planned files\n${memoLines.join("\n\n") || "none"}`,
  ].join("\n\n");
  return { prompt, fullDocs };
}

// ---- source check (code) ----
export function checkSources(brief: RepoBrief, map: RepoMap): { brief: RepoBrief; dropped: number } {
  let dropped = 0;
  const ok = (p: string) => {
    const q = p.replace(/^\.?\//, "").replace(/\/$/, "");
    const hit = map.byPath.has(q) || (q !== "" && map.dirs.has(q));
    if (!hit) dropped++;
    return hit;
  };
  const f = (ps: string[]) => ps.filter(ok);
  const b: RepoBrief = {
    what: { ...brief.what, sources: f(brief.what.sources) },
    users: brief.users.map((u) => ({ ...u, sources: f(u.sources) })),
    howItRuns: { ...brief.howItRuns, parts: brief.howItRuns.parts.map((p) => ({ ...p, paths: f(p.paths) })), sources: f(brief.howItRuns.sources) },
    concepts: brief.concepts.map((c) => ({ ...c, paths: f(c.paths) })),
    features: brief.features.map((x) => ({ ...x, paths: f(x.paths) })),
    extensionPoints: brief.extensionPoints.map((x) => ({ ...x, paths: f(x.paths) })),
    unknowns: brief.unknowns,
  };
  return { brief: b, dropped };
}

// ---- the foreground build ----
export interface BriefBuildOptions {
  map: RepoMap;
  files: Map<string, string>;
  writer: MemoWriter & BriefWriter;
  events: BriefEvents;
  signal: AbortSignal;
  caps?: BriefCaps;
  batchBytes?: number;
  concurrency?: number;
  /** Files the download skipped (read-volume limit, binary, too large). */
  notDownloaded?: number;
}
export interface BriefResult {
  records: Record<string, MemoRecord>;
  brief: BriefRecord;
}
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  }));
}
/** Plans, memoizes the planned files, writes the brief. Throws when no valid brief is submitted (the writer has recorded the failure). */
export async function buildBrief(o: BriefBuildOptions): Promise<BriefResult> {
  const caps = o.caps ?? DEFAULT_CAPS;
  const batchBytes = o.batchBytes ?? 48 * 1024;
  const ranked = rankFiles(o.map);
  const outline = docsOutline(o.map, o.files);
  // 1. Plan (one call), checked by code; a failed or empty plan falls back to the code ranking, labeled.
  let plan: PlannedFile[] = [];
  let dropped = 0;
  let byCode = false;
  try {
    const checked = checkPlan(await o.writer.plan(planPrompt(o.map, o.files, ranked, outline, caps), o.signal), o.map, caps, batchBytes);
    plan = checked.files;
    dropped = checked.dropped;
  } catch {
    plan = []; // the writer recorded the failure
  }
  if (plan.length === 0) {
    byCode = true;
    plan = planByCode(o.map, ranked, outline, caps, batchBytes);
  }
  await o.events.planned(plan, { byCode, dropped });
  // 2. File memos for the planned files, in plan order, batched across directories.
  const records: Record<string, MemoRecord> = {};
  const put = async (key: string, r: MemoRecord, files: number) => {
    records[key] = r;
    await o.events.written(r, { files, fromCache: false });
  };
  const batches = batchesFor(plan.map((f) => o.map.byPath.get(f.path)!), o.files, batchBytes);
  await pool(batches, o.concurrency ?? 4, async (batch) => {
    if (o.signal.aborted) return;
    await memoizeBatch({ map: o.map, writer: o.writer, events: o.events, signal: o.signal }, "(planned files from several folders)", batch, put);
  });
  if (o.signal.aborted) throw new Error("stopped");
  // 3. The brief (one call); source paths checked against the map; coverage by code.
  const { prompt, fullDocs } = briefPrompt(o.map, o.files, plan, records);
  const checked = checkSources(RepoBriefSchema.parse(await o.writer.brief(prompt, o.signal)), o.map);
  const readme = readmeOf(o.map, o.files);
  const cutFiles = batches.flat().filter((f) => f.cut).map((f) => f.path);
  const planned = new Set(plan.map((f) => f.path));
  const read = [...(readme ? [readme.path] : []), ...plan.map((f) => f.path)];
  const coverage: Coverage = {
    read,
    cut: [...(readme?.cut ? [readme.path] : []), ...cutFiles.filter((p) => !fullDocs.includes(p))],
    noMemo: plan.filter((f) => records[f.path]?.level === "file" && (records[f.path] as { source: string }).source === "missing" && !fullDocs.includes(f.path)).map((f) => f.path),
    mapOnly: o.map.entries.filter((e) => e.mapOnly).length,
    notReadYet: o.map.entries.filter((e) => !e.mapOnly && !planned.has(e.path) && e.path !== readme?.path).length,
    notDownloaded: o.notDownloaded ?? 0,
  };
  return { records, brief: { brief: checked.brief, coverage, plan, planByCode: byCode, droppedSources: checked.dropped } };
}

// ---- rendering (agents, Workspace, REPO_MEMO.md) ----
const src = (ps: string[]) => (ps.length ? ` (${ps.join(", ")})` : "");
export function renderBrief(r: BriefRecord): string {
  const b = r.brief;
  const c = r.coverage;
  const lines = [`## Repo brief`, `${b.what.text} Kind: ${b.what.kind.replace("_", " ")}.${src(b.what.sources)}`, "", "### Who uses it"];
  for (const u of b.users) lines.push(`- ${u.who}: ${u.jobs.join("; ")}${src(u.sources)}`);
  lines.push("", "### How it runs", `Stack: ${b.howItRuns.stack.join(", ") || "not stated"}.`);
  for (const p of b.howItRuns.parts) lines.push(`- ${p.name}: ${p.role}${src(p.paths)}`);
  if (b.howItRuns.entryPoints.length) lines.push(`Entry points: ${b.howItRuns.entryPoints.join(", ")}`);
  if (b.concepts.length) lines.push("", "### Core concepts", ...b.concepts.map((x) => `- ${x.name}: ${x.meaning}${src(x.paths)}`));
  if (b.features.length) lines.push("", "### Features", ...b.features.map((x) => `- ${x.name}: ${x.userAction}${src(x.paths)}`));
  if (b.extensionPoints.length) lines.push("", "### Extension points (LLM assessment, not a guarantee)", ...b.extensionPoints.map((x) => `- ${x.where}: ${x.couldAttach}${src(x.paths)}`));
  if (b.unknowns.length) lines.push("", "### Unknowns", ...b.unknowns.map((x) => `- ${x.question} (${x.why})`));
  lines.push(
    "",
    "### Coverage (computed by code)",
    `Read: ${c.read.length} files${c.cut.length ? `, ${c.cut.length} of them only the beginning` : ""}. No memo: ${c.noMemo.length}. Map only (tests, vendored, generated): ${c.mapOnly}. Not read yet (background index): ${c.notReadYet}. Not downloaded: ${c.notDownloaded}.`,
    `Reading plan: ${r.planByCode ? "by code (the Reader's plan was not usable)" : "by the Reader"}.${r.droppedSources ? ` ${r.droppedSources} source paths not in the repository were dropped.` : ""}`,
  );
  return lines.join("\n");
}
