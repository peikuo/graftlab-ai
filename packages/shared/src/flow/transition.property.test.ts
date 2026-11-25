import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NODE_OUTCOMES, currentStory, initialTaskState, type TaskState } from "../task.ts";
import { placeAt, taskStateArb } from "../testing/taskArb.ts";
import { entryInvariant } from "./guards.ts";
import { ALL_EDGES, findEdge, type FlowEdge } from "./graph.ts";
import { GATHERING_NODES, type NodeId } from "./ids.ts";
import { transition } from "./transition.ts";

const POST_FREEZE: NodeId[] = [
  "frozen", "planning", "plan_review", "documenting", "tech_design", "adapter_branch_2", "target_check", "docs_only",
  "story_test", "story_develop", "story_review", "story_ask", "story_run", "story_checkpoint", "verifying", "regression_check",
];
const EXECUTION = POST_FREEZE.filter((n) => n.startsWith("story_") || n.startsWith("api_") || n === "verifying" || n === "regression_check");
const SAME_STORY_BACK_EDGES = ["request_changes", "answered", "checkpoint_feedback"];
// Results, not unexpected failures, plus the Task timeout (design.md, "Failure review").
const RESULT_EDGES_TO_FAILED = [
  "task_timeout",
  "verify_failed",
  "verified_last_partial",
  "regression_failed",
  "unanswered_last",
  "answered_at_limit_last",
];

const atSource = (node: NodeId) => taskStateArb.map((t): TaskState => placeAt(t, node));

/** A state at the edge's source whose outcome satisfies the edge guard when some outcome can (80%). */
const guardSatisfyingAt = (edge: FlowEdge): fc.Arbitrary<TaskState> =>
  fc.tuple(atSource(edge.from), fc.nat(), fc.integer({ min: 0, max: 9 })).map(([t0, pick, coin]) => {
    // A retry edge leaves failure_review only after a failure at its target; set it, or such edges are rarely sampled.
    const t = edge.from === "failure_review" && edge.id.startsWith("retry_") && coin >= 2 ? { ...t0, failure: { node: edge.to, failureClass: "interface_call_failure" as const, detail: "test failure" } } : t0;
    if (coin < 2) return t;
    const fits = NODE_OUTCOMES.filter((o) => edge.guard({ ...t, outcome: o }));
    return fits.length > 0 ? { ...t, outcome: fits[pick % fits.length]! } : t;
  });

// Mostly an edge with the state at its source node (so accepted transitions are common),
// sometimes any state with any known edge id or a random id.
const caseArb: fc.Arbitrary<[TaskState, string]> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...ALL_EDGES).chain((edge) => guardSatisfyingAt(edge).map((t): [TaskState, string] => [t, edge.id])) },
  { weight: 3, arbitrary: fc.tuple(taskStateArb, fc.constantFrom(...new Set(ALL_EDGES.map((x) => x.id)))) },
  { weight: 1, arbitrary: fc.tuple(taskStateArb, fc.string({ maxLength: 12 })) },
);

describe("transition", () => {
  // Feature: graftlab-ai, Property 2: Transitions happen only along edges whose guard holds
  it("every edge is accepted for some generated state at its source node", () => {
    const never = ALL_EDGES.filter((edge) => {
      const samples = fc.sample(guardSatisfyingAt(edge), 1000);
      return !samples.some((t) => transition(t, edge.id).ok);
    }).map((x) => `${x.from}:${x.id}`);
    expect(never).toEqual([]);
  }, 30_000); // about 180 edges times 1000 samples

  it("changes the node iff the edge leaves the node and its guard and entry invariant hold", () => {
    fc.assert(
      fc.property(caseArb, ([task, edgeId]: [TaskState, string]) => {
        const r = transition(task, edgeId);
        const edge = findEdge(task.node, edgeId);
        const expected = !!edge && edge.guard(task) && entryInvariant(edge.to, task) === null;
        expect(r.ok).toBe(expected);

        if (!r.ok) {
          expect(r.task).toBe(task);
          expect(r.event.type).toBe("transition_rejected");
          expect(r.event.payload).toMatchObject({ from: task.node, requestedEdgeId: edgeId });
          return;
        }
        const to = r.task.node;
        expect(r.event).toEqual({ type: "node_entered", payload: { from: task.node, to, edgeId } });
        expect(r.task.outcome).toBeUndefined();

        // Consequences (design.md, Property 2)
        if (POST_FREEZE.includes(to)) expect(task.frozenVersion).not.toBeNull();
        if (EXECUTION.includes(to)) {
          expect(task.docsComplete).toBe(true);
          expect(task.repoKind).toBe("adapted");
          expect(task.targetCheckPassed).toBe(true);
        }
        const judgeRetry = task.node === "failure_review" && edgeId === `retry_${to}`;
        if (to === "meeting") {
          const fromOk =
            (task.node === "adapter_branch" && task.repoKind === "other") ||
            (GATHERING_NODES as readonly NodeId[]).includes(task.node) ||
            // R19.12: the Judge sends the plan back with a reason.
            (task.node === "plan_review" && task.outcome === "send_back" && !!task.planSentBackReason?.trim()) ||
            judgeRetry;
          expect(fromOk).toBe(true);
        }
        if ((GATHERING_NODES as readonly NodeId[]).includes(task.node) && !edge!.global) {
          expect(to).not.toMatch(/^(success|failed|aborted|analysis_only|docs_only)$/);
        }
        if (SAME_STORY_BACK_EDGES.includes(edgeId)) {
          expect(currentStory(task)!.attempts).toBeLessThan(task.limits.storyAttempts);
        }
        // Failure review (R36.6): unexpected failures stop for the Judge; only results and the Task timeout end directly.
        if (to === "failure_review") {
          expect(task.failure?.node).toBe(task.node);
          expect(["failed", "node_timeout", "unrecoverable_error", "rejected"]).toContain(task.outcome);
        }
        if (to === "failed" && task.node !== "failure_review") {
          expect(RESULT_EDGES_TO_FAILED).toContain(edgeId);
        }
        if (task.node === "failure_review" && edgeId.startsWith("retry_")) {
          expect(to).toBe(task.failure!.node);
        }
        if (to === "documenting") expect(task.planConfirmed && task.backlogValid).toBe(true);
        if (edgeId === "freeze") {
          expect(task.review!.accepted).toBe(task.review!.total);
          expect(task.review!.approachComplete).toBe(true);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("request changes at the retry limit leads to story_ask, never back to story_develop", () => {
    fc.assert(
      fc.property(taskStateArb, (t0) => {
        const cur = currentStory(t0);
        fc.pre(!!cur);
        const t: TaskState = {
          ...t0,
          node: "story_review",
          outcome: "request_changes",
          frozenVersion: 1,
          docsComplete: true,
          repoKind: "adapted",
          targetCheckPassed: true,
          stories: t0.stories.map((s) => (s.storyId === cur!.storyId ? { ...s, attempts: t0.limits.storyAttempts } : s)),
        };
        expect(transition(t, "request_changes").ok).toBe(false);
        const r = transition(t, "escalate");
        expect(r.ok).toBe(true);
        expect(r.task.node).toBe("story_ask");
      }),
      { numRuns: 100 },
    );
  });
});

describe("transition examples", () => {
  const base = initialTaskState({
    taskId: "t1",
    url: "https://github.com/sissbruecker/linkding",
    owner: "sissbruecker",
    repo: "linkding",
    repoKind: "adapted",
    adapterId: "linkding",
    runtimeRulesVersion: "0.1.0",
    startedAt: "2026-11-22T10:00:00.000Z",
    deadlineAt: "2026-11-22T11:30:00.000Z",
  });

  it("accepts reading_done only after a done outcome with a valid Repo_Brief", () => {
    expect(transition(base, "reading_done")).toMatchObject({ ok: false, event: { type: "transition_rejected" } });
    expect(transition({ ...base, outcome: "done" }, "reading_done")).toMatchObject({ ok: false, event: { type: "transition_rejected" } });
    const r = transition({ ...base, outcome: "done", briefReady: true }, "reading_done");
    expect(r).toMatchObject({ ok: true, task: { node: "adapter_branch" } });
  });

  it("a failed Sandbox start continues to the meeting instead of ending the Task", () => {
    const t: TaskState = { ...base, node: "sandbox_start", outcome: "failed", gathering: { ...base.gathering, experienceUnavailable: "start failed" } };
    expect(transition(t, "sandbox_unavailable").task.node).toBe("meeting");
    expect(transition({ ...t, outcome: "node_timeout" }, "timeout").ok).toBe(false);
  });

  it("a failed download stops for the Judge, who can retry, and the Task timeout still ends it", () => {
    const failure = { node: "reading" as const, failureClass: "interface_call_failure" as const, detail: "GitHub 502" };
    const failed: TaskState = { ...base, outcome: "failed", failure };
    expect(transition({ ...base, outcome: "failed" }, "reading_failed")).toMatchObject({ ok: false });
    const review = transition(failed, "reading_failed");
    expect(review).toMatchObject({ ok: true, task: { node: "failure_review" } });
    expect(transition({ ...review.task, outcome: "retry" }, "retry_reading")).toMatchObject({ ok: true, task: { node: "reading" } });
    expect(transition({ ...review.task, outcome: "retry" }, "retry_meeting")).toMatchObject({ ok: false });
    expect(transition({ ...review.task, outcome: "end_task" }, "end_task")).toMatchObject({ ok: true, task: { node: "failed", terminal: "failed" } });
    expect(transition({ ...review.task, outcome: "task_timeout" }, "task_timeout")).toMatchObject({ ok: true, task: { node: "failed" } });
  });

  it("planning cannot start without a frozen version", () => {
    const t: TaskState = { ...base, node: "frozen" };
    expect(transition(t, "frozen_recorded")).toMatchObject({ ok: false });
    expect(transition({ ...t, frozenVersion: 1 }, "frozen_recorded")).toMatchObject({ ok: true, task: { node: "planning" } });
  });
});
