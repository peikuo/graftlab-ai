import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { NODE_OUTCOMES, type NodeOutcome, type TaskState } from "../task.ts";
import { placeAt, taskStateArb } from "../testing/taskArb.ts";
import { ALL_EDGES, EDGES, NODES, edgesFrom } from "./graph.ts";
import { NODE_IDS, isTerminal, type NodeId } from "./ids.ts";
import { enabledEdges, transition } from "./transition.ts";

function reachableTerminals(start: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>([start]);
  const queue: NodeId[] = [start];
  const terminals = new Set<NodeId>();
  while (queue.length > 0) {
    const n = queue.shift()!;
    if (isTerminal(n)) terminals.add(n);
    for (const edge of edgesFrom(n, { includeGlobal: false })) {
      if (!seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return terminals;
}

describe("Flow_Graph structure", () => {
  // Feature: graftlab-ai, Property 1: A terminal is reachable from every node, and terminals are absorbing
  it("every node reaches a terminal through non-global edges (exhaustive)", () => {
    const stuck = NODE_IDS.filter((n) => reachableTerminals(n).size === 0);
    expect(stuck).toEqual([]);
  });

  it("no edge leaves a terminal, and every node except terminals has the global edges", () => {
    for (const n of NODE_IDS) {
      const out = edgesFrom(n);
      if (isTerminal(n)) {
        expect(out).toEqual([]);
        continue;
      }
      const globals = out.filter((x) => x.global).map((x) => x.id).sort();
      const ownTimeout = n !== "failure_review" && n !== "sandbox_start" && n !== "browser_experience";
      expect(globals).toEqual(ownTimeout ? ["judge_abort", "task_timeout", "timeout", "unrecoverable_error"] : ["judge_abort", "task_timeout", "unrecoverable_error"]);
      // The Task timeout always ends the Task; nothing else global goes to failed except from failure_review.
      for (const x of out.filter((y) => y.global)) {
        if (x.id === "task_timeout") expect(x.to).toBe("failed");
        else if (x.id === "judge_abort") expect(x.to).toBe("aborted");
        else expect(x.to).toBe(n === "failure_review" ? "failed" : "failure_review");
      }
    }
  });

  it("the gathering nodes reach a terminal only through meeting", () => {
    for (const n of ["sandbox_start", "browser_experience"] as const) {
      const own = edgesFrom(n, { includeGlobal: false });
      expect(own.every((x) => x.to === "meeting" || x.to === "browser_experience")).toBe(true);
    }
  });

  it("edge ids are unique, edges reference known nodes, and every node is entered by some edge except reading", () => {
    const ids = EDGES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of ALL_EDGES) {
      expect(NODES[x.from]).toBeDefined();
      expect(NODES[x.to]).toBeDefined();
    }
    const entered = new Set(EDGES.map((x) => x.to));
    const unentered = NODE_IDS.filter((n) => n !== "reading" && n !== "aborted" && !entered.has(n));
    expect(unentered).toEqual([]);
  });

  it("random walks that stop end in exactly one terminal, which is absorbing", () => {
    const step = fc.record({
      outcome: fc.constantFrom<NodeOutcome>(...NODE_OUTCOMES),
      facts: taskStateArb,
    });
    fc.assert(
      fc.property(taskStateArb, fc.array(step, { minLength: 1, maxLength: 120 }), (start, steps) => {
        let t: TaskState = { ...start, node: "reading" };
        delete t.terminal;
        for (const s of steps) {
          if (isTerminal(t.node)) break;
          // New facts arrive from the runner; the node and the story list stay.
          t = {
            ...placeAt(s.facts, t.node),
            stories: t.stories.length > 0 ? t.stories : s.facts.stories,
            outcome: s.outcome,
          };
          const enabled = enabledEdges(t);
          if (enabled.length > 0) t = transition(t, enabled[0]!).task;
        }
        // Force an end the way the runner does at the Task deadline.
        if (!isTerminal(t.node)) t = transition({ ...t, outcome: "task_timeout" }, "task_timeout").task;
        expect(isTerminal(t.node)).toBe(true);
        expect(t.terminal).toBe(t.node);
        for (const edge of ALL_EDGES) {
          for (const outcome of NODE_OUTCOMES) expect(transition({ ...t, outcome }, edge.id).ok).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  }, 30_000); // 100 walks, each checked against every edge and outcome
});
