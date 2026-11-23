// The LLM side of the Repo_Memo (design.md, "Repo_Memo", "Prompt caching"). Every Reader call has the same
// system prompt and the same submit tools in the same order, so all calls share one byte-identical prefix; only
// the user message differs. Results arrive through a submit tool, validated by zod; an invalid submission is
// returned to the model once as an error (one visible retry, R23.5), then the call gives up. A call that ends
// without a valid submission is a visible failure, never a silent empty result.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { z } from "zod";
import type { StudioModel } from "../llm/model.ts";
import { systemPrompt, type RuntimeRules } from "../roles/rules.ts";
import { runAgentTurn, type DeltaSink, type Emit } from "../runtime/pi.ts";
import { THINKING } from "../llm/thinking.ts";
import { BRIEF_KINDS, ReadingPlanSchema, RepoBriefSchema, type BriefWriter, type ReadingPlan, type RepoBrief } from "./brief.ts";
import { DirMemoSchema, FileMemoSchema, RootMemoSchema, type BatchFile, type ChildLine, type FileMemoInput, type MemoWriter } from "./memo.ts";

type Kind = "plan" | "files" | "brief" | "directory" | "root";

const fileMemo = obj({ path: str(), purpose: str(), keySymbols: arr(str()), relatesTo: arr(str()), features: opt(arr(str())), notes: opt(str()) });
const paths = arr(str());
const briefParams = obj({
  what: obj({ text: str(), kind: oneOf(BRIEF_KINDS), sources: paths }),
  users: arr(obj({ who: str(), jobs: arr(str()), sources: paths })),
  howItRuns: obj({ stack: arr(str()), parts: arr(obj({ name: str(), role: str(), paths })), entryPoints: arr(str()), sources: paths }),
  concepts: arr(obj({ name: str(), meaning: str(), paths })),
  features: arr(obj({ name: str(), userAction: str(), paths })),
  extensionPoints: arr(obj({ where: str(), couldAttach: str(), paths })),
  unknowns: arr(obj({ question: str(), why: str() })),
});
const dirFields = { purpose: str(), contains: arr(str()), entryPoints: arr(str()), featuresHere: arr(str()) };

export interface PiMemoWriterOptions {
  model: StudioModel;
  rules: RuntimeRules;
  emit: Emit;
  /** Streamed text and reasoning go to the SSE hub only, never to the event store. */
  hub?: DeltaSink;
  /** Unique per Task, for message ids. */
  idPrefix: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** The reading plan is a selection from a ranked list: no thinking by default (measured 2026-11-23). */
  planThinkingLevel?: "off" | "low" | "medium" | "high";
}

export function piMemoWriter(o: PiMemoWriterOptions): MemoWriter & BriefWriter {
  const system = systemPrompt(o.rules, "reader");
  let n = 0;

  async function call<T>(kind: Kind, prompt: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    let accepted: T | undefined;
    let invalid = 0;
    const make = (name: string, k: Kind, parameters: any, description: string): AgentTool<any> => ({
      name,
      label: name,
      description,
      parameters,
      execute: async (_id, args) => {
        if (k !== kind) return { content: [{ type: "text", text: `Wrong tool: this request needs the ${kind} submission.` }], details: {}, isError: true };
        const parsed = schema.safeParse(k === "files" ? (args as { memos: unknown }).memos : args);
        if (parsed.success) {
          accepted = parsed.data;
          return { content: [{ type: "text", text: "Accepted." }], details: {}, terminate: true };
        }
        invalid++;
        const issue = parsed.error.issues[0];
        return { content: [{ type: "text", text: `Not accepted: ${issue?.path.join(".") || "input"} ${issue?.message ?? "is invalid"}. Submit again.` }], details: {}, isError: true, terminate: invalid >= 2 };
      },
    });
    // The same tools, in the same order, on every Reader call (one shared cache prefix).
    const tools = [
      make("submit_reading_plan", "plan", obj({ files: arr(obj({ path: str(), why: str() })) }), "Submit the files you will read, each with why."),
      make("submit_file_memos", "files", obj({ memos: arr(fileMemo) }), "Submit one memo for every file of the batch."),
      make("submit_repo_brief", "brief", briefParams, "Submit the Repo_Brief of the whole repository."),
      make("submit_directory_memo", "directory", obj(dirFields), "Submit the memo of the directory."),
      make("submit_root_memo", "root", obj({ ...dirFields, workflows: arr(obj({ name: str(), paths: arr(str()) })) }), "Submit the memo of the whole repository."),
    ];
    const r = await runAgentTurn({ roleId: "reader", purpose: "memo", systemPrompt: system, prompt, tools, model: o.model, emit: o.emit, ...(o.hub ? { hub: o.hub } : {}), signal, thinkingLevel: kind === "plan" ? (o.planThinkingLevel ?? THINKING.readerPlan) : kind === "brief" || kind === "root" ? (o.thinkingLevel ?? THINKING.readerBrief) : (o.thinkingLevel ?? THINKING.readerMemo), idPrefix: `${o.idPrefix}-memo${++n}`, maxToolErrors: 3 });
    if (accepted === undefined) {
      const why = r.error ?? (r.toolCalls === 0 ? "it answered without calling the submit tool" : "no submission was valid");
      // A model-call error already produced its own failure event in runAgentTurn; everything else is recorded here.
      if (r.stopReason !== "error" && !signal.aborted) await o.emit({ type: "failure", actor: { kind: "role", roleId: "reader" }, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `the Reader ended without a valid ${kind} submission: ${why}` } });
      throw new Error(why);
    }
    return accepted;
  }

  const childText = (children: ChildLine[]) => children.map((c) => `- ${c.kind === "directory" ? `${c.path}/` : c.path}: ${c.line}`).join("\n");

  return {
    files: (dir: string, batch: BatchFile[], signal: AbortSignal) => {
      const body = batch
        .map((f) => {
          const m = f.map;
          const facts = [`${m.lines} lines`, m.symbols.length ? `symbols: ${m.symbols.slice(0, 12).join(", ")}` : "", m.imports.length ? `imports: ${m.imports.join(", ")}` : "", f.cut ? "cut: only the beginning is shown" : ""].filter(Boolean).join("; ");
          return `### ${f.path}\n(${facts})\n\`\`\`\n${f.text}\n\`\`\``;
        })
        .join("\n\n");
      const where = dir.startsWith("(") ? dir : `the directory "${dir || "/"}"`;
      const prompt = `File memos for ${where}. Write one memo for each of these ${batch.length} files and submit them all with submit_file_memos.\n\n${body}`;
      return call<FileMemoInput[]>("files", prompt, FileMemoSchema.array(), signal);
    },
    plan: (prompt: string, signal: AbortSignal) => call<ReadingPlan>("plan", prompt, ReadingPlanSchema, signal),
    brief: (prompt: string, signal: AbortSignal) => call<RepoBrief>("brief", prompt, RepoBriefSchema, signal),
    directory: (path: string, children: ChildLine[], signal: AbortSignal) =>
      call<z.infer<typeof DirMemoSchema>>("directory", `Directory memo for "${path}/". Its children and their memos:\n\n${childText(children)}\n\nSubmit it with submit_directory_memo.`, DirMemoSchema, signal),
    root: (children: ChildLine[], signal: AbortSignal) =>
      call<z.infer<typeof RootMemoSchema>>("root", `Root memo for the whole repository. Its top-level children and their memos:\n\n${childText(children)}\n\nSubmit it with submit_root_memo.`, RootMemoSchema, signal),
  };
}
