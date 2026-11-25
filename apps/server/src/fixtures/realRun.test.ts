// The UI state folded from a real full run (tasks.md 3.2): the recorded events validate, and the whiteboard, the
// regression result and the usage come out as the run showed them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { featureBoard, foldEvents, parseEvents, usageSummary } from "@graftlab/shared";
const text = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "packages", "shared", "test", "fixtures", "real-linkding-success.jsonl"), "utf8");
describe("a real linkding run (fixture)", () => {
  const parsed = parseEvents(text);
  it("every recorded event validates against the event schema", () => {
    expect(parsed.ok).toBe(true);
  });
  it("folds to success with every Feature merged, no regression and the app's model call counted", () => {
    if (!parsed.ok) return;
    const s = foldEvents(parsed.events);
    expect(s.terminal).toBe("success");
    const b = featureBoard(s)!;
    expect(b.total).toBe(4);
    expect(b.merged).toBe(4);
    expect(s.regression).toMatchObject({ pass: true, regressions: [], newFailing: [] });
    expect(s.regression!.main.ran).toBeGreaterThan(s.regression!.baseline.ran);
    expect(s.appUsage.reduce((a, u) => a + u.calls, 0)).toBeGreaterThan(0);
    const u = usageSummary(s);
    expect(u.label).toBe("estimate from configured prices");
    expect(u.total.inputTokens).toBeGreaterThan(u.total.cachedTokens);
    expect(s.changeSummary?.files.some((f) => f.studio)).toBe(true);
  });
});
