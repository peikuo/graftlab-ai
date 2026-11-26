// The planning node's agents (design.md, "Planning and document-first"; R19.1, R19.3, R19.9, R19.10, R20.1,
// R20.5-R20.9, R40.1, R40.3). Multi-role (decided by the user 2026-11-23): (1) the Planner drafts the plan,
// (2) Feasibility and Risk assess every story at the same time, (3) the Facilitator decides the final plan.
// Code validates every submission (an incomplete story is named) and derives the Sprint_Plan and the versions.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, int, obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";
import { buildPlan, PlanSchema, stripIds, StoryAssessmentSchema, type Actor, type DecisionDocContent, type Plan, type RoleId, type StoryAssessment } from "@graftlab/shared";
import { z } from "zod";
import { THINKING } from "../llm/thinking.ts";
import { readFileLines, renderReadFile, renderSearch, searchRepo } from "../reader/tools.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { CHECK_FORMATS } from "../decision/draft.ts";

const NAME: Record<string, string> = { planner: "Planner", facilitator: "Facilitator", feasibility: "Feasibility", risk: "Risk" };

export interface PlanningOptions {
  rules: RuntimeRules;
  context: string;
  /** The Frozen Decision_Doc as Markdown and as content, and its version. */
  decisionMarkdown: string;
  decision: DecisionDocContent;
  decisionVersion: number;
  /** How the Verifier can check this target (adapted repositories only). */
  checkHints?: string;
  /** R42: open execution (no Adapter): every Acceptance_Check must be a test_suite check. */
  testsOnly?: boolean;
  files: Map<string, string>;
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  /** Thinking per step (defaults from the table in llm/thinking.ts); used to measure alternatives. */
  thinking?: { draft?: "off" | "low"; assess?: "off" | "low"; final?: "off" | "low" };
}
type Built = Extract<ReturnType<typeof buildPlan>, { ok: true }>;
export type PlanningResult = { ok: true; plan: Plan } | { ok: false; reason: string };

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });

const storyParams = obj({
  id: str(),
  title: str(),
  priority: int(),
  userStory: str(),
  acceptanceCriteria: arr(str()),
  demoPoint: str(),
  references: opt(arr(str())),
  featureContract: obj({ feature: str(), shouldDo: arr(str()), shouldNotDo: opt(arr(str())), executionKind: oneOf(["source_change"] as const), acceptanceChecks: opt(arr(unknown())) }),
});
const planParams = (withNote: boolean) =>
  obj({ ...(withNote ? { note: str() } : {}), sprintGoal: str(), stories: arr(storyParams), definitionOfDone: arr(str()) } as Record<string, ReturnType<typeof str>>);

/**
 * The story kinds a plan may use. The Studio builds software and does not operate it for the user (decided by the
 * user 2026-11-25; the API-operation path is withdrawn), so every story is delivered as a change of the software.
 */
export function allowedKinds(_decision: DecisionDocContent): Set<string> {
  return new Set(["source_change"]);
}

export async function runPlanning(o: PlanningOptions): Promise<PlanningResult> {
  const system = sharedSystemPrompt(o.rules, o.context);
  const kinds = allowedKinds(o.decision);
  const skill = o.rules.skills?.["story-splitting"];
  const base = `# Frozen Decision_Doc (version ${o.decisionVersion}; the decisions are made)\n\n${o.decisionMarkdown}\n\n---\n\n${CHECK_FORMATS}${o.checkHints ? `\n\n${o.checkHints}` : ""}${skill ? `\n\n---\n\n# Skill\n\n${skill}` : ""}`;
  let turnNo = 0;
  async function turn(roleId: RoleId, ask: string, tools: AgentTool<any>[], accepted: () => boolean, thinkingLevel: "off" | "low"): Promise<boolean> {
    if (o.signal.aborted) return false;
    const actor: Actor = { kind: "role", roleId };
    const prompt = `${base}\n\n---\n\n# Your role\n\n${roleText(o.rules, roleId)}\n\n---\n\n${ask}`;
    const id = `${o.idPrefix}-p${++turnNo}`;
    const submit = tools.at(-1)!.name;
    const r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt, tools, signal: o.signal, idPrefix: id, thinkingLevel });
    if (accepted() || o.signal.aborted || r.stopReason === "error") return accepted();
    const why = r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission");
    await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]} ended the turn without a valid ${submit} (${why}); one retry` } });
    const r2 = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid ${submit}. Call it now.`, tools, signal: o.signal, idPrefix: `${id}r`, thinkingLevel });
    if (!accepted() && !o.signal.aborted && r2.stopReason !== "error") await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]}'s ${submit} failed: ${r2.error ?? "no valid submission"}` } });
    return accepted();
  }

  // Validation shared by the draft and the final plan: schema, story completeness (named), allowed kinds.
  const check = (a: unknown) => {
    const built = buildPlan(a, o.decisionVersion);
    if (!built.ok) return { ok: false as const, message: built.problems.slice(0, 6).join("; ") };
    const wrong = built.backlog.stories.filter((s) => !kinds.has(s.featureContract.executionKind)).map((s) => s.id);
    if (wrong.length) return { ok: false as const, message: `the chosen approach allows only ${[...kinds].join(" or ")} stories; change ${wrong.join(", ")}` };
    if (o.testsOnly) {
      const app = built.backlog.stories.flatMap((s) => s.featureContract.acceptanceChecks.filter((c) => c.kind !== "test_suite").map((c) => `${s.id} ${c.id} (${c.kind})`));
      if (app.length) return { ok: false as const, message: `this repository runs without an Adapter, so the app is not started and every acceptance check must be a test_suite check; change ${app.join(", ")}` };
    }
    return { ok: true as const, built };
  };
  const readTools: AgentTool<any>[] = [
    { name: "read_file", label: "read_file", description: "Read lines of a repository file (at most 400 lines).", parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }), execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))) },
    { name: "search_repo", label: "search_repo", description: "Literal search over the repository files.", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(renderSearch(a.query, searchRepo(o.files, a.query))) },
  ];

  // (1) The Planner's draft.
  let draft: { input: unknown; built: Built } | null = null;
  const draftTool: AgentTool<any> = {
    name: "submit_plan",
    label: "submit_plan",
    description: "Submit the plan: sprint goal, 1 to 4 stories with a Feature_Contract each, and the Definition_of_Done.",
    parameters: planParams(false),
    execute: async (_i, a: unknown) => {
      const r = check(a);
      if (!r.ok) return text(`Not accepted: ${r.message}. Submit again.`, true);
      draft = { input: a, built: r.built };
      return { ...text("Accepted."), terminate: true };
    },
  };
  const askDraft = "Write the plan from the Frozen Decision_Doc: the sprint goal, 1 to 4 stories (each with a Feature_Contract and exactly one demo point) and the Definition_of_Done. Then submit_plan. Tell the Judge in at most 80 words what the plan contains.";
  if (!(await turn("planner", askDraft, [...readTools, draftTool], () => draft !== null, o.thinking?.draft ?? THINKING.planDraft))) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Planner did not submit a valid plan" };
  const d = draft as { input: unknown; built: Built } | null;
  if (!d) return { ok: false, reason: "no plan" };

  // (2) Assessments of every story, at the same time.
  const storiesText = d.built.backlog.stories.map((s) => `- ${s.id} ${s.title} (${s.featureContract.executionKind}): ${s.featureContract.feature}; should do: ${s.featureContract.shouldDo.join("; ")}`).join("\n");
  const parts: Record<"feasibility" | "risk", StoryAssessment[]> = { feasibility: [], risk: [] };
  const AssessIn = z.object({ assessments: z.array(StoryAssessmentSchema.partial({ storyId: true }).extend({ storyId: z.string() })) });
  const assessTool = (roleId: "feasibility" | "risk"): AgentTool<any> => ({
    name: "submit_plan_assessment",
    label: "submit_plan_assessment",
    description: roleId === "feasibility" ? "Submit per story the effort (small, medium or large) and your concerns." : "Submit per story the main risk and the conditions that keep it acceptable.",
    parameters: obj({ assessments: arr(obj({ storyId: str(), effort: opt(oneOf(["small", "medium", "large"] as const)), concerns: opt(str()), risk: opt(str()), conditions: opt(str()) })) }),
    execute: async (_i, a: unknown) => {
      const p = AssessIn.safeParse(a);
      if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
      const ids = d.built.backlog.stories.map((s) => s.id);
      const missing = ids.filter((id) => !p.data.assessments.some((x) => x.storyId === id));
      const bad = p.data.assessments.filter((x) => (roleId === "feasibility" ? !x.effort : !x.risk)).map((x) => x.storyId);
      if (missing.length || bad.length) return text(`Not accepted: ${[missing.length ? `no assessment for ${missing.join(", ")}` : "", bad.length ? `${roleId === "feasibility" ? "effort" : "risk"} missing for ${bad.join(", ")}` : ""].filter(Boolean).join("; ")}. Submit again.`, true);
      parts[roleId] = p.data.assessments.filter((x) => ids.includes(x.storyId)).map((x) => ({ ...x, ...(x.concerns ? { concerns: stripIds(x.concerns).text } : {}), ...(x.risk ? { risk: stripIds(x.risk).text } : {}) }));
      return { ...text("Accepted."), terminate: true };
    },
  });
  const askAssess = (r: "feasibility" | "risk") =>
    `Assess every story of the Planner's plan from your viewpoint:\n${storiesText}\n\n${r === "feasibility" ? "For each: the effort (small, medium or large) in this code and your main concern in one sentence." : "For each: the main risk in one sentence and the condition that keeps it acceptable."} Then submit_plan_assessment. Tell the Judge in at most 60 words what matters most.`;
  await Promise.all((["feasibility", "risk"] as const).map((r) => turn(r, askAssess(r), [assessTool(r)], () => parts[r].length > 0, o.thinking?.assess ?? THINKING.planAssessment)));
  if (o.signal.aborted) return { ok: false, reason: "stopped" };

  // (3) The Facilitator decides the final plan.
  let final: { built: Built; note: string } | null = null;
  const finalTool: AgentTool<any> = {
    name: "submit_final_plan",
    label: "submit_final_plan",
    description: "Submit the final plan (same fields as the Planner's plan) and a note of at most 80 words on what you changed and why.",
    parameters: planParams(true),
    execute: async (_i, a: unknown) => {
      const note = typeof (a as { note?: unknown })?.note === "string" ? ((a as { note: string }).note) : "";
      const { note: _n, ...rest } = (a ?? {}) as Record<string, unknown>;
      const r = check(rest);
      if (!r.ok) return text(`Not accepted: ${r.message}. Submit again.`, true);
      final = { built: r.built, note: stripIds(note).text.slice(0, 800) };
      return { ...text("Accepted."), terminate: true };
    },
  };
  const assessed = (["feasibility", "risk"] as const)
    .map((r) => `${NAME[r]}:\n${parts[r].length ? parts[r].map((x) => `- ${x.storyId}: ${r === "feasibility" ? `effort ${x.effort}; ${x.concerns ?? ""}` : `${x.risk}${x.conditions ? `; condition: ${x.conditions}` : ""}`}`).join("\n") : "- no assessment was submitted"}`)
    .join("\n\n");
  const askFinal = `You decide the final plan. The Planner's plan (JSON):\n${JSON.stringify(d.input)}\n\nThe assessments (LLM judgments):\n${assessed}\n\nKeep what is right; change, split, merge, drop or reorder stories where the assessments give a reason. A large story should become a smaller first version when that still meets the Decision_Doc. Keep story ids for stories you keep. Then submit_final_plan with a note on what you changed and why (or "no changes" and why). Tell the Judge in at most 80 words what you decided.`;
  if (!(await turn("facilitator", askFinal, [finalTool], () => final !== null, o.thinking?.final ?? THINKING.planFinal))) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Facilitator did not submit a valid final plan" };
  const f = final as { built: Built; note: string } | null;
  if (!f) return { ok: false, reason: "no final plan" };
  const plan = PlanSchema.safeParse({
    decisionVersion: o.decisionVersion,
    backlog: f.built.backlog,
    sprintPlan: f.built.sprintPlan,
    definitionOfDone: f.built.definitionOfDone,
    assessments: parts,
    facilitatorNote: f.note,
    label: "LLM assessment, not a guarantee",
  });
  if (!plan.success) return { ok: false, reason: `the plan does not match the schema: ${plan.error.issues[0]?.path.join(".")} ${plan.error.issues[0]?.message}` };
  return { ok: true, plan: plan.data };
}
