// transition(): the only way to change task.node (R36.3). It returns the new state and exactly one
// event draft, node_entered or transition_rejected (R36.4, R36.9); the event store assigns seq and ts.
import type { PayloadOf } from "../events.ts";
import type { TaskState } from "../task.ts";
import { entryInvariant } from "./guards.ts";
import { edgesFrom, findEdge } from "./graph.ts";
import { isTerminal } from "./ids.ts";

export type TransitionEventDraft =
  | { type: "node_entered"; payload: PayloadOf<"node_entered"> }
  | { type: "transition_rejected"; payload: PayloadOf<"transition_rejected"> };

export interface TransitionResult {
  ok: boolean;
  task: TaskState;
  event: TransitionEventDraft;
}

export function transition(task: TaskState, edgeId: string): TransitionResult {
  const reject = (reason: string): TransitionResult => ({
    ok: false,
    task,
    event: { type: "transition_rejected", payload: { from: task.node, requestedEdgeId: edgeId, reason } },
  });

  if (isTerminal(task.node)) return reject(`${task.node} is a terminal state`);
  const edge = findEdge(task.node, edgeId);
  if (!edge) return reject(`no edge "${edgeId}" leaves ${task.node}`);
  if (!edge.guard(task)) return reject(`guard of "${edgeId}" does not hold (outcome: ${task.outcome ?? "none"})`);
  const invariant = entryInvariant(edge.to, task);
  if (invariant) return reject(invariant);

  const next: TaskState = { ...task, node: edge.to, outcome: undefined };
  if (isTerminal(edge.to)) next.terminal = edge.to;
  return {
    ok: true,
    task: next,
    event: { type: "node_entered", payload: { from: task.node, to: edge.to, edgeId } },
  };
}

/** Edge ids from the current node whose guard and entry invariant hold, in graph order. */
export function enabledEdges(task: TaskState): string[] {
  if (isTerminal(task.node)) return [];
  return edgesFrom(task.node)
    .map((x) => x.id)
    .filter((id) => transition(task, id).ok);
}
