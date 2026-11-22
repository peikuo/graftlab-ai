// Repo_Memo builder tests with a scripted writer (tasks.md 6.4c; R10.7, R10.9, R24).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildRepoMap } from "./map.ts";
import { batchesFor, buildMemo, dirKey, memoCachePath, readMemoCache, renderMemo, renderRepoMemoDoc, searchMemo, writeMemoCache, type MemoRecord, type MemoWriter } from "./memo.ts";

const repo = [
  { path: "README.md", text: "# app\n" },
  { path: "app/models.py", text: "class Bookmark:\n    pass\n" },
  { path: "app/views.py", text: "from .models import Bookmark\ndef index():\n    pass\n" },
  { path: "app/api/routes.py", text: "def list_bookmarks():\n    pass\n" },
  { path: "app/tests/test_models.py", text: "def test_x():\n    pass\n" },
];
const map = buildRepoMap(repo);
const files = new Map(repo.map((f) => [f.path, f.text]));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A writer that describes every file except those in `skip`, and records what it was given. */
function scriptedWriter(skip: string[] = []) {
  const calls = { files: 0, directory: [] as string[], root: 0, childrenSeen: new Map<string, string[]>() };
  const w: MemoWriter = {
    async files(_dir, batch) {
      calls.files++;
      return batch
        .filter((f) => !skip.includes(f.path))
        .map((f) => ({ path: f.path, purpose: `Purpose of ${f.path}`, keySymbols: f.map.symbols, relatesTo: [...f.map.imports, "not/a/repo/file.py"] }));
    },
    async directory(path, children) {
      calls.directory.push(path);
      calls.childrenSeen.set(path, children.map((c) => c.path));
      return { purpose: `Purpose of ${path}/`, contains: children.map((c) => c.path), entryPoints: [], featuresHere: ["bookmarks"] };
    },
    async root(children) {
      calls.root++;
      calls.childrenSeen.set("", children.map((c) => c.path));
      return { purpose: "A bookmark app.", contains: children.map((c) => c.path), entryPoints: ["README.md"], featuresHere: [], workflows: [{ name: "Save a bookmark", paths: ["app/views.py"] }] };
    },
  };
  return { w, calls };
}

function run(writer: MemoWriter, extra: Partial<Parameters<typeof buildMemo>[0]> = {}) {
  const written: MemoRecord[] = [];
  const p = buildMemo({ commit: "c1", promptVersion: "0.1.0", map, files, writer, signal: new AbortController().signal, events: { written: async (r) => void written.push(r) }, ...extra });
  return p.then((tree) => ({ tree, written }));
}

describe("buildMemo", () => {
  it("covers every file and directory, bottom-up, and the root sees its children's memos only", async () => {
    const { w, calls } = scriptedWriter();
    const { tree, written } = await run(w);
    for (const f of repo) expect(tree.records[f.path]).toBeDefined();
    for (const d of map.dirs.keys()) expect(tree.records[dirKey(d)]).toBeDefined();
    expect(tree.records["app/tests/test_models.py"]).toMatchObject({ source: "map" }); // tests are map only
    expect(calls.directory.indexOf("app/api")).toBeLessThan(calls.directory.indexOf("app")); // deepest first
    expect(calls.childrenSeen.get("")).toEqual(["app", "README.md"]);
    expect(written.at(-1)).toMatchObject({ level: "root", source: "llm" });
  });

  it("keeps only related paths that exist in the repository", async () => {
    const { tree } = await run(scriptedWriter().w);
    const r = tree.records["app/views.py"];
    expect(r?.level === "file" && r.relatesTo).toEqual(["app/models.py"]);
  });

  it("marks a file the model left out instead of inventing a memo", async () => {
    const { tree } = await run(scriptedWriter(["app/models.py"]).w);
    expect(tree.records["app/models.py"]).toMatchObject({ source: "missing", purpose: "No memo: the model did not describe this file." });
    expect(renderMemo(tree, dirKey("app"))).toBeTruthy();
  });

  it("falls back to map-only memos when time is up, and still writes the root", async () => {
    const { w, calls } = scriptedWriter();
    const { tree } = await run(w, { deadline: 0, now: () => 1 });
    expect(calls.files + calls.directory.length + calls.root).toBe(0);
    expect(tree.records[dirKey("")]).toMatchObject({ level: "root", source: "map" });
    expect(Object.values(tree.records).every((r) => r.source === "map")).toBe(true);
  });

  it("a failing writer call degrades to map memos for that part only", async () => {
    const { w } = scriptedWriter();
    const failing: MemoWriter = { ...w, directory: async (p, c, s) => (p === "app/api" ? Promise.reject(new Error("model down")) : w.directory(p, c, s)) };
    const { tree } = await run(failing);
    expect(tree.records[dirKey("app/api")]).toMatchObject({ source: "map" });
    expect(tree.records[dirKey("app")]).toMatchObject({ source: "llm" });
  });
});

describe("batching, cache and rendering", () => {
  it("batches by size and cuts an oversized file at a line boundary", () => {
    const big = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
    const m = buildRepoMap([{ path: "a/big.py", text: big }, { path: "a/small.py", text: "x = 1\n" }]);
    const b = batchesFor(m.dirs.get("a")!.files.map((p) => m.byPath.get(p)!), new Map([["a/big.py", big], ["a/small.py", "x = 1\n"]]), 1024);
    expect(b.map((x) => x.map((f) => f.path))).toEqual([["a/big.py"], ["a/small.py"]]);
    expect(b[0]![0]).toMatchObject({ cut: true });
    expect(Buffer.byteLength(b[0]![0]!.text)).toBeLessThanOrEqual(1024);
    expect(b[0]![0]!.text.endsWith("\n")).toBe(false);
  });

  it("a second build on the same commit and prompt version comes from the cache (R10.9)", async () => {
    const root = await mkdtemp(join(tmpdir(), "gl-memo-"));
    dirs.push(root);
    const file = memoCachePath(root, "O", "R", "c1", "0.1.0");
    expect(await readMemoCache(file)).toBeNull();
    const { tree } = await run(scriptedWriter().w);
    await writeMemoCache(file, tree);
    expect(await readMemoCache(file)).toEqual(tree);
    expect(memoCachePath(root, "O", "R", "c1", "0.2.0")).not.toBe(file); // a new prompt version builds again
  });

  it("renders Markdown deterministically and the repo memo doc starts at the root", async () => {
    const { tree } = await run(scriptedWriter().w);
    expect(renderMemo(tree, "app/models.py")).toBe("## app/models.py\nPurpose of app/models.py\nKey symbols: Bookmark");
    expect(renderMemo(tree, dirKey(""))).toMatch(/^## \/ \(whole repository\)\nA bookmark app\.\nWorkflows:\n- Save a bookmark: app\/views\.py/);
    const doc = renderRepoMemoDoc(tree, map);
    expect(doc.indexOf("whole repository")).toBeLessThan(doc.indexOf("## app/api"));
    expect(doc).toMatch(/not evidence/);
    expect(renderRepoMemoDoc(tree, map)).toBe(doc);
    expect(searchMemo(tree, "bookmark app")).toEqual([dirKey("")]);
  });
});
describe("buildMemo retry and reuse (R10.8, R10.12)", () => {
  it("retries left-out files once in a smaller batch, with a visible failure first", async () => {
    let left = false;
    const seen: string[][] = [];
    const w: MemoWriter = {
      ...scriptedWriter().w,
      async files(_dir, batch) {
        seen.push(batch.map((f) => f.path));
        // the first call with app/models.py leaves it out; the retry describes it
        const skip = !left && batch.length > 1 && batch.some((f) => f.path === "app/models.py");
        if (skip) left = true;
        return batch.filter((f) => !skip || f.path !== "app/models.py").map((f) => ({ path: f.path, purpose: `P ${f.path}`, keySymbols: [], relatesTo: [] }));
      },
    };
    const failures: string[] = [];
    const tree = await buildMemo({ commit: "c", promptVersion: "v", map, files, writer: w, signal: new AbortController().signal, events: { written: async () => {}, failure: async (d) => void failures.push(d) } });
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("app/models.py");
    expect(seen.some((b) => b.length === 1 && b[0] === "app/models.py")).toBe(true);
    expect(tree.records["app/models.py"]).toMatchObject({ source: "llm" });
  });
  it("reuses foreground memos and can skip the root", async () => {
    const { w, calls } = scriptedWriter();
    const reuse: Record<string, MemoRecord> = { "app/models.py": { level: "file", source: "llm", path: "app/models.py", purpose: "From the brief.", keySymbols: [], relatesTo: [] } };
    const asked: string[] = [];
    const tree = await buildMemo({ commit: "c", promptVersion: "v", map, files, writer: { ...w, files: async (d, b, s) => (asked.push(...b.map((f) => f.path)), w.files(d, b, s)) }, signal: new AbortController().signal, events: { written: async () => {} }, reuse, withRoot: false });
    expect(asked).not.toContain("app/models.py");
    expect(tree.records["app/models.py"]).toMatchObject({ purpose: "From the brief." });
    expect(calls.root).toBe(0);
    expect(tree.records[dirKey("")]).toBeUndefined();
  });
});
