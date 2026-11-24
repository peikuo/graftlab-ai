import { describe, expect, it } from "vitest";
import type { Feature, TechDesign } from "@graftlab/shared";
import type { MemoTree } from "../reader/memo.ts";
import { buildFocusPack, exampleTest, importsOf, readPaths } from "./focus.ts";

const files: Record<string, string> = {
  "bookmarks/services/tagging.py": "from bookmarks.models import Bookmark\nfrom bookmarks.services import website_loader\n\ndef suggest(url):\n    pass\n\nclass Helper:\n    pass\n",
  "bookmarks/models.py": "class Bookmark:\n    pass\n",
  "bookmarks/services/website_loader.py": "def load(url):\n    pass\n",
  "bookmarks/services/__init__.py": "",
  "bookmarks/tests/test_auto_tagging.py": "from django.test import TestCase\n\nclass AutoTaggingTest(TestCase):\n    pass\n",
  "bookmarks/tests/test_health.py": "x = 1\n",
  "bookmarks/views/settings.py": "def general(request):\n    pass\n",
};
const feature: Feature = {
  id: "F1", storyId: "S1", title: "Suggest tags", summary: "s",
  scope: { modules: ["tagging"], files: ["bookmarks/services/tagging.py"], notTouch: [] },
  interfaces: [], tests: { files: ["bookmarks/tests/test_tag_suggestions.py"], command: ["pytest"] }, size: "S", dependsOn: [], servesChecks: [],
};
const design = { architecture: { affected: [{ part: "save step", how: "h", quotes: [{ path: "bookmarks/models.py", line: 1, snippet: "class Bookmark:", status: "passed" }, { path: "x.py", snippet: "nope", status: "unverified" }] }] } } as unknown as TechDesign;
const memo = { commit: "c", promptVersion: "p", records: { "bookmarks/services/tagging.py": { level: "file", source: "llm", path: "bookmarks/services/tagging.py", purpose: "Tags a bookmark.", keySymbols: ["suggest"], relatesTo: ["bookmarks/views/settings.py"] } } } as unknown as MemoTree;

describe("focus pack (R40.19)", () => {
  it("resolves Python imports to repository files", () => {
    expect(importsOf("bookmarks/services/tagging.py", files["bookmarks/services/tagging.py"]!, new Set(Object.keys(files)))).toEqual(["bookmarks/models.py", "bookmarks/services/__init__.py"]);
  });

  it("maps the planned files, their neighbors, checked quotes and an example test, and marks outdated summaries", () => {
    const p = buildFocusPack({ feature, design, memo, read: (x) => files[x], paths: Object.keys(files), changedSincePinned: ["bookmarks/services/tagging.py"] });
    expect(p.text).toContain("`bookmarks/services/tagging.py` (changed by an earlier Feature; the summary may be outdated)");
    expect(p.text).toContain("Tags a bookmark. Key parts: suggest.");
    expect(p.text).toContain("Outline: Helper, suggest");
    expect(p.text).toContain("`bookmarks/tests/test_tag_suggestions.py` (does not exist yet)");
    expect(p.text).toMatch(/## Direct neighbors[\s\S]*bookmarks\/models.py[\s\S]*bookmarks\/views\/settings.py/);
    expect(p.text).toContain("`bookmarks/models.py:1` — `class Bookmark:`");
    expect(p.text).not.toContain("nope");
    expect(p.text).toContain("An existing test next to yours: `bookmarks/tests/test_auto_tagging.py`");
    expect(p.files).toContain("bookmarks/tests/test_auto_tagging.py");
  });

  it("prefers the example test with the most shared name words and reads paths from tool inputs", () => {
    expect(exampleTest(["bookmarks/tests/test_health_check.py"], Object.keys(files))).toBe("bookmarks/tests/test_health.py");
    expect(readPaths([{ tool: "read", inputSummary: '{"path":"/work/bookmarks/models.py"}' }, { tool: "bash", inputSummary: '{"command":"ls"}' }])).toEqual(["bookmarks/models.py"]);
  });
});
