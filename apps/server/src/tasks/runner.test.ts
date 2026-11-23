import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry, initialTaskState, type NodeOutcome, type TaskState } from "@graftlab/shared";
import { EventStore } from "../events/store.ts";
import { TaskRunner, closeInterruptedTask, type Clock, type NodeHandler } from "./runner.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

/** A fake clock: timers fire only when the test advances time. */
function fakeClock(): Clock & { advance(ms: number): void } {
  let t = 0;
  const timers: { at: number; fn: () => void; live: boolean }[] = [];
  return {
    now: () => t,
    setTimer(fn, ms) {
      const timer = { at: t + ms, fn, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance(ms) {
      t += ms;
      for (const x of timers) if (x.live && x.at <= t) {
        x.live = false;
        x.fn();
      }
    },
  };
}

async function setup(repoKind: "adapted" | "other" = "other") {
  const dataDir = await mkdtemp(join(tmpdir(), "gl-runner-"));
  dirs.push(dataDir);
  const store = await EventStore.open({ dataDir, taskId: "t1", secrets: new SecretRegistry() });
  const task: TaskState = initialTaskState({
    taskId: "t1",
    url: "https://github.com/o/r",
    owner: "o",
    repo: "r",
    repoKind,
    runtimeRulesVersion: "0.1.0",
    startedAt: "2026-11-23T10:00:00.000Z",
    deadlineAt: "2026-11-23T11:30:00.000Z",
  });
  return { store, task };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await tick();
  expect(cond()).toBe(true);
}
const nodes = (store: EventStore) => store.events().filter((e) => e.type === "node_entered").map((e) => (e.payload as { to: string }).to);

describe("TaskRunner", () => {
  it("moves only through transition(): reading, adapter_branch, then a missing step stops in failure_review", async () => {
    const { store, task } = await setup("other");
    const handlers: Partial<Record<string, NodeHandler>> = {
      reading: async (ctx) => (ctx.patch({ briefReady: true }), "done"),
      adapter_branch: async () => "done",
    };
    const runner = new TaskRunner({ store, task, handlers, clock: fakeClock() });
    void runner.start();
    await until(() => runner.openCards().length === 1);
    expect(nodes(store)).toEqual(["adapter_branch", "meeting", "failure_review"]);
    const failure = store.events().find((e) => e.type === "failure");
    expect(failure?.payload).toMatchObject({ detail: 'the step "meeting" is not built yet in this version' });
    runner.answer(runner.openCards()[0]!, { optionId: "end_task" });
    expect(await runner.done).toBe("failed");
    expect(store.events().at(-1)).toMatchObject({ type: "terminal_reached", payload: { terminal: "failed" } });
  });

  it("a failed download stops for the Judge; retry runs the step again", async () => {
    const { store, task } = await setup("other");
    let attempts = 0;
    const handlers: Partial<Record<string, NodeHandler>> = {
      reading: async (ctx) => {
        attempts++;
        if (attempts === 1) {
          await ctx.fail("interface_call_failure", "github", "GitHub returned 502");
          return "failed";
        }
        ctx.patch({ briefReady: true });
        return "done";
      },
      adapter_branch: async () => "done",
      meeting: async () => "judge_abort" as NodeOutcome,
    };
    const runner = new TaskRunner({ store, task, handlers, clock: fakeClock() });
    void runner.start();
    await until(() => runner.openCards().length === 1);
    expect(nodes(store)).toEqual(["failure_review"]);
    runner.answer(runner.openCards()[0]!, { optionId: "retry" });
    expect(await runner.done).toBe("aborted");
    expect(attempts).toBe(2);
    expect(nodes(store)).toEqual(["failure_review", "reading", "adapter_branch", "meeting", "aborted"]);
  });

  it("a node timeout ends a hanging step and stops for the Judge; the Task timeout ends the Task", async () => {
    const { store, task } = await setup("other");
    const clock = fakeClock();
    const handlers: Partial<Record<string, NodeHandler>> = { reading: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))) };
    const runner = new TaskRunner({ store, task, handlers, clock, taskTimeoutMs: 60 * 60_000 });
    void runner.start();
    await tick();
    clock.advance(15 * 60_000 + 1); // reading node timeout is 15 min
    await until(() => runner.openCards().length === 1);
    expect(store.events().find((e) => e.type === "failure")?.payload).toMatchObject({ detail: 'step "reading" timed out after 900 s' });
    clock.advance(60 * 60_000); // Task timeout while waiting for the Judge
    expect(await runner.done).toBe("failed");
    expect(nodes(store).at(-1)).toBe("failed");
  });

  it("a gathering timeout continues to the meeting labeled experience unavailable", async () => {
    const { store, task } = await setup("adapted");
    const clock = fakeClock();
    const handlers: Partial<Record<string, NodeHandler>> = {
      reading: async (ctx) => (ctx.patch({ briefReady: true }), "done"),
      adapter_branch: async () => "done",
      sandbox_start: (ctx) => new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(new Error("aborted")))),
      meeting: async () => "judge_abort" as NodeOutcome,
    };
    const runner = new TaskRunner({ store, task, handlers, clock });
    void runner.start();
    await until(() => nodes(store).includes("sandbox_start"));
    clock.advance(3 * 60_000 + 1);
    expect(await runner.done).toBe("aborted");
    expect(nodes(store)).toEqual(["adapter_branch", "sandbox_start", "meeting", "aborted"]);
    expect(runner.task.gathering.experienceUnavailable).toMatch(/timed out/);
  });

  it("Judge abort works in any step, including while waiting for an answer", async () => {
    const { store, task } = await setup("other");
    const handlers: Partial<Record<string, NodeHandler>> = { reading: async (ctx) => { await ctx.askJudge({ kind: "question", title: "?", body: "", options: [{ id: "a", label: "A" }], allowFreeText: false }); return "done"; } };
    const runner = new TaskRunner({ store, task, handlers, clock: fakeClock() });
    void runner.start();
    await until(() => runner.openCards().length === 1);
    runner.abort();
    expect(await runner.done).toBe("aborted");
  });

  it("closes a Task that has no terminal after a backend restart", async () => {
    const { store } = await setup();
    await store.append({ type: "node_entered", node: "reading", actor: { kind: "system" }, payload: { from: null, to: "reading", edgeId: "task_start" } });
    expect(await closeInterruptedTask(store)).toBe(true);
    expect(store.events().at(-1)).toMatchObject({ type: "terminal_reached", payload: { terminal: "failed", summary: { label: "backend restarted" } } });
    expect(await closeInterruptedTask(store)).toBe(false);
  });
});

describe("document-first (tasks.md 13.7; R19.4, R19.6, R19.11, R19.12, R25.2)", () => {
  // Handlers from frozen on: planning marks the backlog valid, documenting marks the docs complete.
  const planned = (sendBackFirst: boolean, docs = true): Partial<Record<string, NodeHandler>> => {
    let reviews = 0;
    return {
      frozen: async (ctx) => (ctx.patch({ backlogValid: false, planConfirmed: false }), "done"),
      planning: async (ctx) => (ctx.patch({ backlogValid: true }), "done"),
      plan_review: async (ctx) => {
        reviews++;
        const a = await ctx.askJudge({ kind: "confirm", title: "plan?", body: "", options: [{ id: "confirm", label: "ok" }, { id: "send_back", label: "back" }], allowFreeText: true });
        if (a.optionId === "send_back") return (ctx.patch({ planSentBackReason: a.text ?? "", backlogValid: false }), "send_back");
        return (ctx.patch({ planConfirmed: true }), "confirmed");
      },
      documenting: async () => "done",
      tech_design: async (ctx) => (docs ? (ctx.patch({ docsComplete: true }), "done") : "done"),
      adapter_branch_2: async () => "done",
      // The meeting after a send back waits (the test only checks that the flow got there).
      meeting: (ctx) => new Promise((res) => ctx.signal.addEventListener("abort", () => res(reviews > 0 ? "failed" : "failed"), { once: true })),
      deciding: async () => "done",
      awaiting_confirmation: async () => "confirmed",
    };
  };

  it("an Other_Repo ends in docs_only after the Judge confirms the plan", async () => {
    const { store, task } = await setup("other");
    const runner = new TaskRunner({ store, task: { ...task, node: "frozen", frozenVersion: 1 }, handlers: planned(false) as Record<string, NodeHandler> });
    const done = runner.start();
    await until(() => runner.openCards().length === 1);
    runner.answer(runner.openCards()[0]!, { optionId: "confirm" });
    expect(await done).toBe("docs_only");
    expect(nodes(store)).toEqual(["planning", "plan_review", "documenting", "tech_design", "adapter_branch_2", "docs_only"]);
  });

  it("a send back goes to the meeting; documents are never written before the confirmation", async () => {
    const { store, task } = await setup("other");
    const runner = new TaskRunner({ store, task: { ...task, node: "frozen", frozenVersion: 1 }, handlers: planned(true) as Record<string, NodeHandler> });
    const done = runner.start();
    await until(() => runner.openCards().length === 1);
    runner.answer(runner.openCards()[0]!, { optionId: "send_back", text: "the stories are too big" });
    await until(() => nodes(store).includes("meeting"));
    runner.abort();
    await done;
    expect(nodes(store).slice(0, 3)).toEqual(["planning", "plan_review", "meeting"]);
    expect(nodes(store)).not.toContain("documenting");
  });

  it("development cannot start while the documents are incomplete", async () => {
    const { store, task } = await setup("adapted");
    const runner = new TaskRunner({ store, task: { ...task, node: "frozen", frozenVersion: 1 }, handlers: planned(false, false) as Record<string, NodeHandler> });
    const done = runner.start();
    await until(() => runner.openCards().length === 1);
    runner.answer(runner.openCards()[0]!, { optionId: "confirm" });
    await until(() => store.events().some((e) => e.type === "transition_rejected"));
    const rejected = store.events().find((e) => e.type === "transition_rejected");
    expect(rejected?.payload).toMatchObject({ from: "tech_design" });
    runner.abort();
    await done;
    expect(nodes(store)).not.toContain("adapter_branch_2");
  });
});
