// The deciding node's agents (design.md, "Decision step"; R15.1, R15.2, R37.1-R37.3, R37.5, R37.6, R37.9).
// (1) The Facilitator drafts from the meeting result; (2) Feasibility and Risk assess every option at the same
// time; (3) code merges, checks every quote, computes `complete`, names large changes as risks and validates.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, int, obj, oneOf, opt, str, unknown } from "@earendil-works/pi-schema";
import { AcceptanceCheckSchema, DecisionDocContentSchema, stripIds, type AcceptanceCheckSpec, type Actor, type DecisionDocContent, type EvidenceRef, type Proposal, type RoleId } from "@graftlab/shared";
import { z } from "zod";
import { checkConclusion, type EvidenceFiles } from "../evidence/check.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { THINKING, type Thinking } from "../llm/thinking.ts";

const NAME: Record<string, string> = { facilitator: "Facilitator", feasibility: "Feasibility", risk: "Risk" };
// Soft caps: an over-long text is cut with "…" instead of refusing the whole submission (a refusal costs a model
// turn; found 2026-11-23 with DeepSeek, which writes longer texts).
const soft = (max: number) => (s: string) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const line = (max: number) => z.string().trim().min(1).transform(soft(max));
const cut = (max: number) => z.string().transform(soft(max));
const capped = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
const Quote = z.object({ path: line(300), line: z.number().int().positive().optional(), snippet: z.string().max(2000) });
const DraftIn = z.object({
  purpose: z.enum(["A", "B"]),
  workflows: capped(z.object({ proposal: line(400), name: line(120), purpose: z.enum(["A", "B"]), description: line(600) }), 4).refine((a) => a.length > 0, "needs at least one entry"),
  inScope: capped(line(300), 8).refine((a) => a.length > 0, "needs at least one entry"),
  outOfScope: capped(line(300), 8).default([]),
  acceptanceCriteria: capped(line(300), 8).refine((a) => a.length > 0, "needs at least one entry"),
  approachOptions: capped(z.object({ id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/), kind: z.enum(["source_change", "ui_change", "mix"]), title: line(100), summary: line(600), acceptanceChecks: z.array(z.unknown()).default([]) }), 3).refine((a) => a.length > 0, "needs at least one entry"),
  uiImpact: line(800),
  risks: capped(line(300), 8).default([]),
  openQuestions: capped(line(300), 4).default([]),
  // R15.12: required in every new draft.
  aiRuntime: z.object({ source: z.enum(["studio_service", "judge_endpoint", "local"]), endpoint: z.string().url().optional(), dataSent: capped(line(200), 8), reason: line(400) }),
});
const Claim = z.object({ text: line(400), quotes: capped(Quote, 3).default([]) });
const AssessIn = z.object({
  assessments: capped(
    z.object({
      optionId: line(24),
      feasibility: cut(800).optional(),
      effort: z.enum(["small", "medium", "large"]).optional(),
      firstVersion: cut(400).optional(),
      neededEnvironments: z.array(z.enum(["sandbox", "development_sandbox", "run_environment"])).optional(),
      risk: cut(800).optional(),
      claims: capped(Claim, 4).default([]),
    }),
    4,
  ),
});
type DraftInput = z.infer<typeof DraftIn>;
type Option = DraftInput["approachOptions"][number];
type Part = z.infer<typeof AssessIn>["assessments"][number];

export interface DraftOptions {
  rules: RuntimeRules;
  context: string;
  /** The meeting result (the board with the Facilitator's verdicts) and the Judge's answers so far. */
  proposals: Proposal[];
  openQuestions: string[];
  judgeAnswers: string[];
  /** How the Verifier can check this target (adapted repositories only). */
  checkHints?: string;
  files: Map<string, string>;
  evidence: EvidenceFiles;
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  /** Thinking per step (default low); measured to decide the defaults. */
  thinking?: { draft?: Thinking; assess?: Thinking };
  /** After a send back: the previous draft and the rejected items with the Judge's reasons. */
  previous?: { content: DecisionDocContent; rejections: { title: string; reason: string }[] };
}
export type DraftResult = { ok: true; content: DecisionDocContent; reassessed: string[] } | { ok: false; reason: string };

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });
const err = (e: z.ZodError) => `${e.issues[0]?.path.join(".")} ${e.issues[0]?.message}`;

function renderMeeting(o: DraftOptions): string {
  const lines = ["# Meeting result (the Facilitator's verdicts; the Judge decides now)"];
  const order = (p: Proposal) => (p.verdict?.verdict === "recommend" ? (p.verdict.rank ?? 50) : p.verdict?.verdict === "park" ? 100 : 200);
  for (const p of [...o.proposals].sort((a, b) => order(a) - order(b))) {
    const v = p.verdict;
    lines.push(`- ${p.id} “${p.title}” [${p.kind === "new" ? "new capability" : "improvement"}, purpose ${p.purpose}] — ${v ? `${v.verdict}${v.rank ? ` #${v.rank}` : ""}: ${v.reason}${v.conditions.length ? `; binding conditions: ${v.conditions.join("; ")}` : ""}` : "no verdict"}`);
    lines.push(`  For the user: ${p.userChange}`);
    const fe = p.stances.feasibility;
    if (fe?.effort) lines.push(`  Effort (Feasibility): ${fe.effort}${fe.conditions ? `; ${fe.conditions}` : ""}`);
  }
  if (o.judgeAnswers.length) lines.push("", "Judge answers:", ...o.judgeAnswers.map((a) => `- ${a}`));
  if (o.openQuestions.length) lines.push("", "Open questions from the meeting:", ...o.openQuestions.map((q) => `- ${q}`));
  return lines.join("\n");
}
/** The Acceptance_Check formats, for every repository (the Adapter adds its endpoints and test hints). */
export const CHECK_FORMATS = [
  "# Acceptance check formats (JSON objects in acceptanceChecks)",
  '- {"id":"c1","kind":"test_suite","command":["python","manage.py","test","app.tests.test_x"],"timeoutS":600}: runs tests in the development sandbox.',
  '- {"id":"c2","kind":"browser_check","target":"run_environment","steps":[{"op":"goto","path":"/"},{"op":"fill","role":"textbox","name":"URL","value":"https://example.org"},{"op":"click","role":"button","name":"Save"},{"op":"expectText","text":"…"},{"op":"expectRole","role":"button","name":"…"}],"needsAi":true}: drives the changed app in a browser; set needsAi when the steps use a model-powered feature (the Verifier then requires that the app called the model). Prefer an expectText on text only the model\'s answer produces over a fixed label.',
  '- {"id":"c3","kind":"api_readback","target":"run_environment","expect":[{"key":"<item key>","mustExist":true,"fields":{"<field>":"<value>"}}]}: reads items back through the app API.',
  "Option ids: short lowercase words with dashes, for example local-model-tags.",
].join("\n");
const optionKey = (o: { kind: string; title: string; summary: string; acceptanceChecks: unknown[] }) => JSON.stringify([o.kind, o.title, o.summary, o.acceptanceChecks]);

export async function runDecisionDraft(o: DraftOptions): Promise<DraftResult> {
  const system = sharedSystemPrompt(o.rules, o.context);
  const meeting = renderMeeting(o);
  let turnNo = 0;
  async function turn(roleId: RoleId, ask: string, tool: AgentTool<any>, accepted: () => boolean): Promise<boolean> {
    // Measured 2026-11-23 on linkding: assessments with thinking took 99 to 186 s each (over 90 % reasoning tokens)
    // and 12 to 20 s without, of similar quality; the draft keeps low thinking for a better option structure.
    const thinkingLevel = roleId === "facilitator" ? (o.thinking?.draft ?? THINKING.decisionDraft) : (o.thinking?.assess ?? THINKING.decisionAssessment);
    if (o.signal.aborted) return false;
    const actor: Actor = { kind: "role", roleId };
    const prompt = `${meeting}\n\n---\n\n${CHECK_FORMATS}${o.checkHints ? `\n\n${o.checkHints}` : ""}\n\n---\n\n# Your role\n\n${roleText(o.rules, roleId)}\n\n---\n\n${ask}`;
    const id = `${o.idPrefix}-d${++turnNo}`;
    const r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt, tools: [tool], signal: o.signal, idPrefix: id, thinkingLevel });
    if (accepted() || o.signal.aborted || r.stopReason === "error") return accepted();
    const why = r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission");
    await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]} ended the turn without a valid ${tool.name} (${why}); one retry` } });
    const r2 = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid ${tool.name}. Call it now.`, tools: [tool], signal: o.signal, idPrefix: `${id}r`, thinkingLevel });
    if (!accepted() && !o.signal.aborted && r2.stopReason !== "error") await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]}'s ${tool.name} failed: ${r2.error ?? "no valid submission"}` } });
    return accepted();
  }

  // (1) The Facilitator's draft.
  let draft: DraftInput | null = null;
  const draftTool: AgentTool<any> = {
    name: "submit_decision_draft",
    label: "submit_decision_draft",
    description: "Submit the decision draft. Each approach option needs at least one executable acceptance check, or the Judge cannot choose it.",
    parameters: obj({
      purpose: oneOf(["A", "B"] as const),
      workflows: arr(obj({ proposal: str(), name: str(), purpose: oneOf(["A", "B"] as const), description: str() })),
      inScope: arr(str()),
      outOfScope: opt(arr(str())),
      acceptanceCriteria: arr(str()),
      approachOptions: arr(obj({ id: str(), kind: oneOf(["source_change", "ui_change", "mix"] as const), title: str(), summary: str(), acceptanceChecks: opt(arr(unknown())) })),
      uiImpact: str(),
      risks: opt(arr(str())),
      openQuestions: opt(arr(str())),
      aiRuntime: obj({ source: oneOf(["studio_service", "judge_endpoint", "local"] as const), endpoint: opt(str()), dataSent: arr(str()), reason: str() }),
    }),
    execute: async (_i, a: unknown) => {
      const p = DraftIn.safeParse(a);
      if (!p.success) return text(`Not accepted: ${err(p.error)}. Submit again.`, true);
      const problems: string[] = [];
      for (const w of p.data.workflows) if (!findProposal(o.proposals, w.proposal)) problems.push(`workflow "${w.name}" names no proposal of the meeting ("${w.proposal}")`);
      const ids = new Set<string>();
      for (const op of p.data.approachOptions) {
        if (ids.has(op.id)) problems.push(`option id "${op.id}" is used twice`);
        ids.add(op.id);
        op.acceptanceChecks.forEach((c, i) => {
          const r = AcceptanceCheckSchema.safeParse(c);
          if (!r.success) problems.push(`option "${op.id}", check ${i + 1}: ${err(r.error)}`);
        });
      }
      if (problems.length) return text(`Not accepted: ${problems.join("; ")}. Submit again.`, true);
      draft = p.data;
      return { ...text("Accepted."), terminate: true };
    },
  };
  const askDraft = o.previous
    ? `The Judge sent your previous draft back. Revise only what the rejections ask for; copy every other section exactly as it was, word for word, so the Judge's earlier verdicts stay valid.\n\nRejected items and reasons:\n${o.previous.rejections.map((r) => `- ${r.title}: ${r.reason}`).join("\n")}\n\nPrevious draft (JSON):\n${JSON.stringify(stripChecked(o.previous.content))}\n\nThen submit_decision_draft. Tell the Judge in at most 80 words what you changed.`
    : "Write the decision draft from the meeting result. Workflows: one per recommended proposal; set `proposal` to its id (P1, P2, …). Approach options: 2 or 3 different ways to build the top recommendations, each with executable acceptance checks. Carry the binding conditions into scope and risks. Fill aiRuntime following the AI runtime skill in the Task context: the model source the meeting and the Judge agreed (a local model only when the environment facts allow it), the endpoint if the Judge gave one, and the data sent. Then submit_decision_draft. Tell the Judge in at most 80 words what the draft says.";
  if (!(await turn("facilitator", askDraft, draftTool, () => draft !== null))) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Facilitator did not submit a valid decision draft" };
  const d = draft as DraftInput | null;
  if (!d) return { ok: false, reason: "no draft" };

  // (2) Assessments, at the same time; an option unchanged since the previous draft keeps its assessment.
  const prevOptions = new Map((o.previous?.content.approachOptions ?? []).map((x) => [x.id, x]));
  const unchanged = (op: Option) => {
    const prev = prevOptions.get(op.id);
    return prev && optionKey({ ...prev, acceptanceChecks: prev.assessment.acceptanceChecks }) === optionKey(op) ? prev : undefined;
  };
  const toAssess = d.approachOptions.filter((op: Option) => !unchanged(op));
  const parts: Record<"feasibility" | "risk", Map<string, Part>> = { feasibility: new Map(), risk: new Map() };
  const optionsText = toAssess.map((op: Option) => `- ${op.id} (${op.kind}) ${op.title}: ${op.summary}`).join("\n");
  const assessTool = (roleId: "feasibility" | "risk"): AgentTool<any> => ({
    name: "submit_assessment",
    label: "submit_assessment",
    description: roleId === "feasibility" ? "Submit feasibility, effort (small, medium or large; a first version for large), needed environments and claims with quotes, per option." : "Submit the risk and claims with quotes, per option.",
    parameters: obj({ assessments: arr(obj({ optionId: str(), feasibility: opt(str()), effort: opt(oneOf(["small", "medium", "large"] as const)), firstVersion: opt(str()), neededEnvironments: opt(arr(oneOf(["sandbox", "development_sandbox", "run_environment"] as const))), risk: opt(str()), claims: opt(arr(obj({ text: str(), quotes: opt(arr(obj({ path: str(), line: opt(int()), snippet: str() }))) }))) })) }),
    execute: async (_i, a: unknown) => {
      const p = AssessIn.safeParse(a);
      if (!p.success) return text(`Not accepted: ${err(p.error)}. Submit again.`, true);
      const missing = toAssess.filter((op: Option) => !p.data.assessments.some((x) => x.optionId === op.id)).map((op: Option) => op.id);
      const bad = p.data.assessments.filter((x) => (roleId === "feasibility" ? !x.feasibility || !x.effort : !x.risk)).map((x) => x.optionId);
      if (missing.length || bad.length) return text(`Not accepted: ${[missing.length ? `no assessment for ${missing.join(", ")}` : "", bad.length ? `${roleId === "feasibility" ? "feasibility and effort" : "risk"} missing for ${bad.join(", ")}` : ""].filter(Boolean).join("; ")}. Submit again.`, true);
      for (const x of p.data.assessments) parts[roleId].set(x.optionId, x);
      return { ...text("Accepted."), terminate: true };
    },
  });
  const askAssess = (r: "feasibility" | "risk") =>
    `Assess every approach option of the draft from your viewpoint:\n${optionsText}\n\n${r === "feasibility" ? "For each: is it feasible in this code, the effort (small, medium or large; for large name a small first version), the environments it needs, and up to 3 claims with quotes copied exactly from files." : "For each: the main risks and what keeps them acceptable, and up to 3 claims with quotes copied exactly from files."} Then submit_assessment. Tell the Judge in at most 60 words what matters most.`;
  if (toAssess.length) await Promise.all((["feasibility", "risk"] as const).map((r) => turn(r, askAssess(r), assessTool(r), () => parts[r].size > 0)));
  if (o.signal.aborted) return { ok: false, reason: "stopped" };

  // (3) Merge and check by code.
  const used: EvidenceRef[] = [];
  const checkClaims = (cs: Part["claims"]) =>
    cs.map((c) => {
      const r = checkConclusion(c.quotes, o.evidence);
      used.push(...r.evidence);
      return { text: stripIds(c.text).text, evidence: r.evidence, evidenceStatus: r.status };
    });
  const approachOptions = d.approachOptions.map((op: Option) => {
    const prev = unchanged(op);
    if (prev) {
      for (const c of prev.assessment.claims) used.push(...c.evidence);
      return prev;
    }
    const fe = parts.feasibility.get(op.id);
    const ri = parts.risk.get(op.id);
    const checks = op.acceptanceChecks.map((c: unknown) => AcceptanceCheckSchema.parse(c)) as AcceptanceCheckSpec[];
    return {
      id: op.id,
      kind: op.kind,
      title: stripIds(op.title).text.replace(/\(\s*\)/g, "").trim(),
      summary: stripIds(op.summary).text,
      assessment: {
        feasibility: fe?.feasibility ? stripIds(fe.feasibility).text : "",
        effort: fe?.effort ?? ("not_assessed" as const),
        ...(fe?.firstVersion ? { firstVersion: stripIds(fe.firstVersion).text } : {}),
        risk: ri?.risk ? stripIds(ri.risk).text : "",
        neededEnvironments: fe?.neededEnvironments ?? [],
        acceptanceChecks: checks,
        label: "LLM assessment, not a guarantee" as const,
        claims: [...checkClaims(fe?.claims ?? []), ...checkClaims(ri?.claims ?? [])],
        complete: checks.length > 0, // R37.5: computed by code
      },
    };
  });
  const workflows = d.workflows.map((w: DraftInput["workflows"][number], i: number) => {
    const p = findProposal(o.proposals, w.proposal)!;
    used.push(...p.evidence);
    return { id: `w${i + 1}`, name: stripIds(w.name).text, purpose: w.purpose, description: stripIds(w.description).text, evidence: p.evidence, evidenceStatus: p.evidenceStatus };
  });
  // R37.9: large changes are named as engineering risks; options nobody assessed are named too.
  const codeRisks = approachOptions.flatMap((op: DecisionDocContent["approachOptions"][number]) => [
    ...(op.assessment.effort === "large" ? [`Large change (engineering risk): ${op.title}${op.assessment.firstVersion ? `; a first version: ${op.assessment.firstVersion}` : ""}`] : []),
    ...(op.assessment.effort === "not_assessed" ? [`${op.title}: effort not assessed by Feasibility`] : []),
  ]);
  const seen = new Set<string>();
  const evidenceSources = used.filter((e) => {
    const k = `${e.path}\u0000${e.snippet}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  const content = {
    purpose: d.purpose,
    workflows,
    inScope: d.inScope,
    outOfScope: d.outOfScope,
    acceptanceCriteria: d.acceptanceCriteria,
    approachOptions,
    chosenApproachIds: [],
    uiImpact: stripIds(d.uiImpact).text,
    executableAcceptanceChecks: [],
    risks: [...d.risks.map((r: string) => stripIds(r).text), ...codeRisks],
    evidenceSources,
    openQuestions: d.openQuestions,
    aiRuntime: { ...d.aiRuntime, reason: stripIds(d.aiRuntime.reason).text },
  };
  const v = DecisionDocContentSchema.safeParse(content);
  if (!v.success) return { ok: false, reason: `the draft does not match the Decision_Doc schema: ${err(v.error)}` };
  return { ok: true, content: v.data, reassessed: toAssess.map((op: Option) => op.id) };
}

function findProposal(ps: Proposal[], ref: string): Proposal | undefined {
  const key = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return ps.find((p) => p.id.toLowerCase() === ref.trim().toLowerCase()) ?? ps.find((p) => key(p.title) === key(ref)) ?? ps.find((p) => key(p.title).includes(key(ref)) || key(ref).includes(key(p.title)));
}
/** The previous draft as the Facilitator wrote it (without code-computed parts), for a faithful revision. */
function stripChecked(c: DecisionDocContent) {
  return {
    purpose: c.purpose,
    workflows: c.workflows.map((w) => ({ proposal: w.name, name: w.name, purpose: w.purpose, description: w.description })),
    inScope: c.inScope,
    outOfScope: c.outOfScope,
    acceptanceCriteria: c.acceptanceCriteria,
    approachOptions: c.approachOptions.map((op) => ({ id: op.id, kind: op.kind, title: op.title, summary: op.summary, acceptanceChecks: op.assessment.acceptanceChecks })),
    uiImpact: c.uiImpact,
    risks: c.risks.filter((r) => !r.startsWith("Large change (engineering risk):") && !r.endsWith("effort not assessed by Feasibility")),
    openQuestions: c.openQuestions,
    ...(c.aiRuntime ? { aiRuntime: c.aiRuntime } : {}),
  };
}
