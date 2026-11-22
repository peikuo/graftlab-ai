// Agent read tools over the downloaded files (design.md, "Repo_Memo", table "How agents use it"; R10.3).
// Pure functions over the in-memory download: no file system path, no network, nothing is executed, and every
// result is bounded so a single call can never flood an agent's context.

export interface ReadLimits {
  maxLines: number; // GL_READ_FILE_MAX_LINES, default 400
  maxBytes: number; // GL_READ_FILE_MAX_KB, default 16 KB
  maxMatches: number; // search_repo, default 30
  contextLines: number; // lines around a match, default 2
}

export const DEFAULT_TOOL_LIMITS: ReadLimits = { maxLines: 400, maxBytes: 16 * 1024, maxMatches: 30, contextLines: 2 };

export type ReadFileResult =
  | { ok: true; path: string; fromLine: number; toLine: number; totalLines: number; text: string; truncated: boolean }
  | { ok: false; error: string };

/** Lines fromLine..toLine (1-based, inclusive) of one downloaded file, bounded by lines and bytes. */
export function readFileLines(files: Map<string, string>, path: string, fromLine = 1, toLine?: number, limits = DEFAULT_TOOL_LIMITS): ReadFileResult {
  const text = files.get(path);
  if (text === undefined) return { ok: false, error: `no downloaded file "${path}"` };
  const lines = text.split("\n");
  const total = lines.length;
  const from = Math.max(1, Math.floor(fromLine));
  if (from > total) return { ok: false, error: `"${path}" has only ${total} lines` };
  const wanted = Math.min(total, toLine === undefined ? from + limits.maxLines - 1 : Math.floor(toLine), from + limits.maxLines - 1);
  const out: string[] = [];
  let bytes = 0;
  let last = from - 1;
  for (let i = from; i <= wanted; i++) {
    const line = `${i}: ${lines[i - 1]}`;
    bytes += Buffer.byteLength(line, "utf8") + 1;
    if (bytes > limits.maxBytes && out.length > 0) break;
    out.push(line);
    last = i;
  }
  return { ok: true, path, fromLine: from, toLine: last, totalLines: total, text: out.join("\n"), truncated: last < total };
}

/** Renders a read result for the agent, saying how much is left (design: "the result says how many lines remain"). */
export function renderReadFile(r: ReadFileResult): string {
  if (!r.ok) return r.error;
  const tail = r.truncated ? `\n[lines ${r.fromLine}-${r.toLine} of ${r.totalLines}; ${r.totalLines - r.toLine} more lines; read on with fromLine=${r.toLine + 1}]` : `\n[lines ${r.fromLine}-${r.toLine} of ${r.totalLines}; end of file]`;
  return `${r.path}\n${r.text}${tail}`;
}

export interface SearchHit {
  path: string;
  line: number;
  context: string;
}

/**
 * Case-insensitive literal search over the downloaded files (a literal, not a regular expression, so a query
 * can never be a slow pattern). Up to maxMatches hits, each with contextLines lines around it.
 */
export function searchRepo(files: Map<string, string>, query: string, limits = DEFAULT_TOOL_LIMITS): { hits: SearchHit[]; more: boolean } {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return { hits: [], more: false };
  const hits: SearchHit[] = [];
  const paths = [...files.keys()].sort();
  for (const path of paths) {
    const lines = files.get(path)!.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]!.toLowerCase().includes(q)) continue;
      if (hits.length >= limits.maxMatches) return { hits, more: true };
      const a = Math.max(0, i - limits.contextLines);
      const b = Math.min(lines.length - 1, i + limits.contextLines);
      const context = lines
        .slice(a, b + 1)
        .map((l, k) => `${a + k + 1}${a + k === i ? ">" : ":"} ${l.slice(0, 240)}`)
        .join("\n");
      hits.push({ path, line: i + 1, context });
    }
  }
  return { hits, more: false };
}

export function renderSearch(query: string, r: { hits: SearchHit[]; more: boolean }): string {
  if (r.hits.length === 0) return `no match for "${query}" in the downloaded files`;
  const body = r.hits.map((h) => `${h.path}:${h.line}\n${h.context}`).join("\n\n");
  return `${r.hits.length} matches for "${query}"${r.more ? " (more exist; refine the query)" : ""}\n\n${body}`;
}
