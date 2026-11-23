// PiCodeRuntime protocol handling with the runner's recorded stdout fixtures (tasks.md 14.5; R38.7, R40.11, R40.13).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AttachedExec } from "../containers/docker.ts";
import { runCodeAttempt } from "./pi-code.ts";

const fixture = (name: string) => readFileSync(new URL(`../../../../docker/dev-sandbox/runner/fixtures/${name}.out.jsonl`, import.meta.url), "utf8").trim().split("\n");

/** Replays the recorded stdout: the first segment after `prompt`, each next segment after an `answer`. */
function fakeExec(lines: string[], extra: string[] = []): AttachedExec & { commands: object[] } {
  const segments: string[][] = [[]];
  for (const l of lines) {
    segments.at(-1)!.push(l);
    if (l.includes('"type":"final","outcome":"question"')) segments.push([]);
  }
  const [ready, ...rest] = segments[0]!;
  segments[0] = rest;
  let out: (d: Buffer) => void = () => {};
  let close: () => void = () => {};
  const commands: object[] = [];
  let next = 0;
  const play = () => setTimeout(() => out(Buffer.from(`${segments[next++]!.join("\n")}\n`)), 1);
  return {
    commands,
    stdin: {
      write: (d: string) => {
        const c = JSON.parse(d) as { cmd: string };
        commands.push(c);
        if (c.cmd === "prompt" || c.cmd === "answer") play();
        if (c.cmd === "abort") setTimeout(() => out(Buffer.from('{"type":"final","outcome":"aborted"}\n')), 1);
      },
      end: () => setTimeout(() => close(), 2),
    },
    onStdout: (f) => {
      out = f;
      setTimeout(() => f(Buffer.from(`${[ready, ...extra].join("\n")}\n`)), 1);
    },
    onStderr: () => {},
    exited: new Promise<number>((r) => (close = () => r(0))),
    kill: () => close(),
  };
}

describe("runCodeAttempt", () => {
  it("maps the recorded events, answers questions in the same process and ends completed", async () => {
    const x = fakeExec(fixture("ask"), ["this is not a protocol line"]);
    const events: { type: string; payload: Record<string, unknown> }[] = [];
    const asked: string[] = [];
    const r = await runCodeAttempt({
      start: async () => x,
      prompt: "Read /context/story.md and do the story.",
      emit: async (e) => void events.push(e as never),
      onQuestion: async (q) => (asked.push(q.kind), "Use Hello."),
      budgetMs: 60_000,
      signal: new AbortController().signal,
      idPrefix: "t-F1-a1",
    });
    expect(r.outcome).toBe("completed");
    expect(asked).toEqual(["feature", "technical"]);
    expect(x.commands.map((c) => (c as { cmd: string }).cmd)).toEqual(["prompt", "answer", "answer"]);
    expect(r.unknownLines).toBe(1);
    expect(events.filter((e) => e.type === "message_started").every((e) => String(e.payload.messageId).startsWith("t-F1-a1-"))).toBe(true);
    expect(events.filter((e) => e.type === "tool_started").length).toBe(r.toolCalls);
    expect(events.some((e) => e.type === "finding_recorded" && /1 output lines were not protocol events/.test(String(e.payload.text)))).toBe(true);
  });

  it("the budget aborts the runner and the attempt ends as budget exceeded", async () => {
    let fire: () => void = () => {};
    const x = fakeExec(fixture("fix"));
    let started = 0;
    const r = runCodeAttempt({
      start: async () => x,
      prompt: "go",
      emit: async (e) => {
        if (e.type === "tool_started" && ++started === 1) fire();
      },
      onQuestion: async () => "",
      budgetMs: 1,
      signal: new AbortController().signal,
      idPrefix: "t",
      setTimer: (fn, ms) => {
        if (ms === 1) fire = fn;
        else setTimeout(fn, 5);
        return () => {};
      },
    });
    const done = await r;
    expect(done.outcome).toBe("budget_exceeded");
    expect(x.commands.some((c) => (c as { cmd: string }).cmd === "abort")).toBe(true);
  });

  it("a read-only write outside /work is recorded as rejected by a safety rule", async () => {
    const lines = [
      '{"type":"ready","model":"m","tools":["read","bash","edit","write","ask_question"]}',
      '{"type":"tool_start","callId":"c1","tool":"bash","inputSummary":"echo x > /etc/x"}',
      '{"type":"tool_end","callId":"c1","tool":"bash","ok":false,"outputSummary":"sh: 1: cannot create /etc/x: Read-only file system"}',
      '{"type":"final","outcome":"completed"}',
    ];
    const failures: string[] = [];
    const r = await runCodeAttempt({ start: async () => fakeExec(lines), prompt: "go", emit: async (e) => void (e.type === "failure" && failures.push((e.payload as { failureClass: string }).failureClass)), onQuestion: async () => "", budgetMs: 60_000, signal: new AbortController().signal, idPrefix: "t" });
    expect(r.confinementHits).toHaveLength(1);
    expect(failures).toEqual(["rejected_by_safety_rule"]);
  });
});
