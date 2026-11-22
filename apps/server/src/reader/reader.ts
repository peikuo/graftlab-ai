// Repo_Reader (design.md, "Repo_Reader"; R10, R34). Downloads a repository read-only as text, in a prioritized
// order, within the read-volume limit, with a cache by commit SHA. Files are never executed (R10.3). Every file
// read is an event (R10.4); skipped parts are listed (R10.6); a failure is shown and not retried silently (R10.5).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import type { GitHub, RepoMeta, TreeEntry } from "./github.ts";

export interface ReadLimits {
  maxFiles: number; // GL_READ_MAX_FILES, default 500
  maxBytes: number; // GL_READ_MAX_BYTES, default 4 MB
  maxFileBytes: number; // files above 200 KB are skipped
}

export const DEFAULT_LIMITS: ReadLimits = { maxFiles: 500, maxBytes: 4 * 1024 * 1024, maxFileBytes: 200 * 1024 };

const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|svgz|pdf|zip|gz|tgz|bz2|xz|7z|rar|tar|jar|war|class|so|dylib|dll|exe|bin|o|a|pyc|pyo|whl|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|wav|ogg|flac|sqlite3?|db|psd|ai|sketch)$/i;

/** Lower is read earlier: README, docs, API and schema files, routes and URLs, models, then the rest by depth. */
export function priority(path: string): number {
  const p = path.toLowerCase();
  const name = p.split("/").pop() ?? p;
  const depth = p.split("/").length - 1;
  if (/^readme(\.|$)/.test(name) && depth === 0) return 0;
  if (/^readme(\.|$)/.test(name)) return 10 + depth;
  if (p.startsWith("docs/") || p.startsWith("doc/")) return 100 + depth;
  if (/openapi|swagger|schema\.(json|ya?ml|graphql)|\.graphql$/.test(p)) return 200 + depth;
  if (/(^|\/)(urls?|routes?|router|routing|api)(\.|\/)/.test(p)) return 300 + depth;
  if (/(^|\/)models?(\.|\/)|(^|\/)schemas?(\.|\/)|(^|\/)entities?(\.|\/)/.test(p)) return 400 + depth;
  return 1000 + depth * 10;
}

export function isProbablyBinary(path: string, bytes?: Uint8Array): boolean {
  if (BINARY_EXT.test(path)) return true;
  if (!bytes) return false;
  const n = Math.min(bytes.length, 8000);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return true;
  return false;
}

export interface ReadPlan {
  read: TreeEntry[];
  skipped: { path: string; reason: string }[];
}

/** Orders the tree and applies the limits before any download (so skipped parts are known up front). */
export function planReading(entries: TreeEntry[], limits: ReadLimits = DEFAULT_LIMITS): ReadPlan {
  const ordered = [...entries].sort((a, b) => priority(a.path) - priority(b.path) || a.path.localeCompare(b.path));
  const read: TreeEntry[] = [];
  const skipped: ReadPlan["skipped"] = [];
  let bytes = 0;
  for (const e of ordered) {
    if (isProbablyBinary(e.path)) skipped.push({ path: e.path, reason: "binary" });
    else if (e.size > limits.maxFileBytes) skipped.push({ path: e.path, reason: `larger than ${Math.round(limits.maxFileBytes / 1024)} KB` });
    else if (read.length >= limits.maxFiles || bytes + e.size > limits.maxBytes) skipped.push({ path: e.path, reason: "read-volume limit reached" });
    else {
      read.push(e);
      bytes += e.size;
    }
  }
  return { read, skipped };
}

/** Cache layout: data/cache/github/<owner>/<repo>/<sha>/{tree.json,files/...} (R34.2). */
export class RepoCache {
  constructor(readonly root: string) {}

  dir(meta: RepoMeta): string {
    return join(this.root, "github", meta.owner.toLowerCase(), meta.repo.toLowerCase(), meta.sha);
  }

  /** A cache path for a repository file; refuses paths that would leave the cache directory. */
  filePath(meta: RepoMeta, path: string): string {
    const base = join(this.dir(meta), "files");
    const p = normalize(join(base, path));
    if (!p.startsWith(base + "/")) throw new Error(`refused a file path outside the repository: ${path}`);
    return p;
  }

  async readTree(meta: RepoMeta): Promise<{ entries: TreeEntry[]; truncated: boolean } | null> {
    try {
      return JSON.parse(await readFile(join(this.dir(meta), "tree.json"), "utf8"));
    } catch {
      return null;
    }
  }

  async writeTree(meta: RepoMeta, tree: { entries: TreeEntry[]; truncated: boolean }): Promise<void> {
    await mkdir(this.dir(meta), { recursive: true });
    await writeFile(join(this.dir(meta), "tree.json"), JSON.stringify(tree));
  }

  async readFile(meta: RepoMeta, path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.filePath(meta, path)));
    } catch {
      return null;
    }
  }

  async writeFile(meta: RepoMeta, path: string, bytes: Uint8Array): Promise<void> {
    const p = this.filePath(meta, path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
}

export interface ReadCallbacks {
  onPlan(plan: ReadPlan, fromCache: boolean, truncated: boolean): Promise<void>;
  onFile(entry: TreeEntry, text: string, fromCache: boolean): Promise<void>;
  onSkippedAfterRead(path: string, reason: string): Promise<void>;
  signal?: AbortSignal;
}

export interface ReadResult {
  files: { path: string; text: string }[];
  skipped: ReadPlan["skipped"];
  fromCache: boolean;
}

/** Downloads (or reads from the cache) the planned files and reports each one as it is read. */
export async function readRepository(gh: GitHub, cache: RepoCache, meta: RepoMeta, cb: ReadCallbacks, limits: ReadLimits = DEFAULT_LIMITS): Promise<ReadResult> {
  const cached = await cache.readTree(meta);
  const tree = cached ?? (await gh.tree(meta));
  if (!cached) await cache.writeTree(meta, tree);
  const plan = planReading(tree.entries, limits);
  await cb.onPlan(plan, !!cached, tree.truncated);
  const files: ReadResult["files"] = [];
  const skipped = [...plan.skipped];
  let allCached = !!cached;
  for (const entry of plan.read) {
    if (cb.signal?.aborted) break;
    let bytes = await cache.readFile(meta, entry.path);
    const hit = bytes !== null;
    if (!bytes) {
      allCached = false;
      bytes = await gh.file(meta, entry.path);
      await cache.writeFile(meta, entry.path, bytes);
    }
    if (isProbablyBinary(entry.path, bytes)) {
      skipped.push({ path: entry.path, reason: "binary" });
      await cb.onSkippedAfterRead(entry.path, "binary");
      continue;
    }
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    files.push({ path: entry.path, text });
    await cb.onFile(entry, text, hit);
  }
  return { files, skipped, fromCache: allCached };
}
