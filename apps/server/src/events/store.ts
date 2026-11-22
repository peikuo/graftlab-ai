// Event store: the single writer of one Task's Event_Stream (design.md, "Persistence and live delivery";
// R27.1, R27.6, R27.9, R30.15). Every event is redacted, validated, appended to events.jsonl and only then
// broadcast. A redaction hit is a defect: the redacted event is stored and a visible failure follows it.
import { mkdir, open, readFile, writeFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  EVENT_SCHEMA_VERSION,
  parseEvents,
  serializeEvent,
  type Actor,
  type EventType,
  type PayloadOf,
  type SecretRegistry,
  type StudioEvent,
  type NodeId,
} from "@graftlab/shared";

export type EventDraft<T extends EventType = EventType> = {
  [K in T]: { type: K; node: NodeId; actor: Actor; payload: PayloadOf<K> };
}[T];

export type StoreListener = (msg: { kind: "event"; event: StudioEvent } | { kind: "error"; message: string }) => void;

/** Event types after which the file is fsynced (decisions, answers, terminals, failures). */
const FSYNC_TYPES: ReadonlySet<EventType> = new Set(["decision_doc_frozen", "card_answered", "terminal_reached", "failure"]);

export class AppendError extends Error {}

export interface EventStoreOptions {
  dataDir: string;
  taskId: string;
  secrets: SecretRegistry;
  now?: () => Date;
}

export class EventStore {
  readonly taskId: string;
  readonly dir: string;
  #fh: FileHandle;
  #secrets: SecretRegistry;
  #now: () => Date;
  #events: StudioEvent[];
  #listeners = new Set<StoreListener>();
  #queue: Promise<unknown> = Promise.resolve();
  #broken = false;

  private constructor(dir: string, taskId: string, fh: FileHandle, events: StudioEvent[], secrets: SecretRegistry, now: () => Date) {
    this.dir = dir;
    this.taskId = taskId;
    this.#fh = fh;
    this.#events = events;
    this.#secrets = secrets;
    this.#now = now;
  }

  /** Opens (or creates) the store of a Task; existing events are loaded so seq continues without gaps. */
  static async open(opts: EventStoreOptions): Promise<EventStore> {
    const dir = join(opts.dataDir, "tasks", opts.taskId);
    await mkdir(dir, { recursive: true });
    const file = join(dir, "events.jsonl");
    let events: StudioEvent[] = [];
    try {
      const parsed = parseEvents(await readFile(file, "utf8"));
      if (!parsed.ok) throw new AppendError(`events.jsonl line ${parsed.line} is invalid: ${parsed.error}`);
      events = parsed.events;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const fh = await open(file, "a");
    return new EventStore(dir, opts.taskId, fh, events, opts.secrets, opts.now ?? (() => new Date()));
  }

  get lastSeq(): number {
    return this.#events.at(-1)?.seq ?? 0;
  }

  /** All persisted events, in order. */
  events(): readonly StudioEvent[] {
    return this.#events;
  }

  /** Events with seq greater than `afterSeq` (for SSE resume with Last-Event-ID). */
  eventsAfter(afterSeq: number): StudioEvent[] {
    return this.#events.filter((e) => e.seq > afterSeq);
  }

  subscribe(listener: StoreListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Appends one event (and, after a redaction hit, the failure that reports it). Appends are serialized,
   * so seq values are assigned in order without gaps. Resolves with the stored events.
   */
  append(draft: EventDraft): Promise<StudioEvent[]> {
    const run = this.#queue.then(() => this.#appendNow(draft));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #appendNow(draft: EventDraft): Promise<StudioEvent[]> {
    if (this.#broken) throw new AppendError("the event store is broken after a failed append");
    const { value: redacted, hits } = this.#secrets.redact(draft);
    const stored = [await this.#write(redacted)];
    if (hits.length > 0) {
      stored.push(
        await this.#write({
          type: "failure",
          node: draft.node,
          actor: { kind: "system" },
          payload: {
            failureClass: "rejected_by_safety_rule",
            source: "persistence",
            // Names only, never values (R30.15).
            detail: `secret found in a ${draft.type} event and redacted: ${hits.join(", ")}`,
            relatedRef: `seq:${stored[0]!.seq}`,
          },
        }),
      );
    }
    return stored;
  }

  async #write(draft: EventDraft): Promise<StudioEvent> {
    const event = {
      v: EVENT_SCHEMA_VERSION,
      seq: this.lastSeq + 1,
      ts: this.#now().toISOString(),
      taskId: this.taskId,
      node: draft.node,
      actor: draft.actor,
      type: draft.type,
      payload: draft.payload,
    } as StudioEvent;
    // Throws on an invalid event: a programming error, nothing is written.
    const line = serializeEvent(event) + "\n";
    try {
      await this.#fh.appendFile(line, "utf8");
      if (FSYNC_TYPES.has(event.type)) await this.#fh.sync();
    } catch (e) {
      await this.#markBroken((e as Error).message);
      throw new AppendError(`append failed: ${(e as Error).message}`);
    }
    this.#events.push(event);
    for (const l of this.#listeners) l({ kind: "event", event });
    return event;
  }

  async #markBroken(reason: string): Promise<void> {
    this.#broken = true;
    // R27.6: the Workspace gets an error frame and the Task is marked incomplete; the runner then takes
    // the unrecoverable_error edge.
    for (const l of this.#listeners) l({ kind: "error", message: "the event log could not be written; the Task stops" });
    try {
      await writeFile(join(this.dir, "meta.json"), JSON.stringify({ incomplete: true, reason, at: this.#now().toISOString() }) + "\n");
    } catch {
      // nothing more can be recorded
    }
  }

  get broken(): boolean {
    return this.#broken;
  }

  async close(): Promise<void> {
    await this.#queue;
    await this.#fh.close();
  }
}
