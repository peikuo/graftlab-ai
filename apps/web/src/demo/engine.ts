// Mock engine for the UI demo: produces StudioEvents and deltas in the browser, with the same reducer as the
// live app, and waits for the Judge's clicks at every decision point. MOCK DATA ONLY: nothing here talks to a
// model, GitHub or a container. The demo is labeled "DEMO · mock data" wherever it is shown.
import { EVENT_SCHEMA_VERSION, reduce, initialUiState, validateEvent, type Actor, type EventType, type NodeId, type PayloadOf, type StudioEvent, type UiState } from "@graftlab/shared";

export interface DemoSnapshot {
  state: UiState;
  events: StudioEvent[];
  buffers: Record<string, { text: string; reasoning: string }>;
  now: number;
}

type Answer = { optionId?: string; text?: string };

export class DemoEngine {
  #events: StudioEvent[] = [];
  #state: UiState = initialUiState;
  #buffers: Record<string, { text: string; reasoning: string }> = {};
  #listeners = new Set<() => void>();
  #waiters = new Map<string, (a: Answer) => void>();
  #signals = new Map<string, () => void>();
  #node: NodeId = "reading";
  #stopped = false;
  speed = 1;
  readonly taskId = `demo-${Date.now()}`;

  snapshot(): DemoSnapshot {
    return { state: this.#state, events: this.#events, buffers: this.#buffers, now: Date.now() };
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  stop(): void {
    this.#stopped = true;
  }

  get node(): NodeId {
    return this.#node;
  }

  #notify(): void {
    for (const l of this.#listeners) l();
  }

  async sleep(ms: number): Promise<void> {
    if (this.#stopped) throw new Error("stopped");
    await new Promise((r) => setTimeout(r, ms / this.speed));
    if (this.#stopped) throw new Error("stopped");
  }

  emit<T extends EventType>(type: T, payload: PayloadOf<T>, actor: Actor = { kind: "system" }): StudioEvent {
    const e = { v: EVENT_SCHEMA_VERSION, seq: this.#events.length + 1, ts: new Date().toISOString(), taskId: this.taskId, node: this.#node, actor, type, payload } as StudioEvent;
    const r = validateEvent(e);
    if (!r.ok) throw new Error(`demo event ${type} is invalid: ${r.error}`);
    this.#events = [...this.#events, e];
    this.#state = reduce(this.#state, e);
    if (type === "message_completed" || type === "message_incomplete") {
      const { [(payload as { messageId: string }).messageId]: _done, ...rest } = this.#buffers;
      this.#buffers = rest;
    }
    this.#notify();
    return e;
  }

  enter(to: NodeId, edgeId: string): void {
    const from = this.#node;
    this.#node = to;
    this.emit("node_entered", { from, to, edgeId });
  }

  delta(messageId: string, channel: "text" | "reasoning", text: string): void {
    const cur = this.#buffers[messageId] ?? { text: "", reasoning: "" };
    this.#buffers = { ...this.#buffers, [messageId]: { ...cur, [channel]: cur[channel] + text } };
    this.#notify();
  }

  #msg = 0;
  /** A streamed statement: waiting for the model, optional reasoning, then text, then the complete message. */
  async say(roleId: Extract<Actor, { kind: "role" }>["roleId"] | "code_agent" | "test_agent", text: string, reasoning = ""): Promise<void> {
    const id = `m${++this.#msg}`;
    const agent = roleId === "code_agent" || roleId === "test_agent";
    const actor: Actor = roleId === "code_agent" ? { kind: "code_agent" } : roleId === "test_agent" ? { kind: "test_agent" } : { kind: "role", roleId };
    this.emit("message_started", { messageId: id, ...(agent ? {} : { roleId }), purpose: agent ? "code_agent_step" : "statement" }, actor);
    await this.sleep(900);
    if (reasoning) {
      this.emit("message_progress", { messageId: id, phase: "thinking", textChars: 0, reasoningChars: 0 }, actor);
      for (let i = 0; i < reasoning.length; i += 6) {
        this.delta(id, "reasoning", reasoning.slice(i, i + 6));
        await this.sleep(35);
      }
    }
    this.emit("message_progress", { messageId: id, phase: "speaking", textChars: 0, reasoningChars: reasoning.length }, actor);
    for (let i = 0; i < text.length; i += 4) {
      this.delta(id, "text", text.slice(i, i + 4));
      await this.sleep(28);
      if (i > 0 && i % 160 === 0) this.emit("message_progress", { messageId: id, phase: "speaking", textChars: i, reasoningChars: reasoning.length }, actor);
    }
    this.emit("message_completed", { messageId: id, text, ...(reasoning ? { reasoning } : {}), finishReason: "stop" }, actor);
  }

  /** Opens a card and resolves with the Judge's answer. */
  ask(cardId: string, payload: Omit<PayloadOf<"card_opened">, "cardId">, actor: Actor): Promise<Answer> {
    this.emit("card_opened", { cardId, ...payload }, actor);
    return new Promise((resolve) => this.#waiters.set(cardId, resolve));
  }

  /** Called by the UI. Mirrors the server: only an open card can be answered. */
  async answer(cardId: string, a: Answer): Promise<{ ok: true } | { ok: false; error: string }> {
    const w = this.#waiters.get(cardId);
    if (!w) return { ok: false, error: "the card is not open" };
    this.#waiters.delete(cardId);
    this.emit("card_answered", { cardId, ...(a.optionId ? { optionId: a.optionId } : {}), ...(a.text ? { text: a.text } : {}) }, { kind: "judge" });
    w(a);
    return { ok: true };
  }

  #msgId = 0;
  async message(to: string, text: string): Promise<{ ok: true; clientMsgId: string } | { ok: false; error: string }> {
    const clientMsgId = `j${++this.#msgId}`;
    const gathering = this.#node === "reading" || this.#node === "sandbox_start" || this.#node === "browser_experience";
    this.emit("judge_message", { clientMsgId, to: to as "all", text, status: gathering ? "queued" : "delivered", deliveredTo: gathering ? [] : ["facilitator"] }, { kind: "judge" });
    this.#pendingMessages.push({ clientMsgId, text });
    return { ok: true, clientMsgId };
  }

  #pendingMessages: { clientMsgId: string; text: string }[] = [];
  takeMessages(): { clientMsgId: string; text: string }[] {
    const m = this.#pendingMessages;
    this.#pendingMessages = [];
    return m;
  }

  /** A one-shot UI signal, for example "start the meeting now" or "freeze". */
  waitSignal(name: string): Promise<void> {
    return new Promise((r) => this.#signals.set(name, r));
  }

  signal(name: string): boolean {
    const s = this.#signals.get(name);
    if (!s) return false;
    this.#signals.delete(name);
    s();
    return true;
  }

  hasSignal(name: string): boolean {
    return this.#signals.has(name);
  }
}
