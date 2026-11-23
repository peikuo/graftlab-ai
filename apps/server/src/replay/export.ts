// Replay_File export (design.md, "Replay_File"; R27.11-R27.13, R26.6). At the Task's terminal: header plus the
// persisted events, after a second secret scan (registered values and common patterns). A hit refuses the export
// and writes no file; the caller records the failure. A copy goes to the web app's static folder with an index, so
// a Replay plays while the backend is stopped.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findSecretPatterns, type SecretRegistry, type StudioEvent } from "@graftlab/shared";

export interface ReplayHeader {
  schemaVersion: 1;
  taskId: string;
  repo: string;
  runtimeRulesVersion: string;
  createdAt: string;
  label: "Replay";
}
export interface ReplayFile {
  header: ReplayHeader;
  events: readonly StudioEvent[];
}
export interface IndexEntry {
  taskId: string;
  repo: string;
  terminal: string;
  createdAt: string;
}
export type ExportResult = { ok: true; file: string } | { ok: false; found: string[] };

/** The second scan: names of the registered secrets and the patterns that occur, never the values. */
export function scanForSecrets(text: string, registry: SecretRegistry): string[] {
  return [...new Set([...registry.redact(text).hits, ...findSecretPatterns(text)])];
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

export async function exportReplay(o: { events: readonly StudioEvent[]; repo: string; runtimeRulesVersion: string; registry: SecretRegistry; dataDir: string; publicDir?: string; now?: () => Date }): Promise<ExportResult> {
  const first = o.events[0];
  if (!first) return { ok: false, found: ["no events"] };
  const replay: ReplayFile = {
    header: { schemaVersion: 1, taskId: first.taskId, repo: o.repo, runtimeRulesVersion: o.runtimeRulesVersion, createdAt: (o.now?.() ?? new Date()).toISOString(), label: "Replay" },
    events: o.events,
  };
  const text = JSON.stringify(replay);
  const found = scanForSecrets(text, o.registry);
  if (found.length > 0) return { ok: false, found };
  const file = join(o.dataDir, "replays", `${first.taskId}.json`);
  await writeAtomic(file, text);
  if (o.publicDir) {
    await writeAtomic(join(o.publicDir, `${first.taskId}.json`), text);
    const indexFile = join(o.publicDir, "index.json");
    const index = JSON.parse(await readFile(indexFile, "utf8").catch(() => "[]")) as IndexEntry[];
    const terminal = o.events.findLast((e) => e.type === "terminal_reached");
    const entry: IndexEntry = { taskId: first.taskId, repo: o.repo, terminal: terminal?.type === "terminal_reached" ? terminal.payload.terminal : "unknown", createdAt: replay.header.createdAt };
    await writeAtomic(indexFile, JSON.stringify([entry, ...index.filter((x) => x.taskId !== entry.taskId)].slice(0, 50)));
  }
  return { ok: true, file };
}
