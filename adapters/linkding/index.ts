// linkding Adapter hooks (design.md, "Adapter contract", "Sandbox and test data"; reference-target-linkding.md,
// "Provisioning", "Fixed test data set, reset and restore"; R13.3, R13.5, R29.1-R29.4). Only the contract types are
// used; the container work (start, fresh volume, relay) belongs to the Studio's container manager.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AdapterHooks, BaselineHandle, ItemResult, TargetClient, TargetCredential, TargetItem } from "@graftlab/shared";
import { z } from "zod";
import { compare, itemFields, key, normalizeUrl } from "./comparator.ts";

export const TestDataSchema = z
  .object({
    bookmarks: z
      .array(z.object({ url: z.string().url(), title: z.string().min(1), tags: z.array(z.string().regex(/^[^\s]+$/)).min(1), archived: z.boolean().default(false) }).strict())
      .min(8)
      .max(12),
  })
  .strict()
  .refine((d) => d.bookmarks.every((b) => /^https?:\/\/([a-z0-9-]+\.)*example\.(com|org|net)(\/|$)/i.test(b.url)), "test data uses only the reserved example domains (R29.3)");
export type TestData = z.infer<typeof TestDataSchema>;
export const testData: TestData = TestDataSchema.parse(JSON.parse(readFileSync(join(import.meta.dirname, "test-data.json"), "utf8")));

/** Every page of the read endpoints: active and archived bookmarks. */
export async function readAll(c: TargetClient): Promise<TargetItem[]> {
  const out: TargetItem[] = [];
  for (const base of ["/api/bookmarks/", "/api/bookmarks/archived/"]) {
    let path: string | null = `${base}?limit=100&offset=0`;
    for (let page = 0; path && page < 100; page++) {
      const r = await c.request("GET", path);
      if (r.status !== 200) throw new Error(`GET ${base} returned ${r.status}`);
      const j = r.json as { results: TargetItem[]; next: string | null };
      out.push(...j.results);
      path = j.next ? new URL(j.next).pathname + new URL(j.next).search : null;
    }
  }
  return out;
}

/** The token script reads the superuser name from the environment, so no Studio value is put into code. */
const TOKEN_SCRIPT = 'import os\nfrom django.contrib.auth.models import User\nfrom bookmarks.models import ApiToken\nu = User.objects.get(username=os.environ["GL_SUPERUSER"])\nprint(ApiToken.objects.create(user=u, name="graftlab").key)';

export const hooks: AdapterHooks = {
  async provision(b: BaselineHandle): Promise<TargetCredential[]> {
    const user = b.secretEnv.LD_SUPERUSER_NAME;
    if (!user) throw new Error("LD_SUPERUSER_NAME was not generated for this start");
    const r = await b.exec(["python", "manage.py", "shell", "-c", TOKEN_SCRIPT], { workdir: "/etc/linkding", env: { GL_SUPERUSER: user } });
    const token = r.stdout.trim().split("\n").at(-1)?.trim() ?? "";
    if (r.code !== 0 || !/^[0-9a-f]{40}$/.test(token)) throw new Error(`creating the API token failed (exit ${r.code})`);
    return [{ name: "linkding_api_token", value: token }];
  },
  testData: {
    async seed(c: TargetClient): Promise<void> {
      for (const b of testData.bookmarks) {
        const r = await c.request("POST", "/api/bookmarks/?disable_scraping", { url: b.url, title: b.title, tag_names: b.tags });
        if (r.status !== 201) throw new Error(`seeding ${b.url} returned ${r.status}`);
        if (b.archived) {
          const id = (r.json as { id: number }).id;
          const a = await c.request("POST", `/api/bookmarks/${id}/archive/`);
          if (a.status !== 204) throw new Error(`archiving ${b.url} returned ${a.status}`);
        }
      }
    },
    async reset(b: BaselineHandle): Promise<void> {
      await b.recreate(); // a fresh container on a fresh volume; the manager then provisions, seeds and checks equality
    },
    async equals(c: TargetClient): Promise<ItemResult[]> {
      const items = await readAll(c);
      const results: ItemResult[] = testData.bookmarks.map((t) => {
        const found = items.filter((b) => key(b) === normalizeUrl(t.url));
        const b = found[0];
        const want = `"${t.title}", tags ${[...t.tags].sort().join(", ")}${t.archived ? ", archived" : ""}`;
        if (found.length !== 1 || !b) return { item: normalizeUrl(t.url), pass: false, expected: want, actual: `${found.length} bookmark(s)` };
        const tags = [...((b.tag_names as string[]) ?? [])].sort();
        const got = `"${String(b.title)}", tags ${tags.join(", ")}${b.is_archived ? ", archived" : ""}`;
        const same = b.title === t.title && tags.join("\u0000") === [...t.tags].sort().join("\u0000") && Boolean(b.is_archived) === t.archived;
        return { item: normalizeUrl(t.url), pass: same, expected: want, actual: same ? "as expected" : got };
      });
      results.push({ item: "bookmark count", pass: items.length === testData.bookmarks.length, expected: String(testData.bookmarks.length), actual: String(items.length) });
      return results;
    },
  },
  itemFields,
  comparator: { key, compare },
  readAll,
};
