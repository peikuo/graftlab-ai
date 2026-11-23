// Adapter contract, registry and readback check (tasks.md 10.2, 10.15; R9.5, R22.4, R39.10).
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AdapterJsonSchema } from "@graftlab/shared";
import { afterEach, describe, expect, it } from "vitest";
import { LinkdingModel } from "../../../../adapters/linkding/model.ts";
import { runReadback, snapshot } from "../verifier/readback.ts";
import { forbiddenFields, loadAdapters, matchAdapter } from "./registry.ts";

const ADAPTERS = join(import.meta.dirname, "../../../../adapters");
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function withAdapter(json: unknown) {
  const d = await mkdtemp(join(tmpdir(), "gl-adapters-"));
  dirs.push(d);
  await mkdir(join(d, "linkding"));
  await writeFile(join(d, "linkding", "adapter.json"), JSON.stringify(json));
  return d;
}

describe("Adapter contract", () => {
  it("the real linkding adapter.json passes the contract schema and loads with its hooks", async () => {
    const [a] = await loadAdapters(ADAPTERS);
    expect(a).toMatchObject({ id: "linkding", api: { itemCap: 10 } });
    expect(a!.api.read.map((r) => r.path)).toContain("/api/bookmarks/archived/");
    expect(typeof a!.hooks.comparator.compare).toBe("function");
  });
  it("refuses a start or build procedure for the modified target and any unknown field (R39.10)", async () => {
    const real = JSON.parse(await readFile(join(ADAPTERS, "linkding", "adapter.json"), "utf8"));
    await expect(loadAdapters(await withAdapter({ ...real, startCommand: ["python", "manage.py", "runserver"] }))).rejects.toThrow(/no start or build procedure/);
    await expect(loadAdapters(await withAdapter({ ...real, devSandbox: { ...real.devSandbox, buildScript: "make" } }))).rejects.toThrow(/devSandbox.buildScript/);
    expect(AdapterJsonSchema.safeParse({ ...real, notes: "x" }).success).toBe(false);
    expect(forbiddenFields(real)).toEqual([]);
  });
  it("refuses an image that is not pinned by digest and an item cap above 10", async () => {
    const real = JSON.parse(await readFile(join(ADAPTERS, "linkding", "adapter.json"), "utf8"));
    await expect(loadAdapters(await withAdapter({ ...real, baseline: { ...real.baseline, image: "sissbruecker/linkding:latest" } }))).rejects.toThrow(/pinned by digest/);
    await expect(loadAdapters(await withAdapter({ ...real, api: { ...real.api, itemCap: 50 } }))).rejects.toThrow(/itemCap/);
  });
  it("matches case-insensitively", async () => {
    const all = await loadAdapters(ADAPTERS);
    expect(matchAdapter(all, { owner: "SissBruecker", repo: "LinkDing" })?.id).toBe("linkding");
    expect(matchAdapter(all, { owner: "sindresorhus", repo: "p-limit" })).toBeUndefined();
  });
});

describe("api_readback (Verifier)", () => {
  it("passes a planned state, fails with per-item results otherwise, and treats a create of an existing URL as an update", async () => {
    const [a] = await loadAdapters(ADAPTERS);
    const m = new LinkdingModel();
    await m.request("POST", "/api/bookmarks/?disable_scraping", { url: "https://example.com/a", title: "Old", tag_names: ["x"] });
    const pre = await snapshot(a!, m);
    await m.request("POST", "/api/bookmarks/?disable_scraping", { url: "HTTPS://EXAMPLE.COM/a", title: "Sourdough", tag_names: ["cooking"] });
    const ok = await runReadback(a!, m, [{ key: "https://example.com/a", mustExist: true, fields: { titleContains: "Sourdough", tagsInclude: ["cooking"] } }], pre);
    expect(ok).toMatchObject({ pass: true, items: [{ pass: true, expected: 'title contains "Sourdough"; tags include cooking' }] });
    const bad = await runReadback(a!, m, [{ key: "https://example.com/a", mustExist: true, fields: { tagsInclude: ["bread"] } }, { key: "https://example.org/none", mustExist: true, fields: {} }], pre);
    expect(bad.pass).toBe(false);
    expect(bad.items.map((i) => i.pass)).toEqual([false, false]);
  });
  it("a failing read is a failed check with the reason", async () => {
    const [a] = await loadAdapters(ADAPTERS);
    const broken = { request: async () => ({ status: 503, json: {} }) };
    expect(await runReadback(a!, broken, [{ key: "https://example.com/a", mustExist: true, fields: {} }], [])).toMatchObject({ pass: false, items: [{ item: "read back", actual: "GET /api/bookmarks/ returned 503" }] });
  });
});
