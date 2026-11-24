import { describe, expect, it } from "vitest";
import { compareRuns, moduleFiles, parseDjango } from "./regression.ts";
const out = (failures: string[], ran: number) =>
  ["Found 3 test(s).", "..F.E", "DEBUG 2026 website_loader: x", ...failures.flatMap((f) => ["======", f, "------", "Traceback (most recent call last):", "AssertionError"]), "----------------------------------------------------------------------", `Ran ${ran} tests in 12.5s`, failures.length ? `FAILED (failures=${failures.length})` : "OK"].join("\n");
describe("Regression_Check", () => {
  it("parses Django failure headers and the run count", () => {
    const r = parseDjango(out(["FAIL: test_a (bookmarks.tests.test_x.Case.test_a)", "ERROR: setUpClass (bookmarks.tests.test_y.Other)"], 40), 1);
    expect(r).toEqual({ ran: 40, failed: ["bookmarks.tests.test_x.Case.test_a", "bookmarks.tests.test_y.Other.setUpClass"], exitCode: 1 });
  });
  it("a run without a summary did not run", () => {
    expect(parseDjango("ImportError: no module", 1).ran).toBeNull();
  });
  it("names module files from a dotted id", () => {
    expect(moduleFiles("bookmarks.tests.test_x.Case.test_a")).toContain("bookmarks/tests/test_x.py");
  });
  it("counts a test failing only on main as a regression when its module existed at the pinned commit", () => {
    const base = parseDjango(out(["FAIL: test_old (bookmarks.tests.test_x.Case.test_old)"], 10), 1);
    const main = parseDjango(out(["FAIL: test_old (bookmarks.tests.test_x.Case.test_old)", "FAIL: test_b (bookmarks.tests.test_x.Case.test_b)", "FAIL: test_n (bookmarks.tests.test_new.Case.test_n)"], 14), 1);
    const r = compareRuns(base, main, (p) => p === "bookmarks/tests/test_x.py", false);
    expect(r.regressions).toEqual(["bookmarks.tests.test_x.Case.test_b"]);
    expect(r.newFailing).toEqual(["bookmarks.tests.test_new.Case.test_n"]);
    expect(r.newTests).toBe(4);
    expect(r.pass).toBe(false);
  });
  it("passes when main fails nothing new, and fails when main did not run", () => {
    const base = parseDjango(out([], 10), 0);
    expect(compareRuns(base, parseDjango(out([], 12), 0), () => true, true)).toMatchObject({ pass: true, newTests: 2, cached: true });
    expect(compareRuns(base, parseDjango("Traceback: broken settings", 1), () => true, false).pass).toBe(false);
  });
});
