// Meeting tests with a scripted turn runner (tasks.md 6.9; R11.1, R11.2, R11.5, R11.6, R5.3, R24).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { filesFrom } from "../evidence/check.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import type { TurnResult } from "../runtime/pi.ts";
import { runMeeting, type MeetingOptions } from "./meeting.ts";

const files = new Map([["app/models.py", "class Bookmark(models.Model):\n    url = models.URLField()\n"]]);
const rules: RuntimeRules = { version: "t", shared: "SHARED", roles: { facilitator: "FAC", user_value: "UV", feasibility: "FE", risk: "RISK" } };
type Call = { roleId: string; systemPrompt: string; prompt: string };
type Script = (roleId: string, tools: Map<string, AgentTool<any>>, n: number) => Promise<void>;
const call = (tools: Map<string, AgentTool<any>>, name: string, args: unknown) => tools.get(name)!.execute("id", args as never, undefined as never, undefined as never);
const good = { summary: "Users save links.", findings: [{ claim: "Bookmarks have a URL", evidence: [{ path: "app/models.py", snippet: "url = models.URLField()" }] }, { claim: "Bookmarks have tags", evidence: [{ path: "app/models.py", snippet: "tags = models.ManyToManyField" }] }], workflows: [{ name: "Auto-tag", purpose: "A", description: "AI suggests tags", evidence: [{ path: "app/models.py", snippet: "class Bookmark(models.Model):" }] }] };
const summaryArgs = { findings: [{ claim: "Bookmark model exists", evidence: [{ path: "app/models.py", snippet: "class Bookmark(models.Model):" }] }], workflows: [{ name: "Auto-tag", purpose: "B", description: "x", evidence: [] }], openQuestions: ["Which model provider?"] };
function setup(script: Script, extra: Partial<MeetingOptions> = {}) {
  const calls: Call[] = [];
  const events: { type: string; actor: unknown; payload: any }[] = [];
  const asked: string[] = [];
  let n = 0;
  const o: MeetingOptions = {
    rules,
    context: "BRIEF",
    files,
    evidence: filesFrom(files),
    memo: null,
    emit: async (d) => void events.push(d as never),
    askJudgeFor: async (card) => (asked.push(card.title), null),
    runTurn: async (t) => {
      calls.push({ roleId: t.roleId, systemPrompt: t.systemPrompt, prompt: t.prompt });
      await script(t.roleId, new Map(t.tools.map((x) => [x.name, x])), n++);
      return { stopReason: "stop", text: `${t.roleId} speaks.`, toolCalls: 1, truncated: false } satisfies TurnResult;
    },
    signal: new AbortController().signal,
    idPrefix: "m",
    ...extra,
  };
  return { o, calls, events, asked };
}
const everyoneSubmits: Script = async (_r, tools) => {
  if (tools.has("submit_meeting_summary")) await call(tools, "submit_meeting_summary", summaryArgs);
  else await call(tools, "submit_statement", good);
};

describe("runMeeting", () => {
  it("runs the fixed turn order for 2 rounds and ends with a checked meeting summary", async () => {
    const { o, calls, events } = setup(everyoneSubmits);
    const r = await runMeeting(o);
    expect(calls.map((c) => c.roleId)).toEqual(["facilitator", "user_value", "feasibility", "risk", "facilitator", "facilitator", "user_value", "feasibility", "risk", "facilitator"]);
    expect(r.ok).toBe(true);
    const summary = events.find((e) => e.type === "meeting_summary")!.payload;
    expect(summary.findings[0]).toMatchObject({ claim: "Bookmark model exists", evidenceStatus: "passed" });
    expect(summary.workflows[0]).toMatchObject({ purpose: "B", evidenceStatus: "unverified" }); // no evidence: Unverified (R11.6)
  });
  it("checks every finding by code: a quoted line passes, an invented one is Unverified with its reason (R24)", async () => {
    const { o, events } = setup(everyoneSubmits, { rounds: 1 });
    await runMeeting(o);
    const findings = events.filter((e) => e.type === "finding_recorded").map((e) => e.payload);
    expect(findings[0]).toMatchObject({ text: "Bookmarks have a URL", evidenceStatus: "passed" });
    expect(findings[1]).toMatchObject({ text: "Bookmarks have tags", evidenceStatus: "unverified", evidence: [{ reason: "snippet_absent" }] });
    expect(events.find((e) => e.type === "statement_submitted")!.payload).toMatchObject({ roleId: "facilitator", round: 1, workflows: [{ purpose: "A", evidenceStatus: "passed" }] });
  });
  it("a turn without a valid statement fails visibly and the meeting continues (R11.2)", async () => {
    const { o, events, calls } = setup(async (role, tools) => {
      if (role === "risk") return void (await call(tools, "submit_statement", { summary: "" , findings: [] })); // invalid, never accepted
      await everyoneSubmits(role, tools, 0);
    }, { rounds: 1 });
    const r = await runMeeting(o);
    expect(r.ok).toBe(true);
    const failures = events.filter((e) => e.type === "failure").map((e) => e.payload.detail);
    expect(failures[0]).toMatch(/^Risk ended the turn without a valid submit_statement .*; one retry$/); // the visible retry
    expect(failures[1]).toMatch(/^Risk's turn failed/);
    expect(events.filter((e) => e.type === "statement_submitted").map((e) => e.payload.roleId)).not.toContain("risk");
    expect(calls.at(-1)!.prompt).toContain("### Risk (round 1)\n(turn failed: no valid statement)");
  });
  it("an unanswered question is recorded in the transcript and the meeting continues (R5.3, R11.4)", async () => {
    const { o, calls, asked } = setup(async (role, tools, n) => {
      if (n === 0) {
        const res = await call(tools, "ask_judge", { question: "Who are the main users?", options: ["Individuals", "Teams"] });
        expect((res.content[0] as { text: string }).text).toMatch(/No answer within the wait/);
      }
      await everyoneSubmits(role, tools, n);
    }, { rounds: 1 });
    await runMeeting(o);
    expect(asked).toEqual(["Who are the main users?"]);
    expect(calls[1]!.prompt).toContain('### No answer from the Judge to "Who are the main users?" within the wait');
  });
  it("only the Facilitator can ask, and only the last closing turn can submit the summary", async () => {
    const seen: Record<string, string[]> = {};
    const { o } = setup(async (role, tools, n) => {
      seen[`${n}:${role}`] = [...tools.keys()];
      await everyoneSubmits(role, tools, n);
    }, { rounds: 1 });
    await runMeeting(o);
    expect(seen["0:facilitator"]).toEqual(["read_file", "search_repo", "read_memo", "search_memo", "ask_judge", "submit_statement"]);
    expect(seen["1:user_value"]).toEqual(["read_file", "search_repo", "read_memo", "search_memo", "submit_statement"]);
    expect(seen["4:facilitator"]).toEqual(["read_file", "search_repo", "read_memo", "search_memo", "ask_judge", "submit_meeting_summary"]);
  });
  it("stops reads after the per-turn budget (5 in round 1)", async () => {
    const outs: string[] = [];
    const { o } = setup(async (role, tools, n) => {
      if (n === 0) for (let i = 0; i < 6; i++) outs.push(((await call(tools, "search_repo", { query: "Bookmark" })).content[0] as { text: string }).text);
      await everyoneSubmits(role, tools, n);
    }, { rounds: 1 });
    await runMeeting(o);
    expect(outs.slice(0, 5).every((t) => !t.includes("budget"))).toBe(true);
    expect(outs[5]).toBe("read budget reached, submit now");
  });
  it("a turn that ends without a submission gets one retry that can still succeed (R23.5)", async () => {
    let first = true;
    const { o, events } = setup(async (role, tools, n) => {
      if (role === "user_value" && first) return void (first = false); // ends without submitting
      await everyoneSubmits(role, tools, n);
    }, { rounds: 1 });
    expect((await runMeeting(o)).ok).toBe(true);
    expect(events.filter((e) => e.type === "failure").map((e) => e.payload.detail)).toEqual(["User_Value ended the turn without a valid submit_statement (no valid submission); one retry"]);
    expect(events.filter((e) => e.type === "statement_submitted").map((e) => e.payload.roleId)).toContain("user_value");
  });
  it("keeps one cached prefix: same system prompt prefix for all roles, and each prompt extends the transcript of the previous one", async () => {
    const { o, calls } = setup(everyoneSubmits, { rounds: 1 });
    await runMeeting(o);
    for (const c of calls) expect(c.systemPrompt.startsWith("SHARED\n\n---\n\n# Task context\n\nBRIEF")).toBe(true);
    const body = (p: string) => p.slice(0, p.lastIndexOf("\n\n---\n\n"));
    for (let i = 1; i < calls.length; i++) if (body(calls[i - 1]!.prompt) !== "# Meeting transcript so far\n\n(the meeting starts now)") expect(body(calls[i]!.prompt).startsWith(body(calls[i - 1]!.prompt))).toBe(true);
  });
  it("without a valid summary the meeting result is not ok", async () => {
    const { o } = setup(async (role, tools) => {
      if (!tools.has("submit_meeting_summary")) await call(tools, "submit_statement", good);
    }, { rounds: 1 });
    expect(await runMeeting(o)).toMatchObject({ ok: false });
  });
});
