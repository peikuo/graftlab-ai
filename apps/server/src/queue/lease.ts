// Queue and single operator lease (design.md, "Queue"; R28.1-R28.6). Held server-side; the UI only reflects it.
// One operator at a time; others queue in order and may watch. During an active Task the lease stays with
// that Task's Judge until the Task ends; idle release applies only while no Task is active.

export interface QueueView {
  /** "operator" holds the lease; "queued" waits at `position` (1 = next); "watching" has not joined. */
  role: "operator" | "queued" | "watching";
  position?: number;
  queueLength: number;
  open: boolean;
}

export interface LeaseOptions {
  idleReleaseMs?: number; // GL_LEASE_IDLE_S, default 120 s
  now?: () => number;
}

export class Lease {
  #holder: { sessionId: string; acquiredAt: number; lastHeartbeatAt: number } | null = null;
  #queue: string[] = [];
  #lastSeen = new Map<string, number>();
  #taskActive = false;
  #open = true;
  #idleMs: number;
  #now: () => number;
  #onChange: (() => void) | undefined;

  constructor(opts: LeaseOptions = {}) {
    this.#idleMs = opts.idleReleaseMs ?? 120_000;
    this.#now = opts.now ?? Date.now;
  }

  onChange(fn: () => void): void {
    this.#onChange = fn;
  }

  get holder(): string | null {
    return this.#holder?.sessionId ?? null;
  }

  get open(): boolean {
    return this.#open;
  }

  isOperator(sessionId: string | undefined): boolean {
    this.tick();
    return !!sessionId && this.#holder?.sessionId === sessionId;
  }

  /** Joins the queue; the first session in an empty queue becomes the operator at once. */
  join(sessionId: string): QueueView {
    this.tick();
    this.#lastSeen.set(sessionId, this.#now());
    if (this.#holder?.sessionId !== sessionId && !this.#queue.includes(sessionId)) {
      if (!this.#open) return this.view(sessionId);
      this.#queue.push(sessionId);
    }
    this.#promote();
    this.#changed();
    return this.view(sessionId);
  }

  heartbeat(sessionId: string): QueueView {
    const now = this.#now();
    this.#lastSeen.set(sessionId, now);
    if (this.#holder?.sessionId === sessionId) this.#holder.lastHeartbeatAt = now;
    this.tick();
    return this.view(sessionId);
  }

  leave(sessionId: string): void {
    this.#queue = this.#queue.filter((s) => s !== sessionId);
    this.#lastSeen.delete(sessionId);
    if (this.#holder?.sessionId === sessionId && !this.#taskActive) this.#holder = null;
    this.#promote();
    this.#changed();
  }

  /** Called by the task runner. While a Task is active the lease is not released for idleness. */
  taskStarted(): void {
    this.#taskActive = true;
  }

  /** Task reached a terminal: the next queued session is promoted (R28.5). */
  taskEnded(): void {
    this.#taskActive = false;
    this.#holder = null;
    this.#promote();
    this.#changed();
  }

  setOpen(open: boolean): void {
    this.#open = open;
    this.#changed();
  }

  /** Releases idle sessions (holder only while no Task is active) and promotes the next one. */
  tick(): void {
    const now = this.#now();
    let changed = false;
    if (this.#holder && !this.#taskActive && now - this.#holder.lastHeartbeatAt > this.#idleMs) {
      this.#holder = null;
      changed = true;
    }
    const before = this.#queue.length;
    this.#queue = this.#queue.filter((s) => now - (this.#lastSeen.get(s) ?? 0) <= this.#idleMs);
    if (this.#queue.length !== before) changed = true;
    if (this.#promote() || changed) this.#changed();
  }

  view(sessionId: string | undefined): QueueView {
    const base = { queueLength: this.#queue.length, open: this.#open };
    if (sessionId && this.#holder?.sessionId === sessionId) return { role: "operator", ...base };
    const i = sessionId ? this.#queue.indexOf(sessionId) : -1;
    if (i >= 0) return { role: "queued", position: i + 1, ...base };
    return { role: "watching", ...base };
  }

  #promote(): boolean {
    if (this.#holder || this.#queue.length === 0) return false;
    const next = this.#queue.shift()!;
    const now = this.#now();
    this.#holder = { sessionId: next, acquiredAt: now, lastHeartbeatAt: now };
    return true;
  }

  #changed(): void {
    this.#onChange?.();
  }
}
