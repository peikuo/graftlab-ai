// In-memory model of the linkding REST API's documented write semantics (reference-target-linkding.md, "Write
// semantics for the comparator"), used only by the Adapter's tests (Property 11) and the hook tests. It answers the
// same paths and shapes as the pinned image: upsert by normalized URL that replaces title and tags, auto-tag rules
// that add their tag on create and keep it on a PATCH without tag_names, archived bookmarks only in /archived/.
import type { TargetClient, TargetItem } from "@graftlab/shared";
import { key, normalizeUrl } from "./comparator.ts";

export interface AutoTagRule {
  host: string;
  tag: string;
}
export class LinkdingModel implements TargetClient {
  #items: TargetItem[] = [];
  #next = 1;
  constructor(
    readonly rules: AutoTagRule[] = [],
    readonly pageSize = 3,
  ) {}
  get items(): TargetItem[] {
    return this.#items.map((b) => ({ ...b, tag_names: [...(b.tag_names as string[])] }));
  }
  #auto(url: string): string[] {
    const host = /^[a-z]+:\/\/([^/:?#]+)/.exec(normalizeUrl(url))?.[1] ?? "";
    return this.rules.filter((r) => host === r.host || host.endsWith(`.${r.host}`)).map((r) => r.tag);
  }
  async request(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
    const u = new URL(path, "http://model");
    const b = (body ?? {}) as { url?: string; title?: string; tag_names?: string[] };
    if (method === "GET" && (u.pathname === "/api/bookmarks/" || u.pathname === "/api/bookmarks/archived/")) {
      const archived = u.pathname.endsWith("/archived/");
      const all = this.#items.filter((x) => Boolean(x.is_archived) === archived);
      const limit = Number(u.searchParams.get("limit") ?? this.pageSize);
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const results = all.slice(offset, offset + Math.min(limit, this.pageSize));
      const next = offset + results.length < all.length ? `http://model${u.pathname}?limit=${limit}&offset=${offset + results.length}` : null;
      return { status: 200, json: { count: all.length, next, previous: null, results } };
    }
    if (method === "POST" && u.pathname === "/api/bookmarks/") {
      if (!b.url) return { status: 400, json: { url: ["required"] } };
      const tags = [...new Set([...(b.tag_names ?? []), ...this.#auto(b.url)])];
      const existing = this.#items.find((x) => key(x) === normalizeUrl(b.url!));
      if (existing) {
        existing.title = b.title ?? "";
        existing.tag_names = tags;
        return { status: 201, json: existing };
      }
      const item = { id: this.#next++, url: b.url, title: b.title ?? "", tag_names: tags, is_archived: false };
      this.#items.push(item);
      return { status: 201, json: item };
    }
    const m = /^\/api\/bookmarks\/(\d+)\/(archive\/)?$/.exec(u.pathname);
    const item = m ? this.#items.find((x) => x.id === Number(m[1])) : undefined;
    if (m && !item) return { status: 404, json: {} };
    if (method === "PATCH" && item && !m![2]) {
      if (b.tag_names !== undefined) item.tag_names = [...new Set([...b.tag_names, ...this.#auto(String(item.url))])];
      if (b.title !== undefined) item.title = b.title;
      return { status: 200, json: item };
    }
    if (method === "POST" && item && m![2]) {
      item.is_archived = true;
      return { status: 204, json: null };
    }
    if (method === "GET" && item && !m![2]) return { status: 200, json: item };
    return { status: 405, json: {} };
  }
}
