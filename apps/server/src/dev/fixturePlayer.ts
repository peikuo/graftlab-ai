// Development fixture player (tasks.md 3.2, 3.15): plays a fixture file into the current Task's event store
// and the SSE hub with its recorded timing, so the Workspace can be built and checked against a live stream.
// Fixture format (JSONL): {"at": ms from start, "event": EventDraft} or {"at": ms, "delta": {messageId, channel, text}}.
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { NodeIdSchema, ActorSchema } from "@graftlab/shared";
import type { EventDraft, EventStore } from "../events/store.ts";
import type { SseHub } from "../sse/hub.ts";

const Line = z.union([
  z.object({ at: z.number().nonnegative(), event: z.object({ type: z.string(), node: NodeIdSchema, actor: ActorSchema, payload: z.unknown() }) }),
  z.object({ at: z.number().nonnegative(), delta: z.object({ messageId: z.string(), channel: z.enum(["text", "reasoning", "toolcall"]), text: z.string() }) }),
]);
export type FixtureLine = z.infer<typeof Line>;

export async function loadFixture(path: string): Promise<FixtureLine[]> {
  const lines = (await readFile(path, "utf8")).split("\n").filter((l) => l.trim() !== "");
  return lines.map((l, i) => {
    const r = Line.safeParse(JSON.parse(l));
    if (!r.success) throw new Error(`${path} line ${i + 1}: ${r.error.message}`);
    return r.data;
  });
}

export interface PlayOptions {
  speed?: number; // 2 = twice as fast
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

export async function playFixture(lines: FixtureLine[], store: EventStore, hub: SseHub, opts: PlayOptions = {}): Promise<void> {
  const speed = opts.speed ?? 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let clock = 0;
  for (const line of lines) {
    if (opts.signal?.aborted) return;
    const wait = (line.at - clock) / speed;
    if (wait > 0) await sleep(wait);
    clock = line.at;
    if ("delta" in line) hub.delta(line.delta.messageId, line.delta.channel, line.delta.text);
    else await store.append(line.event as EventDraft);
  }
}
