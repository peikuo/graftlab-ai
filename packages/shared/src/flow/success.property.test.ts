// Property 3 (design.md, "Correctness Properties"): success comes only from the Verifier. A random walk over the
// development part of the Flow_Graph with random node outcomes; the walk marks a story verified only where the
// Verifier passes it (an outcome "passed" in `verifying`), the way the dev stage does. Review verdicts, checkpoint
// answers and Judge choices are random too and never mark a story verified.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NODE_OUTCOMES, currentStory, nextPendingStory, initialTaskState, type NodeOutcome, type StoryProgress, type TaskState } from "../task.ts";
import { edgesFrom } from "./graph.ts";
import { isTerminal } from "./ids.ts";
import { transition } from "./transition.ts";

const startState = (stories: StoryProgress[]): TaskState => ({
  ...initialTaskState({ taskId: "t", url: "https://github.com/o/r", owner: "o", repo: "r", repoKind: "adapted", runtimeRulesVersion: "1", startedAt: "2026-11-25T00:00:00.000Z", deadlineAt: "2026-11-25T02:00:00.000Z" }),
  node: "target_check",
  frozenVersion: 1,
  backlogValid: true,
  planConfirmed: true,
  docsComplete: true,
  targetCheckPassed: true,
  stories,
});

/** One step: the node's outcome, then the first edge whose guard and entry invariant hold. */
function step(t: TaskState, outcome: NodeOutcome, verifierPasses: boolean): TaskState {
  let task: TaskState = { ...t, outcome };
  // What the node handlers do before the edge is taken (by code): pick the next Feature, count attempts, and only
  // the Verifier marks a story verified.
  if (task.node === "story_develop" || task.node === "story_test") {
    const cur = currentStory(task);
    if (!cur || cur.status !== "in_progress") {
      const next = nextPendingStory(task) ?? task.stories.find((s) => s.status === "pending");
      if (next) task = { ...task, currentStoryId: next.storyId, stories: task.stories.map((s) => (s.storyId === next.storyId ? { ...s, status: "in_progress" } : s)) };
    }
  }
  if (task.node === "verifying") {
    const id = task.currentStoryId;
    const ok = outcome === "passed" && verifierPasses;
    task = { ...task, outcome: ok ? "passed" : "failed", stories: task.stories.map((s) => (s.storyId === id ? { ...s, status: ok ? "verified" : "failed" } : s)) };
  }
  if (task.node === "regression_check") task = { ...task, outcome: outcome === "passed" && verifierPasses ? "passed" : "failed" };
  for (const e of edgesFrom(task.node)) {
    const r = transition(task, e.id);
    if (r.ok) return r.task;
  }
  return { ...task, node: "failed", terminal: "failed" };
}

const storiesArb = fc.integer({ min: 1, max: 3 }).map((n) =>
  Array.from({ length: n }, (_, i): StoryProgress => ({ storyId: `F${i + 1}`, parent: "S1", kind: "source_change", purpose: "B", attempts: 0, status: "pending", unconfirmed: false, demoCaseRejections: 0, suggestionConfirmed: false })),
);
const walkArb = fc.record({
  stories: storiesArb,
  outcomes: fc.array(fc.constantFrom<NodeOutcome>(...NODE_OUTCOMES, "done", "approve", "passed", "confirmed", "needs_tests"), { minLength: 10, maxLength: 120 }),
  verifier: fc.array(fc.boolean(), { minLength: 120, maxLength: 120 }),
});

describe("success only from the Verifier", () => {
  // Feature: graftlab-ai, Property 3: Success comes only from the Verifier
  it("a walk reaches success only when every story was passed by the Verifier and the regression check passed", () => {
    fc.assert(
      fc.property(walkArb, ({ stories, outcomes, verifier }) => {
        let t = startState(stories);
        let lastRegressionPassed = false;
        for (let i = 0; i < outcomes.length && !isTerminal(t.node); i++) {
          if (t.node === "regression_check") lastRegressionPassed = outcomes[i] === "passed" && verifier[i]!;
          t = step(t, outcomes[i]!, verifier[i]!);
        }
        if (t.node === "success") {
          expect(t.stories.every((s) => s.status === "verified")).toBe(true);
          expect(lastRegressionPassed).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });
  it("the walk reaches success in some runs, so the property above is not empty", () => {
    // Outcomes that move a Feature forward, with the Verifier passing: success must be reachable.
    const good: NodeOutcome[] = ["done", "needs_tests", "done", "done", "approve", "done", "confirmed", "passed"];
    let reached = 0;
    for (const s of fc.sample(storiesArb, 50)) {
      let t = startState(s);
      for (let i = 0; i < 200 && !isTerminal(t.node); i++) {
        const o: NodeOutcome = t.node === "story_develop" ? (t.stories.find((x) => x.storyId === t.currentStoryId)?.attempts === 0 && i % 2 === 0 ? "needs_tests" : "done") : t.node === "story_review" ? "approve" : t.node === "story_checkpoint" ? "confirmed" : t.node === "verifying" || t.node === "regression_check" ? "passed" : good[i % good.length]!;
        t = step(t, o, true);
      }
      if (t.node === "success") reached++;
    }
    expect(reached).toBeGreaterThan(0);
  });
  it("an approving review, a confirmed checkpoint or a Judge answer never leads to success directly", () => {
    const into = ["approve", "confirmed", "answered", "unconfirmed", "retry", "skip_story"] as const;
    fc.assert(
      fc.property(storiesArb, fc.constantFrom(...into), fc.constantFrom("story_review", "story_checkpoint", "story_ask", "failure_review") as fc.Arbitrary<TaskState["node"]>, (stories, outcome, node) => {
        const t: TaskState = { ...startState(stories.map((s) => ({ ...s, status: "verified" }))), node, outcome, currentStoryId: stories[0]!.storyId };
        for (const e of edgesFrom(node)) {
          const r = transition(t, e.id);
          if (r.ok) expect(r.task.node).not.toBe("success");
        }
      }),
      { numRuns: 200 },
    );
  });
});
