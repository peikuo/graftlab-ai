// Meeting flow with a scripted turn runner (tasks.md 6.9; R11.1, R11.2, R11.4, R11.10-R11.13, R5.3).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { describe, expect, it } from "vitest";
import { filesFrom } from "../evidence/check.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import type { TurnResult } from "../runtime/pi.ts";
import { runMeeting, type JudgeInput, type MeetingCard, type MeetingOptions } from "./meeting.ts";

const files = new Map([["app/models.py", "class Bookmark(models.Model):\n    url = models.URLField()\n"]]);
const rules: RuntimeRules = { version: "t", shared: "SHARED", roles: { facilitator: "FAC", user_value: "UV", feasibility: "FE", risk: "RISK" } };
type Tools = Map<string, AgentTool<any>>;
type Call = { roleId: string; purpose: string; thinking?: string; systemPrompt: string; prompt: string; tools: string[] };
type Script = (c: Call, tools: Tools) => Promise<string | void>;
const call = async (tools: Tools, name: string, args: unknown) => ((await tools.get(name)!.execute("id", args as never, undefined as never, undefined as never)).content[0] as { text: string }).text;
const quote = { path: "app/models.py", snippet: "url = models.URLField()" };
const position = (title: string, effort?: string) => ({ quotes: [quote], proposals: [{ kind: "new", title, userChange: `With ${title} users save time.`, purpose: "B", quotes: [1], reason: "Users do this by hand", ...(effort ? { effort } : {}) }] });

/** Default team: each perspective proposes its own idea, then gives stances on the others when picked; nobody signals. */
const team: Script = async (c, tools) => {
  if (tools.has("submit_position")) {
    await call(tools, "submit_position", position(`Idea of ${c.roleId}`, c.roleId === "feasibility" ? "large" : undefined));
    return `My view as ${c.roleId} [E1].`;
  }
  if (tools.has("submit_signal")) return void (await call(tools, "submit_signal", { speak: false }));
  if (tools.has("submit_close")) {
    const ids = [...new Set([...c.prompt.matchAll(/^(P\d+) “/gm)].map((m) => m[1]!))];
    await call(tools, "submit_close", { decisions: ids.map((id, i) => ({ proposal: id, verdict: "recommend", rank: i + 1, reason: "All three support it", conditions: i === 0 ? ["off by default"] : [] })), openQuestions: ["Which model provider?"] });
    return "I recommend these.";
  }
  if (c.roleId === "facilitator") return void (await call(tools, "submit_turn", {}));
  const missing = [...c.prompt.matchAll(/P\d+/g)].map((m) => m[0]);
  const need = /still needs your stance on: ([P\d, ]+)/.exec(c.prompt)?.[1]?.split(", ") ?? missing.slice(0, 1);
  await call(tools, "submit_turn", { respondsTo: "facilitator", changes: need.map((p) => ({ kind: "stance", proposal: p, stance: "support", reason: "Fits", evidence: [{ id: "E1" }], ...(c.roleId === "feasibility" ? { effort: "small" } : {}) })) });
  return "I agree, it fits.";
};
function setup(script: Script, extra: Partial<MeetingOptions> = {}) {
  const calls: Call[] = [];
  const events: { type: string; actor: any; payload: any }[] = [];
  const cards: { title: string; answer: (a: { optionId?: string; text?: string }) => void; closed: boolean }[] = [];
  const judge: JudgeInput[] = [];
  const o: MeetingOptions = {
    rules,
    context: "BRIEF",
    files,
    evidence: filesFrom(files),
    memo: null,
    emit: async (d) => void events.push(d as never),
    openCard: async (card) => {
      let answer!: (a: { optionId?: string; text?: string }) => void;
      const rec = { title: card.title, answer: (a: { optionId?: string; text?: string }) => answer(a), closed: false };
      cards.push(rec);
      const c: MeetingCard = { cardId: `c${cards.length}`, answer: new Promise((r) => (answer = r)), close: async () => ((rec.closed = true), true) };
      return c;
    },
    takeJudgeMessages: () => judge.splice(0),
    runTurn: async (t) => {
      const c: Call = { roleId: t.roleId, purpose: t.purpose, ...(t.thinkingLevel ? { thinking: t.thinkingLevel } : {}), systemPrompt: t.systemPrompt, prompt: t.prompt, tools: t.tools.map((x) => x.name) };
      calls.push(c);
      const said = await script(c, new Map(t.tools.map((x) => [x.name, x])));
      return { stopReason: "stop", text: said ?? "", toolCalls: 1, truncated: false } satisfies TurnResult;
    },
    signal: new AbortController().signal,
    idPrefix: "m",
    ...extra,
  };
  return { o, calls, events, cards, judge };
}

describe("runMeeting", () => {
  it("prepares the three perspectives first, then opens, discusses until every stance exists, and closes", async () => {
    const { o, calls, events } = setup(team);
    const r = await runMeeting(o);
    expect(r.ok).toBe(true);
    expect(calls.slice(0, 3).map((c) => c.roleId).sort()).toEqual(["feasibility", "risk", "user_value"]);
    expect(calls.slice(0, 3).every((c) => c.tools.includes("submit_position") && c.tools.includes("read_file"))).toBe(true);
    expect(calls[3]).toMatchObject({ roleId: "facilitator", tools: ["ask_judge", "submit_turn"] });
    expect(calls.at(-1)).toMatchObject({ roleId: "facilitator", tools: ["submit_close"] });
    const summary = events.find((e) => e.type === "meeting_summary")!.payload;
    expect(summary.proposals).toHaveLength(3);
    for (const p of summary.proposals) expect(Object.keys(p.stances).sort()).toEqual(["feasibility", "risk", "user_value"]);
    expect(summary.openQuestions).toEqual(["Which model provider?"]);
    // speaking rounds are announced in plain form; nobody signals, so code names the role that lacks stances
    expect(events.find((e) => e.type === "signals_collected")!.payload).toMatchObject({ reason: "the board still needs its view" });
  });
  it("signals run without thinking and without read tools; all roles share one system prompt; role text comes after the transcript", async () => {
    const { o, calls } = setup(team);
    await runMeeting(o);
    const sig = calls.filter((c) => c.purpose === "signal");
    expect(sig.length).toBeGreaterThan(0);
    expect(sig.every((c) => c.thinking === "off" && c.tools.join() === "submit_signal")).toBe(true);
    expect(new Set(calls.map((c) => c.systemPrompt)).size).toBe(1);
    expect(calls[0]!.systemPrompt).toBe("SHARED\n\n---\n\n# Task context\n\nBRIEF");
    const p = calls.at(-1)!.prompt;
    expect(p.indexOf("# Meeting transcript so far")).toBeLessThan(p.indexOf("# Your role\n\nFAC"));
  });
  it("the disagreeing perspective speaks next and the previous speaker never speaks twice in a row", async () => {
    const { o, calls, events } = setup(async (c, tools) => {
      if (tools.has("submit_signal")) return void (await call(tools, "submit_signal", c.roleId === "risk" ? { speak: true, kind: "disagree", intent: "warn about privacy [E1]" } : { speak: false }));
      return team(c, tools);
    }, { maxStatements: 3 });
    await runMeeting(o);
    const rounds = events.filter((e) => e.type === "signals_collected").map((e) => e.payload);
    expect(rounds[0]).toMatchObject({ next: "risk", reason: "a disagreement goes first" });
    expect(rounds[0].signals.find((s: { roleId: string }) => s.roleId === "risk").intent).toBe("warn about privacy");
    expect(rounds[1].signals.map((s: { roleId: string }) => s.roleId)).not.toContain("risk");
    const speakers = calls.filter((c) => c.tools.includes("submit_turn") && c.roleId !== "facilitator").map((c) => c.roleId);
    for (let i = 1; i < speakers.length; i++) expect(speakers[i]).not.toBe(speakers[i - 1]);
  });
  it("shows statements without ids: the transcript gets cleaned text, statement events carry plain changes and the quotes", async () => {
    const { o, calls, events } = setup(team);
    await runMeeting(o);
    expect(calls.at(-1)!.prompt).toContain("My view as risk.");
    expect(calls.at(-1)!.prompt).not.toContain("My view as risk [E1]");
    const st = events.find((e) => e.type === "statement_submitted" && e.payload.phase === "discuss")!.payload;
    expect(st.changes[0]).toMatch(/^Supports “Idea of .+”(, a small change)?: Fits$/);
    expect(st.evidence[0]).toMatchObject({ path: "app/models.py", status: "passed" });
  });
  it("a question does not block: the answer arrives as a Judge input; an unanswered card is closed at the end and listed (R5.3)", async () => {
    let answered = false;
    const { o, calls, cards } = setup(async (c, tools) => {
      if (c.roleId === "facilitator" && tools.has("ask_judge") && cards.length === 0) {
        expect(await call(tools, "ask_judge", { question: "Who uses it most?", options: ["People", "Teams"] })).toMatch(/Continue/);
        await call(tools, "ask_judge", { question: "Second in one turn?" }).then((t) => expect(t).toMatch(/Only one question/));
        await call(tools, "submit_turn", {});
        return;
      }
      if (!answered && cards[0] && c.purpose === "signal") {
        answered = true;
        cards[0].answer({ optionId: "o1" });
        await new Promise((r) => setTimeout(r, 0));
      }
      return team(c, tools);
    });
    const r = await runMeeting(o);
    expect(r.ok).toBe(true);
    expect(calls.some((c) => c.prompt.includes('### Judge answered the question "Who uses it most?"\nPeople'))).toBe(true);
    // a second meeting where nobody answers: the card is closed and becomes an open question
    const s2 = setup(async (c, tools) => {
      if (c.roleId === "facilitator" && tools.has("ask_judge") && s2.cards.length === 0) {
        await call(tools, "ask_judge", { question: "Unanswered?" });
        return void (await call(tools, "submit_turn", {}));
      }
      return team(c, tools);
    });
    const r2 = await runMeeting(s2.o);
    expect(s2.cards[0]!.closed).toBe(true);
    expect(r2.ok && r2.summary.openQuestions).toContain("Unanswered?");
  });
  it("a Judge message addressed to a perspective is delivered and that role speaks next (R12.2)", async () => {
    const s = setup(team, { maxStatements: 2 });
    s.judge.push({ text: "Risk, is the API safe?", to: "risk", clientMsgId: "m1" });
    await runMeeting(s.o);
    expect(s.events.find((e) => e.type === "judge_message_delivered")!.payload).toEqual({ clientMsgIds: ["m1"], deliveredTo: ["facilitator", "user_value", "feasibility", "risk"] });
    expect(s.calls[0]!.prompt).toContain("### Judge (to Risk)\nRisk, is the API safe?");
    expect(s.events.find((e) => e.type === "signals_collected")!.payload).toMatchObject({ next: "risk", reason: "you addressed it" });
  });
  it("a statement without a valid submission gets one visible retry, then fails visibly; the meeting continues (R11.2, R23.5)", async () => {
    const { o, events } = setup(async (c, tools) => {
      if (c.roleId === "feasibility" && tools.has("submit_position")) return "I forgot to submit.";
      return team(c, tools);
    });
    const r = await runMeeting(o);
    const failures = events.filter((e) => e.type === "failure").map((e) => e.payload.detail);
    expect(failures.slice(0, 2)).toEqual(["Feasibility ended the turn without a valid submit_position (no valid submission); one retry", "Feasibility's statement failed: no valid submission"]);
    expect(r.ok).toBe(true);
  });
  it("a discussion statement must change the board; the end is forced at the statement limit", async () => {
    const outs: string[] = [];
    const { o, calls } = setup(async (c, tools) => {
      if (tools.has("submit_signal")) return void (await call(tools, "submit_signal", { speak: true, kind: "add" }));
      if (tools.has("submit_turn") && c.roleId !== "facilitator") outs.push(await call(tools, "submit_turn", { changes: [] }));
      return team(c, tools);
    }, { maxStatements: 2 });
    await runMeeting(o);
    expect(outs[0]).toMatch(/^Not accepted: no change\. Every statement gives or changes/);
    expect(calls.filter((c) => c.purpose === "signal").length).toBeLessThanOrEqual(2 * 3);
  });
  it("without any proposal the meeting result is not ok", async () => {
    const { o } = setup(async (c, tools) => {
      if (tools.has("submit_position")) return "nothing";
      return team(c, tools);
    });
    expect(await runMeeting(o)).toMatchObject({ ok: false, reason: "the meeting ended without any proposal on the board" });
  });
  it("the Facilitator concludes: every proposal gets a verdict; the close is refused until then (R11.14)", async () => {
    const outs: string[] = [];
    const { o, events } = setup(async (c, tools) => {
      if (tools.has("submit_close")) {
        outs.push(await call(tools, "submit_close", { decisions: [{ proposal: "P1", verdict: "drop", reason: "Too risky" }] }));
        return team(c, tools);
      }
      return team(c, tools);
    });
    const r = await runMeeting(o);
    expect(outs[0]).toMatch(/^Not accepted yet: no verdict yet for P2, P3/);
    expect(r.ok).toBe(true);
    const ps = events.find((e) => e.type === "meeting_summary")!.payload.proposals;
    expect(ps.find((p: { id: string }) => p.id === "P1").verdict).toMatchObject({ verdict: "recommend", rank: 1, conditions: ["off by default"] });
    expect(ps.every((p: { verdict?: unknown }) => p.verdict)).toBe(true);
    const close = events.findLast((e) => e.type === "statement_submitted" && e.payload.phase === "close")!.payload;
    expect(close.changes[0]).toBe("Recommends “Idea of user_value” as number 1, only if off by default: All three support it");
  });
  it("the Facilitator can end the discussion in a steering turn after one statement", async () => {
    const { o, calls } = setup(async (c, tools) => {
      if (tools.has("submit_signal")) return void (await call(tools, "submit_signal", { speak: true, kind: "disagree" }));
      if (c.roleId === "facilitator" && tools.has("submit_turn") && /Steer/.test(c.prompt)) return void (await call(tools, "submit_turn", { endDiscussion: true }));
      return team(c, tools);
    }, { maxStatements: 10 });
    await runMeeting(o);
    const discuss = calls.filter((c) => c.roleId !== "facilitator" && c.tools.includes("submit_turn")).length;
    expect(discuss).toBe(4); // the first steering turn comes after 4 statements and ends it
    expect(calls.at(-1)!.tools).toContain("submit_close");
  });
  it("a position without a new capability is refused; the board keeps the kind (R11.15)", async () => {
    const outs: string[] = [];
    const { o, events } = setup(async (c, tools) => {
      if (c.roleId === "risk" && tools.has("submit_position") && outs.length === 0) {
        outs.push(await call(tools, "submit_position", { quotes: [quote], proposals: [{ kind: "improve", title: "Better tags", userChange: "x", purpose: "B", quotes: [1], reason: "y" }] }));
        outs.push(await call(tools, "submit_position", { quotes: [quote], proposals: [{ kind: "improve", title: "Better tags", userChange: "x", purpose: "B", quotes: [1], reason: "y" }, { kind: "new", title: "Ask your library", userChange: "z", purpose: "B", quotes: [1], reason: "w" }] }));
        return "ok";
      }
      return team(c, tools);
    });
    await runMeeting(o);
    expect(outs[0]).toMatch(/^Not accepted: at least one proposal must be kind new/);
    expect(outs[1]).toMatch(/^Accepted/);
    const kinds = Object.fromEntries(events.find((e) => e.type === "meeting_summary")!.payload.proposals.map((p: { title: string; kind: string }) => [p.title, p.kind]));
    expect(kinds).toMatchObject({ "Better tags": "improve", "Ask your library": "new" });
  });
  it("Feasibility must state the effort; a large one is named an engineering risk (R37.9)", async () => {
    const outs: string[] = [];
    const { o, events } = setup(async (c, tools) => {
      if (c.roleId === "feasibility" && tools.has("submit_position") && outs.length === 0) {
        outs.push(await call(tools, "submit_position", position("No effort given")));
        outs.push(await call(tools, "submit_position", position("Big one", "large")));
        return "ok";
      }
      return team(c, tools);
    });
    await runMeeting(o);
    expect(outs[0]).toMatch(/effort \(small, medium or large\) is needed/);
    const prep = events.find((e) => e.type === "statement_submitted" && e.actor.roleId === "feasibility" && e.payload.phase === "prepare")!.payload;
    expect(prep.changes[0]).toBe("Proposed a new capability, “Big one”");
    const big = events.find((e) => e.type === "meeting_summary")!.payload.proposals.find((p: { title: string }) => p.title === "Big one");
    expect(big.stances.feasibility.effort).toBe("large");
  });
});
