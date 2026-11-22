// SSE hub (design.md, "Persistence and live delivery"; R2.8, R3.6, R3.11, R27.3, R28.3).
// Frames: `event` (a persisted StudioEvent, id = seq), `delta` (streamed text, never persisted), `buffer`
// (in-progress text on connect, so a reload mid-stream shows it), `queue` (per client), `error`, and comment
// heartbeats. Every outgoing text passes the secret registry; a hit in a delta is reported to onLeak.
import type { SecretRegistry, StudioEvent } from "@graftlab/shared";
import type { EventStore } from "../events/store.ts";

export type DeltaChannel = "text" | "reasoning" | "toolcall";

export interface SseClient {
  sessionId: string | undefined;
  write: (chunk: string) => void;
}

export interface SseHubOptions {
  secrets: SecretRegistry;
  heartbeatMs?: number;
  /** Called with registered secret names when a delta contained a secret (the caller records a failure). */
  onLeak?: (names: string[], where: string) => void;
  queueView?: (sessionId: string | undefined) => unknown;
}

export function frame(kind: string, data: unknown, id?: number): string {
  const head = id === undefined ? "" : `id: ${id}\n`;
  return `${head}event: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
}

export class SseHub {
  #clients = new Set<SseClient>();
  #buffers = new Map<string, Record<DeltaChannel, string>>();
  #secrets: SecretRegistry;
  #onLeak: SseHubOptions["onLeak"];
  #queueView: SseHubOptions["queueView"];
  #store: EventStore | null = null;
  #unsubscribe: (() => void) | null = null;
  #timer: ReturnType<typeof setInterval>;

  constructor(opts: SseHubOptions) {
    this.#secrets = opts.secrets;
    this.#onLeak = opts.onLeak;
    this.#queueView = opts.queueView;
    this.#timer = setInterval(() => this.#broadcast(": hb\n\n"), opts.heartbeatMs ?? 15_000);
    this.#timer.unref?.();
  }

  /** Attaches the current Task's store; events are forwarded as they are persisted. */
  attach(store: EventStore | null): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#buffers.clear();
    this.#store = store;
    if (!store) return;
    // Clients that were already connected (for example on the home page) get the new Task's events so far,
    // so they never miss task_created when it was written before this store was attached.
    for (const e of store.events()) this.#broadcast(frame("event", e, e.seq));
    this.#unsubscribe = store.subscribe((m) => {
      if (m.kind === "error") return this.#broadcast(frame("error", { message: m.message }));
      this.#onEvent(m.event);
    });
  }

  /** Connects a client; sends missed events after `lastEventId`, then the in-progress buffers and its queue view. */
  connect(client: SseClient, lastEventId?: number): () => void {
    this.#clients.add(client);
    client.write("retry: 2000\n\n");
    if (this.#store) for (const e of this.#store.eventsAfter(lastEventId ?? 0)) client.write(frame("event", e, e.seq));
    if (this.#buffers.size > 0) {
      const buffers = [...this.#buffers].map(([messageId, b]) => ({ messageId, ...b }));
      client.write(frame("buffer", buffers));
    }
    if (this.#queueView) client.write(frame("queue", this.#queueView(client.sessionId)));
    return () => this.#clients.delete(client);
  }

  /** Streams one chunk of an open message. Not persisted (R3.11); redacted like events. */
  delta(messageId: string, channel: DeltaChannel, text: string): void {
    const { value, hits } = this.#secrets.redactText(text);
    if (hits.length > 0) this.#onLeak?.(hits, `a streamed ${channel} chunk of message ${messageId}`);
    const b = this.#buffers.get(messageId) ?? { text: "", reasoning: "", toolcall: "" };
    b[channel] += value;
    this.#buffers.set(messageId, b);
    this.#broadcast(frame("delta", { messageId, channel, text: value }));
  }

  /** Sends each client its own queue position (R28.2). */
  queueChanged(): void {
    if (!this.#queueView) return;
    for (const c of this.#clients) this.#safeWrite(c, frame("queue", this.#queueView(c.sessionId)));
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  close(): void {
    clearInterval(this.#timer);
    this.#unsubscribe?.();
    this.#clients.clear();
  }

  #onEvent(e: StudioEvent): void {
    if (e.type === "message_completed" || e.type === "message_incomplete") this.#buffers.delete(e.payload.messageId);
    this.#broadcast(frame("event", e, e.seq));
  }

  #broadcast(chunk: string): void {
    for (const c of this.#clients) this.#safeWrite(c, chunk);
  }

  #safeWrite(c: SseClient, chunk: string): void {
    try {
      c.write(chunk);
    } catch {
      this.#clients.delete(c);
    }
  }
}
