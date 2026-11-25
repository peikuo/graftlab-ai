// Local prompt trace (design.md, "Prompt trace"; R35): every finished model turn of the current Task, written to
// data/tasks/<taskId>/traces/ after the secret registry redacted it. For problem analysis on the host only: it is
// not an event, not part of a Replay_File, and data/ is not in git.
import { cp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SecretRegistry } from "@graftlab/shared";
import type { TurnTrace } from "../runtime/pi.ts";

export const TRACE_TEXT_MAX = 200_000;
const SAFE = /[^A-Za-z0-9_.-]/g;

/** Long texts are cut so one trace stays readable; the cut is marked. */
function cutDeep(v: unknown): unknown {
  if (typeof v === "string") return v.length > TRACE_TEXT_MAX ? `${v.slice(0, TRACE_TEXT_MAX)}\n… (${v.length - TRACE_TEXT_MAX} more characters)` : v;
  if (Array.isArray(v)) return v.map(cutDeep);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cutDeep(x)]));
  return v;
}

export class TraceWriter {
  #n = 0;
  constructor(
    private readonly dataDir: string,
    private readonly secrets: SecretRegistry,
    private readonly currentTaskId: () => string | null,
  ) {}

  dir(taskId: string): string {
    return join(this.dataDir, "tasks", taskId, "traces");
  }

  /** One turn: `<number>-<idPrefix>.json`, redacted; a redaction hit is noted in the file, never the value. */
  async turn(t: TurnTrace): Promise<void> {
    const taskId = this.currentTaskId();
    if (!taskId) return;
    const dir = this.dir(taskId);
    await mkdir(dir, { recursive: true });
    const raw = JSON.stringify(cutDeep(t), null, 2);
    const red = this.secrets.redactText(raw);
    // Common key patterns are also caught here, even when they are not registered.
    const body = red.hits.length ? red.value.replace(/^\{/, `{\n  "redactedSecrets": ${JSON.stringify(red.hits)},`) : red.value;
    const name = `${String(++this.#n).padStart(4, "0")}-${t.idPrefix.replace(SAFE, "_").slice(-80)}.json`;
    await writeFile(join(dir, name), body);
  }

  /** The conversation of one in-container agent attempt: the runner events with full tool inputs and outputs. */
  async agentRun(taskId: string, label: string, data: unknown): Promise<void> {
    const dir = join(this.dir(taskId), label.replace(SAFE, "_"));
    await mkdir(dir, { recursive: true });
    const red = this.secrets.redactText(JSON.stringify(cutDeep(data), null, 2));
    await writeFile(join(dir, "conversation.json"), red.hits.length ? red.value.replace(/^\{/, `{\n  "redactedSecrets": ${JSON.stringify(red.hits)},`) : red.value);
  }

  /** The input files of one in-container agent attempt (story bundle, rules, focus pack), kept per attempt. */
  async attemptInputs(taskId: string, contextDir: string, label: string): Promise<void> {
    const dir = join(this.dir(taskId), label.replace(SAFE, "_"));
    await mkdir(dir, { recursive: true });
    await cp(contextDir, dir, { recursive: true, force: true });
  }
}
