// Validates the splitting skills (R19.15; design.md, "Planning and document-first", skill validation). Runs the
// technical design step with the real model on confirmed plans recorded in earlier Tasks, once with the
// feature-breakdown skill and once without it, and reports what code can measure plus the Reviewer's rubric.
// Usage: npx tsx scripts/eval-skills.ts <taskId>... (GL_DATA_DIR, default ./data; LLM profile from .env)
// Report: runtime-rules/skills/eval/<VERSION>-<date>.md and .json. Paid model calls: run it deliberately.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PlanSchema, type TechDesign } from "@graftlab/shared";
import { renderDecisionDoc } from "../apps/server/src/decision/render.ts";
import { filesFrom } from "../apps/server/src/evidence/check.ts";
import { resolveLlmConfig } from "../apps/server/src/llm/config.ts";
import { buildStudioModel } from "../apps/server/src/llm/model.ts";
import { runTechDesign } from "../apps/server/src/planning/techdesign.ts";
import { renderBrief } from "../apps/server/src/reader/brief.ts";
import { RepoCache } from "../apps/server/src/reader/reader.ts";
import { loadRuntimeRules } from "../apps/server/src/roles/rules.ts";
import { runAgentTurn } from "../apps/server/src/runtime/pi.ts";

process.loadEnvFile(".env");
const dataDir = process.env.GL_DATA_DIR ?? "data";
const taskIds = process.argv.slice(2);
if (!taskIds.length) throw new Error("usage: eval-skills.ts <taskId>...");
const cfg = resolveLlmConfig(process.env);
const model = buildStudioModel(cfg);
const rules = await loadRuntimeRules("runtime-rules", ["planner", "feasibility", "reviewer"]);
const env = "The changed software runs in a container without internet access, so install steps that download packages fail; already installed: git, node 24, uv 0.8.13, dev dependency group (hash-checked), npm ci, npm run build. The app must listen on 0.0.0.0, not 127.0.0.1, so the Studio can reach it.";

interface Run {
  taskId: string;
  variant: "with skill" | "without skill";
  ok: boolean;
  reason?: string;
  seconds: number;
  retries: number;
  rejections: string[];
  features?: { id: string; storyId: string; size: string; files: number; tests: number; dependsOn: string[] }[];
  concerns?: number;
  gradesTotal?: number;
  quotesPassed?: string;
  feasibilityDoubts?: number;
}
const runs: Run[] = [];
for (const taskId of taskIds) {
  const ev: any[] = readFileSync(join(dataDir, "tasks", taskId, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const created = ev.find((e) => e.type === "task_created").payload;
  const confirmed = ev.findLast((e) => e.type === "plan_confirmed").payload.planId;
  const plan = PlanSchema.parse(ev.findLast((e) => e.type === "plan_proposed" && e.payload.planId === confirmed).payload.content);
  const version = ev.findLast((e) => e.type === "decision_doc_version" && e.payload.version === plan.decisionVersion).payload;
  const frozen = ev.findLast((e) => e.type === "decision_doc_frozen" && e.payload.version === plan.decisionVersion).payload;
  const brief = ev.findLast((e) => e.type === "repo_brief").payload.content;
  const meta = { owner: created.owner, repo: created.repo, defaultBranch: "main", sha: created.commitSha };
  const cache = new RepoCache(join(dataDir, "cache"));
  const files = new Map<string, string>();
  for (const e of ev.filter((x) => x.type === "file_read")) {
    const b = await cache.readFile(meta, e.payload.path);
    if (b) files.set(e.payload.path, new TextDecoder().decode(b));
  }
  const context = `## Repo_Brief (written by the Reader; an LLM description, not evidence)\n\n${renderBrief(brief).replace(/^## Repo brief\n/, "")}`;
  for (const variant of ["with skill", "without skill"] as const) {
    const r0 = variant === "with skill" ? rules : { ...rules, skills: { ...rules.skills, "feature-breakdown": "(no method given)" } };
    const rejections: string[] = [];
    const t0 = Date.now();
    const r = await runTechDesign({
      rules: r0,
      context,
      decisionMarkdown: renderDecisionDoc(version.content, frozen),
      plan,
      needsRunEnvironment: true,
      environmentNote: env,
      files,
      evidence: filesFrom(files),
      emit: async (e: any) => {
        if (e.type === "tool_finished" && !e.payload.ok) rejections.push(String(e.payload.outputSummary).slice(0, 200));
      },
      runTurn: (o) => runAgentTurn({ thinkingLevel: "low", ...o, model, emit: async (e: any) => void (e.type === "tool_finished" && !e.payload.ok && rejections.push(String(e.payload.outputSummary).slice(0, 200))), maxToolErrors: 4 }),
      signal: new AbortController().signal,
      idPrefix: "eval",
    });
    const seconds = Math.round((Date.now() - t0) / 1000);
    const run: Run = { taskId, variant, ok: r.ok, seconds, retries: r.stats.retries, rejections };
    if (r.ok) {
      const d: TechDesign = r.design;
      run.features = d.breakdown.features.map((f) => ({ id: f.id, storyId: f.storyId, size: f.size, files: f.scope.files.length, tests: f.tests.files.length, dependsOn: f.dependsOn }));
      run.gradesTotal = d.grades.length * 5;
      run.concerns = d.grades.reduce((n, g) => n + (["verticalSlice", "independent", "testable", "small", "inScope"] as const).filter((k) => g[k] === "concern").length, 0);
      const quotes = [...d.architecture.affected.flatMap((a) => a.quotes), ...(d.architecture.runEnvironment?.evidence ?? [])];
      run.quotesPassed = `${quotes.filter((q) => q.status === "passed").length}/${quotes.length}`;
      run.feasibilityDoubts = d.review.filter((x) => x.fits === "doubt" || !x.sizeRight).length;
      mkdirSync("spike/rec/eval", { recursive: true });
      writeFileSync(`spike/rec/eval/${taskId}-${variant.replace(" ", "-")}.json`, JSON.stringify(d, null, 2));
    } else run.reason = r.reason;
    console.log(JSON.stringify(run));
    runs.push(run);
  }
}
const date = new Date().toISOString().slice(0, 10);
const out = "runtime-rules/skills/eval";
mkdirSync(out, { recursive: true });
const md = [
  `# Skill validation: feature-breakdown (Runtime_Rules ${rules.version}, ${date})`,
  `Model: ${cfg.model} (profile ${cfg.profile}). Each confirmed plan ran through the technical design step twice: with the skill, and with the skill text replaced. Code checks are guaranteed; the rubric is the Reviewer's LLM assessment, not a guarantee.`,
  "| Task | Variant | Valid | Time | Retries | Rejected submissions | Features (size, files, tests) | Rubric concerns | Quotes found | Feasibility doubts |",
  "|---|---|---|---|---|---|---|---|---|---|",
  ...runs.map((r) => `| ${r.taskId} | ${r.variant} | ${r.ok ? "yes" : `no: ${r.reason}`} | ${r.seconds} s | ${r.retries} | ${r.rejections.length} | ${(r.features ?? []).map((f) => `${f.id} ${f.size} ${f.files}/${f.tests}`).join(", ")} | ${r.concerns ?? "-"}/${r.gradesTotal ?? "-"} | ${r.quotesPassed ?? "-"} | ${r.feasibilityDoubts ?? "-"} |`),
  "",
  "Rejections by code (first 200 characters each):",
  ...runs.flatMap((r) => r.rejections.map((x) => `- ${r.taskId} ${r.variant}: ${x.replace(/\n/g, " ")}`)),
].join("\n");
writeFileSync(`${out}/${rules.version}-${date}.md`, `${md}\n`);
writeFileSync(`${out}/${rules.version}-${date}.json`, `${JSON.stringify({ version: rules.version, model: cfg.model, runs }, null, 2)}\n`);
console.log(`report: ${out}/${rules.version}-${date}.md`);
