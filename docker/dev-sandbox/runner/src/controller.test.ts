// Runner unit tests with the sanitized pi event fixtures recorded on 2026-11-23 (real runner, real model through
// the LLM_Proxy, toy repository): fix (story completed), ask (two ask_question calls answered in the same
// process), abort (abort after the first tool call).
import { readFileSync } from "node:fs";
import { parseRunnerLine, type PiEventLike, type RunnerEvent } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { RunnerController, type SessionLike } from "./controller.ts";

const fixture = (name: string, kind: "pi" | "out") =>
  readFileSync(new URL(`../fixtures/${name}.${kind}.jsonl`, import.meta.url), "utf8")
    .trim()
    .split("\n");

/** Replays recorded pi events: each prompt plays the events up to and including the next agent_settled. */
class FakeSession implements SessionLike {
  #listener: ((e: PiEventLike) => void) | null = null;
  #events: PiEventLike[];
  #pos = 0;
  isStreaming = false;
  prompts: string[] = [];
  steered: string[] = [];
  aborted = 0;
  disposed = 0;
  constructor(
    events: PiEventLike[],
    private readonly controller: () => RunnerController,
  ) {
    this.#events = events;
  }
  subscribe(l: (e: PiEventLike) => void) {
    this.#listener = l;
    return () => {};
  }
  async prompt(text: string) {
    this.prompts.push(text);
    this.isStreaming = true;
    while (this.#pos < this.#events.length) {
      const e = this.#events[this.#pos++]!;
      await Promise.resolve();
      this.#listener!(e);
      // pi executes the custom tool between tool_execution_start and tool_execution_end.
      if (e.type === "tool_execution_start" && e.toolName === "ask_question") this.controller().askQuestion(String(e.toolCallId), e.args);
      if (e.type === "agent_settled") break;
    }
    this.isStreaming = false;
  }
  async steer(text: string) {
    this.steered.push(text);
  }
  async followUp(text: string) {
    this.prompts.push(text);
  }
  async abort() {
    this.aborted++;
  }
  async waitForIdle() {}
  dispose() {
    this.disposed++;
  }
}

function setup(events: PiEventLike[], react?: (e: RunnerEvent, c: RunnerController) => void) {
  const out: RunnerEvent[] = [];
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((r) => (resolveExit = r));
  const c: RunnerController = new RunnerController({
    out: (e) => {
      out.push(e);
      react?.(e, c);
    },
    exit: (code) => resolveExit(code),
  });
  const session = new FakeSession(events, () => c);
  c.attach(session, { model: "m", tools: ["read", "bash", "edit", "write", "ask_question"] });
  return { c, out, session, exited };
}

const recorded = (name: string) => fixture(name, "out").map((l) => JSON.parse(l) as RunnerEvent);
/**
 * Host paths were replaced by shorter ones when the fixtures were sanitized, so a recorded 160-character summary
 * can be shorter than one mapped again; summaries are compared on their first 80 characters.
 */
const norm = (events: RunnerEvent[]) =>
  events.map((e) => {
    const x: Record<string, unknown> = { ...e };
    for (const k of ["inputSummary", "outputSummary"]) if (typeof x[k] === "string") x[k] = (x[k] as string).slice(0, 80);
    return x;
  });
const piEvents = (name: string) => fixture(name, "pi").map((l) => JSON.parse(l) as PiEventLike);

describe("runner protocol fixtures", () => {
  it("every recorded runner line is a valid protocol event", () => {
    for (const name of ["fix", "ask", "abort"]) for (const line of fixture(name, "out")) expect(parseRunnerLine(line), line.slice(0, 80)).not.toBeNull();
  });

  it("fix: every pi event maps to the recorded runner events and the attempt ends completed", async () => {
    const { c, out, exited } = setup(piEvents("fix"));
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "Read /context/story.md and do the story." }));
    expect(await exited).toBe(0);
    expect(norm(out.slice(1))).toEqual(norm(recorded("fix").slice(1)));
    expect(out.at(-1)).toEqual({ type: "final", outcome: "completed" });
    expect(out.filter((e) => e.type === "tool_start")).toHaveLength(7);
  });

  it("ask: ask_question produces a question event, the turn ends, and answer resumes the same session", async () => {
    let session!: FakeSession;
    const { c, out, exited, session: s } = setup(piEvents("ask"), (e, ctl) => {
      if (e.type === "final" && e.outcome === "question") ctl.handleLine(JSON.stringify({ cmd: "answer", questionId: ctl.pendingQuestion, text: "Casual." }));
    });
    session = s;
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "go" }));
    expect(await exited).toBe(0);
    const questions = out.filter((e) => e.type === "question");
    expect(questions).toHaveLength(2);
    expect(questions[0]).toMatchObject({ kind: "feature", options: ["formal", "casual"] });
    expect(out.filter((e) => e.type === "final").map((e) => (e as { outcome: string }).outcome)).toEqual(["question", "question", "completed"]);
    expect(session.prompts).toEqual(["go", "Answer to your question: Casual.", "Answer to your question: Casual."]);
    // Same mapping as the real run (the recorded answers differ only in text, which is not part of the events).
    expect(norm(out.slice(1))).toEqual(norm(recorded("ask").slice(1)));
  });

  it("abort: an abort during the turn ends the attempt as aborted", async () => {
    const { c, out, exited, session } = setup(piEvents("abort"), (e, ctl) => {
      if (e.type === "tool_start") ctl.handleLine(JSON.stringify({ cmd: "abort" }));
    });
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "go" }));
    expect(await exited).toBe(1);
    expect(session.aborted).toBe(1);
    expect(session.disposed).toBe(1);
    expect(norm(out.slice(1))).toEqual(norm(recorded("abort").slice(1)));
    expect(out.at(-1)).toEqual({ type: "final", outcome: "aborted" });
  });
});

describe("runner commands", () => {
  const rejected = (out: RunnerEvent[]) => out.filter((e) => e.type === "command_rejected").map((e) => (e as { reason: string }).reason);

  it("rejects invalid commands and ignores blank lines and a BOM", () => {
    const { c, out } = setup([]);
    for (const line of ["", "   ", "\uFEFF", "not json", '{"cmd":"launch"}', '{"cmd":"prompt"}', '{"cmd":"prompt","text":"x","extra":1}', '{"cmd":"abort","now":true}']) c.handleLine(line);
    const r = rejected(out);
    expect(r).toHaveLength(5);
    expect(r[0]).toBe("the command is not JSON");
    expect(r.slice(1).every((x) => x.startsWith("invalid command"))).toBe(true);
  });

  it("answer without an open question, steer while idle, and a second prompt while running are rejected", async () => {
    const { c, out, exited } = setup(piEvents("fix"), (e, ctl) => {
      if (e.type === "message_start" && e.messageId === "code-m1") ctl.handleLine(JSON.stringify({ cmd: "prompt", text: "again" }));
    });
    c.handleLine(JSON.stringify({ cmd: "answer", questionId: "q", text: "x" }));
    c.handleLine(JSON.stringify({ cmd: "steer", text: "x" }));
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "go" }));
    await exited;
    expect(rejected(out)).toEqual(["no question is open", "no turn is running", "a turn is running; use steer"]);
  });

  it("steer while running reaches the session", async () => {
    const { c, session, exited } = setup(piEvents("fix"), (e, ctl) => {
      if (e.type === "tool_start" && e.tool === "read") ctl.handleLine(JSON.stringify({ cmd: "steer", text: "add docstrings" }));
    });
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "go" }));
    await exited;
    expect(session.steered).toEqual(["add docstrings"]);
  });

  it("an answer to a different question id and a prompt while a question is open are rejected", async () => {
    let checked = false;
    const { c, out } = setup(piEvents("ask"), (e, ctl) => {
      if (e.type === "final" && e.outcome === "question" && !checked) {
        checked = true;
        ctl.handleLine(JSON.stringify({ cmd: "answer", questionId: "other", text: "x" }));
        ctl.handleLine(JSON.stringify({ cmd: "prompt", text: "x" }));
      }
    });
    c.handleLine(JSON.stringify({ cmd: "prompt", text: "go" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(rejected(out)).toEqual(["the answer does not match the open question", "a question is open; use answer"]);
    expect(c.pendingQuestion).toBe("call_cc5a3fd644c94a3cb30ab46d");
  });

  it("ask_question with invalid arguments returns an error result to the model and opens no question", () => {
    const { c, out } = setup([]);
    const r = c.askQuestion("call_1", { kind: "urgent", text: "" });
    expect(r.terminate).toBeUndefined();
    expect(r.content[0]!.text).toMatch(/^Invalid ask_question arguments/);
    expect(out.some((e) => e.type === "question")).toBe(false);
    expect(c.pendingQuestion).toBeNull();
  });

  it("abort while idle and a closed command stream end the process as aborted", async () => {
    const a = setup([]);
    a.c.handleLine(JSON.stringify({ cmd: "abort" }));
    expect(await a.exited).toBe(1);
    const b = setup([]);
    await b.c.close();
    expect(await b.exited).toBe(1);
    expect(b.out.at(-1)).toEqual({ type: "final", outcome: "aborted", detail: "the command stream closed" });
  });
});
