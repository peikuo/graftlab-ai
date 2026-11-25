// The development stage for source-change Features (design.md, "Development stage", "Worktree manager",
// "PiCodeRuntime", "Verifier"; R21, R22, R38, R39, R40). One instance per Task. Every container step goes through
// the container manager; every LLM step is labeled; success comes only from the Verifier's exit codes.
import { readFileSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { currentStory, describeCheck, isTestPath, nextPendingStory, PATCH_MAX, unplannedChanges, type FeaturePhase, type Adapter, type AiRuntime, type BaselineHandle, type Feature, type TargetItem, type Plan, type RequirementsDoc, type SecretRegistry, type StoryProgress, type TechDesign } from "@graftlab/shared";
import { z } from "zod";
import type { ContainerManager } from "../containers/manager.ts";
import { issueProxyCredential, PROXY_APP_SECRET_NAME } from "../proxy/credential.ts";
import { appCallsSince, lastCallNumber, parseProxyLog } from "../proxy/usageLog.ts";
import { compareRuns, parseDjango, type SuiteRun } from "../verifier/regression.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import { roleText, sharedSystemPrompt } from "../roles/rules.ts";
import type { TurnOptions, TurnResult } from "../runtime/pi.ts";
import { runCodeAttempt } from "../runtime/pi-code.ts";
import type { NodeHandler } from "../tasks/runner.ts";
import { abandonFeature, addStudioFiles, changedOnMain, commitFeature, createWorktree, discardPaths, mainSummary, pathsAt, pathsOnMain, diffWorktree, mergeFeature, type LineStat, mirrorSourceFromEnv, notIgnored, snapshotWorktree, startFeature, writePatchArtifact, type FeatureBranch, type Worktree } from "../worktree/worktree.ts";
import { writeFeatureContext } from "./context.ts";
import { renderDetail } from "../planning/render.ts";
import { buildFocusPack, readPaths } from "./focus.ts";
import type { MemoTree } from "../reader/memo.ts";
import { generateSecretEnv, targetClient } from "../containers/sandbox.ts";
import { runBrowserCheck } from "../verifier/browser.ts";
import { runReadback, snapshot } from "../verifier/readback.ts";

type Ctx = Parameters<NodeHandler>[0];

export interface DevStageOptions {
  dataDir: string;
  manager: ContainerManager;
  secrets: SecretRegistry;
  devImage: string;
  adapter: Adapter;
  /** The real LLM settings; only the LLM_Proxy container receives the key. */
  llm: { baseUrl: string; apiKey: string; model: string; reasoningParam: string; reasoningEffort: string };
  rules: RuntimeRules;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel" | "emit">) => Promise<TurnResult>;
  context: () => string;
  plan: () => Plan;
  design: () => TechDesign;
  requirements: () => RequirementsDoc | undefined;
  /** The Repo_Memo of this Task (the summaries the focus pack points with). */
  memo: () => MemoTree | null;
  /** The Frozen Decision_Doc's AI runtime (R15.12). */
  aiRuntime: () => AiRuntime | undefined;
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/**
 * A command as an argument list; a single element with spaces ("python manage.py test x") is split into words, as
 * models often write it that way (found 2026-11-24: the whole command was taken as one program name).
 */
export const shellCommand = (argv: string[]) => (argv.length === 1 && /\s/.test(argv[0]!.trim()) ? argv[0]!.trim().split(/\s+/) : argv).map(shq).join(" ");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);
/** The line counts of a diff with the planned marks of a Feature (R4.9). */
const fileRows = (f: Feature, changed: { status: string; path: string }[], stats: LineStat[]) =>
  changed.map((c) => {
    const st = stats.find((x) => x.path === c.path);
    return { path: c.path, status: c.status, added: st?.added ?? 0, removed: st?.removed ?? 0, planned: [...f.scope.files, ...f.tests.files].includes(c.path) || isTestPath(f, c.path) };
  });
/** The prewritten AI client libraries (R40.23), next to the Studio code. */
const LIBS_DIR = join(import.meta.dirname, "..", "..", "..", "..", "runtime-libs");
/**
 * Added lines outside the AI client that call a chat endpoint or read the GL_AI_* variables themselves (R40.23): the
 * endpoint or the variable name as a string literal, so a comment or docstring that mentions them does not count.
 */
export function ownModelClients(patch: string, clientDir: string | undefined): string[] {
  const hits = new Set<string>();
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    else if (line.startsWith("+") && !line.startsWith("+++") && /["'][^"']*chat\/completions[^"']*["']|["']GL_AI_(BASE_URL|API_KEY|MODEL)["']/.test(line) && !(clientDir && file.startsWith(`${clientDir}/`)) && !/(^|\/)tests?\//.test(file)) hits.add(file);
  }
  return [...hits];
}
const patchPayload = (patch: string) => (patch.length > PATCH_MAX ? { patch: patch.slice(0, PATCH_MAX), patchTruncated: true } : { patch });

export class DevStage {
  #wt: Worktree | null = null;
  #dev: string | null = null;
  #credential: string | null = null;
  /** The changed app's own proxy credential, so its calls are counted apart from the agents' (R22.11). */
  #appCredential: string | null = null;
  /** The Test_Agent's commit and files per Feature (R40.20, R40.21). */
  #tests = new Map<string, { commit: string; files: string[]; patch: string }>();
  /** Protected test files a Code_Agent attempt changed; the review sends the attempt back by code (R40.21). */
  #protectedHit: string[] = [];
  /** The whole suite at the pinned commit, started at target_check (R22.10). */
  #baseline: Promise<{ run: SuiteRun; cached: boolean } | null> | null = null;
  #relayPort: number | null = null;
  #branch: FeatureBranch | null = null;
  #lastDiff: { files: string[]; patch: string; testFiles: string[]; testsPatch: string } | null = null;
  #feedback = new Map<string, string[]>();
  /** R40.24: every question about a Feature and its answer, for the later agents and the Reviewer of that Feature. */
  #answers = new Map<string, { from: string; question: string; by: string; answer: string }[]>();
  #pendingQuestion: string | null = null;
  /** The provisioned Run_Environment of the current story: generated secrets, credentials, state after the seed. */
  #app: { name: string; secretEnv: Record<string, string>; credentials: Record<string, string>; preState: TargetItem[] } | null = null;
  #runs = 0;

  constructor(private readonly o: DevStageOptions) {}

  /**
   * The changed software's model (R15.12, R38.4): with an outside source and the Judge's consent the run and test
   * containers get internet access and the GL_AI_* variables. The Studio's own service is reached through the
   * LLM_Proxy with the per-Task credential, so the real key never enters these containers either.
   */
  #aiAccess(): { env: Record<string, string>; egress: boolean } {
    const ai = this.o.aiRuntime();
    if (!ai || ai.source === "local") return { env: {}, egress: false };
    if (ai.source === "studio_service") return { env: { GL_AI_BASE_URL: "http://llm-proxy:8787/v1", GL_AI_API_KEY: this.#appCredential ?? "", GL_AI_MODEL: this.o.llm.model }, egress: true };
    return { env: { GL_AI_BASE_URL: ai.endpoint ?? "", GL_AI_API_KEY: "", GL_AI_MODEL: "" }, egress: true };
  }

  #feature(ctx: Ctx): Feature {
    const id = ctx.task.currentStoryId;
    const f = this.o.design().breakdown.features.find((x) => x.id === id);
    if (!f) throw new Error(`no Feature ${id ?? "(none)"} in the technical design`);
    return f;
  }

  /** One phase change on the development whiteboard (R1.10), written by code. */
  async #status(ctx: Ctx, f: Pick<Feature, "id" | "storyId">, status: FeaturePhase, reason?: string): Promise<void> {
    const attempt = ctx.task.stories.find((s) => s.storyId === f.id)?.attempts ?? 0;
    await ctx.emit({ type: "feature_status", actor: { kind: "system" }, payload: { featureId: f.id, storyId: f.storyId, status, attempt, ...(reason ? { reason: reason.slice(0, 300) } : {}) } });
  }

  #setStory(ctx: Ctx, id: string, p: Partial<StoryProgress>): void {
    ctx.patch({ stories: ctx.task.stories.map((s) => (s.storyId === id ? { ...s, ...p } : s)) });
  }

  /** target_check (R13.4, R25.8): engine, images, Worktree, LLM_Proxy with the relay, Development_Sandbox. */
  async targetCheck(ctx: Ctx): Promise<"done" | "failed"> {
    const m = this.o.manager;
    const step = async (what: string, fn: () => Promise<unknown>) => {
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: what, evidence: [], evidenceStatus: "none" } });
      await fn();
    };
    try {
      if (!(await m.docker.ping())) throw new Error("no container engine answered");
      await step("Checking the development image", () => m.verifyImage(this.o.devImage));
      const src = mirrorSourceFromEnv(this.o.adapter.id);
      await step("Preparing a private copy of the code at the reviewed commit", async () => {
        this.#wt = await createWorktree(this.o.dataDir, ctx.task.taskId, { adapterId: this.o.adapter.id, upstreamUrl: this.o.adapter.source.upstreamUrl, commit: this.o.adapter.source.commit, ...(src ? { source: src } : {}) });
        const bad = await notIgnored(this.#wt, this.o.adapter.devSandbox.prebuilt);
        if (bad.length) throw new Error(`prebuilt paths not ignored by the target: ${bad.join(", ")}`);
      });
      const lib = this.o.adapter.aiClient;
      if (lib) {
        await step("Adding the Studio's AI client library to the code (Studio-provided, not generated)", async () => {
          const src = join(LIBS_DIR, lib.language, "graftlab_ai");
          const names = (await readdir(src)).filter((n) => n.endsWith(".py"));
          const files = await Promise.all(names.map(async (n) => ({ path: `${lib.dir}/${n}`, content: await readFile(join(src, n), "utf8") })));
          await addStudioFiles(this.#wt!, files, `Studio-provided: graftlab_ai client (${relative(LIBS_DIR, src)})`);
        });
      }
      const port = this.o.design().architecture.runEnvironment?.port;
      await step("Starting the LLM_Proxy (the only holder of the model key)", async () => {
        this.#credential = issueProxyCredential(this.o.secrets);
        this.#appCredential = issueProxyCredential(this.o.secrets, PROXY_APP_SECRET_NAME);
        const p = await m.startProxy(ctx.task.taskId, { image: this.o.devImage, credential: this.#credential, appCredential: this.#appCredential, upstreamUrl: this.o.llm.baseUrl, upstreamKey: this.o.llm.apiKey, ...(port ? { relayTarget: `app:${port}` } : {}) });
        this.#relayPort = p.relayHostPort;
      });
      await step("Starting the Development_Sandbox", async () => {
        const contextDir = join(this.o.dataDir, "tasks", ctx.task.taskId, "context");
        await mkdir(contextDir, { recursive: true });
        this.#dev = (await m.startDevSandbox(ctx.task.taskId, { image: this.o.devImage, workDir: this.#wt!.path, contextDir, prebuilt: this.o.adapter.devSandbox.prebuilt, env: this.o.adapter.devSandbox.env ?? {} })).name;
      });
      ctx.patch({ targetCheckPassed: true });
      if (this.o.adapter.regression) {
        // The pinned commit is copied now, before any Feature changes the Worktree; the suite runs in the background.
        const snap = await snapshotWorktree(this.o.dataDir, this.#wt!, `regression-base-${Date.now()}`);
        this.#baseline = this.#runBaseline(ctx, snap.path).catch(() => null);
      }
      const all = this.o.design().breakdown.features;
      for (const f of all) {
        // Run and demo only for the last Feature of a story that has something to show (R21.10).
        const lastOfStory = all.filter((x) => x.storyId === f.storyId).at(-1)?.id === f.id;
        const demo = lastOfStory && ctx.task.stories.find((s) => s.storyId === f.id)?.demo !== false;
        const phases: FeaturePhase[] = ["testing", "building", "reviewing", ...(demo ? (["running", "demo"] as const) : []), "verifying", "merged"];
        await ctx.emit({ type: "feature_status", actor: { kind: "system" }, payload: { featureId: f.id, storyId: f.storyId, status: "todo", attempt: 0, phases } });
      }
      return "done";
    } catch (e) {
      await ctx.fail("interface_call_failure", "docker", `the development environment could not start: ${(e as Error).message}`);
      return "failed";
    }
  }

  /** story_develop: one Code_Agent attempt on the Feature's branch, then the change is recorded (R38.5, R40.5). */
  async develop(ctx: Ctx): Promise<"done" | "failed" | "question" | "retry_limit" | "needs_tests"> {
    const cur = currentStory(ctx.task);
    if (!cur || cur.status !== "in_progress") {
      // A Feature that builds on a blocked or failed Feature cannot be built: it is blocked by code (found 2026-11-25:
      // the next Feature read a store the blocked one should have added and ran out of time).
      const features = this.o.design().breakdown.features;
      for (;;) {
        const cand = currentStory(ctx.task)?.status === "pending" ? currentStory(ctx.task)! : (nextPendingStory(ctx.task) ?? ctx.task.stories.find((s) => s.status === "pending"));
        if (!cand) break;
        const f = features.find((x) => x.id === cand.storyId);
        const missing = (f?.dependsOn ?? []).filter((d) => ctx.task.stories.find((s) => s.storyId === d)?.status !== "verified");
        if (!f || missing.length === 0) break;
        this.#setStory(ctx, cand.storyId, { status: "blocked" });
        await this.#status(ctx, f, "blocked", `it builds on ${missing.join(", ")}, which was not built`);
        await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}" is blocked: it builds on ${missing.join(", ")}, which was not built`, evidence: [], evidenceStatus: "none" } });
      }
      const now = currentStory(ctx.task);
      const next = now && now.status === "pending" ? now : nextPendingStory(ctx.task) ?? ctx.task.stories.find((s) => s.status === "pending");
      if (!next) {
        await ctx.fail("interface_call_failure", "persistence", "no Feature is left to develop: the remaining ones build on Features that were not built");
        return "failed";
      }
      ctx.patch({ currentStoryId: next.storyId });
      this.#setStory(ctx, next.storyId, { status: "in_progress" });
    }
    const f = this.#feature(ctx);
    const wt = this.#wt!;
    // Test first (R40.20): a Feature without the Test_Agent's tests goes to story_test before any code is written.
    if (!this.#tests.has(f.id)) {
      this.#branch = await startFeature(wt, f.id);
      return "needs_tests";
    }
    const progress = currentStory(ctx.task)!;
    if (progress.attempts >= ctx.task.limits.storyAttempts) return "retry_limit";
    const attempt = progress.attempts + 1;
    this.#setStory(ctx, f.id, { attempts: attempt });
    this.#branch = await startFeature(wt, f.id);
    const tests = this.#tests.get(f.id)!;
    await this.#status(ctx, f, "building");
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    const contextDir = await writeFeatureContext(this.o.dataDir, ctx.task.taskId, { featureId: f.id, plan: this.o.plan(), design: this.o.design(), protectedTests: tests.files, ...(this.o.adapter.aiClient ? { aiClient: this.o.adapter.aiClient.dir } : {}), ...(this.#answers.get(f.id)?.length ? { answers: this.#answers.get(f.id)! } : {}), ...(this.o.requirements() ? { requirements: this.o.requirements()! } : {}), ...(this.#feedback.get(f.id) ? { previousFeedback: this.#feedback.get(f.id)! } : {}) }, roleText(this.o.rules, "code_agent"));
    const focus = await this.#focus(f, contextDir);
    await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}", attempt ${attempt}: the Code_Agent starts on its own branch`, evidence: [], evidenceStatus: "none" } });
    const tools: { tool: string; inputSummary: string }[] = [];
    const r = await this.#runAgent(ctx, f, { agent: "code_agent", rulesFile: "rules.md", prompt: `Read /context/${f.id}/story.md and build the Feature it describes.`, tools, idPrefix: `${ctx.task.taskId}-${f.id}-a${attempt}`, budgetMs: this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!.featureContract.budgets.maxCodeAgentMinutes * 60_000 });
    if (r.outcome !== "completed") {
      if (ctx.signal.aborted) return "failed";
      await this.#status(ctx, f, "failed", r.detail ?? r.outcome);
      await ctx.fail(r.outcome === "budget_exceeded" ? "budget_exceeded" : "interface_call_failure", "code_agent", `Feature ${f.id}, attempt ${attempt}: ${r.detail ?? r.outcome}`);
      return "failed";
    }
    // Record the change of this attempt against the Test_Agent's commit; the review sees tests and code (R38.5, R40.22).
    const diff = await diffWorktree(wt, tests.commit);
    const changed = diff.changedFiles.map((c) => c.path);
    this.#protectedHit = changed.filter((p) => tests.files.includes(p));
    this.#lastDiff = { files: changed, patch: diff.patch, testFiles: tests.files, testsPatch: tests.patch };
    const dir = join(this.o.dataDir, "tasks", ctx.task.taskId, "docs", "patches");
    await mkdir(dir, { recursive: true });
    const ref = `docs/patches/${f.id}-attempt${attempt}.diff`;
    await writeFile(join(this.o.dataDir, "tasks", ctx.task.taskId, ref), diff.patch);
    await ctx.emit({ type: "code_change", actor: { kind: "code_agent" }, payload: { storyId: f.id, attempt, changedFiles: changed, diffRef: ref, by: "code_agent", files: fileRows(f, diff.changedFiles, diff.stats), ...patchPayload(diff.patch) } });
    // Focus measurement (R40.19): how much of what the Code_Agent read and changed the pack pointed at.
    const inPack = new Set(focus.files);
    const reads = readPaths(tools).filter((p) => !p.startsWith("/context/"));
    const planned = new Set([...f.scope.files, ...f.tests.files]);
    await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Focus of ${f.id}, attempt ${attempt}: read ${reads.length} files, ${reads.filter((p) => inPack.has(p)).length} of them in the focus pack; changed ${changed.length} files, ${changed.filter((p) => planned.has(p)).length} of them planned`, evidence: [], evidenceStatus: "none" } });
    if (changed.length === 0) {
      await this.#status(ctx, f, "failed", "the Code_Agent changed no file");
      await ctx.fail("interface_call_failure", "code_agent", `Feature ${f.id}, attempt ${attempt}: the Code_Agent changed no file`);
      return "failed";
    }
    return "done";
  }

  /**
   * story_test (R40.20, R22.12): the Test_Agent writes the Feature's tests before the code. Studio code refuses
   * non-test files, commits the tests on the Feature branch and runs the red check; one visible retry.
   */
  async testFirst(ctx: Ctx): Promise<"done" | "failed"> {
    const f = this.#feature(ctx);
    const wt = this.#wt!;
    this.#branch = await startFeature(wt, f.id);
    const base = this.#branch.base;
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    let reason: string | null = null;
    for (let tryNo = 1; tryNo <= 2; tryNo++) {
      await this.#status(ctx, f, "testing", tryNo > 1 ? `second try: ${reason}` : undefined);
      const contextDir = await writeFeatureContext(this.o.dataDir, ctx.task.taskId, { featureId: f.id, plan: this.o.plan(), design: this.o.design(), ...(this.o.adapter.aiClient ? { aiClient: this.o.adapter.aiClient.dir } : {}), ...(this.#answers.get(f.id)?.length ? { answers: this.#answers.get(f.id)! } : {}), ...(this.o.requirements() ? { requirements: this.o.requirements()! } : {}), ...(reason ? { previousFeedback: [reason] } : {}) }, roleText(this.o.rules, "test_agent"), "rules-test.md");
      await this.#focus(f, contextDir);
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}": the Test_Agent writes the tests first${tryNo > 1 ? " (second try)" : ""}`, evidence: [], evidenceStatus: "none" } });
      const r = await this.#runAgent(ctx, f, { agent: "test_agent", rulesFile: "rules-test.md", prompt: `Read /context/${f.id}/story.md and write the tests of the Feature it describes. Write only test files; the code does not exist yet.`, tools: [], idPrefix: `${ctx.task.taskId}-${f.id}-t${tryNo}`, budgetMs: Math.min(15, story.featureContract.budgets.maxCodeAgentMinutes) * 60_000 });
      if (r.outcome !== "completed") {
        if (ctx.signal.aborted) return "failed";
        await this.#status(ctx, f, "failed", r.detail ?? r.outcome);
        await ctx.fail(r.outcome === "budget_exceeded" ? "budget_exceeded" : "interface_call_failure", "code_agent", `Feature ${f.id}, Test_Agent: ${r.detail ?? r.outcome}`);
        return "failed";
      }
      const diff = await diffWorktree(wt, base);
      const refused = diff.changedFiles.map((c) => c.path).filter((p) => !isTestPath(f, p));
      if (refused.length) {
        // The refused files are put back, so the Code_Agent starts from tests only (R40.20).
        await discardPaths(wt, base, refused);
        await ctx.emit({ type: "failure", actor: { kind: "system" }, payload: { failureClass: "rejected_by_safety_rule", source: "code_agent", detail: `the Test_Agent may change only test files; refused and put back: ${refused.join(", ").slice(0, 300)}` } });
      }
      const kept = await diffWorktree(wt, base);
      const files = kept.changedFiles.map((c) => c.path);
      if (files.length === 0) {
        reason = "no test file was written; write the Feature's tests";
        await ctx.emit({ type: "failure", actor: { kind: "system" }, payload: { failureClass: "llm_output_format_invalid", source: "code_agent", detail: `Feature ${f.id}: the Test_Agent wrote no test file${tryNo < 2 ? "; one visible retry" : ""}` } });
        continue;
      }
      const commit = await commitFeature(wt, this.#branch, `${f.id}: tests (Test_Agent)${tryNo > 1 ? ", second try" : ""}`);
      const dir = join(this.o.dataDir, "tasks", ctx.task.taskId, "docs", "patches");
      await mkdir(dir, { recursive: true });
      const ref = `docs/patches/${f.id}-tests${tryNo}.diff`;
      await writeFile(join(this.o.dataDir, "tasks", ctx.task.taskId, ref), kept.patch);
      await ctx.emit({ type: "code_change", actor: { kind: "test_agent" }, payload: { storyId: f.id, attempt: tryNo, changedFiles: files, diffRef: ref, by: "test_agent", files: fileRows(f, kept.changedFiles, kept.stats), ...patchPayload(kept.patch) } });
      // The red check: the tests must fail before the code exists (R22.12), in a fresh test container.
      const snap = await snapshotWorktree(this.o.dataDir, wt, `${f.id}-red${tryNo}-${Date.now()}`);
      const t = await this.o.manager.runTests(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, command: shellCommand(f.tests.command), timeoutS: 600, env: { ...(this.o.adapter.devSandbox.env ?? {}) } });
      const summary = t.output.trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300);
      const red = !t.timedOut && t.code !== 0;
      await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: f.id, checkId: `${f.id}-red${tryNo > 1 ? "-2" : ""}`, pass: red, items: [{ item: `Tests fail before the code exists (red): ${f.tests.command.join(" ")}`, pass: red, expected: "a non-zero exit code", actual: t.timedOut ? "timed out after 600 s" : `exit code ${t.code}${summary ? `: ${summary}` : ""}` }] } });
      if (red && commit) {
        this.#tests.set(f.id, { commit, files, patch: kept.patch });
        return "done";
      }
      reason = t.timedOut ? "the tests did not finish within 600 s" : "the tests already pass without the Feature, so they test nothing new; test the Feature's new behavior";
    }
    await this.#status(ctx, f, "failed", reason ?? "no valid tests");
    await ctx.fail("llm_output_format_invalid", "code_agent", `Feature ${f.id}: no valid red tests after one visible retry (${reason})`);
    return "failed";
  }

  /** The focus pack (R40.19): a map of where to look, built now from the summaries and the current main. */
  async #focus(f: Feature, contextDir: string): Promise<{ files: string[] }> {
    const wt = this.#wt!;
    const focus = buildFocusPack({
      feature: f,
      design: this.o.design(),
      memo: this.o.memo(),
      read: (p) => {
        try {
          return readFileSync(join(wt.path, p), "utf8");
        } catch {
          return undefined;
        }
      },
      paths: await pathsOnMain(wt),
      changedSincePinned: await changedOnMain(wt),
    });
    await writeFile(join(contextDir, "focus.md"), focus.text);
    return focus;
  }

  /** One run of an in-container agent (Code_Agent or Test_Agent) with the same runner and the proxy (R40.20). */
  #runAgent(ctx: Ctx, f: Feature, o: { agent: "code_agent" | "test_agent"; rulesFile: string; prompt: string; tools: { tool: string; inputSummary: string }[]; idPrefix: string; budgetMs: number }) {
    return runCodeAttempt({
      agent: o.agent,
      start: () =>
        this.o.manager.docker.execAttach(this.#dev!, ["node", "/opt/runner/runner.mjs"], {
          workdir: "/work",
          env: {
            GL_PROXY_BASE: "http://llm-proxy:8787/v1",
            GL_PROXY_CREDENTIAL: this.#credential!,
            GL_MODEL_ID: this.o.llm.model,
            GL_REASONING_PARAM: this.o.llm.reasoningParam,
            GL_REASONING_EFFORT: this.o.llm.reasoningEffort,
            GL_RULES_FILE: `/context/${f.id}/${o.rulesFile}`,
            GL_CONTEXT_FILES: `/context/${f.id}/focus.md`,
            WORK_DIR: "/work",
          },
        }),
      prompt: o.prompt,
      emit: async (e) => {
        if (e.type === "tool_started") o.tools.push(e.payload as { tool: string; inputSummary: string });
        await ctx.emit(e);
      },
      onQuestion: (q) => this.#answer(ctx, f, q, o.agent),
      budgetMs: o.budgetMs,
      signal: ctx.signal,
      idPrefix: o.idPrefix,
    });
  }

  /** A question from the running Code_Agent or Test_Agent: technical to the Reviewer, feature to the Judge (R40.8, R40.13). */
  async #answer(ctx: Ctx, f: Feature, q: { questionId: string; kind: "technical" | "feature"; text: string; options?: string[] }, from: "code_agent" | "test_agent" = "code_agent"): Promise<string> {
    const askedParty = q.kind === "technical" ? "reviewer" : "judge";
    const who = from === "test_agent" ? "Test_Agent writing the tests of" : "Code_Agent building";
    await ctx.emit({ type: "question_opened", actor: { kind: from }, payload: { questionId: q.questionId, from, askedParty, kind: q.kind, text: q.text, featureId: f.id } });
    let answer: string;
    if (q.kind === "technical") {
      let got = "";
      const tool: AgentTool<any> = { name: "answer_question", label: "answer_question", description: "Answer the agent's technical question.", parameters: obj({ answer: str() }), execute: async (_i, a: { answer: string }) => ((got = String(a.answer ?? "").trim()), { ...text(got ? "Sent." : "Empty answer."), terminate: !!got }) };
      await this.o.runTurn({ roleId: "reviewer", purpose: "review", systemPrompt: sharedSystemPrompt(this.o.rules, this.o.context()), prompt: `# Your role\n\n${roleText(this.o.rules, "reviewer")}\n\n---\n\nThe ${who} Feature ${f.id} "${f.title}" (${f.summary}) asks a technical question:\n\n${q.text}${q.options?.length ? `\n\nOptions: ${q.options.join("; ")}` : ""}\n\nAnswer it in at most 120 words with answer_question, staying inside the Feature's scope and the technical design.`, tools: [tool], signal: ctx.signal, idPrefix: `${ctx.task.taskId}-${f.id}-q`, thinkingLevel: "low", emit: ctx.emit });
      answer = got || "No technical answer was given; follow the technical design and keep the change inside the Feature.";
    } else {
      const a = await ctx.askJudgeFor({ kind: "question", title: "The developer has a question about the feature", body: q.text, options: (q.options ?? []).slice(0, 4).map((o, i) => ({ id: `o${i + 1}`, label: o })), allowFreeText: true }, 300_000);
      answer = a ? (q.options?.[Number((a.optionId ?? "").slice(1)) - 1] ?? a.text ?? "") : "No answer within 5 minutes; keep the simplest behaviour that meets the Feature_Contract.";
    }
    await ctx.emit({ type: "question_answered", actor: askedParty === "judge" ? { kind: "judge" } : { kind: "role", roleId: "reviewer" }, payload: { questionId: q.questionId, answer } });
    this.#answers.set(f.id, [...(this.#answers.get(f.id) ?? []), { from: from === "test_agent" ? "Test_Agent" : "Code_Agent", question: q.text.slice(0, 600), by: askedParty === "judge" ? "the Judge" : "Reviewer", answer: answer.slice(0, 800) }]);
    return answer;
  }

  /** story_review (R40.6-R40.10): the Reviewer judges the diff against the Feature and the contract. */
  async review(ctx: Ctx): Promise<"approve" | "request_changes" | "escalate" | "failed"> {
    const f = this.#feature(ctx);
    const d = this.#lastDiff;
    if (!d) {
      await ctx.fail("interface_call_failure", "persistence", "there is no change to review");
      return "failed";
    }
    const attempt = currentStory(ctx.task)!.attempts;
    // R40.21 (decided by the user 2026-11-24): when the Code_Agent changes a Test_Agent test, the flow follows the
    // Code_Agent, records it visibly, and the Reviewer must justify each changed test to approve.
    const changedTests = this.#protectedHit;
    this.#protectedHit = [];
    if (changedTests.length)
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `The Code_Agent changed tests the Test_Agent wrote: ${changedTests.join(", ")}. The flow follows the Code_Agent; the Reviewer must justify each change to approve.`, evidence: [], evidenceStatus: "none" } });
    await this.#status(ctx, f, "reviewing");
    const ownClients = ownModelClients(d.patch, this.o.adapter.aiClient?.dir);
    if (ownClients.length)
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `The change calls the model or reads GL_AI_* outside the Studio's AI client in ${ownClients.join(", ")}; the Reviewer must justify it or request changes.`, evidence: [], evidenceStatus: "none" } });
    const unplanned = [...new Set([...unplannedChanges(f, d.files), ...changedTests, ...ownClients])];
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    let verdict: { verdict: "approve" | "request_changes" | "escalate"; reasons: string[] } | null = null;
    const Verdict = z.object({ verdict: z.enum(["approve", "request_changes", "escalate"]), reasons: z.array(z.string()).default([]), justified: z.array(z.object({ file: z.string(), reason: z.string() })).default([]) });
    const tools: AgentTool<any>[] = [
      { name: "read_diff", label: "read_diff", description: "The full diff of this attempt: the Test_Agent's tests first, then the Code_Agent's change.", parameters: obj({}), execute: async () => text(`# Tests written first by the Test_Agent\n${cut(d.testsPatch, 30_000)}\n\n# The Code_Agent's change\n${cut(d.patch, 60_000)}`) },
      {
        name: "read_changed_file",
        label: "read_changed_file",
        description: "A file of the working copy as it is now: a changed file, or any other file for context (read-only).",
        parameters: obj({ path: str() }),
        execute: async (_i, a: { path: string }) => {
          const rel = String(a.path ?? "").replace(/^\/+/, "").replace(/^work\//, "");
          if (!rel || rel.split(/[\\/]/).includes("..") || rel.startsWith(".git")) return text(`${a.path} is not a path inside the working copy`, true);
          const changed = d.files.includes(rel) || d.testFiles.includes(rel);
          const body = await readFile(join(this.#wt!.path, rel), "utf8").catch(() => null);
          if (body === null) return text(changed ? "(deleted in this attempt)" : `${rel} does not exist`, !changed);
          return text(`${changed ? "" : "(unchanged file, for context)\n"}${cut(body, 40_000)}`);
        },
      },
      {
        name: "submit_review_verdict",
        label: "submit_review_verdict",
        description: "approve, request_changes or escalate, with reasons; justify every unplanned file to approve.",
        parameters: obj({ verdict: oneOf(["approve", "request_changes", "escalate"] as const), reasons: arr(str()), justified: opt(arr(obj({ file: str(), reason: str() }))) }),
        execute: async (_i, a: unknown) => {
          const p = Verdict.safeParse(a);
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.message}. Submit again.`, true);
          const missing = unplanned.filter((u) => !p.data.justified.some((j) => j.file === u && j.reason.trim()));
          if (p.data.verdict === "approve" && missing.length) return text(`Not accepted: to approve, justify every unplanned change: ${missing.join(", ")}. Or request changes.`, true);
          if (p.data.verdict !== "approve" && p.data.reasons.length === 0) return text("Not accepted: give at least one reason.", true);
          verdict = { verdict: p.data.verdict, reasons: [...p.data.reasons, ...p.data.justified.map((j) => `unplanned ${j.file}: ${j.reason}`)] };
          return { ...text("Accepted."), terminate: true };
        },
      },
    ];
    const prompt = [
      `# Your role\n\n${roleText(this.o.rules, "reviewer")}`,
      `# Feature ${f.id}: ${f.title} (story ${story.id} "${story.title}")\n${f.summary}\n\nPlanned files: ${f.scope.files.join(", ")}\nTests: ${f.tests.files.join(", ")} — command: ${f.tests.command.join(" ")}\nMust not touch: ${f.scope.notTouch.join("; ") || "nothing named"}\nInterfaces: ${f.interfaces.join("; ") || "none named"}${f.detail ? `\n\n${renderDetail(f.detail)}\nCheck that tests and code follow this detail design, in particular the answer shapes of the model calls.` : ""}`,
      ...(this.#answers.get(f.id)?.length ? [`# Questions asked about this Feature and their answers\n${this.#answers.get(f.id)!.map((a) => `- ${a.from}: ${a.question}\n  ${a.by}: ${a.answer}`).join("\n")}`] : []),
      `# Feature_Contract\n${story.featureContract.feature}\nShould do: ${story.featureContract.shouldDo.join("; ")}\nShould not do: ${story.featureContract.shouldNotDo.join("; ")}`,
      `# This attempt (${attempt})\nTests written first by the Test_Agent (review them too): ${d.testFiles.join(", ")}\nChanged by the Code_Agent: ${d.files.join(", ")}\nUnplanned changes found by Studio code: ${unplanned.length ? unplanned.join(", ") : "none"}${changedTests.length ? `\nTests of the Test_Agent changed by the Code_Agent (justify each, or request changes): ${changedTests.join(", ")}` : ""}${ownClients.length ? `\nOwn model client outside graftlab_ai (justify, or request changes so it uses graftlab_ai): ${ownClients.join(", ")}` : ""}`,
      "Read the diff, then submit_review_verdict. Tell the Judge in at most 60 words what you decided.",
    ].join("\n\n---\n\n");
    const r = await this.o.runTurn({ roleId: "reviewer", purpose: "review", systemPrompt: sharedSystemPrompt(this.o.rules, this.o.context()), prompt, tools, signal: ctx.signal, idPrefix: `${ctx.task.taskId}-${f.id}-r${attempt}`, thinkingLevel: "low", emit: ctx.emit });
    const v = verdict as { verdict: "approve" | "request_changes" | "escalate"; reasons: string[] } | null;
    if (!v) {
      if (ctx.signal.aborted) return "failed";
      await ctx.fail("llm_output_format_invalid", "llm", `the Reviewer gave no valid verdict on Feature ${f.id} (${r.error ?? "no submission"})`);
      return "failed";
    }
    await ctx.emit({ type: "review_verdict", actor: { kind: "role", roleId: "reviewer" }, payload: { storyId: f.id, attempt, verdict: v.verdict, reasons: v.reasons, label: "reviewed by Reviewer (LLM judgment)" } });
    if (v.verdict === "request_changes") this.#feedback.set(f.id, v.reasons);
    if (v.verdict === "escalate") this.#pendingQuestion = v.reasons.join("; ");
    return v.verdict;
  }

  /** story_ask (R40.12, R40.14): retry limit or escalation; the Judge answers, or the Feature is blocked. */
  async ask(ctx: Ctx): Promise<"answered" | "unanswered"> {
    const f = this.#feature(ctx);
    const reason = this.#pendingQuestion ?? `the Feature "${f.title}" did not pass the review after ${currentStory(ctx.task)?.attempts ?? 0} attempts`;
    this.#pendingQuestion = null;
    const a = await ctx.askJudgeFor({ kind: "question", title: `The team needs your decision on "${f.title}"`, body: `${reason}\n\nWrite what should change, or leave it: without an answer the Feature is blocked and the next one starts.`, options: [], allowFreeText: true }, 290_000);
    if (a?.text?.trim()) {
      this.#feedback.set(f.id, [...(this.#feedback.get(f.id) ?? []), `The Judge: ${a.text.trim()}`]);
      return "answered";
    }
    this.#setStory(ctx, f.id, { status: "blocked" });
    await this.#status(ctx, f, "blocked", "no answer from you; the next Feature starts");
    if (this.#branch) await abandonFeature(this.#wt!, this.#branch);
    return "unanswered";
  }

  /** story_run (R39.3-R39.11): the story's app from a snapshot, in a fresh Run_Environment, health through the relay. */
  async run(ctx: Ctx): Promise<"done" | "failed"> {
    const f = this.#feature(ctx);
    const re = this.o.design().architecture.runEnvironment;
    if (!re || !this.#relayPort) {
      await ctx.fail("interface_call_failure", "docker", "the technical design has no run environment, so the changed app cannot be started");
      return "failed";
    }
    const attempt = currentStory(ctx.task)!.attempts;
    await this.#status(ctx, f, "running");
    const snap = await snapshotWorktree(this.o.dataDir, this.#wt!, `${f.id}-${attempt}-run`);
    await ctx.emit({ type: "artifact_updated", actor: { kind: "system" }, payload: { artifactKind: "worktree_handoff", ref: snap.commit, title: `Snapshot of ${f.id} for the app run` } });
    const m = this.o.manager;
    await m.docker.stopContainer(this.#dev!, 5).catch(() => undefined); // memory: the Development_Sandbox pauses
    // One script line per command under `set -e`; joining with && broke on a start command ending in &.
    const { name } = await m.startRunEnvironment(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, commands: [...re.buildCommands, ...re.startCommands].join("\n"), env: { ...(this.o.adapter.devSandbox.env ?? {}), ...this.#aiAccess().env }, egress: this.#aiAccess().egress });
    const url = `http://127.0.0.1:${this.#relayPort}${re.healthPath}`;
    const end = Date.now() + 230_000;
    while (Date.now() < end && !ctx.signal.aborted) {
      const ok = await fetch(url, { signal: AbortSignal.timeout(3000) }).then((r) => r.status < 500, () => false);
      if (ok) {
        await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `The changed app answers on ${re.healthPath}`, evidence: [], evidenceStatus: "none" } });
        return (await this.#provision(ctx, name)) ? "done" : "failed";
      }
      const info = await m.docker.inspectContainer(name);
      if (!info?.State.Running) {
        const logs = await m.docker.logs(name, 30).catch(() => "");
        await ctx.fail("interface_call_failure", "docker", `the changed app stopped while starting (exit ${info?.State.ExitCode}): ${logs.trim().split("\n").slice(-5).join(" | ").slice(0, 400)}`);
        return "failed";
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
    await ctx.fail("interface_call_failure", "docker", `the changed app did not answer on ${re.healthPath} within 230 s`);
    return "failed";
  }

  /**
   * The Run_Environment starts from an empty database: Studio code creates the user and the API credential with the
   * Adapter's provision hook (generated values, registered with the redactor) and loads the fixed test data, so
   * browser and read-back checks have something to work on (R13.5, R29.1).
   */
  async #provision(ctx: Ctx, name: string): Promise<boolean> {
    const a = this.o.adapter;
    const gen = ++this.#runs;
    const secretEnv = generateSecretEnv(a.baseline.secretEnv);
    for (const [k, v] of Object.entries(secretEnv)) this.o.secrets.register(`run_${k.toLowerCase()}_${gen}`.slice(0, 41), v);
    const handle: BaselineHandle = { secretEnv, appDir: "/tmp/app", exec: (cmd, opts) => this.o.manager.docker.exec(name, cmd, opts ?? {}), recreate: async () => { throw new Error("a Run_Environment is not recreated in place"); } };
    try {
      const credentials: Record<string, string> = {};
      for (const c of await a.hooks.provision(handle)) {
        this.o.secrets.register(`run_${c.name}_${gen}`.slice(0, 41), c.value);
        credentials[c.name] = c.value;
      }
      const client = targetClient(a, this.#relayPort!, credentials);
      await a.hooks.testData.seed(client);
      this.#app = { name, secretEnv, credentials, preState: await snapshot(a, client) };
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: "Studio code created a user and loaded the fixed test data in the changed app", evidence: [], evidenceStatus: "none" } });
      return true;
    } catch (e) {
      await ctx.fail("interface_call_failure", "docker", `the changed app could not be prepared with the test data: ${(e as Error).message}`);
      return false;
    }
  }

  /** story_checkpoint (R21): the Judge looks at the story's demo point; no answer marks it Unconfirmed. */
  async checkpoint(ctx: Ctx): Promise<"confirmed" | "unconfirmed" | "feedback"> {
    const f = this.#feature(ctx);
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    const built = this.o.design().breakdown.features.filter((x) => x.storyId === story.id).map((x) => `- ${x.title}`).join("\n");
    await this.#status(ctx, f, "demo");
    const a = await ctx.askJudgeFor({ kind: "checkpoint", title: `"${story.title}" is running`, body: `What you should see: ${story.demoPoint.description}\n\nBuilt in this story:\n${built}\n\nThe changed app runs in its own container; the Verifier checks it next.`, options: [{ id: "confirm", label: "Looks right" }, { id: "feedback", label: "Something is off" }], allowFreeText: false, textRequiredFor: ["feedback"] }, 110_000);
    if (!a) {
      ctx.patch({ pendingUnconfirmed: [...ctx.task.pendingUnconfirmed, story.title] });
      this.#setStory(ctx, f.id, { unconfirmed: true });
      return "unconfirmed";
    }
    if (a.optionId === "feedback") {
      this.#feedback.set(f.id, [...(this.#feedback.get(f.id) ?? []), `The Judge at the demo: ${a.text ?? ""}`]);
      await this.#restartDev(ctx);
      return "feedback";
    }
    return "confirmed";
  }

  async #restartDev(ctx: Ctx): Promise<void> {
    this.#app = null;
    await this.o.manager.docker.removeContainer(`gl-${ctx.task.taskId}-run`).catch(() => undefined);
    await this.o.manager.docker.startContainer(this.#dev!).catch(() => undefined);
  }

  /** verifying (R22): the Feature's tests (and, for the story's last Feature, its test checks) by exit code; merge. */
  async verify(ctx: Ctx): Promise<"passed" | "failed"> {
    const f = this.#feature(ctx);
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    const last = !ctx.task.stories.some((s) => s.storyId !== f.id && s.parent === f.storyId && (s.status === "pending" || s.status === "in_progress"));
    const attempt = currentStory(ctx.task)!.attempts;
    await this.#status(ctx, f, "verifying");
    const snap = await snapshotWorktree(this.o.dataDir, this.#wt!, `${f.id}-${attempt}-test`);
    const checks: { id: string; command: string[]; timeoutS: number; label: string }[] = [{ id: `${f.id}-tests`, command: f.tests.command, timeoutS: 600, label: `Feature tests: ${f.tests.command.join(" ")}` }];
    const notRun: string[] = [];
    const appChecks = last ? story.featureContract.acceptanceChecks.filter((c) => c.kind !== "test_suite") : [];
    if (last)
      for (const c of story.featureContract.acceptanceChecks) if (c.kind === "test_suite") checks.push({ id: c.id, command: c.command, timeoutS: c.timeoutS, label: describeCheck(c) });
    let pass = true;
    for (const c of checks) {
      const r = await this.o.manager.runTests(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, command: shellCommand(c.command), timeoutS: c.timeoutS, env: { ...(this.o.adapter.devSandbox.env ?? {}), ...this.#aiAccess().env }, egress: this.#aiAccess().egress });
      const summary = r.output.trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 300);
      const ok = r.code === 0;
      pass &&= ok;
      await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: f.id, checkId: c.id, pass: ok, items: [{ item: c.label, pass: ok, expected: "exit code 0", actual: r.timedOut ? `timed out after ${c.timeoutS} s` : `exit code ${r.code}${summary ? `: ${summary}` : ""}` }] } });
    }
    // Checks against the running changed app (browser steps, API read-back); success is decided by code only.
    for (const c of appChecks) {
      const app = this.#app;
      if (c.target !== "run_environment" || !app || !this.#relayPort) {
        notRun.push(`${c.id} (${c.kind} against ${c.target}${app ? "" : ", the app is not running"})`);
        continue;
      }
      const baseUrl = `http://127.0.0.1:${this.#relayPort}`;
      if (c.kind === "browser_check") {
        const l = this.o.adapter.browserLogin;
        const shot = join(this.o.dataDir, "tasks", ctx.task.taskId, "artifacts", "shots", `${f.id}-${c.id}.jpg`);
        const counting = this.o.aiRuntime()?.source === "studio_service";
        const before = counting ? lastCallNumber(parseProxyLog(await this.o.manager.proxyLog(ctx.task.taskId).catch(() => ""))) : 0;
        const r = await runBrowserCheck({ baseUrl, check: c, screenshot: shot, ...(l ? { login: { path: l.path, usernameLabel: l.usernameLabel, passwordLabel: l.passwordLabel, submitLabel: l.submitLabel, username: app.secretEnv[l.usernameEnv] ?? "", password: app.secretEnv[l.passwordEnv] ?? "" } } : {}) }).catch((e: unknown) => ({ items: [{ item: "start the browser", pass: false, expected: "browser runs", actual: (e as Error).message.split("\n")[0]!.slice(0, 200) }], screenshot: null }));
        if (counting) {
          // R22.11: the app's own model calls during the steps, counted by the LLM_Proxy (code, not the page text).
          await new Promise((res) => setTimeout(res, 500));
          const u = appCallsSince(parseProxyLog(await this.o.manager.proxyLog(ctx.task.taskId).catch(() => "")), before);
          await ctx.emit({ type: "ai_usage", actor: { kind: "verifier" }, payload: { caller: "app", checkId: c.id, calls: u.calls, statuses: u.statuses, inputTokens: u.inputTokens, cachedTokens: u.cachedTokens, outputTokens: u.outputTokens } });
          const need = c.needsAi === true;
          r.items.push({ item: "the app called the AI service (counted by the LLM_Proxy)", pass: !need || u.ok > 0, expected: need ? "at least one successful call" : "counted", actual: `${u.calls} ${u.calls === 1 ? "call" : "calls"}${u.calls ? ` (status ${u.statuses.join(", ")})` : ""}, ${u.inputTokens} input and ${u.outputTokens} output tokens` });
        }
        const ok = r.items.every((i) => i.pass);
        pass &&= ok;
        if (r.screenshot) await ctx.emit({ type: "artifact_updated", actor: { kind: "verifier" }, payload: { artifactKind: "screenshot", ref: `artifacts/shots/${f.id}-${c.id}.jpg`, title: `Browser check ${c.id}` } });
        await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: f.id, checkId: c.id, pass: ok, items: r.items } });
      } else {
        const r = await runReadback(this.o.adapter, targetClient(this.o.adapter, this.#relayPort, app.credentials), c.expect, app.preState).catch((e: unknown) => ({ pass: false, items: [{ item: "read back", pass: false, expected: "read", actual: (e as Error).message.slice(0, 200) }] }));
        pass &&= r.pass;
        await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: f.id, checkId: c.id, pass: r.pass, items: r.items } });
      }
    }
    for (const n of notRun) {
      pass = false;
      await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: f.id, checkId: n.split(" ")[0]!, pass: false, items: [{ item: n, pass: false, expected: "check executed", actual: "this check kind is not built yet in this version" }] } });
    }
    if (!pass) {
      this.#setStory(ctx, f.id, { status: "failed" });
      await this.#status(ctx, f, "failed", "a Verifier check failed");
      if (this.#branch) await abandonFeature(this.#wt!, this.#branch);
      return "failed";
    }
    const merged = await mergeFeature(this.#wt!, this.#branch!, f.title);
    if (!merged.ok) {
      await ctx.fail("interface_call_failure", "persistence", merged.reason);
      this.#setStory(ctx, f.id, { status: "failed" });
      await this.#status(ctx, f, "failed", "the merge into main failed");
      return "failed";
    }
    await this.#status(ctx, f, "merged");
    await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}" merged into main`, evidence: [], evidenceStatus: "none" } });
    await writePatchArtifact(this.o.dataDir, this.#wt!, "TASK");
    this.#setStory(ctx, f.id, { status: "verified" });
    this.#lastDiff = null;
    if (last) await this.#restartDev(ctx);
    return "passed";
  }

  /** The whole suite at the pinned commit, cached per Adapter, commit and image (R22.10). */
  async #runBaseline(ctx: Ctx, snapshotDir: string): Promise<{ run: SuiteRun; cached: boolean } | null> {
    const reg = this.o.adapter.regression!;
    const img = (await this.o.manager.docker.imageInspect(this.o.devImage))?.Id ?? "unknown";
    const key = `${this.o.adapter.id}-${this.o.adapter.source.commit.slice(0, 12)}-${img.replace(/^sha256:/, "").slice(0, 12)}`;
    const file = join(this.o.dataDir, "cache", "regression", `${key}.json`);
    const hit = await readFile(file, "utf8").then((t) => JSON.parse(t) as SuiteRun, () => null);
    if (hit) return { run: hit, cached: true };
    const t = await this.o.manager.runTests(ctx.task.taskId, { image: this.o.devImage, snapshotDir, prebuilt: this.o.adapter.devSandbox.prebuilt, command: shellCommand(reg.suite), timeoutS: reg.timeoutS, env: { ...(this.o.adapter.devSandbox.env ?? {}) }, logTail: 200_000, suffix: "base" });
    const run = parseDjango(t.output, t.timedOut ? -1 : t.code);
    if (run.ran !== null && !t.timedOut) {
      await mkdir(join(this.o.dataDir, "cache", "regression"), { recursive: true });
      await writeFile(file, JSON.stringify(run));
    }
    return { run, cached: false };
  }

  /** regression_check (R22.10): the whole suite on main against the pinned commit, test by test; code only. */
  async regression(ctx: Ctx): Promise<"passed" | "failed"> {
    const wt = this.#wt!;
    const sum = await mainSummary(wt);
    await ctx.emit({ type: "change_summary", actor: { kind: "system" }, payload: { base: sum.base, head: sum.head, files: sum.files.map((x) => ({ path: x.path, status: x.status, added: x.added, removed: x.removed, ...(this.o.adapter.aiClient && x.path.startsWith(`${this.o.adapter.aiClient.dir}/`) ? { studio: true } : {}) })), added: sum.files.reduce((a, x) => a + x.added, 0), removed: sum.files.reduce((a, x) => a + x.removed, 0) } });
    await writePatchArtifact(this.o.dataDir, wt, "TASK");
    const reg = this.o.adapter.regression;
    if (!reg) {
      await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: "The Adapter names no whole test suite, so no Regression_Check ran", evidence: [], evidenceStatus: "none" } });
      return "passed";
    }
    await ctx.emit({ type: "finding_recorded", actor: { kind: "verifier" }, payload: { kind: "note", text: "Running the whole test suite on the changed code and comparing it with the pinned commit", evidence: [], evidenceStatus: "none" } });
    const snap = await snapshotWorktree(this.o.dataDir, wt, `regression-main-${Date.now()}`);
    const t = await this.o.manager.runTests(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, command: shellCommand(reg.suite), timeoutS: reg.timeoutS, env: { ...(this.o.adapter.devSandbox.env ?? {}), ...this.#aiAccess().env }, egress: this.#aiAccess().egress, logTail: 200_000 });
    const main = parseDjango(t.output, t.timedOut ? -1 : t.code);
    const base = (await this.#baseline) ?? null;
    const items: { item: string; pass: boolean; expected: string; actual: string }[] = [];
    if (!base || base.run.ran === null) {
      items.push({ item: "the whole suite at the pinned commit", pass: false, expected: "a test summary", actual: "the suite did not run at the pinned commit, so nothing can be compared" });
      await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: "TASK", checkId: "regression", pass: false, items } });
      return "failed";
    }
    const pinned = new Set(await pathsAt(wt, wt.base));
    const r = compareRuns(base.run, main, (p) => pinned.has(p), base.cached);
    await ctx.emit({ type: "regression_result", actor: { kind: "verifier" }, payload: r });
    items.push({ item: `whole suite at the pinned commit${base.cached ? " (cached)" : ""}`, pass: true, expected: "a test summary", actual: `${r.baseline.ran} tests, ${r.baseline.failed.length} failing before the change` });
    items.push({ item: "whole suite on the changed code", pass: main.ran !== null, expected: "a test summary", actual: main.ran === null ? (t.timedOut ? `timed out after ${reg.timeoutS} s` : `no summary (exit ${t.code})`) : `${r.main.ran} tests (${r.newTests >= 0 ? "+" : ""}${r.newTests} new), ${r.main.failed.length} failing` });
    items.push({ item: "no test that passed before fails now", pass: r.regressions.length === 0, expected: "0 regressions", actual: r.regressions.length ? `${r.regressions.length}: ${r.regressions.slice(0, 5).join(", ")}` : "0" });
    items.push({ item: "no new test fails", pass: r.newFailing.length === 0, expected: "0 failing new tests", actual: r.newFailing.length ? `${r.newFailing.length}: ${r.newFailing.slice(0, 5).join(", ")}` : "0" });
    await ctx.emit({ type: "verifier_result", actor: { kind: "verifier" }, payload: { storyId: "TASK", checkId: "regression", pass: r.pass, items } });
    return r.pass ? "passed" : "failed";
  }

  /** Task end: every container of the Task is removed and the proxy credential is no longer accepted anywhere. */
  async close(taskId: string): Promise<void> {
    // The proxy credential stays registered with the redactor, so a late leak is still redacted.
    await this.o.manager.removeTask(taskId).catch(() => undefined);
  }
}
