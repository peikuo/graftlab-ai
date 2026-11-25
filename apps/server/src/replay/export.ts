// Replay_File export (design.md, "Replay_File"; R27.11-R27.13, R26.6). At the Task's terminal: header plus the
// persisted events, after a second secret scan (registered values and common patterns). A hit refuses the export
// and writes no file; the caller records the failure. A copy goes to the web app's static folder with an index, so
// a Replay plays while the backend is stopped.
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
export type ExportResult = { ok: true; file: string; shots: number } | { ok: false; found: string[] };
/** The screenshot files the events name (`artifacts/shots/<name>.jpg`), by file name. */
export function screenshotNames(events: readonly StudioEvent[]): string[] {
  const refs = events.flatMap((e) => (e.type === "browser_observation" && e.payload.screenshotRef ? [e.payload.screenshotRef] : e.type === "artifact_updated" && e.payload.artifactKind === "screenshot" ? [e.payload.ref] : []));
  return [...new Set(refs.map((r) => r.split("/").pop() ?? "").filter((n) => /^[A-Za-z0-9_-]{1,80}\.jpg$/.test(n)))];
}

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
  // The screenshots the events name go next to the Replay_File, so a Replay shows the app pages without the Task
  // directory (R26). Only files an event names are copied; a missing one is skipped.
  let shots = 0;
  const targets = [join(o.dataDir, "replays", first.taskId, "shots"), ...(o.publicDir ? [join(o.publicDir, first.taskId, "shots")] : [])];
  for (const name of screenshotNames(o.events)) {
    const src = join(o.dataDir, "tasks", first.taskId, "artifacts", "shots", name);
    let copied = false;
    for (const dir of targets) {
      await mkdir(dir, { recursive: true });
      copied = (await copyFile(src, join(dir, name)).then(() => true, () => false)) || copied;
    }
    if (copied) shots++;
  }
  if (o.publicDir) {
    await writeAtomic(join(o.publicDir, `${first.taskId}.json`), text);
    const indexFile = join(o.publicDir, "index.json");
    const index = JSON.parse(await readFile(indexFile, "utf8").catch(() => "[]")) as IndexEntry[];
    const terminal = o.events.findLast((e) => e.type === "terminal_reached");
    const entry: IndexEntry = { taskId: first.taskId, repo: o.repo, terminal: terminal?.type === "terminal_reached" ? terminal.payload.terminal : "unknown", createdAt: replay.header.createdAt };
    await writeAtomic(indexFile, JSON.stringify([entry, ...index.filter((x) => x.taskId !== entry.taskId)].slice(0, 50)));
  }
  return { ok: true, file, shots };
}
