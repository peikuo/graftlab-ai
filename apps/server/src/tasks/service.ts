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
import { buildRepoBrief, buildRepoIndex, type RepoMemoHandle } from "../reader/repoMemo.ts";
import { renderBrief } from "../reader/brief.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import { filesFrom, type EvidenceFiles } from "../evidence/check.ts";
import { runMeeting } from "../meeting/meeting.ts";
import { exportReplay } from "../replay/export.ts";
import { runDecisionDraft } from "../decision/draft.ts";
import { DecisionDesk, type Verdict } from "../decision/desk.ts";
import { splitItems } from "../decision/items.ts";
import { renderDecisionDoc } from "../decision/render.ts";
import { mkdir, writeFile } from "node:fs/promises";
import type { DecisionDocContent, Proposal, ReviewItemData } from "@graftlab/shared";
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
  /** Static folder of the web app where Replay copies and their index go (R27.13); optional. */
  replayPublicDir?: string;
  /** Where the Adapters live (adapters/<id>/adapter.json). */
  adaptersDir?: string;
  /** The Reader's LLM side (R10.7); without it the reading step stops honestly after the download. */
  reader?: {
    makeWriter: (emit: Emit, idPrefix: string) => MemoWriter & BriefWriter;
    promptVersion: string;
    caps?: BriefCaps;
    concurrency?: number;
    indexConcurrency?: number;
  };
  /** The meeting roles' LLM side (R11); without it the meeting stops honestly. */
  meeting?: {
    rules: RuntimeRules;
    runTurn: (o: Omit<TurnOptions, "model">) => Promise<TurnResult>;
    maxStatements?: number;
    maxMs?: number;
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
  /** (Re)starts the background Repo_Index of the current Task; set by the reading step. */
  #startIndex: (() => void) | null = null;
  /** Judge messages already handed to the meeting (by seq). */
  #judgeSeen = 0;
  /** The decision step of the current Task (R15, R16). */
  #decision: { draft?: { draftId: string; number: number; content: DecisionDocContent; items: ReviewItemData[] }; verdicts: Map<string, Verdict>; selected?: string | null; rejections?: { itemId: string; title: string; reason: string }[]; desk?: DecisionDesk; frozen: number } = { verdicts: new Map(), frozen: 0 };
  /** What the reading step produced, for the meeting of the same Task. */
  #read: { memo: RepoMemoHandle; files: Map<string, string>; evidence: EvidenceFiles } | null = null;

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
    this.#startIndex = null;
    this.#judgeSeen = 0;
    this.#decision = { verdicts: new Map(), frozen: 0 };
    this.#read = null;
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
        void this.#exportReplay(store, `${meta.owner}/${meta.repo}`);
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
  async #readerStep(ctx: Parameters<NodeHandler>[0], meta: RepoMeta, files: { path: string; text: string }[], skipped: string[]): Promise<"done" | "failed"> {
    const notDownloaded = skipped.length;
    const r = this.#o.reader;
    if (!r) {
      await ctx.fail("interface_call_failure", "llm", "the Reader is not configured (no LLM profile), so no Repo_Brief can be written");
      return "failed";
    }
    const taskId = ctx.task.taskId;
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
    const texts = new Map(files.map((f) => [f.path, f.text]));
    this.#read = { memo: handle, files: texts, evidence: filesFrom(texts, skipped) };
    // The meeting does not wait for the index; it pauses during the meeting and stops at Task end, abort or a new Task.
    let run = 0;
    this.#startIndex = () => {
      if (this.#index && !this.#index.signal.aborted) return;
      const index = new AbortController();
      this.#index = index;
      void buildRepoIndex(opts(index.signal, `index${++run}`), handle).catch(async (e: unknown) => {
        if (index.signal.aborted) return;
        await ctx.emit({ type: "failure", actor: { kind: "role", roleId: "reader" }, payload: { failureClass: "interface_call_failure", source: "llm", detail: `the background index stopped: ${(e as Error).message}` } }).catch(() => undefined);
      });
    };
    this.#startIndex();
    return "done";
  }

  /** Judge messages not yet handed to the meeting, including those sent during gathering (R11.10, R12.2). */
  #takeJudgeMessages() {
    const out: { text: string; to: string; clientMsgId: string }[] = [];
    for (const e of this.#store?.events() ?? []) {
      if (e.seq <= this.#judgeSeen) continue;
      this.#judgeSeen = e.seq;
      if (e.type === "judge_message" && e.payload.status === "queued") out.push({ text: e.payload.text, to: e.payload.to, clientMsgId: e.payload.clientMsgId });
    }
    return out;
  }

  /** The meeting (R11): evidence summary by code, preparation, discussion by speaking signals; leaving needs a board with a proposal. */
  async #meetingStep(ctx: Parameters<NodeHandler>[0]): Promise<"done" | "failed"> {
    const m = this.#o.meeting;
    const read = this.#read;
    if (!m || !read) {
      await ctx.fail("interface_call_failure", "llm", !m ? "the meeting roles are not configured (no LLM profile)" : "the meeting has no Repo_Brief from this Task's reading step");
      return "failed";
    }
    const events = this.#store?.events() ?? [];
    const agentFindings = events.flatMap((e) => (e.type === "finding_recorded" && e.actor.kind === "role" && e.payload.kind === "finding" ? [e.payload.text] : []));
    const skipped = events.flatMap((e) => (e.type === "finding_recorded" && e.payload.kind === "skipped" ? [e.payload.text] : []));
    const g = ctx.task.gathering;
    const summary = { findings: agentFindings, skipped, experienceNotes: [], screenshotRefs: [], ...(g.experienceUnavailable ? { experienceUnavailable: g.experienceUnavailable } : {}), partial: g.partial };
    await ctx.emit({ type: "evidence_summary", actor: { kind: "system" }, payload: summary });
    const context = this.#contextFor(ctx, read);
    // The background index pauses so it does not compete with the meeting for model calls.
    this.#index?.abort("paused");
    const r = await runMeeting({
      rules: m.rules,
      context,
      files: read.files,
      evidence: read.evidence,
      memo: read.memo.tree,
      emit: ctx.emit,
      openCard: (card, actor) => ctx.openCard(card, actor),
      takeJudgeMessages: () => this.#takeJudgeMessages(),
      runTurn: (t) => m.runTurn({ ...t, emit: ctx.emit }),
      signal: ctx.signal,
      idPrefix: `${ctx.task.taskId}-meeting`,
      ...(m.maxStatements ? { maxStatements: m.maxStatements } : {}),
      ...(m.maxMs ? { maxMs: m.maxMs } : {}),
    });
    if (!ctx.signal.aborted) this.#startIndex?.();
    if (r.ok) return "done";
    if (ctx.signal.aborted) return "failed";
    await ctx.fail("llm_output_format_invalid", "llm", r.reason);
    return "failed";
  }

  /** Replay_File at the terminal (R27.11-R27.13); a secret hit refuses the export and is recorded as a failure. */
  async #exportReplay(store: EventStore, repo: string): Promise<void> {
    const r = await exportReplay({ events: store.events(), repo, runtimeRulesVersion: this.#o.runtimeRulesVersion, registry: this.#o.secrets, dataDir: this.#o.dataDir, ...(this.#o.replayPublicDir ? { publicDir: this.#o.replayPublicDir } : {}) }).catch((e: unknown) => ({ ok: false as const, found: [`export error: ${(e as Error).message}`] }));
    if (!r.ok)
      await store
        .append({ type: "failure", node: store.events().at(-1)?.node ?? "failed", actor: { kind: "system" }, payload: { failureClass: "rejected_by_safety_rule", source: "persistence", detail: `the Replay was not exported: ${r.found.join(", ")}` } })
        .catch(() => undefined);
  }

  /** Drafting (R15.1, R15.2, R37): Facilitator draft, Feasibility and Risk assessments, merged by code. */
  async #decidingStep(ctx: Parameters<NodeHandler>[0]): Promise<"done" | "failed"> {
    const m = this.#o.meeting;
    const read = this.#read;
    const events = this.#store?.events() ?? [];
    const summary = events.findLast((e) => e.type === "meeting_summary");
    if (!m || !read || summary?.type !== "meeting_summary") {
      await ctx.fail("interface_call_failure", "llm", !m ? "the decision roles are not configured (no LLM profile)" : "the decision step has no meeting result from this Task");
      return "failed";
    }
    const cards = new Map(events.flatMap((e) => (e.type === "card_opened" ? [[e.payload.cardId, e.payload] as const] : [])));
    const judgeAnswers = events.flatMap((e) => {
      if (e.type !== "card_answered") return [];
      const c = cards.get(e.payload.cardId);
      if (!c || c.kind !== "question") return [];
      return [`${c.title} → ${c.options.find((o) => o.id === e.payload.optionId)?.label ?? e.payload.text ?? ""}`];
    });
    const d = this.#decision;
    const r = await runDecisionDraft({
      rules: m.rules,
      context: this.#contextFor(ctx, read),
      proposals: summary.payload.proposals as Proposal[],
      openQuestions: summary.payload.openQuestions,
      judgeAnswers,
      ...(ctx.task.adapterId ? { checkHints: await this.#checkHints(ctx.task.adapterId) } : {}),
      files: read.files,
      evidence: read.evidence,
      emit: ctx.emit,
      runTurn: (t) => m.runTurn({ ...t, emit: ctx.emit }),
      signal: ctx.signal,
      idPrefix: `${ctx.task.taskId}-decide${(d.draft?.number ?? 0) + 1}`,
      ...(d.draft && d.rejections ? { previous: { content: d.draft.content, rejections: d.rejections } } : {}),
    });
    if (!r.ok) {
      if (ctx.signal.aborted) return "failed";
      await ctx.fail("llm_output_format_invalid", "llm", r.reason);
      return "failed";
    }
    const number = (d.draft?.number ?? 0) + 1;
    const items = splitItems(r.content);
    d.draft = { draftId: `draft-${number}`, number, content: r.content, items };
    delete d.rejections;
    await ctx.emit({ type: "decision_draft", actor: { kind: "role", roleId: "facilitator" }, payload: { draftId: d.draft.draftId, number, content: r.content, items } });
    return "done";
  }

  /** The Judge reviews item by item, chooses one approach, then sends back or freezes (R5.7, R15.3, R15.11). */
  async #confirmationStep(ctx: Parameters<NodeHandler>[0]): Promise<"send_back" | "confirmed" | "judge_end" | "failed"> {
    const d = this.#decision;
    if (!d.draft) {
      await ctx.fail("interface_call_failure", "persistence", "there is no decision draft to review");
      return "failed";
    }
    const desk = new DecisionDesk({
      draftId: d.draft.draftId,
      content: d.draft.content,
      items: d.draft.items,
      verdicts: d.verdicts,
      ...(d.selected ? { selected: d.selected } : {}),
      nextVersion: d.frozen + 1,
      emit: async (e) => {
        await ctx.emit({ ...e, actor: { kind: "judge" } } as never);
        ctx.patch({ review: desk.review() });
      },
    });
    d.desk = desk;
    ctx.patch({ review: desk.review() });
    const stopped = new Promise<null>((res) => ctx.signal.addEventListener("abort", () => res(null), { once: true }));
    const out = await Promise.race([desk.outcome, stopped]);
    delete d.desk;
    d.selected = desk.selected;
    if (!out) return "failed";
    ctx.patch({ review: desk.review() });
    if (out.kind === "send_back") {
      d.rejections = out.rejections;
      return "send_back";
    }
    if (out.kind === "confirmed") {
      d.frozen = out.version;
      ctx.patch({ frozenVersion: out.version });
      return "confirmed";
    }
    return "judge_end";
  }

  /** A Judge action on the decision draft; every rule is checked again by the desk (R5.7, R28.6). */
  async decision(taskId: string, action: "review" | "select" | "send-back" | "freeze" | "end", body: { draftId?: string; itemId?: string; itemHash?: string; verdict?: "accept" | "reject"; reason?: string; optionId?: string }, sessionId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
    if (this.#runner?.task.taskId !== taskId) return { ok: false, status: 404, error: "no such Task" };
    const desk = this.#decision.desk;
    if (!desk || this.#runner.task.node !== "awaiting_confirmation") return { ok: false, status: 409, error: "no decision draft is waiting for review" };
    const draftId = body.draftId ?? "";
    if (action === "review") return body.itemId && body.itemHash && body.verdict ? desk.reviewItem(draftId, body.itemId, body.itemHash, body.verdict, body.reason) : { ok: false, status: 400, error: "itemId, itemHash and verdict are required" };
    if (action === "select") return body.optionId ? desk.select(draftId, body.optionId) : { ok: false, status: 400, error: "optionId is required" };
    if (action === "send-back") return desk.sendBack(draftId);
    if (action === "freeze") return desk.freeze(draftId, sessionId);
    if (this.#runner.task.repoKind !== "other") return { ok: false, status: 409, error: "ending before the freeze is only for repositories the Studio cannot run" };
    return desk.end();
  }

  async #checkHints(adapterId: string): Promise<string> {
    const a = JSON.parse(await readFile(join(this.#o.adaptersDir ?? "adapters", adapterId, "adapter.json"), "utf8")) as { api?: { read?: { method: string; path: string }[] }; testSelectionHint?: string };
    return [
      "# How the Verifier can check this app (from its Adapter)",
      "api_readback keys are bookmark URLs; fields are bookmark fields such as tag_names.",
      `Read endpoints: ${(a.api?.read ?? []).map((r) => `${r.method} ${r.path}`).join(", ")}.`,
      a.testSelectionHint ? `Tests: ${a.testSelectionHint}` : "",
    ].filter(Boolean).join("\n");
  }

  /** The stable Task context of every meeting and decision turn (one cached prefix): Repo_Brief and evidence summary. */
  #contextFor(ctx: Parameters<NodeHandler>[0], read: { memo: RepoMemoHandle }): string {
    const events = this.#store?.events() ?? [];
    const s = events.find((e) => e.type === "evidence_summary");
    const sum = s?.type === "evidence_summary" ? s.payload : { findings: [], skipped: [], partial: ctx.task.gathering.partial, experienceUnavailable: ctx.task.gathering.experienceUnavailable };
    return [
      `## Repo_Brief (written by the Reader; an LLM description, not evidence)\n\n${renderBrief(read.memo.brief).replace(/^## Repo brief\n/, "")}`,
      `## Evidence summary (built by Studio code)\n\n${[
        sum.findings.length ? `Findings so far:\n${sum.findings.map((f) => `- ${f}`).join("\n")}` : "No findings were recorded during reading.",
        sum.skipped.length ? `Skipped while reading:\n${sum.skipped.map((x) => `- ${x}`).join("\n")}` : "",
        sum.experienceUnavailable ? `App experience unavailable: ${sum.experienceUnavailable}.` : "",
        sum.partial ? "Evidence gathering was ended early by the Judge (partial)." : "",
      ].filter(Boolean).join("\n\n")}`,
    ].join("\n\n");
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
        return this.#readerStep(ctx, meta, read.files, [...read.skipped.map((s) => s.path), ...lateSkipped]);
      },
      adapter_branch: async () => "done",
      // Until milestone 11 builds the app trial, the experience is honestly unavailable and the meeting starts (R13.4).
      sandbox_start: async (ctx) => {
        const reason = "the app trial is not built yet in this version";
        ctx.patch({ gathering: { ...ctx.task.gathering, experienceUnavailable: reason } });
        await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Experience unavailable: ${reason}. The meeting starts with what was read.`, evidence: [], evidenceStatus: "none" } });
        return "failed";
      },
      meeting: (ctx) => this.#meetingStep(ctx),
      deciding: (ctx) => this.#decidingStep(ctx),
      awaiting_confirmation: (ctx) => this.#confirmationStep(ctx),
      frozen: async (ctx) => {
        // The Decision_Doc as an Output_Doc (layer C), next to REPO_MEMO.md.
        const e = this.#store?.events().findLast((x) => x.type === "decision_doc_frozen");
        const v = this.#store?.events().findLast((x) => x.type === "decision_doc_version");
        if (e?.type === "decision_doc_frozen" && v?.type === "decision_doc_version") {
          const dir = join(this.#o.dataDir, "tasks", ctx.task.taskId, "docs");
          await mkdir(dir, { recursive: true });
          await writeFile(join(dir, "DECISION_DOC.md"), renderDecisionDoc(v.payload.content as DecisionDocContent, e.payload));
        }
        return "done";
      },
    };
  }
}

export { DEFAULT_LIMITS };
