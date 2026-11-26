// R42: the Flow_Graph edges of open execution.
import { describe, expect, it } from "vitest";
import { initialTaskState, type TaskState } from "../task.ts";
import { transition } from "./transition.ts";

const base = (over: Partial<TaskState>): TaskState => ({ ...initialTaskState({ taskId: "t", url: "u", owner: "o", repo: "r", repoKind: "other", runtimeRulesVersion: "x", startedAt: "", deadlineAt: "" }), frozenVersion: 1, ...over });

describe("open execution edges (R42)", () => {
  it("goes from frozen to env_check only when offered", () => {
    expect(transition(base({ node: "frozen", open: { allowed: true, ready: false, declined: false } }), "frozen_open").ok).toBe(true);
    expect(transition(base({ node: "frozen", open: { allowed: true, ready: false, declined: false } }), "frozen_recorded").ok).toBe(false);
    expect(transition(base({ node: "frozen", open: { allowed: false, ready: false, declined: false } }), "frozen_open").ok).toBe(false);
    expect(transition(base({ node: "frozen", open: { allowed: true, ready: false, declined: true } }), "frozen_recorded").ok).toBe(true);
    expect(transition(base({ node: "frozen" }), "frozen_recorded").ok).toBe(true);
  });
  it("continues to planning after env_check, and to development only with a built environment", () => {
    expect(transition(base({ node: "env_check", outcome: "done", open: { allowed: true, ready: true, declined: false } }), "env_checked").ok).toBe(true);
    const docs = { backlogValid: true, planConfirmed: true, docsComplete: true };
    expect(transition(base({ node: "adapter_branch_2", ...docs, open: { allowed: true, ready: true, declined: false } }), "open_execute").ok).toBe(true);
    expect(transition(base({ node: "adapter_branch_2", ...docs, open: { allowed: true, ready: false, declined: true } }), "open_execute").ok).toBe(false);
    expect(transition(base({ node: "adapter_branch_2", ...docs, open: { allowed: true, ready: false, declined: true } }), "other_docs_only").ok).toBe(true);
  });
});
