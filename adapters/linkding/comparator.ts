// linkding comparator (design.md, "Adapter contract", "Verifier"; reference-target-linkding.md, "Write semantics for
// the comparator"; R22.4, R22.5). Bookmarks are matched by normalized URL; tags by inclusion; titles by substring;
// archived by equality. A planned create whose URL existed before is an update: the count for that URL stays 1.
import type { Expectation, ItemResult, TargetItem } from "@graftlab/shared";
import { z } from "zod";

const DEFAULT_PORT: Record<string, string> = { http: "80", https: "443" };
/** Lower-case scheme and host, drop the default port; path, query and fragment stay as given. */
export function normalizeUrl(raw: string): string {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#:]*)(?::(\d+))?(.*)$/.exec(raw.trim());
  if (!m) return raw.trim();
  const scheme = m[1]!.toLowerCase();
  const host = m[2]!.toLowerCase();
  const port = m[3] && m[3] !== DEFAULT_PORT[scheme] ? `:${m[3]}` : "";
  return `${scheme}://${host}${port}${m[4] ?? ""}`;
}

/** Fields of a Demo_Case item and of an expectation (the Adapter's `api.itemFields`). */
export const DemoItemFields = z.object({ url: z.string().url(), title: z.string().max(300).optional(), tags: z.array(z.string().regex(/^[^\s]+$/)).max(10).optional() }).strict();
export const ExpectFields = z.object({ titleContains: z.string().optional(), tagsInclude: z.array(z.string()).optional(), archived: z.boolean().optional() }).strict();
export const itemFields = z.union([DemoItemFields, ExpectFields]);

const tagsOf = (b: TargetItem) => (Array.isArray(b.tag_names) ? (b.tag_names as string[]) : []);
export const key = (b: TargetItem) => normalizeUrl(String(b.url ?? ""));

export function compare(expect: Expectation, readBack: TargetItem[], preState: TargetItem[]): ItemResult {
  const k = normalizeUrl(expect.key);
  const found = readBack.filter((b) => key(b) === k);
  const existed = preState.some((b) => key(b) === k);
  const item = k;
  if (!expect.mustExist) return { item, pass: found.length === 0, expected: "absent", actual: found.length === 0 ? "absent" : `${found.length} bookmark(s)` };
  if (found.length !== 1) return { item, pass: false, expected: existed ? "1 bookmark (updated, the URL existed before)" : "1 bookmark", actual: `${found.length} bookmark(s)` };
  const b = found[0]!;
  const f = ExpectFields.parse(expect.fields);
  const problems: string[] = [];
  const want: string[] = [];
  if (f.titleContains !== undefined) {
    want.push(`title contains "${f.titleContains}"`);
    if (!String(b.title ?? "").includes(f.titleContains)) problems.push(`title "${String(b.title ?? "")}"`);
  }
  if (f.tagsInclude !== undefined) {
    want.push(`tags include ${f.tagsInclude.join(", ") || "(none)"}`);
    const missing = f.tagsInclude.filter((t) => !tagsOf(b).includes(t));
    if (missing.length) problems.push(`tags ${tagsOf(b).join(", ") || "(none)"} (missing ${missing.join(", ")})`);
  }
  if (f.archived !== undefined) {
    want.push(f.archived ? "archived" : "not archived");
    if (Boolean(b.is_archived) !== f.archived) problems.push(b.is_archived ? "archived" : "not archived");
  }
  return { item, pass: problems.length === 0, expected: want.join("; ") || "present", actual: problems.length ? problems.join("; ") : "as expected" };
}
