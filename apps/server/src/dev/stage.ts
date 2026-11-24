// The development stage for source-change Features (design.md, "Development stage", "Worktree manager",
// "PiCodeRuntime", "Verifier"; R21, R22, R38, R39, R40). One instance per Task. Every container step goes through
// the container manager; every LLM step is labeled; success comes only from the Verifier's exit codes.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { currentStory, describeCheck, nextPendingStory, unplannedChanges, type Adapter, type BaselineHandle, type Feature, type TargetItem, type Plan, type RequirementsDoc, type SecretRegistry, type StoryProgress, type TechDesign } from "@graftlab/shared";
import { z } from "zod";
import type { ContainerManager } from "../containers/manager.ts";
import { issueProxyCredential } from "../proxy/credential.ts";
import type { RuntimeRules } from "../roles/rules.ts";
import { roleText, sharedSystemPrompt } from "../roles/rules.ts";
import type { TurnOptions, TurnResult } from "../runtime/pi.ts";
import { runCodeAttempt } from "../runtime/pi-code.ts";
import type { NodeHandler } from "../tasks/runner.ts";
import { abandonFeature, createWorktree, diffWorktree, mergeFeature, mirrorSourceFromEnv, notIgnored, snapshotWorktree, startFeature, writePatchArtifact, type FeatureBranch, type Worktree } from "../worktree/worktree.ts";
import { writeFeatureContext } from "./context.ts";
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
}

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });
const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/**
 * A command as an argument list; a single element with spaces ("python manage.py test x") is split into words, as
 * models often write it that way (found 2026-11-24: the whole command was taken as one program name).
 */
export const shellCommand = (argv: string[]) => (argv.length === 1 && /\s/.test(argv[0]!.trim()) ? argv[0]!.trim().split(/\s+/) : argv).map(shq).join(" ");
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s);

export class DevStage {
  #wt: Worktree | null = null;
  #dev: string | null = null;
  #credential: string | null = null;
  #relayPort: number | null = null;
  #branch: FeatureBranch | null = null;
  #lastDiff: { files: string[]; patch: string } | null = null;
  #feedback = new Map<string, string[]>();
  #pendingQuestion: string | null = null;
  /** The provisioned Run_Environment of the current story: generated secrets, credentials, state after the seed. */
  #app: { name: string; secretEnv: Record<string, string>; credentials: Record<string, string>; preState: TargetItem[] } | null = null;
  #runs = 0;

  constructor(private readonly o: DevStageOptions) {}

  #feature(ctx: Ctx): Feature {
    const id = ctx.task.currentStoryId;
    const f = this.o.design().breakdown.features.find((x) => x.id === id);
    if (!f) throw new Error(`no Feature ${id ?? "(none)"} in the technical design`);
    return f;
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
      const port = this.o.design().architecture.runEnvironment?.port;
      await step("Starting the LLM_Proxy (the only holder of the model key)", async () => {
        this.#credential = issueProxyCredential(this.o.secrets);
        const p = await m.startProxy(ctx.task.taskId, { image: this.o.devImage, credential: this.#credential, upstreamUrl: this.o.llm.baseUrl, upstreamKey: this.o.llm.apiKey, ...(port ? { relayTarget: `app:${port}` } : {}) });
        this.#relayPort = p.relayHostPort;
      });
      await step("Starting the Development_Sandbox", async () => {
        const contextDir = join(this.o.dataDir, "tasks", ctx.task.taskId, "context");
        await mkdir(contextDir, { recursive: true });
        this.#dev = (await m.startDevSandbox(ctx.task.taskId, { image: this.o.devImage, workDir: this.#wt!.path, contextDir, prebuilt: this.o.adapter.devSandbox.prebuilt, env: this.o.adapter.devSandbox.env ?? {} })).name;
      });
      ctx.patch({ targetCheckPassed: true });
      return "done";
    } catch (e) {
      await ctx.fail("interface_call_failure", "docker", `the development environment could not start: ${(e as Error).message}`);
      return "failed";
    }
  }

  /** story_develop: one Code_Agent attempt on the Feature's branch, then the change is recorded (R38.5, R40.5). */
  async develop(ctx: Ctx): Promise<"done" | "failed" | "question" | "retry_limit"> {
    const cur = currentStory(ctx.task);
    if (!cur || cur.status !== "in_progress") {
      const next = cur && cur.status === "pending" ? cur : nextPendingStory(ctx.task) ?? ctx.task.stories.find((s) => s.status === "pending");
      if (!next) {
        await ctx.fail("interface_call_failure", "persistence", "no Feature is left to develop");
        return "failed";
      }
      ctx.patch({ currentStoryId: next.storyId });
      this.#setStory(ctx, next.storyId, { status: "in_progress" });
    }
    const f = this.#feature(ctx);
    const progress = currentStory(ctx.task)!;
    if (progress.attempts >= ctx.task.limits.storyAttempts) return "retry_limit";
    const attempt = progress.attempts + 1;
    this.#setStory(ctx, f.id, { attempts: attempt });
    const wt = this.#wt!;
    this.#branch = await startFeature(wt, f.id);
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    const contextDir = await writeFeatureContext(this.o.dataDir, ctx.task.taskId, { featureId: f.id, plan: this.o.plan(), design: this.o.design(), ...(this.o.requirements() ? { requirements: this.o.requirements()! } : {}), ...(this.#feedback.get(f.id) ? { previousFeedback: this.#feedback.get(f.id)! } : {}) }, roleText(this.o.rules, "code_agent"));
    void contextDir; // mounted read-only at /context/<featureId>/ (the whole context directory is mounted at start)
    await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}", attempt ${attempt}: the Code_Agent starts on its own branch`, evidence: [], evidenceStatus: "none" } });
    const r = await runCodeAttempt({
      start: () =>
        this.o.manager.docker.execAttach(this.#dev!, ["node", "/opt/runner/runner.mjs"], {
          workdir: "/work",
          env: {
            GL_PROXY_BASE: "http://llm-proxy:8787/v1",
            GL_PROXY_CREDENTIAL: this.#credential!,
            GL_MODEL_ID: this.o.llm.model,
            GL_REASONING_PARAM: this.o.llm.reasoningParam,
            GL_REASONING_EFFORT: this.o.llm.reasoningEffort,
            GL_RULES_FILE: `/context/${f.id}/rules.md`,
            WORK_DIR: "/work",
          },
        }),
      prompt: `Read /context/${f.id}/story.md and build the Feature it describes.`,
      emit: ctx.emit,
      onQuestion: (q) => this.#answer(ctx, f, q),
      budgetMs: story.featureContract.budgets.maxCodeAgentMinutes * 60_000,
      signal: ctx.signal,
      idPrefix: `${ctx.task.taskId}-${f.id}-a${attempt}`,
    });
    if (r.outcome !== "completed") {
      if (ctx.signal.aborted) return "failed";
      await ctx.fail(r.outcome === "budget_exceeded" ? "budget_exceeded" : "interface_call_failure", "code_agent", `Feature ${f.id}, attempt ${attempt}: ${r.detail ?? r.outcome}`);
      return "failed";
    }
    // Record the change of this attempt against the Feature's base on main (R38.5).
    const diff = await diffWorktree(wt, this.#branch.base);
    const changed = diff.changedFiles.map((c) => c.path);
    this.#lastDiff = { files: changed, patch: diff.patch };
    const dir = join(this.o.dataDir, "tasks", ctx.task.taskId, "docs", "patches");
    await mkdir(dir, { recursive: true });
    const ref = `docs/patches/${f.id}-attempt${attempt}.diff`;
    await writeFile(join(this.o.dataDir, "tasks", ctx.task.taskId, ref), diff.patch);
    await ctx.emit({ type: "code_change", actor: { kind: "code_agent" }, payload: { storyId: f.id, attempt, changedFiles: changed, diffRef: ref } });
    if (changed.length === 0) {
      await ctx.fail("interface_call_failure", "code_agent", `Feature ${f.id}, attempt ${attempt}: the Code_Agent changed no file`);
      return "failed";
    }
    return "done";
  }

  /** A question from the running Code_Agent: technical to the Reviewer, feature to the Judge (R40.8, R40.13). */
  async #answer(ctx: Ctx, f: Feature, q: { questionId: string; kind: "technical" | "feature"; text: string; options?: string[] }): Promise<string> {
    const askedParty = q.kind === "technical" ? "reviewer" : "judge";
    await ctx.emit({ type: "question_opened", actor: { kind: "code_agent" }, payload: { questionId: q.questionId, from: "code_agent", askedParty, kind: q.kind, text: q.text } });
    let answer: string;
    if (q.kind === "technical") {
      let got = "";
      const tool: AgentTool<any> = { name: "answer_question", label: "answer_question", description: "Answer the Code_Agent's technical question.", parameters: obj({ answer: str() }), execute: async (_i, a: { answer: string }) => ((got = String(a.answer ?? "").trim()), { ...text(got ? "Sent." : "Empty answer."), terminate: !!got }) };
      await this.o.runTurn({ roleId: "reviewer", purpose: "review", systemPrompt: sharedSystemPrompt(this.o.rules, this.o.context()), prompt: `# Your role\n\n${roleText(this.o.rules, "reviewer")}\n\n---\n\nThe Code_Agent building Feature ${f.id} "${f.title}" (${f.summary}) asks a technical question:\n\n${q.text}${q.options?.length ? `\n\nOptions: ${q.options.join("; ")}` : ""}\n\nAnswer it in at most 120 words with answer_question, staying inside the Feature's scope and the technical design.`, tools: [tool], signal: ctx.signal, idPrefix: `${ctx.task.taskId}-${f.id}-q`, thinkingLevel: "low", emit: ctx.emit });
      answer = got || "No technical answer was given; follow the technical design and keep the change inside the Feature.";
    } else {
      const a = await ctx.askJudgeFor({ kind: "question", title: "The developer has a question about the feature", body: q.text, options: (q.options ?? []).slice(0, 4).map((o, i) => ({ id: `o${i + 1}`, label: o })), allowFreeText: true }, 300_000);
      answer = a ? (q.options?.[Number((a.optionId ?? "").slice(1)) - 1] ?? a.text ?? "") : "No answer within 5 minutes; keep the simplest behaviour that meets the Feature_Contract.";
    }
    await ctx.emit({ type: "question_answered", actor: askedParty === "judge" ? { kind: "judge" } : { kind: "role", roleId: "reviewer" }, payload: { questionId: q.questionId, answer } });
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
    const unplanned = unplannedChanges(f, d.files);
    const story = this.o.plan().backlog.stories.find((s) => s.id === f.storyId)!;
    let verdict: { verdict: "approve" | "request_changes" | "escalate"; reasons: string[] } | null = null;
    const Verdict = z.object({ verdict: z.enum(["approve", "request_changes", "escalate"]), reasons: z.array(z.string()).default([]), justified: z.array(z.object({ file: z.string(), reason: z.string() })).default([]) });
    const tools: AgentTool<any>[] = [
      { name: "read_diff", label: "read_diff", description: "The full diff of this attempt.", parameters: obj({}), execute: async () => text(cut(d.patch, 60_000)) },
      {
        name: "read_changed_file",
        label: "read_changed_file",
        description: "A changed file as it is now.",
        parameters: obj({ path: str() }),
        execute: async (_i, a: { path: string }) => {
          if (!d.files.includes(a.path)) return text(`${a.path} is not a changed file`, true);
          return text(cut(await readFile(join(this.#wt!.path, a.path), "utf8").catch(() => "(deleted)"), 40_000));
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
      `# Feature ${f.id}: ${f.title} (story ${story.id} "${story.title}")\n${f.summary}\n\nPlanned files: ${f.scope.files.join(", ")}\nTests: ${f.tests.files.join(", ")} — command: ${f.tests.command.join(" ")}\nMust not touch: ${f.scope.notTouch.join("; ") || "nothing named"}\nInterfaces: ${f.interfaces.join("; ") || "none named"}`,
      `# Feature_Contract\n${story.featureContract.feature}\nShould do: ${story.featureContract.shouldDo.join("; ")}\nShould not do: ${story.featureContract.shouldNotDo.join("; ")}`,
      `# This attempt (${attempt})\nChanged files: ${d.files.join(", ")}\nUnplanned changes found by Studio code: ${unplanned.length ? unplanned.join(", ") : "none"}`,
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
    const snap = await snapshotWorktree(this.o.dataDir, this.#wt!, `${f.id}-${attempt}-run`);
    await ctx.emit({ type: "artifact_updated", actor: { kind: "system" }, payload: { artifactKind: "worktree_handoff", ref: snap.commit, title: `Snapshot of ${f.id} for the app run` } });
    const m = this.o.manager;
    await m.docker.stopContainer(this.#dev!, 5).catch(() => undefined); // memory: the Development_Sandbox pauses
    const { name } = await m.startRunEnvironment(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, commands: [...re.buildCommands, ...re.startCommands].join("\n"), // one line each under `set -e`; joining with && breaks on a trailing & env: this.o.adapter.devSandbox.env ?? {} });
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
    const snap = await snapshotWorktree(this.o.dataDir, this.#wt!, `${f.id}-${attempt}-test`);
    const checks: { id: string; command: string[]; timeoutS: number; label: string }[] = [{ id: `${f.id}-tests`, command: f.tests.command, timeoutS: 600, label: `Feature tests: ${f.tests.command.join(" ")}` }];
    const notRun: string[] = [];
    const appChecks = last ? story.featureContract.acceptanceChecks.filter((c) => c.kind !== "test_suite") : [];
    if (last)
      for (const c of story.featureContract.acceptanceChecks) if (c.kind === "test_suite") checks.push({ id: c.id, command: c.command, timeoutS: c.timeoutS, label: describeCheck(c) });
    let pass = true;
    for (const c of checks) {
      const r = await this.o.manager.runTests(ctx.task.taskId, { image: this.o.devImage, snapshotDir: snap.path, prebuilt: this.o.adapter.devSandbox.prebuilt, command: shellCommand(c.command), timeoutS: c.timeoutS, env: this.o.adapter.devSandbox.env ?? {} });
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
        const r = await runBrowserCheck({ baseUrl, check: c, screenshot: shot, ...(l ? { login: { path: l.path, usernameLabel: l.usernameLabel, passwordLabel: l.passwordLabel, submitLabel: l.submitLabel, username: app.secretEnv[l.usernameEnv] ?? "", password: app.secretEnv[l.passwordEnv] ?? "" } } : {}) }).catch((e: unknown) => ({ items: [{ item: "start the browser", pass: false, expected: "browser runs", actual: (e as Error).message.split("\n")[0]!.slice(0, 200) }], screenshot: null }));
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
      if (this.#branch) await abandonFeature(this.#wt!, this.#branch);
      return "failed";
    }
    const merged = await mergeFeature(this.#wt!, this.#branch!, f.title);
    if (!merged.ok) {
      await ctx.fail("interface_call_failure", "persistence", merged.reason);
      this.#setStory(ctx, f.id, { status: "failed" });
      return "failed";
    }
    await ctx.emit({ type: "finding_recorded", actor: { kind: "system" }, payload: { kind: "note", text: `Feature ${f.id} "${f.title}" merged into main`, evidence: [], evidenceStatus: "none" } });
    await writePatchArtifact(this.o.dataDir, this.#wt!, "TASK");
    this.#setStory(ctx, f.id, { status: "verified" });
    this.#lastDiff = null;
    if (last) await this.#restartDev(ctx);
    return "passed";
  }

  /** Task end: every container of the Task is removed and the proxy credential is no longer accepted anywhere. */
  async close(taskId: string): Promise<void> {
    // The proxy credential stays registered with the redactor, so a late leak is still redacted.
    await this.o.manager.removeTask(taskId).catch(() => undefined);
  }
}
