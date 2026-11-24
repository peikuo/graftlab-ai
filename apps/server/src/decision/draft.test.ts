// Decision draft with a scripted turn runner (tasks.md 7.3; R15.2, R37.2, R37.5, R37.6, R37.9).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Proposal } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { filesFrom } from "../evidence/check.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import { runDecisionDraft, type DraftOptions } from "./draft.ts";
import { check } from "./fixtures.ts";

const files = new Map([["bookmarks/services/bookmarks.py", "def create_bookmark(bookmark, tag_string, current_user):\n    pass\n"]]);
const rules: RuntimeRules = { version: "t", shared: "S", roles: { facilitator: "F", feasibility: "FE", risk: "R" } };
const proposal: Proposal = { id: "P1", kind: "improve", title: "Tag suggestions", userChange: "x", purpose: "B", evidence: [{ path: "bookmarks/services/bookmarks.py", snippet: "def create_bookmark(", status: "passed" }], evidenceStatus: "passed", stances: {}, verdict: { verdict: "recommend", rank: 1, reason: "all agree", conditions: [] }, addedBy: "user_value" };
const draft = {
  purpose: "B",
  workflows: [{ proposal: "Tag suggestions", name: "Suggest tags", purpose: "B", description: "suggest tags at save [E1]" }],
  inScope: ["suggestions in the save form"],
  acceptanceCriteria: ["suggested tags appear"],
  approachOptions: [
    { id: "src", kind: "source_change", title: "Change the save step", summary: "call a model after the page fetch", acceptanceChecks: [check] },
    { id: "agent", kind: "independent_agent", title: "Separate helper", summary: "a helper container", acceptanceChecks: [] },
  ],
  uiImpact: "chips under the tag box",
  aiRuntime: { source: "studio_service", dataSent: ["the bookmark title and description"], reason: "the server cannot host a model" },
};
type Tools = Map<string, AgentTool<any>>;
const call = async (t: Tools, name: string, a: unknown) => ((await t.get(name)!.execute("i", a as never, undefined as never, undefined as never)).content[0] as { text: string }).text;
function setup(script: (role: string, t: Tools, prompt: string) => Promise<void>, extra: Partial<DraftOptions> = {}) {
  const calls: string[] = [];
  const o: DraftOptions = {
    rules, context: "CTX", proposals: [proposal], openQuestions: [], judgeAnswers: ["Where may AI run? → Cloud AI, user opts in"],
    files, evidence: filesFrom(files), emit: async () => {}, signal: new AbortController().signal, idPrefix: "d",
    runTurn: async (t) => {
      calls.push(t.roleId);
      await script(t.roleId, new Map(t.tools.map((x) => [x.name, x])), t.prompt);
      return { stopReason: "stop", text: "", toolCalls: 1, truncated: false };
    },
    ...extra,
  };
  return { o, calls };
}
const team = async (role: string, t: Tools) => {
  if (role === "facilitator") return void (await call(t, "submit_decision_draft", draft));
  if (role === "feasibility") return void (await call(t, "submit_assessment", { assessments: [{ optionId: "src", feasibility: "fits", effort: "small", neededEnvironments: ["development_sandbox"], claims: [{ text: "the save step exists", quotes: [{ path: "bookmarks/services/bookmarks.py", snippet: "def create_bookmark(bookmark, tag_string, current_user):" }] }] }, { optionId: "agent", feasibility: "new container", effort: "large", firstVersion: "suggest only for new saves" }] }));
  await call(t, "submit_assessment", { assessments: [{ optionId: "src", risk: "wrong tags", claims: [{ text: "invented", quotes: [{ path: "bookmarks/services/bookmarks.py", snippet: "def ai_magic(self):" }] }] }, { optionId: "agent", risk: "another service to run" }] });
};

describe("runDecisionDraft", () => {
  it("refuses a draft without the AI runtime section (R15.12)", async () => {
    let answer = "";
    const { o } = setup(async (role, t) => {
      if (role === "facilitator" && !answer) answer = await call(t, "submit_decision_draft", { ...draft, aiRuntime: undefined });
    });
    await runDecisionDraft(o);
    expect(answer).toMatch(/^Not accepted: aiRuntime/);
  });
  it("merges the draft and both assessments; code computes complete, checks quotes and names large changes as risks", async () => {
    const { o, calls } = setup(team);
    const r = await runDecisionDraft(o);
    expect(calls.sort()).toEqual(["facilitator", "feasibility", "risk"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [src, agent] = r.content.approachOptions;
    expect(src!.assessment).toMatchObject({ complete: true, effort: "small", feasibility: "fits", risk: "wrong tags", label: "LLM assessment, not a guarantee" });
    expect(src!.assessment.claims.map((c) => c.evidenceStatus)).toEqual(["passed", "unverified"]);
    expect(agent!.assessment).toMatchObject({ complete: false, effort: "large" });
    expect(r.content.risks).toContain("Large change (engineering risk): Separate helper; a first version: suggest only for new saves");
    expect(r.content.workflows[0]).toMatchObject({ description: "suggest tags at save", evidenceStatus: "passed" }); // evidence from the meeting board, ids removed
    expect(r.content.chosenApproachIds).toEqual([]);
  });
  it("refuses a draft with an invalid acceptance check or a workflow without a meeting proposal", async () => {
    const outs: string[] = [];
    const { o } = setup(async (role, t) => {
      if (role === "facilitator" && outs.length === 0) {
        outs.push(await call(t, "submit_decision_draft", { ...draft, workflows: [{ ...draft.workflows[0], proposal: "Something else entirely" }], approachOptions: [{ ...draft.approachOptions[0], acceptanceChecks: [{ id: "x", kind: "test_suite", command: [] }] }] }));
      }
      await team(role, t);
    });
    await runDecisionDraft(o);
    expect(outs[0]).toMatch(/names no proposal of the meeting/);
    expect(outs[0]).toMatch(/option "src", check 1/);
  });
  it("after a send back, an unchanged option keeps its assessment and is not assessed again", async () => {
    const first = await runDecisionDraft(setup(team).o);
    if (!first.ok) throw new Error("first draft failed");
    const { o, calls } = setup(async (role, t, prompt) => {
      if (role === "facilitator") {
        expect(prompt).toContain("- What changes on screen: Use chips");
        return void (await call(t, "submit_decision_draft", { ...draft, uiImpact: "chips with an accept button", approachOptions: [draft.approachOptions[0], { ...draft.approachOptions[1], summary: "a helper container, revised" }] }));
      }
      await team(role, t);
    }, { previous: { content: first.content, rejections: [{ title: "What changes on screen", reason: "Use chips" }] } });
    const r = await runDecisionDraft(o);
    expect(r.ok && r.reassessed).toEqual(["agent"]);
    expect(r.ok && r.content.approachOptions[0]).toEqual(first.content.approachOptions[0]);
    expect(calls.filter((c) => c !== "facilitator").length).toBe(2);
  });
});
