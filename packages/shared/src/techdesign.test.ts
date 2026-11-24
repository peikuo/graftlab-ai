import { describe, expect, it } from "vitest";
import { isTestPath } from "./techdesign.ts";
describe("isTestPath (R40.20)", () => {
  const f = { tests: { files: ["bookmarks/checks_ai.py"], command: ["x"] } };
  it("accepts the Feature's named test files and test-looking paths", () => {
    for (const p of ["bookmarks/checks_ai.py", "bookmarks/tests/helpers.py", "bookmarks/tests/test_ai.py", "src/a.test.ts", "src/b.spec.tsx", "pkg/x_test.go", "conftest.py", "web/__tests__/c.js"]) expect(isTestPath(f, p)).toBe(true);
  });
  it("refuses source files", () => {
    for (const p of ["bookmarks/models.py", "bookmarks/services/ai.py", "src/testing.ts", "contest.py", "bookmarks/templates/test.html"]) expect(isTestPath(f, p)).toBe(false);
  });
});
