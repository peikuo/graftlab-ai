// The documenting node (design.md, "Planning and document-first"; R19.2, R19.4, R20.4, R39.9, R39.10). The
// Planner writes the requirements, design and tasks documents for the analyzed repository in one submission;
// code checks that every confirmed story is covered, checks the run-environment quotes, and records the version.
// The Studio supplies no fallback start recipe: the run environment comes from the target's own files.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, int, obj, opt, str } from "@earendil-works/pi-schema";
import { DesignDocSchema, RequirementsDocSchema, stripIds, TasksDocSchema, type DesignDoc, type Plan, type RequirementsDoc, type TasksDoc } from "@graftlab/shared";
import { checkConclusion, type EvidenceFiles } from "../evidence/check.ts";
import { THINKING } from "../llm/thinking.ts";
import { readFileLines, renderReadFile, renderSearch, searchRepo } from "../reader/tools.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { renderPlanMarkdown } from "./render.ts";

export interface DocumentsOptions {
  rules: RuntimeRules;
  context: string;
  decisionMarkdown: string;
  plan: Plan;
  /** Adapted_Repo with a source-change story: the design needs a run environment from the target's files. */
  needsRunEnvironment: boolean;
  /** What the run environment offers (from the Adapter): preinstalled dependencies, no internet. */
  environmentNote?: string;
  thinking?: "off" | "low";
  files: Map<string, string>;
  evidence: EvidenceFiles;
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
}
export type DocumentsResult = { ok: true; requirements: RequirementsDoc; design: DesignDoc; tasks: TasksDoc } | { ok: false; reason: string };

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });

/** Checks the submitted documents against the confirmed plan; returns the documents or the problems. */
export function checkDocuments(a: unknown, o: Pick<DocumentsOptions, "plan" | "needsRunEnvironment" | "evidence">): { ok: true; requirements: RequirementsDoc; design: DesignDoc; tasks: TasksDoc } | { ok: false; problems: string[] } {
  const v = o.plan.decisionVersion;
  const x = (a ?? {}) as { requirements?: Record<string, unknown>; design?: Record<string, unknown>; tasks?: Record<string, unknown> };
  const problems: string[] = [];
  const req = RequirementsDocSchema.safeParse({ ...x.requirements, decisionVersion: v });
  const design0 = x.design as { runEnvironment?: { evidence?: unknown[] } } | undefined;
  if (Array.isArray(design0?.runEnvironment?.evidence)) design0.runEnvironment.evidence = design0.runEnvironment.evidence.slice(0, 10);
  const des = DesignDocSchema.safeParse({ ...x.design, decisionVersion: v });
  const tas = TasksDocSchema.safeParse({ ...x.tasks, decisionVersion: v });
  for (const [name, r] of [["requirements", req], ["design", des], ["tasks", tas]] as const) if (!r.success) problems.push(`${name}: ${r.error.issues[0]?.path.join(".")} ${r.error.issues[0]?.message}`);
  if (!req.success || !des.success || !tas.success) return { ok: false, problems };
  const ids = o.plan.backlog.stories.map((s) => s.id);
  for (const id of ids) {
    if (!req.data.items.some((i) => i.storyId === id)) problems.push(`requirements: no item for story ${id}`);
    if (!des.data.changes.some((c) => c.storyId === id)) problems.push(`design: no change for story ${id}`);
    if (!tas.data.items.some((t) => t.storyId === id)) problems.push(`tasks: no item for story ${id}`);
  }
  const unknownIds = [...req.data.items.map((i) => i.storyId), ...des.data.changes.map((c) => c.storyId), ...tas.data.items.map((t) => t.storyId)].filter((s) => !ids.includes(s));
  if (unknownIds.length) problems.push(`unknown story ids: ${[...new Set(unknownIds)].join(", ")}`);
  if (o.needsRunEnvironment && !des.data.runEnvironment) problems.push("design: runEnvironment is required (how to build and start the changed software, from its own files)");
  if (problems.length) return { ok: false, problems };
  const design = { ...des.data };
  if (design.runEnvironment) {
    // Every quote is checked by code; a command without a found quote stays, marked Unverified.
    const checked = checkConclusion(design.runEnvironment.evidence, o.evidence);
    design.runEnvironment = { ...design.runEnvironment, evidence: checked.evidence.map((e) => ({ path: e.path, ...(e.line ? { line: e.line } : {}), snippet: e.snippet, status: e.status ?? "unverified" })) };
  }
  const clean = (s: string) => stripIds(s).text;
  return {
    ok: true,
    requirements: { ...req.data, introduction: clean(req.data.introduction) },
    design: { ...design, overview: clean(design.overview) },
    tasks: tas.data,
  };
}

export async function runDocuments(o: DocumentsOptions): Promise<DocumentsResult> {
  const system = sharedSystemPrompt(o.rules, o.context);
  let docs: { requirements: RequirementsDoc; design: DesignDoc; tasks: TasksDoc } | null = null;
  const tools: AgentTool<any>[] = [
    { name: "read_file", label: "read_file", description: "Read lines of a repository file (at most 400 lines).", parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }), execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))) },
    { name: "search_repo", label: "search_repo", description: "Literal search over the repository files.", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(renderSearch(a.query, searchRepo(o.files, a.query))) },
    {
      name: "submit_documents",
      label: "submit_documents",
      description: "Submit the requirements, design and tasks documents for the confirmed plan in one call.",
      parameters: obj({
        requirements: obj({ introduction: str(), items: arr(obj({ id: str(), storyId: str(), text: str(), acceptance: arr(str()) })) }),
        design: obj({
          overview: str(),
          changes: arr(obj({ storyId: str(), area: str(), description: str() })),
          runEnvironment: opt(obj({ buildCommands: arr(str()), startCommands: arr(str()), port: int(), healthPath: str(), evidence: arr(obj({ path: str(), line: opt(int()), snippet: str() })) })),
        }),
        tasks: obj({ items: arr(obj({ id: str(), storyId: str(), title: str(), steps: arr(str()) })) }),
      }),
      execute: async (_i, a: unknown) => {
        const r = checkDocuments(a, o);
        if (!r.ok) return text(`Not accepted: ${r.problems.slice(0, 6).join("; ")}. Submit again.`, true);
        docs = { requirements: r.requirements, design: r.design, tasks: r.tasks };
        return { ...text("Accepted."), terminate: true };
      },
    },
  ];
  const runEnv = o.needsRunEnvironment
    ? ` The design needs \`runEnvironment\`: read the software's own files (for example its Dockerfile, scripts, package.json, pyproject.toml, README) and give the build and start commands, the app port and the health path, each backed by quotes copied exactly from those files. Never guess a command.${o.environmentNote ? ` ${o.environmentNote}` : ""}`
    : "";
  const ask = [
    `The Judge confirmed this plan:\n\n${renderPlanMarkdown(o.plan)}`,
    `Write the requirements, design and tasks documents for it. Cover every story (by its id).${runEnv} Then submit_documents. Tell the Judge in at most 80 words what the documents contain.`,
  ].join("\n\n---\n\n");
  const prompt = `# Frozen Decision_Doc (version ${o.plan.decisionVersion})\n\n${o.decisionMarkdown}\n\n---\n\n# Your role\n\n${roleText(o.rules, "planner")}\n\n---\n\n${ask}`;
  const r = await o.runTurn({ roleId: "planner", purpose: "statement", systemPrompt: system, prompt, tools, signal: o.signal, idPrefix: `${o.idPrefix}-docs`, thinkingLevel: o.thinking ?? THINKING.documents });
  if (!docs && !o.signal.aborted && r.stopReason !== "error") {
    await o.emit({ type: "failure", actor: { kind: "role", roleId: "planner" }, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `Planner ended the turn without valid documents (${r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission")}); one retry` } });
    await o.runTurn({ roleId: "planner", purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid submit_documents. Call it now.`, tools, signal: o.signal, idPrefix: `${o.idPrefix}-docsr`, thinkingLevel: o.thinking ?? THINKING.documents });
  }
  const got = docs as { requirements: RequirementsDoc; design: DesignDoc; tasks: TasksDoc } | null;
  if (!got) return { ok: false, reason: o.signal.aborted ? "stopped" : "the Planner did not submit valid documents" };
  return { ok: true, ...got };
}
