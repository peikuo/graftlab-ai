// Repo_Memo builder (design.md, "Repo_Memo"; R10.7-R10.12). File memos in batches per directory (shared by the
// foreground Repo_Brief and the background Repo_Index), then directory memos from their children only, then
// optionally a root memo (the Repo_Brief replaces it in the Task flow). The LLM calls sit behind MemoWriter, so this
// module is plain code: batching, order, concurrency, the time-short fallback, coverage marks, cache, rendering.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { dirsDeepestFirst, type MapEntry, type RepoMap } from "./map.ts";

const short = z.string().trim().min(1).max(400);
const list = (max: number) => z.array(z.string().trim().min(1).max(200)).max(max);

// Over-long lists are cut by code (deterministic) instead of rejected: a rejection costs a whole model call.
const capped = (max: number) => z.array(z.string().trim().min(1).max(200)).transform((a) => a.slice(0, max));
export const FileMemoSchema = z.object({ path: z.string().min(1), purpose: short, keySymbols: capped(8), relatesTo: capped(12), features: capped(4).optional(), notes: z.string().max(400).optional() });
export const DirMemoSchema = z.object({ purpose: short, contains: list(60), entryPoints: list(4), featuresHere: list(6) });
export const RootMemoSchema = DirMemoSchema.extend({ workflows: z.array(z.object({ name: short, paths: list(8) })).max(8) });

export type FileMemoInput = z.infer<typeof FileMemoSchema>;

export type MemoRecord =
  | ({ level: "file"; source: "llm" | "map" | "missing" } & FileMemoInput)
  | ({ level: "directory"; path: string; source: "llm" | "map" } & z.infer<typeof DirMemoSchema>)
  | ({ level: "root"; path: ""; source: "llm" | "map" } & z.infer<typeof RootMemoSchema>);

export interface MemoTree {
  commit: string;
  promptVersion: string;
  records: Record<string, MemoRecord>; // file memos by path; directory memos by "dir:<path>"; root by "dir:"
  /** The Repo_Brief (brief.ts), written before the meeting. */
  brief?: unknown;
  /** The background Repo_Index finished for this commit. */
  indexComplete?: boolean;
}

export const dirKey = (path: string) => `dir:${path}`;

/** One file of a batch, with its map entry; long files are cut at a line boundary. */
export interface BatchFile {
  path: string;
  text: string;
  cut: boolean;
  map: MapEntry;
}

export interface ChildLine {
  path: string;
  kind: "file" | "directory";
  line: string;
}

export interface MemoWriter {
  /** Returns memos for (ideally) every file of the batch; files left out are marked "missing" by the builder. */
  files(dir: string, batch: BatchFile[], signal: AbortSignal): Promise<FileMemoInput[]>;
  directory(path: string, children: ChildLine[], signal: AbortSignal): Promise<z.infer<typeof DirMemoSchema>>;
  root(children: ChildLine[], signal: AbortSignal): Promise<z.infer<typeof RootMemoSchema>>;
}

export interface MemoEvents {
  written(r: MemoRecord, info: { files: number; fromCache: boolean }): Promise<void>;
  /** A visible failure of the Reader's output (for example files left out of a batch), before a retry or a mark. */
  failure?(detail: string): Promise<void>;
}

export interface BuildOptions {
  commit: string;
  promptVersion: string;
  map: RepoMap;
  files: Map<string, string>;
  writer: MemoWriter;
  events: MemoEvents;
  signal: AbortSignal;
  batchBytes?: number; // GL_MEMO_BATCH_KB, default 48 KB
  concurrency?: number; // GL_MEMO_CONCURRENCY, default 4
  /** When now() passes this, remaining work falls back to map-only memos; the root is always written. */
  deadline?: number;
  now?: () => number;
  /** Records written earlier (the foreground memos); LLM file memos among them are reused, not written again. */
  reuse?: Record<string, MemoRecord>;
  /** Write the root memo (default true). The Task flow writes the Repo_Brief instead. */
  withRoot?: boolean;
}

/** Splits a directory's memo-worthy files into batches of at most batchBytes; a large file is cut alone. */
export function batchesFor(entries: MapEntry[], files: Map<string, string>, batchBytes: number): BatchFile[][] {
  const out: BatchFile[][] = [];
  let cur: BatchFile[] = [];
  let size = 0;
  for (const e of entries) {
    let text = files.get(e.path) ?? "";
    let cut = false;
    if (Buffer.byteLength(text, "utf8") > batchBytes) {
      const lines = text.split("\n");
      const kept: string[] = [];
      let b = 0;
      for (const l of lines) {
        b += Buffer.byteLength(l, "utf8") + 1;
        if (b > batchBytes) break;
        kept.push(l);
      }
      text = kept.join("\n");
      cut = true;
    }
    const n = Buffer.byteLength(text, "utf8");
    if (cur.length > 0 && size + n > batchBytes) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push({ path: e.path, text, cut, map: e });
    size += n;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** A map-only file memo (tests, vendored, generated code, or no time left): built from the map, never from an LLM. */
export function mapFileMemo(e: MapEntry, reason: string): MemoRecord {
  const what = e.mapOnlyReason === "test" ? "Test file" : e.mapOnlyReason === "vendored" ? "Vendored third-party code" : e.mapOnlyReason === "generated" ? "Generated file" : `${e.language} file`;
  return { level: "file", source: "map", path: e.path, purpose: `${what} (${reason}).`, keySymbols: e.symbols.slice(0, 8), relatesTo: e.imports.slice(0, 12) };
}

function childLines(map: RepoMap, dir: string, records: Record<string, MemoRecord>): ChildLine[] {
  const d = map.dirs.get(dir)!;
  const subdirs = d.subdirs.map((p) => ({ path: p, kind: "directory" as const, line: records[dirKey(p)]?.purpose ?? "(no memo)" }));
  const files = d.files.map((p) => {
    const r = records[p];
    const tag = r?.level === "file" && r.source === "map" ? " [map only]" : r?.level === "file" && r.source === "missing" ? " [no memo]" : "";
    return { path: p, kind: "file" as const, line: `${r?.purpose ?? "(no memo)"}${tag}` };
  });
  return [...subdirs, ...files];
}

function mapDirMemo(map: RepoMap, dir: string, records: Record<string, MemoRecord>): MemoRecord {
  const d = map.dirs.get(dir)!;
  const symbols = d.files.flatMap((p) => map.byPath.get(p)?.symbols.slice(0, 2) ?? []).slice(0, 6);
  const purpose = `${d.files.length} files and ${d.subdirs.length} folders${symbols.length ? `, defining ${symbols.join(", ")}` : ""} (map only, no time for a summary).`;
  const contains = childLines(map, dir, records).map((c) => `${c.path}: ${c.line}`.slice(0, 200)).slice(0, 60);
  const base = { purpose, contains, entryPoints: [], featuresHere: [], source: "map" as const };
  return dir === "" ? { level: "root", path: "", ...base, workflows: [] } : { level: "directory", path: dir, ...base };
}

/** Runs tasks with a concurrency limit, in order of the input. */
async function pool<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

type Put = (key: string, r: MemoRecord, files: number) => Promise<void>;
/**
 * One batch of file memos. Files the model leaves out are retried once, as a visible retry, in one smaller batch
 * of only those files; a file still missing gets a visible "no memo" mark, never an invented memo.
 */
export async function memoizeBatch(o: { map: RepoMap; writer: MemoWriter; events: MemoEvents; signal: AbortSignal }, dir: string, batch: BatchFile[], put: Put): Promise<void> {
  const wanted = new Set(batch.map((f) => f.path));
  const take = async (files: BatchFile[]) => {
    let got: FileMemoInput[] = [];
    try {
      got = await o.writer.files(dir, files, o.signal);
    } catch {
      got = []; // the writer records the failure as an event
    }
    for (const m of got) {
      const parsed = FileMemoSchema.safeParse(m);
      if (!parsed.success || !wanted.has(parsed.data.path)) continue; // a memo for a file that is not asked for is dropped
      wanted.delete(parsed.data.path);
      await put(parsed.data.path, { level: "file", source: "llm", ...parsed.data, relatesTo: parsed.data.relatesTo.filter((p) => o.map.byPath.has(p)) }, 1);
    }
  };
  await take(batch);
  if (wanted.size > 0 && !o.signal.aborted) {
    await o.events.failure?.(`the Reader left out ${wanted.size} of ${batch.length} files (${[...wanted].slice(0, 6).join(", ")}${wanted.size > 6 ? ", …" : ""}); retrying them once`);
    await take(batch.filter((f) => wanted.has(f.path)));
  }
  for (const p of wanted) {
    const e = o.map.byPath.get(p)!;
    await put(p, { level: "file", source: "missing", path: p, purpose: "No memo: the model did not describe this file.", keySymbols: e.symbols.slice(0, 8), relatesTo: e.imports.slice(0, 12) }, 1);
  }
}
export async function buildMemo(o: BuildOptions): Promise<MemoTree> {
  const now = o.now ?? Date.now;
  const timeLeft = () => o.deadline === undefined || now() < o.deadline;
  const records: Record<string, MemoRecord> = {};
  for (const [k, r] of Object.entries(o.reuse ?? {})) if (r.level === "file" && r.source === "llm") records[k] = r;
  const put = async (key: string, r: MemoRecord, files: number) => {
    records[key] = r;
    await o.events.written(r, { files, fromCache: false });
  };

  // 1. Map-only files first (no LLM), then batches of the remaining files per directory.
  const llmBatches: { dir: string; batch: BatchFile[] }[] = [];
  for (const dir of dirsDeepestFirst(o.map)) {
    const entries = o.map.dirs.get(dir)!.files.map((p) => o.map.byPath.get(p)!);
    for (const e of entries.filter((x) => x.mapOnly)) await put(e.path, mapFileMemo(e, e.mapOnlyReason ?? "map only"), 1);
    for (const batch of batchesFor(entries.filter((x) => !x.mapOnly && !records[x.path]), o.files, o.batchBytes ?? 48 * 1024)) llmBatches.push({ dir, batch });
  }
  await pool(llmBatches, o.concurrency ?? 4, async ({ dir, batch }) => {
    if (o.signal.aborted) return;
    if (!timeLeft()) {
      for (const f of batch) await put(f.path, mapFileMemo(f.map, "no time for a summary"), 1);
      return;
    }
    await memoizeBatch({ map: o.map, writer: o.writer, events: o.events, signal: o.signal }, dir, batch, put);
  });
  // 2. Directories, deepest first; one level at a time so every child memo exists before its parent.
  const order = dirsDeepestFirst(o.map).filter((d) => d !== "");
  const depth = (d: string) => d.split("/").length;
  const levels = [...new Set(order.map(depth))].sort((a, b) => b - a);
  for (const level of levels) {
    await pool(order.filter((d) => depth(d) === level), o.concurrency ?? 4, async (dir) => {
      if (o.signal.aborted) return;
      const files = o.map.dirs.get(dir)!.files.length;
      if (!timeLeft()) return put(dirKey(dir), mapDirMemo(o.map, dir, records), files);
      try {
        const m = DirMemoSchema.parse(await o.writer.directory(dir, childLines(o.map, dir, records), o.signal));
        await put(dirKey(dir), { level: "directory", path: dir, source: "llm", ...m }, files);
      } catch {
        await put(dirKey(dir), mapDirMemo(o.map, dir, records), files);
      }
    });
  }

  // 3. The root memo is always written: from the LLM when possible, otherwise from the map.
  const rootFiles = o.map.entries.length;
  if (!o.signal.aborted && o.withRoot !== false) {
    try {
      if (!timeLeft()) throw new Error("no time");
      const m = RootMemoSchema.parse(await o.writer.root(childLines(o.map, "", records), o.signal));
      await put(dirKey(""), { level: "root", path: "", source: "llm", ...m }, rootFiles);
    } catch {
      await put(dirKey(""), mapDirMemo(o.map, "", records), rootFiles);
    }
  }
  return { commit: o.commit, promptVersion: o.promptVersion, records };
}

// ---- cache (R10.9) ----

export function memoCachePath(root: string, owner: string, repo: string, commit: string, promptVersion: string): string {
  return join(root, "memo", owner.toLowerCase(), repo.toLowerCase(), commit, `memo-${promptVersion.replace(/[^\w.-]/g, "_")}.json`);
}

export async function readMemoCache(file: string): Promise<MemoTree | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as MemoTree;
  } catch {
    return null;
  }
}

export async function writeMemoCache(file: string, tree: MemoTree): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(tree));
}

// ---- rendering (one deterministic function for agents, the Workspace and REPO_MEMO.md) ----

export function renderMemo(tree: MemoTree, key: string): string {
  const r = tree.records[key];
  if (!r) return `no memo for "${key.replace(/^dir:/, "") || "/"}"`;
  if (r.level === "file") {
    const lines = [`## ${r.path}`, r.purpose];
    if (r.keySymbols.length) lines.push(`Key symbols: ${r.keySymbols.join(", ")}`);
    if (r.relatesTo.length) lines.push(`Works with: ${r.relatesTo.join(", ")}`);
    if (r.features?.length) lines.push(`Features: ${r.features.join("; ")}`);
    if (r.notes) lines.push(`Note: ${r.notes}`);
    if (r.source !== "llm") lines.push(r.source === "map" ? "(map only)" : "(no memo)");
    return lines.join("\n");
  }
  const lines = [`## ${r.path || "/ (whole repository)"}`, r.purpose];
  if (r.level === "root" && r.workflows.length) lines.push("Workflows:", ...r.workflows.map((w) => `- ${w.name}: ${w.paths.join(", ")}`));
  if (r.featuresHere.length) lines.push(`Features here: ${r.featuresHere.join("; ")}`);
  if (r.entryPoints.length) lines.push(`Start with: ${r.entryPoints.join(", ")}`);
  if (r.contains.length) lines.push("Contains:", ...r.contains.map((c) => `- ${c}`));
  if (r.source === "map") lines.push("(map only)");
  return lines.join("\n");
}

/** REPO_MEMO.md: the root, then every directory top-down with its files (an Output_Doc, layer C). */
export function renderRepoMemoDoc(tree: MemoTree, map: RepoMap): string {
  return [`# Repo memo\n\nCommit ${tree.commit}. Summaries are LLM descriptions, not evidence.`, renderMemo(tree, dirKey("")), ...renderIndexSections(tree, map)].join("\n\n") + "\n";
}
/** Every directory memo top-down, then every file memo; parts that have no memo yet are left out. */
export function renderIndexSections(tree: MemoTree, map: RepoMap): string[] {
  const parts: string[] = [];
  const dirs = [...map.dirs.keys()].filter((d) => d !== "").sort();
  for (const d of dirs) if (tree.records[dirKey(d)]) parts.push(renderMemo(tree, dirKey(d)));
  for (const f of map.dirs.get("")?.files ?? []) if (tree.records[f]) parts.push(renderMemo(tree, f));
  for (const d of dirs) for (const f of map.dirs.get(d)!.files) if (tree.records[f]) parts.push(renderMemo(tree, f));
  return parts;
}

/** search_memo: memos whose text matches the query (literal, case-insensitive), at most 20. */
export function searchMemo(tree: MemoTree, query: string, max = 20): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return Object.keys(tree.records)
    .sort()
    .filter((k) => renderMemo(tree, k).toLowerCase().includes(q))
    .slice(0, max);
}
