// Task creation and the current Task (design.md, "HTTP API"; R9, R10, R25.8, R28.5, R35.3). One Task at a time.
// Handlers: reading (download by Studio code, then the Reader's Repo_Brief; the Repo_Index continues in the
// background) and adapter_branch; later steps are added by later milestones; until then the runner stops
// honestly in failure_review ("not built yet").
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { initialTaskState, matchesAdapter, parseRepoUrl, type NodeId, type SecretRegistry, type TaskState } from "@graftlab/shared";
import { EventStore } from "../events/store.ts";
import { GitHub, GitHubError, type RepoMeta } from "../reader/github.ts";
import { DEFAULT_LIMITS, RepoCache, readRepository, type ReadLimits } from "../reader/reader.ts";
import type { BriefCaps, BriefWriter } from "../reader/brief.ts";
import type { MemoWriter } from "../reader/memo.ts";
import { buildRepoBrief, buildRepoIndex } from "../reader/repoMemo.ts";
import type { Emit } from "../runtime/pi.ts";
import type { Lease } from "../queue/lease.ts";
import { TaskRunner, closeInterruptedTask, type Clock, type JudgeAnswer, type NodeHandler } from "./runner.ts";

export interface AdapterRef {
  id: string;
  match: { owner: string; repo: string };
}

export async function loadAdapters(adaptersDir: string): Promise<AdapterRef[]> {
  const out: AdapterRef[] = [];
  for (const id of await readdir(adaptersDir).catch(() => [] as string[])) {
    try {
      const a = JSON.parse(await readFile(join(adaptersDir, id, "adapter.json"), "utf8")) as AdapterRef;
      if (a.id && a.match?.owner && a.match?.repo) out.push({ id: a.id, match: a.match });
    } catch {
      // not an adapter directory
    }
  }
  return out;
}

export type CreateResult = { ok: true; taskId: string } | { ok: false; status: number; error: string };

export interface TaskServiceOptions {
  dataDir: string;
  secrets: SecretRegistry;
  github: GitHub;
  adapters: AdapterRef[];
  runtimeRulesVersion: string;
  /** Recorded in task_created so a Replay states which model produced it (R30.18). */
  llm?: { profile: string; model: string };
  lease: Lease;
  onStore: (store: EventStore) => void;
  limits?: ReadLimits;
  clock?: Clock;
  taskTimeoutMs?: number;
  /** The Reader's LLM side (R10.7); without it the reading step stops honestly after the download. */
  reader?: {
    makeWriter: (emit: Emit, idPrefix: string) => MemoWriter & BriefWriter;
    promptVersion: string;
    caps?: BriefCaps;
    concurrency?: number;
    indexConcurrency?: number;
  };
}

export class TaskService {
  #o: TaskServiceOptions;
  #cache: RepoCache;
  #runner: TaskRunner | null = null;
  #store: EventStore | null = null;
  #meta: RepoMeta | null = null;
  /** Stops the background Repo_Index of the current Task (Task end, abort, or a new Task). */
  #index: AbortController | null = null;

  constructor(o: TaskServiceOptions) {
    this.#o = o;
    this.#cache = new RepoCache(join(o.dataDir, "cache"));
  }

  get store(): EventStore | null {
    return this.#store;
  }

  get active(): boolean {
    return !!this.#runner && !this.#runner.task.terminal;
  }

  /** At server start: close Tasks that a previous process left without a terminal (Error Handling). */
  async closeInterrupted(): Promise<number> {
    let n = 0;
    for (const id of await readdir(join(this.#o.dataDir, "tasks")).catch(() => [] as string[])) {
      const store = await EventStore.open({ dataDir: this.#o.dataDir, taskId: id, secrets: this.#o.secrets }).catch(() => null);
      if (!store) continue;
      if (await closeInterruptedTask(store)) n++;
      await store.close();
    }
    return n;
  }

  async create(input: string): Promise<CreateResult> {
    const parsed = parseRepoUrl(input);
    if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
    if (this.active) return { ok: false, status: 409, error: "A Task is already running. Wait until it ends." };
    let meta: RepoMeta;
    try {
      meta = await this.#o.github.meta(parsed.owner, parsed.repo);
    } catch (e) {
      const g = e as GitHubError;
      const status = g.kind === "rate_limited" ? 429 : g.kind === "not_found" ? 404 : g.kind === "not_public" ? 403 : 502;
      return { ok: false, status, error: g.message };
    }
    const adapter = this.#o.adapters.find((a) => matchesAdapter(meta, a));
    const taskId = `${meta.repo.toLowerCase()}-${Date.now().toString(36)}`;
    const store = await EventStore.open({ dataDir: this.#o.dataDir, taskId, secrets: this.#o.secrets });
    const startedAt = new Date();
    const timeoutMs = this.#o.taskTimeoutMs ?? 90 * 60_000;
    const task: TaskState = initialTaskState({
      taskId,
      url: `https://github.com/${meta.owner}/${meta.repo}`,
      owner: meta.owner,
      repo: meta.repo,
      repoKind: adapter ? "adapted" : "other",
      ...(adapter ? { adapterId: adapter.id } : {}),
      runtimeRulesVersion: this.#o.runtimeRulesVersion,
      startedAt: startedAt.toISOString(),
      deadlineAt: new Date(startedAt.getTime() + timeoutMs).toISOString(),
    });
    await store.append({
      type: "task_created",
      node: "reading",
      actor: { kind: "system" },
      payload: { url: task.url, owner: meta.owner, repo: meta.repo, repoKind: task.repoKind, ...(adapter ? { adapterId: adapter.id } : {}), runtimeRulesVersion: task.runtimeRulesVersion, commitSha: meta.sha, ...(this.#o.llm ? { llmProfile: this.#o.llm.profile, llmModel: this.#o.llm.model } : {}) },
    });
    await store.append({ type: "node_entered", node: "reading", actor: { kind: "system" }, payload: { from: null, to: "reading", edgeId: "task_created" } });

    this.#index?.abort();
    this.#index = null;
    await this.#store?.close().catch(() => undefined);
    this.#store = store;
    this.#meta = meta;
    this.#o.onStore(store);
    this.#o.lease.taskStarted();
    this.#runner = new TaskRunner({
      store,
      task,
      handlers: this.#handlers(),
      ...(this.#o.clock ? { clock: this.#o.clock } : {}),
      taskTimeoutMs: timeoutMs,
      onTerminal: () => {
        this.#index?.abort();
        this.#o.lease.taskEnded();
      },
    });
    void this.#runner.start();
    return { ok: true, taskId };
  }

  answer(taskId: string, cardId: string, a: JudgeAnswer): boolean | null {
    if (!this.#runner || this.#runner.task.taskId !== taskId) return null;
    return this.#runner.answer(cardId, a);
  }

  abort(taskId: string): boolean {
    if (!this.#runner || this.#runner.task.taskId !== taskId || this.#runner.task.terminal) return false;
    this.#runner.abort();
    return true;
  }

  endGathering(taskId: string): boolean {
    if (!this.#runner || this.#runner.task.taskId !== taskId) return false;
    return this.#runner.endGathering();
  }

  /** Text of a downloaded file for the reading view (R4.4); only files of the current Task's commit. */
  async fileText(taskId: string, path: string): Promise<string | null> {
    if (!this.#meta || this.#runner?.task.taskId !== taskId) return null;
    const bytes = await this.#cache.readFile(this.#meta, path).catch(() => null);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  /** The Repo_Brief in the foreground, then the Repo_Index in the background (R10.7-R10.12). */
  async #readerStep(ctx: Parameters<NodeHandler>[0], meta: RepoMeta, files: { path: string; text: string }[], notDownloaded: number): Promise<"done" | "failed"> {
    const r = this.#o.reader;
    if (!r) {
      await ctx.fail("interface_call_failure", "llm", "the Reader is not configured (no LLM profile), so no Repo_Brief can be written");
      return "failed";
    }
    const taskId = ctx.task.taskId;
    const index = new AbortController();
    const opts = (signal: AbortSignal, prefix: string) => ({
      files,
      repo: { owner: meta.owner, repo: meta.repo, sha: meta.sha },
      cacheRoot: join(this.#o.dataDir, "cache"),
      docsDir: join(this.#o.dataDir, "tasks", taskId, "docs"),
      promptVersion: r.promptVersion,
      writer: r.makeWriter(ctx.emit, `${taskId}-${prefix}`),
      emit: ctx.emit,
      signal,
      notDownloaded,
      ...(r.caps ? { caps: r.caps } : {}),
      ...(r.concurrency ? { concurrency: r.concurrency } : {}),
      ...(r.indexConcurrency ? { indexConcurrency: r.indexConcurrency } : {}),
    });
    const handle = await buildRepoBrief(opts(ctx.signal, "brief"));
    if (!handle) {
      if (ctx.signal.aborted) return "failed";
      await ctx.fail("llm_output_format_invalid", "llm", "the Reader could not write a valid Repo_Brief");
      return "failed";
    }
    ctx.patch({ briefReady: true });
    // The meeting does not wait for the index; it stops at Task end, abort or a new Task.
    this.#index = index;
    void buildRepoIndex(opts(index.signal, "index"), handle).catch(async (e: unknown) => {
      if (index.signal.aborted) return;
      await ctx.emit({ type: "failure", actor: { kind: "role", roleId: "reader" }, payload: { failureClass: "interface_call_failure", source: "llm", detail: `the background index stopped: ${(e as Error).message}` } }).catch(() => undefined);
    });
    return "done";
  }

  #handlers(): Partial<Record<NodeId, NodeHandler>> {
    const limits = this.#o.limits ?? DEFAULT_LIMITS;
    return {
      reading: async (ctx) => {
        const meta = this.#meta!;
        const lateSkipped: string[] = [];
        let read: Awaited<ReturnType<typeof readRepository>>;
        try {
          read = await readRepository(
            this.#o.github,
            this.#cache,
            meta,
            {
              signal: ctx.signal,
              onPlan: async (plan, fromCache, truncated) => {
                const source = fromCache ? "from the cache (same commit read before)" : "from GitHub";
                await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Reading ${plan.read.length} files ${source}`, evidence: [], evidenceStatus: "none" } });
                if (plan.skipped.length > 0 || truncated) {
                  const sample = plan.skipped.slice(0, 8).map((s) => `${s.path} (${s.reason})`).join(", ");
                  const more = plan.skipped.length > 8 ? ` and ${plan.skipped.length - 8} more` : "";
                  const trunc = truncated ? " GitHub returned only part of the file list." : "";
                  await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "skipped", text: `Skipped ${plan.skipped.length} files: ${sample}${more}.${trunc}`, evidence: [], evidenceStatus: "none" } });
                }
              },
              onFile: async (entry) => {
                await ctx.emit({ type: "file_read", actor: { kind: "system" }, payload: { path: entry.path, bytes: entry.size, artifactRef: `file:${entry.path}` } });
              },
              // Files found to be binary only after download are reported once, at the end (low density).
              onSkippedAfterRead: async (path) => {
                lateSkipped.push(path);
              },
            },
            limits,
          );
          if (lateSkipped.length > 0) {
            const sample = lateSkipped.slice(0, 8).join(", ");
            const more = lateSkipped.length > 8 ? ` and ${lateSkipped.length - 8} more` : "";
            await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "skipped", text: `Also skipped ${lateSkipped.length} files whose content is binary: ${sample}${more}.`, evidence: [], evidenceStatus: "none" } });
          }
        } catch (e) {
          if (ctx.signal.aborted) return "failed";
          const message = e instanceof GitHubError ? e.message : `reading failed: ${(e as Error).message}`;
          await ctx.fail("interface_call_failure", "github", message);
          return "failed";
        }
        return this.#readerStep(ctx, meta, read.files, read.skipped.length + lateSkipped.length);
      },
      adapter_branch: async () => "done",
    };
  }
}

export { DEFAULT_LIMITS };
