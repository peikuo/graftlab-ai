import { describe, expect, it } from "vitest";
import { checkReplay, privacyProblems, siteValues } from "./replayPublish.ts";

const replay = (over: Record<string, unknown> = {}, events: unknown[] = []) =>
  JSON.stringify({
    header: { schemaVersion: 1, taskId: "t1", repo: "o/r", createdAt: "2026-11-25T00:00:00Z", label: "Replay", ...over },
    events: [
      { type: "task_created", payload: {} },
      { type: "browser_observation", payload: { screenshotRef: "artifacts/shots/s1.jpg" } },
      { type: "artifact_updated", payload: { artifactKind: "screenshot", ref: "artifacts/shots/s2.jpg" } },
      { type: "artifact_updated", payload: { artifactKind: "screenshot", ref: "../../etc/passwd" } },
      ...events,
      { type: "terminal_reached", payload: { terminal: "success" } },
    ],
  });

describe("Replay publishing checks (17.6)", () => {
  it("accepts a labeled Replay and lists only well-formed screenshot names", () => {
    const r = checkReplay("t1", replay(), []);
    expect(r).toEqual({ ok: true, entry: { taskId: "t1", repo: "o/r", terminal: "success", createdAt: "2026-11-25T00:00:00Z" }, shots: ["s1.jpg", "s2.jpg"] });
  });
  it("refuses a file without the Replay label or for another Task", () => {
    expect(checkReplay("t1", replay({ label: "Live" }), [])).toMatchObject({ ok: false, problems: ['header label is not "Replay"'] });
    expect(checkReplay("t2", replay(), [])).toMatchObject({ ok: false, problems: ["header taskId does not match the file name"] });
    expect(checkReplay("t1", "{", [])).toEqual({ ok: false, problems: ["not JSON"] });
  });
  it("names private facts and secrets without quoting them", () => {
    const text = replay({}, [{ type: "x", payload: { a: "E:\\\\work\\\\data", b: "/Users/someone/x", c: "100.101.2.3", d: "sk-" + "a".repeat(30), e: "reg.internal:5000" } }]);
    const r = checkReplay("t1", text, siteValues("# note\nREGISTRY=reg.internal:5000\nX=ab\n"));
    expect(r.ok).toBe(false);
    const problems = (r as { problems: string[] }).problems;
    expect(problems).toEqual(expect.arrayContaining(["private: Windows drive path", "private: macOS home path", "private: private VPN address (100.64.0.0/10)", "private: site value 1"]));
    expect(problems.some((p) => p.startsWith("secret pattern"))).toBe(true);
    expect(problems.join(" ")).not.toContain("reg.internal");
  });
  it("does not flag ordinary text or public addresses", () => {
    expect(privacyProblems("visited http://127.0.0.1:9090/bookmarks and 10.0.0.1, 100.200.1.1", [])).toEqual([]);
  });
});
