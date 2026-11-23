// Requirements and the technical design with a scripted turn runner (tasks.md 14.23; R19.2, R19.13-R19.15).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { checkBreakdown, unplannedChanges, type Plan } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { filesFrom } from "../evidence/check.ts";
import { checkRequirements } from "./docs.ts";
import { runPlanning } from "./plan.ts";
import { assess, call, planInput, rules, setup } from "./plan.test.ts";
import { renderArchitecture, renderFeatures } from "./render.ts";
import { checkTechDesign, runTechDesign } from "./techdesign.ts";

const files = new Map([
  ["Makefile", "serve:\n\tuv run manage.py runserver $(BIND)\n"],
  ["bookmarks/services/auto_tagging.py", "def get_tags(script, url):\n    pass\n"],
]);
const skillRules = { ...rules, roles: { ...rules.roles, reviewer: "RV" }, skills: { "feature-breakdown": "FB", "story-splitting": "SS" } };
type Tools = Map<string, AgentTool<any>>;

async function confirmedPlan(): Promise<Plan> {
  const { o } = setup(async (role, t) => {
    if (role === "planner") return void (await call(t, "submit_plan", planInput));
    if (role === "facilitator") return void (await call(t, "submit_final_plan", { ...planInput, note: "no changes" }));
    await assess(role, t);
  });
  const r = await runPlanning(o);
  if (!r.ok) throw new Error(r.reason);
  return r.plan;
}
const feature = (id: string, storyId: string, over: Record<string, unknown> = {}) => ({
  id,
  storyId,
  title: `Feature ${id}`,
  summary: "suggest tags in the save step",
  scope: { modules: ["auto tagging"], files: ["bookmarks/services/auto_tagging.py"], notTouch: ["search syntax"] },
  interfaces: ["suggest_tags(url, text) -> list[str]"],
  tests: { files: ["bookmarks/tests/test_tag_suggestions.py"], command: ["python", "-m", "pytest", "bookmarks/tests/test_tag_suggestions.py"] },
  size: "S",
  dependsOn: [],
  servesChecks: ["c1"],
  ...over,
});
const architecture = {
  overview: "Suggestions next to the auto tags",
  affected: [{ part: "auto tagging", how: "adds a suggestion call", quotes: [{ path: "bookmarks/services/auto_tagging.py", snippet: "def get_tags(script, url):" }] }],
  decisions: [{ decision: "local model", why: "no data leaves the server", rejected: ["cloud API"] }],
  runEnvironment: { buildCommands: [], startCommands: ["uv run manage.py runserver 0.0.0.0:8000"], port: 8000, healthPath: "/health", evidence: [{ path: "Makefile", snippet: "uv run manage.py runserver $(BIND)" }] },
};
const grades = (ids: string[]) => ids.map((featureId) => ({ featureId, verticalSlice: "pass", independent: "pass", testable: "pass", small: "pass", inScope: featureId === "F2" ? "concern" : "pass", note: featureId === "F2" ? "touches the form layout" : "" }));

describe("checkBreakdown (R19.14)", () => {
  it("names the Feature that lacks tests, is too large, depends on a later Feature, or misses its story", async () => {
    const plan = await confirmedPlan();
    const bad = checkBreakdown(
      {
        features: [
          feature("F1", "S1", { dependsOn: ["F2"] }),
          feature("F2", "S1", { tests: { files: [], command: [] } }),
          feature("F3", "S2", { size: "L" }),
          feature("F4", "S9"),
          feature("F5", "S1"),
        ],
      },
      plan.backlog,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    const text = bad.problems.join("\n");
    expect(text).toMatch(/at most 4 Features/);
    expect(text).toMatch(/Feature F1: depends on F2, which is not listed before it/);
    expect(text).toMatch(/Feature F2: tests.files name the test files/);
    expect(text).toMatch(/Feature F2: tests.command give the command/);
    expect(text).toMatch(/Feature F3: size size is XS, S or M/);
    expect(text).toMatch(/Feature F4: story S9 is not in the confirmed plan/);
    const ok = checkBreakdown({ features: [feature("F1", "S1"), feature("F2", "S2", { dependsOn: ["F1"] })] }, plan.backlog);
    expect(ok.ok).toBe(true);
    const missing = checkBreakdown({ features: [feature("F1", "S1", { servesChecks: [] }), feature("F2", "S2")] }, plan.backlog);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.problems).toEqual(["story S1: acceptance check c1 is served by no Feature"]);
  });

  it("checks the size against the planned non-test files", async () => {
    const plan = await confirmedPlan();
    const five = ["a.py", "b.py", "c.py", "d.py"];
    const r = checkBreakdown({ features: [feature("F1", "S1", { size: "S", scope: { modules: ["m"], files: [...five, "bookmarks/tests/test_tag_suggestions.py"], notTouch: [] } }), feature("F2", "S2", { size: "M", scope: { modules: ["m"], files: [...five, "e.py", "f.py"], notTouch: [] } })] }, plan.backlog);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems).toEqual(["Feature F1: size S allows 2 non-test files but 4 are planned; raise the size or split it", "Feature F2: size M allows 5 non-test files but 6 are planned; split it"]);
  });

  it("lists the changed files outside the plan", () => {
    expect(unplannedChanges(feature("F1", "S1") as never, ["bookmarks/services/auto_tagging.py", "bookmarks/tests/test_tag_suggestions.py", "bookmarks/views/settings.py"])).toEqual(["bookmarks/views/settings.py"]);
  });
});

describe("runTechDesign", () => {
  it("Planner drafts, Feasibility reviews, the Reviewer decides and grades; quotes are checked by code", async () => {
    const plan = await confirmedPlan();
    const calls: string[] = [];
    const prompts: string[] = [];
    const r = await runTechDesign({
      rules: skillRules, context: "CTX", decisionMarkdown: "# D", plan, needsRunEnvironment: true, files, evidence: filesFrom(files), emit: async () => {}, signal: new AbortController().signal, idPrefix: "t",
      runTurn: async (t) => {
        calls.push(t.roleId);
        prompts.push(t.prompt);
        const tools: Tools = new Map(t.tools.map((x) => [x.name, x]));
        const fs = [feature("F1", "S1"), feature("F2", "S2", { dependsOn: ["F1"] })];
        if (t.roleId === "planner") await call(tools, "submit_tech_design", { architecture, features: fs });
        if (t.roleId === "feasibility") await call(tools, "submit_tech_review", { reviews: [{ featureId: "F1", fits: "yes", sizeRight: true }, { featureId: "F2", fits: "doubt", sizeRight: false, missing: "the form template" }] });
        if (t.roleId === "reviewer") await call(tools, "submit_final_tech_design", { architecture, features: fs, grades: grades(["F1", "F2"]), note: "Kept both; F2 needs the form template in scope." });
        return { stopReason: "stop", text: "", toolCalls: 1, truncated: false };
      },
    });
    expect(calls).toEqual(["planner", "feasibility", "reviewer"]);
    expect(prompts[0]).toContain("# Skill\n\nFB");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.design.architecture.affected[0]!.quotes[0]!.status).toBe("passed");
    expect(r.design.architecture.runEnvironment!.evidence[0]!.status).toBe("passed");
    expect(r.design.review[1]).toMatchObject({ featureId: "F2", fits: "doubt" });
    expect(r.design.grades[1]!.inScope).toBe("concern");
    const md = renderFeatures(r.design);
    expect(md).toMatch(/## F1 Feature F1 \(story S1, size S\)/);
    expect(md).toMatch(/Command: `python -m pytest bookmarks\/tests\/test_tag_suggestions.py`/);
    expect(md).toMatch(/in scope ⚠ — touches the form layout/);
    expect(renderArchitecture(r.design.architecture)).toMatch(/### Decision 1: local model[\s\S]*Rejected alternatives/);
  });

  it("requires a run environment for a source change and rejects an ungraded final Feature", async () => {
    const plan = await confirmedPlan();
    const noRun = checkTechDesign({ architecture: { ...architecture, runEnvironment: undefined }, features: [feature("F1", "S1"), feature("F2", "S2")] }, { plan, needsRunEnvironment: true, evidence: filesFrom(files) });
    expect(noRun.ok).toBe(false);
    let answer = "";
    await runTechDesign({
      rules: skillRules, context: "CTX", decisionMarkdown: "# D", plan, needsRunEnvironment: true, files, evidence: filesFrom(files), emit: async () => {}, signal: new AbortController().signal, idPrefix: "t",
      runTurn: async (t) => {
        const tools: Tools = new Map(t.tools.map((x) => [x.name, x]));
        const fs = [feature("F1", "S1"), feature("F2", "S2")];
        if (t.roleId === "planner") await call(tools, "submit_tech_design", { architecture, features: fs });
        if (t.roleId === "feasibility") await call(tools, "submit_tech_review", { reviews: [{ featureId: "F1", fits: "yes", sizeRight: true }, { featureId: "F2", fits: "yes", sizeRight: true }] });
        if (t.roleId === "reviewer" && !answer) answer = await call(tools, "submit_final_tech_design", { architecture, features: fs, grades: grades(["F1"]), note: "x" });
        return { stopReason: "stop", text: "", toolCalls: 1, truncated: false };
      },
    });
    expect(answer).toBe("Not accepted: no grade for F2. Submit again.");
  });

  it("requirements cover every story", async () => {
    const plan = await confirmedPlan();
    const r = checkRequirements({ introduction: "x", items: [{ id: "R1", storyId: "S1", text: "t", acceptance: ["a"] }] }, plan);
    expect(r).toEqual({ ok: false, problems: ["requirements: no item for story S2"] });
  });
});
