// Repo_Brief tests with a scripted writer (tasks.md 6.4d; R10.7, R10.10, R10.11).
import { describe, expect, it } from "vitest";
import { buildBrief, checkPlan, docsOutline, planByCode, rankFiles, renderBrief, type BriefWriter, type PlannedFile, type RepoBrief } from "./brief.ts";
import { buildRepoMap } from "./map.ts";
import type { MemoWriter } from "./memo.ts";
const repo = [
  { path: "README.md", text: "# Marks\nA bookmark manager.\n" },
  { path: "package.json", text: "{}" },
  { path: "docs/getting-started.md", text: "---\ntitle: Getting started\ndescription: Install and run it.\n---\nBody.\n" },
  { path: "docs/api.md", text: "# API\n\nThe REST API lists bookmarks.\n" },
  { path: "app/models.py", text: "class Bookmark:\n    pass\n" },
  { path: "app/views.py", text: "from .models import Bookmark\n" },
  { path: "app/services.py", text: "from .models import Bookmark\n" },
  { path: "app/urls.py", text: "from .views import *\n" },
  { path: "app/tests/test_models.py", text: "def test_x(): pass\n" },
];
const map = buildRepoMap(repo);
const files = new Map(repo.map((f) => [f.path, f.text]));
const brief = (sources: string[]): RepoBrief => ({
  what: { text: "A bookmark manager.", kind: "web_app", sources },
  users: [{ who: "Individuals", jobs: ["save a link"], sources: ["README.md"] }],
  howItRuns: { stack: ["Django"], parts: [{ name: "web", role: "serves pages", paths: ["app/views.py", "app/"] }], entryPoints: ["app/urls.py"], sources: [] },
  concepts: [{ name: "Bookmark", meaning: "a saved link", paths: ["app/models.py"] }],
  features: [{ name: "Save", userAction: "save a link", paths: ["app/services.py"] }],
  extensionPoints: [{ where: "when a bookmark is saved", couldAttach: "auto tags", paths: ["app/services.py"] }],
  unknowns: [{ question: "Is there a job queue?", why: "affects async AI calls" }],
});
function writer(plan: () => Promise<{ files: PlannedFile[] }>, skip: string[] = []) {
  const prompts: string[] = [];
  const w: MemoWriter & BriefWriter = {
    plan: async (p) => (prompts.push(p), plan()),
    files: async (_d, batch) => batch.filter((f) => !skip.includes(f.path)).map((f) => ({ path: f.path, purpose: `P ${f.path}`, keySymbols: [], relatesTo: [], features: ["save"] })),
    directory: async () => ({ purpose: "x", contains: [], entryPoints: [], featuresHere: [] }),
    root: async () => ({ purpose: "x", contains: [], entryPoints: [], featuresHere: [], workflows: [] }),
    brief: async (p) => (prompts.push(p), brief(["README.md", "nope/missing.py"])),
  };
  return { w, prompts };
}
const events = () => {
  const log = { planned: [] as { plan: PlannedFile[]; byCode: boolean; dropped: number }[], written: [] as string[], failures: [] as string[] };
  return { log, ev: { planned: async (plan: PlannedFile[], i: { byCode: boolean; dropped: number }) => void log.planned.push({ plan, ...i }), written: async (r: { path: string }) => void log.written.push(r.path), failure: async (d: string) => void log.failures.push(d) } };
};
describe("code ranking and docs outline", () => {
  it("ranks manifests, then entry points, then by import in-degree; tests, README and docs are not ranked", () => {
    const r = rankFiles(map).map((x) => x.entry.path);
    expect(r[0]).toBe("package.json");
    expect(r[1]).toBe("app/urls.py");
    expect(r[2]).toBe("app/models.py"); // imported by 2 files
    expect(r).not.toContain("app/tests/test_models.py");
    expect(r).not.toContain("README.md");
    expect(r).not.toContain("docs/api.md");
  });
  it("outlines docs pages from front matter or the first heading and paragraph", () => {
    expect(docsOutline(map, files)).toEqual([
      { path: "docs/api.md", title: "API", summary: "The REST API lists bookmarks." },
      { path: "docs/getting-started.md", title: "Getting started", summary: "Install and run it." },
    ]);
  });
});
describe("reading plan (R10.10)", () => {
  it("drops unknown, map-only, duplicate and README paths and enforces the caps", () => {
    const plan = { files: ["nope.py", "app/tests/test_models.py", "README.md", "app/models.py", "app/models.py", "app/views.py", "app/services.py"].map((path) => ({ path, why: "w" })) };
    const r = checkPlan(plan, map, { maxFiles: 2, maxBytes: 1024 });
    expect(r.files.map((f) => f.path)).toEqual(["app/models.py", "app/views.py"]);
    expect(r.dropped).toBe(5);
    expect(checkPlan({ files: [{ path: "app/models.py", why: "w" }] }, map, { maxFiles: 5, maxBytes: 5 }).files).toEqual([]);
  });
  it("falls back to the code ranking, labeled, when the plan call fails", async () => {
    const { w } = writer(async () => Promise.reject(new Error("no valid plan")));
    const { log, ev } = events();
    const r = await buildBrief({ map, files, writer: w, events: ev, signal: new AbortController().signal });
    expect(log.planned[0]!.byCode).toBe(true);
    expect(r.brief.planByCode).toBe(true);
    expect(r.brief.plan.map((f) => f.path)).toEqual(planByCode(map, rankFiles(map), docsOutline(map, files), { maxFiles: 30, maxBytes: 160 * 1024 }).map((f) => f.path));
    expect(r.brief.plan[0]!.why).toContain("code ranking");
  });
});
describe("buildBrief (R10.7, R10.11)", () => {
  it("memoizes the planned files, drops unknown source paths and computes coverage by code", async () => {
    const { w, prompts } = writer(async () => ({ files: [{ path: "docs/api.md", why: "API docs" }, { path: "app/models.py", why: "data model" }, { path: "app/services.py", why: "logic" }] }), ["app/services.py"]);
    const { log, ev } = events();
    const r = await buildBrief({ map, files, writer: w, events: ev, signal: new AbortController().signal, notDownloaded: 3 });
    expect(log.planned[0]).toMatchObject({ byCode: false, dropped: 0 });
    expect(r.brief.planByCode).toBe(false);
    // app/services.py was left out twice (first call and the retry): a visible failure and a "no memo" mark
    expect(log.failures).toHaveLength(1);
    expect(r.records["app/services.py"]).toMatchObject({ source: "missing" });
    expect(r.records["app/models.py"]).toMatchObject({ source: "llm", features: ["save"] });
    expect(r.brief.droppedSources).toBe(1);
    expect(r.brief.brief.what.sources).toEqual(["README.md"]);
    expect(r.brief.brief.howItRuns.parts[0]!.paths).toEqual(["app/views.py", "app/"]); // a directory path is a valid source
    expect(r.brief.coverage).toEqual({ read: ["README.md", "docs/api.md", "app/models.py", "app/services.py"], cut: [], noMemo: ["app/services.py"], mapOnly: 1, notReadYet: 4, notDownloaded: 3 });
    // the plan prompt carries the README and the docs outline; the brief prompt has docs in full
    expect(prompts[0]).toContain("A bookmark manager.");
    expect(prompts[0]).toContain("docs/getting-started.md: Getting started — Install and run it.");
    expect(prompts[1]).toContain("## Docs pages read in full\n### docs/api.md");
    const md = renderBrief(r.brief);
    expect(md).toContain("### Extension points (LLM assessment, not a guarantee)");
    expect(md).toContain("Not read yet (background index): 4");
  });
});
