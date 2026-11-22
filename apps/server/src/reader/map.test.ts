import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildRepoMap, dirsDeepestFirst, importsOf, mapOnlyReason, symbolsOf } from "./map.ts";
import { DEFAULT_TOOL_LIMITS, readFileLines, renderReadFile, searchRepo } from "./tools.ts";

const repo = [
  { path: "README.md", text: "# linkding\n## Features\ntext" },
  { path: "bookmarks/models.py", text: "from django.db import models\nfrom .services import tags\n\nclass Bookmark(models.Model):\n    url = 1\n\ndef helper():\n    pass\n" },
  { path: "bookmarks/services/tags.py", text: "def get_or_create_tags(names):\n    return []\n" },
  { path: "bookmarks/services/__init__.py", text: "" },
  { path: "bookmarks/tests/test_tags.py", text: "def test_tags():\n    pass\n" },
  { path: "bookmarks/static/vendor/lib.js", text: "var x = 1;" },
  { path: "web/src/app.ts", text: "import { util } from './util';\nexport function main() {}\nexport class App {}\n" },
  { path: "web/src/util.ts", text: "export const util = 1;\n" },
];

describe("Repo_Map", () => {
  const map = buildRepoMap(repo);

  it("records symbols per language", () => {
    expect(map.byPath.get("bookmarks/models.py")?.symbols).toEqual(["Bookmark", "helper"]);
    expect(map.byPath.get("web/src/app.ts")?.symbols).toEqual(["main", "App"]);
    expect(map.byPath.get("README.md")?.symbols).toEqual(["linkding", "Features"]);
    expect(symbolsOf("python", "    def nested():\n")).toEqual([]); // top level only
  });

  it("resolves imports to repository files, by code", () => {
    expect(map.byPath.get("bookmarks/models.py")?.imports).toEqual(["bookmarks/services/__init__.py"]);
    expect(map.byPath.get("web/src/app.ts")?.imports).toEqual(["web/src/util.ts"]);
    expect(importsOf("a.py", "python", "import os\n", new Set(["a.py"]))).toEqual([]); // stdlib is not a repo file
  });

  it("gives tests, vendored and generated files a map entry only", () => {
    expect(map.byPath.get("bookmarks/tests/test_tags.py")).toMatchObject({ mapOnly: true, mapOnlyReason: "test" });
    expect(map.byPath.get("bookmarks/static/vendor/lib.js")).toMatchObject({ mapOnly: true, mapOnlyReason: "vendored" });
    expect(mapOnlyReason("package-lock.json")).toBe("generated");
    expect(mapOnlyReason("app/migrations/0001_initial.py")).toBe("generated");
    expect(map.byPath.get("bookmarks/models.py")?.mapOnly).toBe(false);
  });

  it("lists every file under exactly one directory and orders directories deepest first", () => {
    const listed = [...map.dirs.values()].flatMap((d) => d.files).sort();
    expect(listed).toEqual(repo.map((f) => f.path).sort());
    const order = dirsDeepestFirst(map);
    expect(order.at(-1)).toBe("");
    expect(order.indexOf("bookmarks/services")).toBeLessThan(order.indexOf("bookmarks"));
    expect(map.dirs.get("bookmarks")?.subdirs).toEqual(["bookmarks/services", "bookmarks/static", "bookmarks/tests"]);
  });
});

describe("read tools", () => {
  const files = new Map(repo.map((f) => [f.path, f.text]));

  it("reads line ranges and says how much is left", () => {
    const r = readFileLines(files, "bookmarks/models.py", 4, 5);
    expect(r).toMatchObject({ ok: true, fromLine: 4, toLine: 5, totalLines: 9, truncated: true });
    expect(renderReadFile(r)).toMatch(/4 more lines; read on with fromLine=6/);
    expect(readFileLines(files, "missing.py")).toEqual({ ok: false, error: 'no downloaded file "missing.py"' });
  });

  it("never returns more than the line and byte limits", () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 200 }), { minLength: 1, maxLength: 900 }), fc.nat({ max: 50 }), (lines, from) => {
        const r = readFileLines(new Map([["f.txt", lines.join("\n")]]), "f.txt", from + 1);
        if (!r.ok) return;
        expect(r.toLine - r.fromLine + 1).toBeLessThanOrEqual(DEFAULT_TOOL_LIMITS.maxLines);
        const bytes = Buffer.byteLength(r.text, "utf8");
        // One overlong first line may exceed the byte limit alone; otherwise the limit holds.
        if (r.toLine > r.fromLine) expect(bytes).toBeLessThanOrEqual(DEFAULT_TOOL_LIMITS.maxBytes);
      }),
      { numRuns: 100 },
    );
  });

  it("searches literally, bounded, with context", () => {
    const r = searchRepo(files, "BOOKMARK");
    expect(r.hits.map((h) => `${h.path}:${h.line}`)).toEqual(["bookmarks/models.py:4"]);
    expect(r.hits[0]!.context).toMatch(/4> class Bookmark/);
    expect(searchRepo(files, "(.*)*").hits).toEqual([]); // a literal, not a pattern
    const many = new Map([["x.txt", Array.from({ length: 100 }, () => "hit").join("\n")]]);
    expect(searchRepo(many, "hit")).toMatchObject({ more: true });
    expect(searchRepo(many, "hit").hits).toHaveLength(30);
  });
});
