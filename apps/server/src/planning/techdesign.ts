// The technical design step (Sprint Planning part two; design.md, "Planning and document-first"; R19.13-R19.15).
// (1) The Planner reads the code and drafts the Technical Architecture and the Feature breakdown with the
// feature-breakdown skill; (2) Feasibility reviews every Feature (thinking off); (3) the Reviewer decides the final
// version and grades every Feature on the rubric. Code checks every submission and names the failing Feature.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, int, obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";
import {
  checkBreakdown,
  missingTestTargets,
  RefinedChecksSchema,
  withRefinedChecks,
  type RefinedChecks,
  FeatureGradeSchema,
  RUBRIC,
  stripIds,
  TechArchitectureSchema,
  TechDesignSchema,
  type Actor,
  type FeatureBreakdown,
  type FeatureGrade,
  type Plan,
  type RoleId,
  type TechArchitecture,
  type TechDesign,
} from "@graftlab/shared";
import { z } from "zod";
import { checkConclusion, type EvidenceFiles } from "../evidence/check.ts";
import { THINKING } from "../llm/thinking.ts";
import { readFileLines, renderReadFile, renderSearch, searchRepo } from "../reader/tools.ts";
import { roleText, sharedSystemPrompt, skillText, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { renderPlanMarkdown } from "./render.ts";

const NAME: Record<string, string> = { planner: "Planner", feasibility: "Feasibility", reviewer: "Reviewer" };

export interface TechDesignOptions {
  rules: RuntimeRules;
  context: string;
  decisionMarkdown: string;
  plan: Plan;
  /** Adapted_Repo with a source-change story: the architecture needs a run environment from the target's files. */
  needsRunEnvironment: boolean;
  environmentNote?: string;
  files: Map<string, string>;
  evidence: EvidenceFiles;
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  thinking?: { draft?: "off" | "low"; review?: "off" | "low"; final?: "off" | "low" };
  /** The Adapter's schema of read-back fields; a read-back check with other fields cannot run (found 2026-11-24). */
  expectFields?: { safeParse(v: unknown): { success: boolean } };
  /** The field names to name in the refusal, for example "titleContains, tagsInclude, archived". */
  expectFieldNames?: string;
}
export type TechDesignResult = { ok: true; design: TechDesign; stats: { retries: number } } | { ok: false; reason: string; stats: { retries: number } };

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });

const quoteP = obj({ path: str(), line: opt(int()), snippet: str() });
const architectureP = obj({
  overview: str(),
  affected: arr(obj({ part: str(), how: str(), quotes: opt(arr(quoteP)) })),
  newComponents: opt(arr(obj({ name: str(), purpose: str(), connectsTo: opt(arr(str())) }))),
  dataChanges: opt(arr(str())),
  decisions: arr(obj({ decision: str(), why: str(), rejected: opt(arr(str())) })),
  runEnvironment: opt(obj({ buildCommands: arr(str()), startCommands: arr(str()), port: int(), healthPath: str(), evidence: arr(quoteP) })),
});
const featureP = obj({
  id: str(),
  storyId: str(),
  title: str(),
  summary: str(),
  scope: obj({ modules: arr(str()), files: arr(str()), notTouch: opt(arr(str())) }),
  interfaces: opt(arr(str())),
  tests: obj({ files: arr(str()), command: arr(str()) }),
  size: oneOf(["XS", "S", "M"] as const),
  dependsOn: opt(arr(str())),
  servesChecks: opt(arr(str())),
  detail: obj({
    usesModel: bool(),
    modelCalls: opt(arr(obj({ purpose: str(), input: str(), answerShape: str(), onFailure: str() }))),
    dataChanges: opt(arr(str())),
    visibleTexts: opt(arr(str())),
    errors: opt(arr(str())),
  }),
});
const gradeP = obj({ featureId: str(), ...Object.fromEntries(RUBRIC.map((k) => [k, oneOf(["pass", "concern"] as const)])), note: str() } as Record<string, ReturnType<typeof str>>);

/**
 * Package installation in a run command (R38.4: the Run_Environment has no internet; dependencies are preinstalled
 * in the image). Found 2026-11-24: the Planner copied `uv sync` and `npm install` from the target's Makefile.
 */
export const INSTALL = /\b(uv\s+sync|uv\s+pip\s+install|pip3?\s+install|python3?\s+-m\s+pip\s+install|npm\s+(install|ci|i)\b|pnpm\s+install|yarn\s+install|poetry\s+install|bundle\s+install|apt(-get)?\s+install)/;

/** Checks a submitted architecture and breakdown; the architecture's quotes are checked against the files. */
export function checkTechDesign(a: unknown, o: Pick<TechDesignOptions, "plan" | "needsRunEnvironment" | "evidence" | "expectFields" | "expectFieldNames"> & { files?: Map<string, string> }): { ok: true; architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks } | { ok: false; problems: string[] } {
  const x = (a ?? {}) as { architecture?: Record<string, unknown>; features?: unknown[]; checks?: unknown };
  const problems: string[] = [];
  const refined = RefinedChecksSchema.safeParse(x.checks ?? []);
  if (!refined.success) problems.push(...refined.error.issues.slice(0, 3).map((i) => `checks: ${i.path.join(".")} ${i.message}`));
  const checks = refined.success ? refined.data : [];
  for (const r of checks) if (!o.plan.backlog.stories.some((s) => s.id === r.storyId)) problems.push(`checks: story ${r.storyId} is not in the confirmed plan`);
  const backlog = withRefinedChecks(o.plan, checks).backlog;
  // An api_readback check can only use the fields the Adapter's comparator knows.
  if (o.expectFields)
    for (const s of backlog.stories)
      for (const c of s.featureContract.acceptanceChecks)
        if (c.kind === "api_readback")
          for (const ex of c.expect)
            if (ex.fields && !o.expectFields.safeParse(ex.fields).success) problems.push(`story ${s.id}: check ${c.id} reads back fields ${Object.keys(ex.fields).join(", ")}, which the Verifier cannot compare (${o.expectFieldNames ?? "use only the fields named in the Adapter checklist"}; refine it in \`checks\`)`);
  const norm = (arch: Record<string, unknown> = {}) => ({
    ...arch,
    affected: ((arch.affected as Record<string, unknown>[] | undefined) ?? []).map((p) => ({ quotes: [], ...p })),
    newComponents: ((arch.newComponents as Record<string, unknown>[] | undefined) ?? []).map((c) => ({ connectsTo: [], ...c })),
    dataChanges: arch.dataChanges ?? [],
    decisions: ((arch.decisions as Record<string, unknown>[] | undefined) ?? []).map((d) => ({ rejected: [], ...d })),
    decisionVersion: o.plan.decisionVersion,
  });
  const arch = TechArchitectureSchema.safeParse(norm(x.architecture));
  if (!arch.success) problems.push(...arch.error.issues.slice(0, 4).map((i) => `architecture: ${i.path.join(".")} ${i.message}`));
  else if (o.needsRunEnvironment && !arch.data.runEnvironment) problems.push("architecture: runEnvironment is required (how to build and start the changed software, from its own files)");
  else if (arch.data.runEnvironment)
    for (const c of [...arch.data.runEnvironment.buildCommands, ...arch.data.runEnvironment.startCommands])
      if (INSTALL.test(c)) problems.push(`architecture: runEnvironment command "${c}" installs packages, but the run container has no internet and the dependencies are preinstalled; leave it out`);
  const features = (x.features ?? []).map((f) => ({ interfaces: [], dependsOn: [], servesChecks: [], ...(f as object), scope: { notTouch: [], ...((f as { scope?: object })?.scope ?? {}) } }));
  const b = checkBreakdown({ features }, backlog, { requireDetail: true });
  if (!b.ok) problems.push(...b.problems);
  // R19.16: every test check runs something that exists or that a Feature adds.
  if (b.ok && o.files) {
    const planned = b.breakdown.features.flatMap((f) => f.tests.files);
    for (const s of backlog.stories)
      for (const m of missingTestTargets(s.featureContract.acceptanceChecks, o.files.keys(), planned))
        problems.push(`story ${s.id}: check ${m.checkId} runs ${m.target}, which is not in the repository and no Feature adds it; refine the check in \`checks\` (the real test module) or add the test file to a Feature`);
  }
  if (problems.length || !arch.success || !b.ok) return { ok: false, problems };
  const architecture = { ...arch.data, overview: stripIds(arch.data.overview).text };
  architecture.affected = architecture.affected.map((p) => ({ ...p, quotes: checkConclusion(p.quotes, o.evidence).evidence.map((e) => ({ path: e.path, ...(e.line ? { line: e.line } : {}), snippet: e.snippet, status: e.status ?? "unverified" })) }));
  if (architecture.runEnvironment) {
    const c = checkConclusion(architecture.runEnvironment.evidence, o.evidence);
    architecture.runEnvironment = { ...architecture.runEnvironment, evidence: c.evidence.map((e) => ({ path: e.path, ...(e.line ? { line: e.line } : {}), snippet: e.snippet, status: e.status ?? "unverified" })) };
  }
  return { ok: true, architecture, breakdown: b.breakdown, checks };
}

export async function runTechDesign(o: TechDesignOptions): Promise<TechDesignResult> {
  const system = sharedSystemPrompt(o.rules, o.context);
  const stats = { retries: 0 };
  const runEnv = o.needsRunEnvironment
    ? `The architecture needs \`runEnvironment\`: the build and start commands, the app port and the health path, each backed by quotes copied exactly from the software's own files (Makefile, Dockerfile, scripts, package.json, pyproject.toml, README). Never guess a command.${o.environmentNote ? ` ${o.environmentNote}` : ""}`
    : "";
  const base = [
    `# Frozen Decision_Doc (version ${o.plan.decisionVersion})\n\n${o.decisionMarkdown}`,
    `# The confirmed plan\n\n${renderPlanMarkdown(o.plan)}`,
    `# Skill\n\n${skillText(o.rules, "feature-breakdown")}`,
  ].join("\n\n---\n\n");
  let turnNo = 0;
  async function turn(roleId: RoleId, ask: string, tools: AgentTool<any>[], accepted: () => boolean, thinkingLevel: "off" | "low"): Promise<boolean> {
    if (o.signal.aborted) return false;
    const actor: Actor = { kind: "role", roleId };
    const prompt = `${base}\n\n---\n\n# Your role\n\n${roleText(o.rules, roleId)}\n\n---\n\n${ask}`;
    const id = `${o.idPrefix}-t${++turnNo}`;
    const submit = tools.at(-1)!.name;
    const r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt, tools, signal: o.signal, idPrefix: id, thinkingLevel });
    if (accepted() || o.signal.aborted || r.stopReason === "error") return accepted();
    stats.retries++;
    await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]} ended the turn without a valid ${submit} (${r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission")}); one retry` } });
    const r2 = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid ${submit}. Call it now.`, tools, signal: o.signal, idPrefix: `${id}r`, thinkingLevel });
    if (!accepted() && !o.signal.aborted && r2.stopReason !== "error") await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]}'s ${submit} failed: ${r2.error ?? "no valid submission"}` } });
    return accepted();
  }
  const readTools = (): AgentTool<any>[] => [
    { name: "read_file", label: "read_file", description: "Read lines of a repository file (at most 400 lines).", parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }), execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))) },
    { name: "search_repo", label: "search_repo", description: "Literal search over the repository files.", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(renderSearch(a.query, searchRepo(o.files, a.query))) },
  ];
  const submitTool = (name: string, description: string, extra: Record<string, unknown>, onOk: (r: { architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks }, a: Record<string, unknown>) => string | null): AgentTool<any> => ({
    name,
    label: name,
    description,
    parameters: obj({ architecture: architectureP, features: arr(featureP), checks: opt(arr(obj({ storyId: str(), checks: arr(unknown()), reason: str() }))), ...extra } as unknown as Record<string, ReturnType<typeof str>>),
    execute: async (_i, a: unknown) => {
      const r = checkTechDesign(a, { ...o, files: o.files });
      if (!r.ok) return text(`Not accepted: ${r.problems.slice(0, 6).join("; ")}. Submit again.`, true);
      const more = onOk(r, (a ?? {}) as Record<string, unknown>);
      if (more) return text(`Not accepted: ${more}. Submit again.`, true);
      return { ...text("Accepted."), terminate: true };
    },
  });

  // (1) The Planner's draft.
  let draft: { input: unknown; architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks } | null = null;
  const checksText = o.plan.backlog.stories.map((s) => `- ${s.id}: ${s.featureContract.acceptanceChecks.map((c) => `${c.id} ${JSON.stringify(c)}`).join("; ") || "no checks"}`).join("\n");
  const checksAsk = `The stories' acceptance checks were written before anyone read the code:\n${checksText}\nMake each one executable against this code: the real test module or file (existing, or one a Feature adds), and for browser checks the real paths and the labels of the fields and buttons as the templates render them (read the templates). Put a refined check list for a story in \`checks\` with the reason; keep the intent.`;
  const askDraft = `Read the code the stories touch, then write the Technical Architecture and the Feature breakdown following the skill. ${checksAsk} ${runEnv} Then submit_tech_design. Tell the Judge in at most 80 words what the design does.`;
  const draftTool = submitTool("submit_tech_design", "Submit the Technical Architecture and the Feature breakdown.", {}, (r, a) => ((draft = { input: a, ...r }), null));
  if (!(await turn("planner", askDraft, [...readTools(), draftTool], () => draft !== null, o.thinking?.draft ?? THINKING.techDraft))) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Planner did not submit a valid technical design", stats };
  const d = draft as { input: unknown; architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks } | null;
  if (!d) return { ok: false, reason: "no technical design", stats };

  // (2) Feasibility reviews every Feature.
  const ReviewIn = z.object({ reviews: z.array(z.object({ featureId: z.string(), fits: z.enum(["yes", "doubt"]), sizeRight: z.boolean(), missing: z.string().transform((s) => s.slice(0, 400)).optional() })) });
  let review: z.infer<typeof ReviewIn>["reviews"] = [];
  const reviewTool: AgentTool<any> = {
    name: "submit_tech_review",
    label: "submit_tech_review",
    description: "Submit per Feature: does it fit the code (yes or doubt), is the size right, and what is missing (dependencies, tests, parts of the scope).",
    parameters: obj({ reviews: arr(obj({ featureId: str(), fits: oneOf(["yes", "doubt"] as const), sizeRight: bool(), missing: opt(str()) })) }),
    execute: async (_i, a: unknown) => {
      const p = ReviewIn.safeParse(a);
      if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
      const missing = d.breakdown.features.filter((f) => !p.data.reviews.some((x) => x.featureId === f.id)).map((f) => f.id);
      if (missing.length) return text(`Not accepted: no review for ${missing.join(", ")}. Submit again.`, true);
      review = p.data.reviews.map((x) => ({ ...x, ...(x.missing ? { missing: stripIds(x.missing).text } : {}) }));
      return { ...text("Accepted."), terminate: true };
    },
  };
  const featuresText = d.breakdown.features.map((f) => `- ${f.id} (${f.storyId}, ${f.size}) ${f.title}: ${f.summary}; files ${f.scope.files.join(", ")}; tests ${f.tests.command.join(" ")}${f.dependsOn.length ? `; after ${f.dependsOn.join(", ")}` : ""}`).join("\n");
  await turn("feasibility", `Review the Planner's Features against the code:\n${featuresText}\n\nFor each: does it fit the code, is the size right, and what is missing. Then submit_tech_review. Tell the Judge in at most 60 words what matters most.`, [reviewTool], () => review.length > 0, o.thinking?.review ?? THINKING.techReview);
  if (o.signal.aborted) return { ok: false, reason: "stopped", stats };

  // (3) The Reviewer decides and grades.
  let final: { architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks; grades: FeatureGrade[]; note: string } | null = null;
  const finalTool = submitTool(
    "submit_final_tech_design",
    "Submit the final Technical Architecture and Feature breakdown, a grade per Feature, and a note on what you changed and why.",
    { grades: arr(gradeP), note: str() },
    (r, a) => {
      const grades = z.array(FeatureGradeSchema).safeParse(a.grades);
      if (!grades.success) return `grades: ${grades.error.issues[0]?.path.join(".")} ${grades.error.issues[0]?.message}`;
      const ungraded = r.breakdown.features.filter((f) => !grades.data.some((g) => g.featureId === f.id)).map((f) => f.id);
      if (ungraded.length) return `no grade for ${ungraded.join(", ")}`;
      final = { ...r, grades: grades.data as FeatureGrade[], note: stripIds(String(a.note ?? "")).text.slice(0, 800) };
      return null;
    },
  );
  const reviewText = review.length ? review.map((x) => `- ${x.featureId}: fits ${x.fits}, size ${x.sizeRight ? "right" : "wrong"}${x.missing ? `; missing: ${x.missing}` : ""}`).join("\n") : "- Feasibility submitted no review";
  const askFinal = `You decide the final technical design. The Planner's design (JSON):\n${JSON.stringify(d.input)}\n\nFeasibility's review (LLM judgment):\n${reviewText}\n\nCheck it against the code, apply the skill, change what needs changing (including the refined acceptance checks: ${checksAsk}), and grade every final Feature on vertical slice, independent, testable, small, in scope. Then submit_final_tech_design. Tell the Judge in at most 80 words what you decided.`;
  if (!(await turn("reviewer", askFinal, [...readTools(), finalTool], () => final !== null, o.thinking?.final ?? THINKING.techFinal))) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Reviewer did not submit a valid final technical design", stats };
  const f = final as { architecture: TechArchitecture; breakdown: FeatureBreakdown; checks: RefinedChecks; grades: FeatureGrade[]; note: string } | null;
  if (!f) return { ok: false, reason: "no final technical design", stats };
  const design = TechDesignSchema.safeParse({ decisionVersion: o.plan.decisionVersion, architecture: f.architecture, breakdown: f.breakdown, checks: f.checks, review, grades: f.grades, reviewerNote: f.note, label: "LLM assessment, not a guarantee" });
  if (!design.success) return { ok: false, reason: `the technical design does not match the schema: ${design.error.issues[0]?.path.join(".")} ${design.error.issues[0]?.message}`, stats };
  return { ok: true, design: design.data as TechDesign, stats };
}
