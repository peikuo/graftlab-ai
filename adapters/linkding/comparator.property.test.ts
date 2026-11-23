// linkding comparator: rules and Property 11 (tasks.md 10.4, 10.15; R22.4, R22.5).
import fc from "fast-check";
import type { Expectation, TargetItem } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { compare, key, normalizeUrl } from "./comparator.ts";
import { readAll } from "./index.ts";
import { LinkdingModel, type AutoTagRule } from "./model.ts";

describe("normalizeUrl", () => {
  it("lower-cases scheme and host, drops the default port, keeps path, query and fragment", () => {
    expect(normalizeUrl("HTTPS://Example.COM:443/A/b?Q=1#Frag")).toBe("https://example.com/A/b?Q=1#Frag");
    expect(normalizeUrl("http://example.org:80/x")).toBe("http://example.org/x");
    expect(normalizeUrl("http://example.org:8080/x")).toBe("http://example.org:8080/x");
    expect(normalizeUrl("https://example.net")).toBe("https://example.net");
  });
});

describe("compare", () => {
  const item = (o: Partial<TargetItem>) => ({ id: 1, url: "https://example.com/a", title: "Sourdough guide", tag_names: ["cooking", "bread"], is_archived: false, ...o });
  const exp = (fields: Record<string, unknown>, mustExist = true): Expectation => ({ key: "HTTPS://example.com/a", mustExist, fields });
  it("checks tags by inclusion, title by substring, archived by equality", () => {
    expect(compare(exp({ tagsInclude: ["bread"], titleContains: "dough", archived: false }), [item({})], []).pass).toBe(true);
    expect(compare(exp({ tagsInclude: ["bread", "italian"] }), [item({})], [])).toMatchObject({ pass: false, actual: "tags cooking, bread (missing italian)" });
    expect(compare(exp({ archived: true }), [item({})], []).pass).toBe(false);
  });
  it("a missing item fails, an absent item passes mustExist false, a duplicate fails", () => {
    expect(compare(exp({}), [], [])).toMatchObject({ pass: false, actual: "0 bookmark(s)" });
    expect(compare(exp({}, false), [], []).pass).toBe(true);
    expect(compare(exp({}), [item({}), item({ id: 2 })], []).pass).toBe(false);
  });
  it("names an update when the URL existed in the pre-state", () => {
    expect(compare(exp({}), [], [item({})]).expected).toBe("1 bookmark (updated, the URL existed before)");
  });
});

// Generators over the reserved example domains, with URL spellings that normalize to the same key.
const host = fc.constantFrom("example.com", "example.org", "example.net");
const urlArb = fc.tuple(fc.constantFrom("https", "http"), host, fc.constantFrom("a", "b", "c", "d", "e"), fc.boolean()).map(([s, h, p, upper]) => `${upper ? s.toUpperCase() : s}://${upper ? h.toUpperCase() : h}${upper ? (s === "https" ? ":443" : ":80") : ""}/${p}`);
const tagArb = fc.constantFrom("dev", "travel", "cooking", "news", "italian");
const tagsArb = fc.uniqueArray(tagArb, { minLength: 1, maxLength: 3 });
const op = fc.oneof(
  fc.record({ op: fc.constant("create" as const), url: urlArb, title: fc.constantFrom("Guide", "Notes on X", "Roundup"), tags: tagsArb }),
  fc.record({ op: fc.constant("update_tags" as const), url: urlArb, tags: tagsArb }),
  fc.record({ op: fc.constant("archive" as const), url: urlArb }),
);
const rulesArb = fc.uniqueArray(fc.record({ host, tag: fc.constantFrom("auto", "news") }), { maxLength: 2, selector: (r) => r.host });

type PlanItem = { op: "create" | "update_tags" | "archive"; url: string; title?: string; tags?: string[] };
/** Applies a Demo_Case plan through the model's API, as the Studio's writer would, and returns the expectations. */
async function apply(model: LinkdingModel, plan: PlanItem[]) {
  const want = new Map<string, Expectation>();
  for (const p of plan) {
    const k = normalizeUrl(p.url);
    const found = model.items.find((b) => key(b) === k);
    if (p.op === "create") {
      await model.request("POST", "/api/bookmarks/?disable_scraping", { url: p.url, title: p.title, tag_names: p.tags });
      want.set(k, { key: p.url, mustExist: true, fields: { titleContains: p.title, tagsInclude: p.tags } });
    } else if (!found) continue; // the validated plan only updates or archives existing items
    else if (p.op === "update_tags") {
      await model.request("PATCH", `/api/bookmarks/${found.id}/`, { tag_names: p.tags });
      const prev = want.get(k)?.fields ?? {};
      want.set(k, { key: p.url, mustExist: true, fields: { ...prev, tagsInclude: p.tags } });
    } else {
      await model.request("POST", `/api/bookmarks/${found.id}/archive/`);
      const prev = want.get(k)?.fields ?? {};
      want.set(k, { key: p.url, mustExist: true, fields: { ...prev, archived: true } });
    }
  }
  return [...want.values()];
}

describe("Adapter comparator", () => {
  // Feature: graftlab-ai, Property 11: The Adapter comparator agrees with a model of the target's write semantics
  it("passes the model's read-back of any plan, fails exactly when a planned item or a planned tag is missing, and counts a create of an existing URL as an update", async () => {
    await fc.assert(
      fc.asyncProperty(rulesArb, fc.array(fc.record({ url: urlArb, title: fc.constant("Old"), tags: tagsArb }), { maxLength: 4 }), fc.array(op, { minLength: 1, maxLength: 6 }), fc.nat(), async (rules: AutoTagRule[], pre, plan, pick) => {
        const model = new LinkdingModel(rules);
        for (const b of pre) await model.request("POST", "/api/bookmarks/?disable_scraping", { url: b.url, title: b.title, tag_names: b.tags });
        const preState = await readAll(model);
        const expectations = await apply(model, plan);
        const readBack = await readAll(model);
        // 1. The comparator passes the model's read-back of the plan.
        for (const x of expectations) expect(compare(x, readBack, preState).pass).toBe(true);
        // 2. A create of a URL that existed before leaves exactly one bookmark for it.
        for (const x of expectations) expect(readBack.filter((b) => key(b) === normalizeUrl(x.key)).length).toBe(1);
        if (expectations.length === 0) return;
        // 3. Removing the planned item, or a planned tag that no auto-tag rule adds, makes exactly that check fail.
        const target = expectations[pick % expectations.length]!;
        const k = normalizeUrl(target.key);
        expect(compare(target, readBack.filter((b) => key(b) !== k), preState).pass).toBe(false);
        const planned = (target.fields.tagsInclude as string[] | undefined) ?? [];
        const ruleTags = rules.filter((r) => k.includes(`://${r.host}`)).map((r) => r.tag);
        const removable = planned.find((t) => !ruleTags.includes(t));
        if (removable) {
          const stripped = readBack.map((b) => (key(b) === k ? { ...b, tag_names: (b.tag_names as string[]).filter((t) => t !== removable) } : b));
          expect(compare(target, stripped, preState).pass).toBe(false);
          for (const other of expectations.filter((x) => normalizeUrl(x.key) !== k)) expect(compare(other, stripped, preState).pass).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
