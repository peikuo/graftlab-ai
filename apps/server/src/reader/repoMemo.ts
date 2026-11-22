// The Repo_Memo in a Task (design.md, "Repo_Memo: brief first, index in the background"; R10.7-R10.12):
// Repo_Map, then the Repo_Brief in the foreground (the reading node waits for it), then the Repo_Index in the
// background (the meeting does not wait). Cached per commit and prompt version; REPO_MEMO.md is written to the
// Task's docs directory, never into the downloaded repository.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { Actor } from "@graftlab/shared";
import type { Emit } from "../runtime/pi.ts";
import { buildBrief, renderBrief, RepoBriefSchema, type BriefCaps, type BriefRecord, type BriefWriter } from "./brief.ts";
import { buildRepoMap, type RepoMap } from "./map.ts";
import { buildMemo, memoCachePath, readMemoCache, renderIndexSections, renderMemo, writeMemoCache, type MemoRecord, type MemoTree, type MemoWriter } from "./memo.ts";

const READER: Actor = { kind: "role", roleId: "reader" };
const paths = z.array(z.string());
export const BriefRecordSchema = z.object({
  brief: RepoBriefSchema,
  coverage: z.object({ read: paths, cut: paths, noMemo: paths, mapOnly: z.number().int().nonnegative(), notReadYet: z.number().int().nonnegative(), notDownloaded: z.number().int().nonnegative() }),
  plan: z.array(z.object({ path: z.string(), why: z.string() })),
  planByCode: z.boolean(),
  droppedSources: z.number().int().nonnegative(),
});

export interface RepoMemoOptions {
  files: { path: string; text: string }[];
  repo: { owner: string; repo: string; sha: string };
  cacheRoot: string;
  /** data/tasks/<id>/docs */
  docsDir: string;
  promptVersion: string;
  writer: MemoWriter & BriefWriter;
  emit: Emit;
  signal: AbortSignal;
  notDownloaded: number;
  caps?: BriefCaps;
  concurrency?: number; // GL_MEMO_CONCURRENCY
  indexConcurrency?: number; // GL_INDEX_CONCURRENCY
}
export interface RepoMemoHandle {
  map: RepoMap;
  brief: BriefRecord;
  /** The Repo_Index so far (grows while the background index runs). */
  tree: MemoTree;
}

/** Foreground: returns the Repo_Brief, or null after a visible failure. */
export async function buildRepoBrief(o: RepoMemoOptions): Promise<RepoMemoHandle | null> {
  const map = buildRepoMap(o.files);
  const cacheFile = memoCachePath(o.cacheRoot, o.repo.owner, o.repo.repo, o.repo.sha, o.promptVersion);
  const cached = await readMemoCache(cacheFile);
  const fromCache = cached ? BriefRecordSchema.safeParse(cached.brief) : null;
  if (cached && fromCache?.success) {
    const brief = fromCache.data as BriefRecord;
    await o.emit({ type: "reading_planned", actor: READER, payload: { files: brief.plan, byCode: brief.planByCode, dropped: 0 } });
    await o.emit({ type: "repo_brief", actor: READER, payload: { content: brief, fromCache: true } });
    await writeDoc(o.docsDir, cached, map, brief);
    return { map, brief, tree: cached };
  }
  const textByPath = new Map(o.files.map((f) => [f.path, f.text]));
  const failure = async (detail: string) => o.emit({ type: "failure", actor: READER, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail } });
  try {
    const r = await buildBrief({
      map,
      files: textByPath,
      writer: o.writer,
      signal: o.signal,
      notDownloaded: o.notDownloaded,
      ...(o.caps ? { caps: o.caps } : {}),
      ...(o.concurrency ? { concurrency: o.concurrency } : {}),
      events: {
        planned: (plan, i) => o.emit({ type: "reading_planned", actor: READER, payload: { files: plan, byCode: i.byCode, dropped: i.dropped } }),
        written: (m) => memoEvent(o.emit, m, false),
        failure,
      },
    });
    const tree: MemoTree = { commit: o.repo.sha, promptVersion: o.promptVersion, records: r.records, brief: r.brief };
    await writeMemoCache(cacheFile, tree);
    await o.emit({ type: "repo_brief", actor: READER, payload: { content: r.brief, fromCache: false } });
    await writeDoc(o.docsDir, tree, map, r.brief);
    return { map, brief: r.brief, tree };
  } catch {
    // The writer or the builder has recorded the failure as an event; the caller records the node failure.
    return null;
  }
}

/** Background: memos for the remaining files and directory memos; never blocks the meeting (R10.12). */
export async function buildRepoIndex(o: RepoMemoOptions, h: RepoMemoHandle): Promise<void> {
  const cacheFile = memoCachePath(o.cacheRoot, o.repo.owner, o.repo.repo, o.repo.sha, o.promptVersion);
  const todo = h.map.entries.filter((e) => !e.mapOnly && !(h.tree.records[e.path]?.level === "file" && (h.tree.records[e.path] as { source: string }).source === "llm")).length;
  const total = todo + h.map.dirs.size - 1;
  if (h.tree.indexComplete) return; // complete in the cache (R10.9)
  let done = 0;
  await o.emit({ type: "index_progress", actor: READER, payload: { state: "started", done: 0, total } });
  const tree = await buildMemo({
    commit: o.repo.sha,
    promptVersion: o.promptVersion,
    map: h.map,
    files: new Map(o.files.map((f) => [f.path, f.text])),
    writer: o.writer,
    signal: o.signal,
    reuse: h.tree.records,
    withRoot: false,
    concurrency: o.indexConcurrency ?? 2,
    events: {
      written: async (m, info) => {
        h.tree.records[m.level === "file" ? m.path : `dir:${m.path}`] = m;
        // Map-only files (tests, vendored, generated) are code-built and counted in the coverage, not announced.
        if (m.level === "file" && m.source === "map") return;
        done++;
        await memoEvent(o.emit, m, info.fromCache);
      },
      failure: (detail) => o.emit({ type: "failure", actor: READER, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail } }),
    },
  });
  if (o.signal.aborted) {
    await o.emit({ type: "index_progress", actor: READER, payload: { state: "stopped", done, total } }).catch(() => undefined);
    return;
  }
  const full: MemoTree = { ...tree, brief: h.brief, indexComplete: true };
  h.tree = full;
  await writeMemoCache(cacheFile, full);
  await writeDoc(o.docsDir, full, h.map, h.brief);
  await o.emit({ type: "index_progress", actor: READER, payload: { state: "finished", done, total } });
}

async function memoEvent(emit: Emit, m: MemoRecord, fromCache: boolean): Promise<void> {
  const files = m.level === "file" ? 1 : (m as { contains: string[] }).contains.length;
  await emit({ type: "memo_written", actor: READER, payload: { path: m.path, level: m.level, purpose: m.purpose, files, fromCache, mapOnly: m.source === "map" } });
}

async function writeDoc(dir: string, tree: MemoTree, map: RepoMap, brief: BriefRecord): Promise<void> {
  await mkdir(dir, { recursive: true });
  const parts = [`# Repo memo\n\nCommit ${tree.commit}. Summaries are LLM descriptions, not evidence.`, renderBrief(brief), ...renderIndexSections(tree, map)];
  await writeFile(join(dir, "REPO_MEMO.md"), parts.join("\n\n") + "\n");
}
export { renderMemo };
