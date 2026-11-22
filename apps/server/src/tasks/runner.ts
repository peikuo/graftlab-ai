// Task runner (design.md, "apps/server modules"; R36.2, R36.5, R36.6, R36.8). It holds the TaskState, runs the
// handler of the current node, and changes the node only through transition() with the validated outcome.
// Node timeouts, the Task timeout and a Judge abort become outcomes too, so every path goes through the same
// guards. Unexpected failures stop in failure_review for the Judge (R36.6).
import {
  NODES,
  enabledEdges,
  isTerminal,
  nextPendingStory,
  currentStory,
  transition,
  type Actor,
  type FailureClass,
  type NodeId,
  type NodeOutcome,
  type PayloadOf,
  type TaskState,
  type TerminalId,
} from "@graftlab/shared";
import type { EventDraft, EventStore } from "../events/store.ts";

export interface Clock {
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
};

export type JudgeAnswer = { optionId?: string; text?: string };

export interface NodeContext {
  readonly task: TaskState;
  readonly signal: AbortSignal;
  /** Appends an event at the current node. */
  emit(draft: Omit<EventDraft, "node">): Promise<void>;
  /** Updates TaskState facts that guards read (never the node itself). */
  patch(p: Partial<Omit<TaskState, "node" | "terminal" | "outcome">>): void;
  /** Records a failure and remembers it for failure_review (R23.1, R36.6). */
  fail(failureClass: FailureClass, source: PayloadOf<"failure">["source"], detail: string, actor?: Actor): Promise<void>;
  /** Opens a card and waits for the Judge's answer. */
  askJudge(card: Omit<PayloadOf<"card_opened">, "cardId">, actor?: Actor): Promise<JudgeAnswer>;
}

/** A node handler does the node's work and returns its validated outcome. */
export type NodeHandler = (ctx: NodeContext) => Promise<NodeOutcome>;

export interface RunnerOptions {
  store: EventStore;
  task: TaskState;
  handlers: Partial<Record<NodeId, NodeHandler>>;
  clock?: Clock;
  /** Task timeout from now, in ms (GL_TASK_TIMEOUT_MIN, default 90 min). */
  taskTimeoutMs?: number;
  /** Per-node timeout overrides in seconds (GL_NODE_TIMEOUT_<NODE>_S). */
  nodeTimeoutS?: Partial<Record<NodeId, number>>;
  onTerminal?: (terminal: TerminalId) => void;
}

const SYSTEM: Actor = { kind: "system" };

export class TaskRunner {
  #store: EventStore;
  #task: TaskState;
  #handlers: Partial<Record<NodeId, NodeHandler>>;
  #clock: Clock;
  #taskTimeoutMs: number;
  #nodeTimeoutS: Partial<Record<NodeId, number>>;
  #onTerminal: ((t: TerminalId) => void) | undefined;
  #cards = new Map<string, (a: JudgeAnswer) => void>();
  #cardSeq = 0;
  #forced: NodeOutcome | null = null;
  #nodeAbort: AbortController | null = null;
  #wake: (() => void) | null = null;
  #cancelTaskTimer: (() => void) | null = null;
  #done: Promise<TerminalId>;

  constructor(opts: RunnerOptions) {
    this.#store = opts.store;
    this.#task = opts.task;
    this.#handlers = opts.handlers;
    this.#clock = opts.clock ?? realClock;
    this.#taskTimeoutMs = opts.taskTimeoutMs ?? 90 * 60_000;
    this.#nodeTimeoutS = opts.nodeTimeoutS ?? {};
    this.#onTerminal = opts.onTerminal;
    this.#done = Promise.resolve("failed");
  }

  get task(): TaskState {
    return this.#task;
  }

  /** Starts the loop at the Task's current node (normally `reading`). Resolves with the terminal. */
  start(): Promise<TerminalId> {
    this.#cancelTaskTimer = this.#clock.setTimer(() => this.#force("task_timeout"), this.#taskTimeoutMs);
    this.#done = this.#loop();
    return this.#done;
  }

  get done(): Promise<TerminalId> {
    return this.#done;
  }

  /** Judge abort (R36.6): leads to `aborted` through the global edge. */
  abort(): void {
    this.#force("judge_abort");
  }

  /** Judge "start the meeting now", accepted only in a gathering node (design.md, Flow_Graph rules). */
  endGathering(): boolean {
    if (this.#task.node !== "sandbox_start" && this.#task.node !== "browser_experience") return false;
    this.#task = { ...this.#task, gathering: { ...this.#task.gathering, partial: true } };
    this.#force("judge_end");
    return true;
  }

  /** A Judge answer to an open card. Returns false when the card is not open. */
  answer(cardId: string, a: JudgeAnswer): boolean {
    const resolve = this.#cards.get(cardId);
    if (!resolve) return false;
    this.#cards.delete(cardId);
    resolve(a);
    return true;
  }

  openCards(): string[] {
    return [...this.#cards.keys()];
  }

  // ---- internals ----

  #force(outcome: NodeOutcome): void {
    if (isTerminal(this.#task.node)) return;
    this.#forced = outcome;
    this.#nodeAbort?.abort();
    this.#wake?.();
  }

  async #append(draft: EventDraft): Promise<void> {
    await this.#store.append(draft);
  }

  #context(signal: AbortSignal): NodeContext {
    const self = this;
    return {
      get task() {
        return self.#task;
      },
      signal,
      emit: (d) => self.#append({ ...d, node: self.#task.node } as EventDraft),
      patch: (p) => {
        self.#task = { ...self.#task, ...p };
      },
      fail: async (failureClass, source, detail, actor = SYSTEM) => {
        const storyId = self.#task.currentStoryId;
        self.#task = { ...self.#task, failure: { node: self.#task.node, failureClass, detail, ...(storyId ? { storyId } : {}) }, failuresByClass: { ...self.#task.failuresByClass, [failureClass]: (self.#task.failuresByClass[failureClass] ?? 0) + 1 } };
        await self.#append({ type: "failure", node: self.#task.node, actor, payload: { failureClass, source, detail } });
      },
      askJudge: async (card, actor = { kind: "role", roleId: "facilitator" }) => {
        const cardId = `card-${++self.#cardSeq}`;
        const answered = new Promise<JudgeAnswer>((resolve) => self.#cards.set(cardId, resolve));
        await self.#append({ type: "card_opened", node: self.#task.node, actor, payload: { cardId, ...card } });
        const aborted = new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        const a = await Promise.race([answered, aborted]);
        await self.#append({ type: "card_answered", node: self.#task.node, actor: { kind: "judge" }, payload: { cardId, ...(a.optionId ? { optionId: a.optionId } : {}), ...(a.text ? { text: a.text } : {}) } });
        return a;
      },
    };
  }

  async #runNode(): Promise<NodeOutcome> {
    const node = this.#task.node;
    const ctrl = new AbortController();
    this.#nodeAbort = ctrl;
    const timeoutS = this.#nodeTimeoutS[node] ?? NODES[node].timeoutS;
    let timedOut = false;
    const cancelNodeTimer = timeoutS === null ? () => {} : this.#clock.setTimer(() => {
      timedOut = true;
      ctrl.abort();
      this.#wake?.();
    }, timeoutS * 1000);
    const ctx = this.#context(ctrl.signal);
    const handler = node === "failure_review" ? (c: NodeContext) => this.#failureReview(c) : this.#handlers[node];
    try {
      if (!handler) {
        // An honest stop: this step is not built yet in this version (R23); the Judge decides in failure_review.
        await ctx.fail("interface_call_failure", "persistence", `the step "${node}" is not built yet in this version`);
        return "unrecoverable_error";
      }
      const work = handler(ctx).catch(async (e: unknown) => {
        if (ctrl.signal.aborted) return "failed" as NodeOutcome;
        await ctx.fail("interface_call_failure", "persistence", `step "${node}" crashed: ${(e as Error).message}`);
        return "unrecoverable_error" as NodeOutcome;
      });
      const interrupted = new Promise<NodeOutcome>((resolve) => {
        this.#wake = () => resolve(this.#forced ?? (timedOut ? "node_timeout" : "failed"));
      });
      const outcome = await Promise.race([work, interrupted]);
      if (this.#forced) return this.#forced;
      if (timedOut) {
        await ctx.fail("interface_call_failure", "persistence", `step "${node}" timed out after ${timeoutS} s`);
        // A gathering step that times out continues to the meeting labeled "experience unavailable" (R13.4, R14.13).
        if (node === "sandbox_start" || node === "browser_experience")
          this.#task = { ...this.#task, gathering: { ...this.#task.gathering, experienceUnavailable: `${node === "sandbox_start" ? "the app did not start" : "the app trial"} timed out after ${timeoutS} s` } };
        return "node_timeout";
      }
      return outcome;
    } finally {
      cancelNodeTimer();
      this.#wake = null;
      this.#nodeAbort = null;
    }
  }

  /** The user loop after an unexpected failure (R36.6): retry, skip the story, or end the Task. */
  async #failureReview(ctx: NodeContext): Promise<NodeOutcome> {
    const f = this.#task.failure;
    const canSkip = !!currentStory(this.#task) && !!nextPendingStory(this.#task);
    const options = [
      { id: "retry", label: "Try this step again" },
      ...(canSkip ? [{ id: "skip_story", label: "Skip this story" }] : []),
      { id: "end_task", label: "End the Task" },
    ];
    const notBuilt = !!f && /is not built yet in this version/.test(f.detail);
    const a = await ctx.askJudge(
      {
        kind: "confirm",
        title: notBuilt ? "The next step is not built yet. What should happen?" : "Something went wrong. What should happen next?",
        body: notBuilt ? `"${f!.node}" comes in a later version of the Studio. Ending the Task keeps everything read so far.` : f ? `The step "${f.node}" failed: ${f.detail}` : "A step failed.",
        options,
        allowFreeText: false,
      },
      SYSTEM,
    );
    if (a.optionId === "retry") return "retry";
    if (a.optionId === "skip_story") return "skip_story";
    return "end_task";
  }

  async #loop(): Promise<TerminalId> {
    while (!isTerminal(this.#task.node)) {
      const outcome = await this.#runNode();
      this.#forced = null;
      this.#task = { ...this.#task, outcome };
      const edges = enabledEdges(this.#task);
      const edge = edges[0];
      if (!edge) {
        // No edge for this outcome: a design gap, shown honestly, and the Judge decides (R36.4, R36.6).
        await this.#append({ type: "transition_rejected", node: this.#task.node, actor: SYSTEM, payload: { from: this.#task.node, requestedEdgeId: `(outcome ${outcome})`, reason: "no edge leaves this step for this outcome" } });
        const ctx = this.#context(new AbortController().signal);
        await ctx.fail("interface_call_failure", "persistence", `no way forward from "${this.#task.node}" after outcome "${outcome}"`);
        this.#task = { ...this.#task, outcome: "unrecoverable_error" };
        const fallback = enabledEdges(this.#task)[0];
        if (!fallback) break;
        await this.#take(fallback);
        continue;
      }
      await this.#take(edge);
    }
    this.#cancelTaskTimer?.();
    const terminal = (this.#task.terminal ?? "failed") as TerminalId;
    await this.#append({
      type: "terminal_reached",
      node: this.#task.node,
      actor: SYSTEM,
      payload: {
        terminal,
        summary: { verifierPassed: 0, verifierFailed: 0, failuresByClass: this.#task.failuresByClass, unconfirmed: this.#task.pendingUnconfirmed, label: terminalLabel(this.#task, terminal) },
      },
    });
    this.#onTerminal?.(terminal);
    return terminal;
  }

  async #take(edgeId: string): Promise<void> {
    const r = transition(this.#task, edgeId);
    if (!r.ok) {
      await this.#append({ type: "transition_rejected", node: this.#task.node, actor: SYSTEM, payload: r.event.payload as PayloadOf<"transition_rejected"> });
      return;
    }
    // The node is changed only here, after transition() accepted the edge (R36.3).
    this.#task = r.task;
    await this.#append({ type: "node_entered", node: this.#task.node, actor: SYSTEM, payload: r.event.payload as PayloadOf<"node_entered"> });
  }
}

function terminalLabel(task: TaskState, terminal: TerminalId): string {
  if (terminal === "analysis_only") return "Analysis only";
  if (terminal === "docs_only") return "Docs only";
  if (terminal === "failed" && task.failure?.node === "target_check") return "not executed";
  return terminal;
}

/**
 * Backend restart handling (design.md, Error Handling): a Task whose events.jsonl has no terminal_reached is
 * ended with a failure "backend restarted" and terminal_reached failed.
 */
export async function closeInterruptedTask(store: EventStore): Promise<boolean> {
  const events = store.events();
  if (events.length === 0 || events.some((e) => e.type === "terminal_reached")) return false;
  const node = events.at(-1)!.node;
  await store.append({ type: "failure", node, actor: SYSTEM, payload: { failureClass: "interface_call_failure", source: "persistence", detail: "backend restarted; the Task cannot continue" } });
  await store.append({ type: "terminal_reached", node, actor: SYSTEM, payload: { terminal: "failed", summary: { verifierPassed: 0, verifierFailed: 0, failuresByClass: { interface_call_failure: 1 }, unconfirmed: [], label: "backend restarted" } } });
  return true;
}
