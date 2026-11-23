// The documenting node (design.md, "Planning and document-first"; R19.2, R20.4): the Planner writes the
// Requirements document for the confirmed plan in one submission; code checks that every story is covered and
// records the version. The technical documents follow in the technical design step (techdesign.ts).
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, str } from "@earendil-works/pi-schema";
import { RequirementsDocSchema, stripIds, type Plan, type RequirementsDoc } from "@graftlab/shared";
import { THINKING } from "../llm/thinking.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { renderPlanMarkdown } from "./render.ts";

export interface RequirementsOptions {
  rules: RuntimeRules;
  context: string;
  decisionMarkdown: string;
  plan: Plan;
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  thinking?: "off" | "low";
}
export type RequirementsResult = { ok: true; requirements: RequirementsDoc } | { ok: false; reason: string };

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });

/** Checks the submitted Requirements against the confirmed plan. */
export function checkRequirements(a: unknown, plan: Plan): { ok: true; requirements: RequirementsDoc } | { ok: false; problems: string[] } {
  const r = RequirementsDocSchema.safeParse({ ...((a ?? {}) as object), decisionVersion: plan.decisionVersion });
  if (!r.success) return { ok: false, problems: r.error.issues.map((i) => `requirements: ${i.path.join(".")} ${i.message}`) };
  const ids = plan.backlog.stories.map((s) => s.id);
  const problems = [
    ...ids.filter((id) => !r.data.items.some((i) => i.storyId === id)).map((id) => `requirements: no item for story ${id}`),
    ...[...new Set(r.data.items.map((i) => i.storyId).filter((s) => !ids.includes(s)))].map((s) => `requirements: unknown story ${s}`),
  ];
  if (problems.length) return { ok: false, problems };
  return { ok: true, requirements: { ...r.data, introduction: stripIds(r.data.introduction).text } };
}

export async function runRequirements(o: RequirementsOptions): Promise<RequirementsResult> {
  const system = sharedSystemPrompt(o.rules, o.context);
  let doc: RequirementsDoc | null = null;
  const tools: AgentTool<any>[] = [
    {
      name: "submit_requirements",
      label: "submit_requirements",
      description: "Submit the Requirements document: an introduction and one item per acceptance criterion, linked to its story.",
      parameters: obj({ introduction: str(), items: arr(obj({ id: str(), storyId: str(), text: str(), acceptance: arr(str()) })) }),
      execute: async (_i, a: unknown) => {
        const r = checkRequirements(a, o.plan);
        if (!r.ok) return text(`Not accepted: ${r.problems.slice(0, 6).join("; ")}. Submit again.`, true);
        doc = r.requirements;
        return { ...text("Accepted."), terminate: true };
      },
    },
  ];
  const prompt = `# Frozen Decision_Doc (version ${o.plan.decisionVersion})\n\n${o.decisionMarkdown}\n\n---\n\n# Your role\n\n${roleText(o.rules, "planner")}\n\n---\n\nThe Judge confirmed this plan:\n\n${renderPlanMarkdown(o.plan)}\n\nWrite the Requirements document: one item per acceptance criterion (ids R1, R2, ...), each linked to its story and with how it is accepted. Then submit_requirements. Tell the Judge in at most 60 words what it contains.`;
  const thinkingLevel = o.thinking ?? THINKING.documents;
  const r = await o.runTurn({ roleId: "planner", purpose: "statement", systemPrompt: system, prompt, tools, signal: o.signal, idPrefix: `${o.idPrefix}-req`, thinkingLevel });
  if (!doc && !o.signal.aborted && r.stopReason !== "error") {
    await o.emit({ type: "failure", actor: { kind: "role", roleId: "planner" }, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `Planner ended the turn without valid requirements (${r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission")}); one retry` } });
    await o.runTurn({ roleId: "planner", purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid submit_requirements. Call it now.`, tools, signal: o.signal, idPrefix: `${o.idPrefix}-reqr`, thinkingLevel });
  }
  const got = doc as RequirementsDoc | null;
  return got ? { ok: true, requirements: got } : { ok: false, reason: o.signal.aborted ? "stopped" : "the Planner did not submit valid requirements" };
}
