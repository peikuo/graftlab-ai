// The LLM side of the Repo_Memo (design.md, "Repo_Memo", "Prompt caching"). Every call has the same system
// prompt and the same three submit tools in the same order, so all memo calls share one byte-identical prefix;
// only the user message (the batch) differs. Results arrive through a submit tool, validated by zod; an invalid
// submission is returned to the model once as an error (one visible retry, R23.5), then the call gives up.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";
import type { z } from "zod";
import type { StudioModel } from "../llm/model.ts";
import { systemPrompt, type RuntimeRules } from "../roles/rules.ts";
import { runAgentTurn, type Emit } from "../runtime/pi.ts";
import { DirMemoSchema, FileMemoSchema, RootMemoSchema, type BatchFile, type ChildLine, type FileMemoInput, type MemoWriter } from "./memo.ts";

type Kind = "files" | "directory" | "root";

const fileMemo = obj({ path: str(), purpose: str(), keySymbols: arr(str()), relatesTo: arr(str()), notes: opt(str()) });
const dirFields = { purpose: str(), contains: arr(str()), entryPoints: arr(str()), featuresHere: arr(str()) };

export interface PiMemoWriterOptions {
  model: StudioModel;
  rules: RuntimeRules;
  emit: Emit;
  /** Unique per Task, for message ids. */
  idPrefix: string;
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

export function piMemoWriter(o: PiMemoWriterOptions): MemoWriter {
  const system = systemPrompt(o.rules, "reader");
  let n = 0;

  async function call<T>(kind: Kind, prompt: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<T> {
    let accepted: T | undefined;
    let invalid = 0;
    const make = (name: string, k: Kind, parameters: ReturnType<typeof obj>, description: string): AgentTool<any> => ({
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
    // The same three tools, in the same order, on every memo call (one shared cache prefix).
    const tools = [
      make("submit_file_memos", "files", obj({ memos: arr(fileMemo) }), "Submit one memo for every file of the batch."),
      make("submit_directory_memo", "directory", obj(dirFields), "Submit the memo of the directory."),
      make("submit_root_memo", "root", obj({ ...dirFields, workflows: arr(obj({ name: str(), paths: arr(str()) })) }), "Submit the memo of the whole repository."),
    ];
    const r = await runAgentTurn({ roleId: "reader", purpose: "memo", systemPrompt: system, prompt, tools, model: o.model, emit: o.emit, signal, thinkingLevel: o.thinkingLevel ?? "low", idPrefix: `${o.idPrefix}-memo${++n}` });
    if (accepted === undefined) throw new Error(r.error ?? "the model submitted no valid memo");
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
      const prompt = `File memos for the directory "${dir || "/"}". Write one memo for each of these ${batch.length} files and submit them all with submit_file_memos.\n\n${body}`;
      return call<FileMemoInput[]>("files", prompt, FileMemoSchema.array(), signal);
    },
    directory: (path: string, children: ChildLine[], signal: AbortSignal) =>
      call<z.infer<typeof DirMemoSchema>>("directory", `Directory memo for "${path}/". Its children and their memos:\n\n${childText(children)}\n\nSubmit it with submit_directory_memo.`, DirMemoSchema, signal),
    root: (children: ChildLine[], signal: AbortSignal) =>
      call<z.infer<typeof RootMemoSchema>>("root", `Root memo for the whole repository. Its top-level children and their memos:\n\n${childText(children)}\n\nSubmit it with submit_root_memo.`, RootMemoSchema, signal),
  };
}
