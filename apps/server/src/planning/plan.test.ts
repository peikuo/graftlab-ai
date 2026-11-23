// Planning and documenting with a scripted turn runner (tasks.md 13.3, 13.4, 13.7; R19.1, R19.2, R20.9, R40.3).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { content, check } from "../decision/fixtures.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import { allowedKinds, runPlanning, type PlanningOptions } from "./plan.ts";
import { renderBacklog } from "./render.ts";

const rules: RuntimeRules = { version: "t", shared: "S", roles: { planner: "PL", facilitator: "F", feasibility: "FE", risk: "R" } };
const decision = content({ chosenApproachIds: ["src"] });
const files = new Map([["Dockerfile", "EXPOSE 9090\nCMD [\"./bootstrap.sh\"]\n"]]);
type Tools = Map<string, AgentTool<any>>;
const call = async (t: Tools, name: string, a: unknown) => ((await t.get(name)!.execute("i", a as never, undefined as never, undefined as never)).content[0] as { text: string }).text;

const story = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Suggest tags ${id}`,
  priority: Number(id.slice(1)),
  userStory: "As a user I want tag suggestions so that saving is faster",
  acceptanceCriteria: ["suggested tags appear in the save form"],
  demoPoint: "save a bookmark and see three suggested tags",
  references: ["workflow:w1"],
  featureContract: { feature: "Suggest tags when saving", shouldDo: ["suggest up to three tags"], shouldNotDo: ["change existing tags"], executionKind: "source_change", acceptanceChecks: [check] },
  ...over,
});
const planInput = { sprintGoal: "Saving a bookmark suggests tags", stories: [story("S1"), story("S2")], definitionOfDone: ["every acceptance check passes in the Verifier"] };

function setup(script: (role: string, t: Tools, prompt: string) => Promise<void>) {
  const calls: string[] = [];
  const failures: string[] = [];
  const o: PlanningOptions = {
    rules,
    context: "CTX",
    decisionMarkdown: "# Decision_Doc version 1",
    decision,
    decisionVersion: 1,
    files,
    emit: async (e) => void (e.type === "failure" && failures.push((e.payload as { detail: string }).detail)),
    signal: new AbortController().signal,
    idPrefix: "p",
    runTurn: async (t) => {
      calls.push(t.roleId);
      await script(t.roleId, new Map(t.tools.map((x) => [x.name, x])), t.prompt);
      return { stopReason: "stop", text: "", toolCalls: 1, truncated: false };
    },
  };
  return { o, calls, failures };
}
const assess = async (role: string, t: Tools) => {
  if (role === "feasibility") return void (await call(t, "submit_plan_assessment", { assessments: [{ storyId: "S1", effort: "small", concerns: "fits the save step" }, { storyId: "S2", effort: "large", concerns: "touches every form" }] }));
  if (role === "risk") return void (await call(t, "submit_plan_assessment", { assessments: [{ storyId: "S1", risk: "wrong tags", conditions: "user confirms" }, { storyId: "S2", risk: "slow saves" }] }));
};

describe("runPlanning", () => {
  it("Planner drafts, Feasibility and Risk assess in parallel, the Facilitator decides; code fills versions and budgets", async () => {
    const { o, calls } = setup(async (role, t) => {
      if (role === "planner") return void (await call(t, "submit_plan", planInput));
      if (role === "facilitator") return void (await call(t, "submit_final_plan", { ...planInput, stories: [story("S1")], note: "Dropped S2: large, and S1 meets the goal." }));
      await assess(role, t);
    });
    const r = await runPlanning(o);
    expect(calls.slice(0, 1)).toEqual(["planner"]);
    expect(calls.slice(1, 3).sort()).toEqual(["feasibility", "risk"]);
    expect(calls[3]).toBe("facilitator");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.backlog.stories.map((s) => s.id)).toEqual(["S1"]);
    expect(r.plan.sprintPlan).toEqual({ decisionVersion: 1, goal: "Saving a bookmark suggests tags", storyIds: ["S1"], featureContractRefs: ["S1.featureContract"] });
    expect(r.plan.backlog.stories[0]!.featureContract).toMatchObject({ derivedFromDecisionVersion: 1, budgets: { maxAttempts: 3, maxCodeAgentMinutes: 10 } });
    expect(r.plan.assessments.feasibility.find((a) => a.storyId === "S2")?.effort).toBe("large");
    expect(r.plan.facilitatorNote).toMatch(/Dropped S2/);
    expect(r.plan.label).toBe("LLM assessment, not a guarantee");
    expect(renderBacklog(r.plan.backlog, r.plan)).toContain("Based on Decision_Doc version 1");
  });

  it("rejects an incomplete story by name and a file list in a Feature_Contract; the role gets one visible retry", async () => {
    const answers: string[] = [];
    let tries = 0;
    const { o, failures } = setup(async (role, t) => {
      if (role === "planner") {
        tries++;
        answers.push(await call(t, "submit_plan", { ...planInput, stories: [story("S1", { acceptanceCriteria: [] })] }));
        answers.push(await call(t, "submit_plan", { ...planInput, stories: [story("S1", { featureContract: { ...story("S1").featureContract, files: ["bookmarks/views.py"] } })] }));
        if (tries === 2) await call(t, "submit_plan", planInput);
        return;
      }
      if (role === "facilitator") return void (await call(t, "submit_final_plan", { ...planInput, note: "no changes" }));
      await assess(role, t);
    });
    const r = await runPlanning(o);
    expect(answers[0]).toMatch(/story S1 "Suggest tags S1": acceptanceCriteria/);
    expect(answers[1]).toMatch(/story S1 .*featureContract.*(Unrecognized|unrecognized)/);
    expect(failures[0]).toMatch(/^Planner ended the turn without a valid submit_plan/);
    expect(r.ok).toBe(true);
  });

  it("refuses story kinds the chosen approach does not allow", async () => {
    expect([...allowedKinds(decision)]).toEqual(["source_change"]);
    expect([...allowedKinds(content({ chosenApproachIds: ["agent"] }))]).toEqual(["api_operation"]);
    let answer = "";
    const { o } = setup(async (role, t) => {
      if (role === "planner") answer = await call(t, "submit_plan", { ...planInput, stories: [story("S1", { featureContract: { ...story("S1").featureContract, executionKind: "api_operation" } })] });
    });
    const r = await runPlanning(o);
    expect(answer).toMatch(/allows only source_change stories; change S1/);
    expect(r).toEqual({ ok: false, reason: "the Planner did not submit a valid plan" });
  });
});

export { setup, assess, call, planInput, story, files, rules };
