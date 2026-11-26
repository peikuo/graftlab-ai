// Open execution (R42): the environment proposal, one structured turn of the Feasibility role. The LLM writes the
// install and test commands; code checks the shape and renders the Dockerfile itself. After a failed build the same
// turn gets the log tail and the previous proposal and proposes a changed environment.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import { readFileLines, renderReadFile } from "../reader/tools.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { EnvironmentProposalSchema, type EnvironmentProposal, type OpenFacts } from "./env.ts";

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });

export const BASE_IMAGE_FACTS = [
  "The image is built FROM the Studio's development image: Debian, Python 3.13 (`python3`), Node 24 with npm, git, curl. No database or other service runs, and none can be started.",
  "Your install commands run once at build time in /opt/target-src (the repository's source), with internet through the configured package indexes. For Python the Studio has already created and activated a fresh venv at /opt/open-venv; use `python -m pip install ...`. For Node use `npm ci` (or `npm install` without a lock file).",
  "Install only the dependencies the tests need. If you install the project itself (`pip install -e .` or `pip install .`), uninstall the project's own distribution afterwards (`python -m pip uninstall -y <name>`): the tests must import the changed code in /work (PYTHONPATH=/work/src:/work), not a copy.",
  "The test command runs later in /work WITHOUT internet; it must not download anything. Give it in argv form, for example [\"python\", \"-m\", \"pytest\", \"-q\"] or [\"npm\", \"test\"].",
  "Keep it as simple as possible; this is a best-effort build on the owner's machine.",
];

export interface ProposalOptions {
  rules: RuntimeRules;
  context: string;
  facts: OpenFacts;
  /** The repository's container configuration and dependency files, as read (path to text). */
  configTexts: { path: string; text: string }[];
  files: Map<string, string>;
  previous?: { proposal: EnvironmentProposal; log: string[] };
  emit: Emit;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
}

export async function proposeEnvironment(o: ProposalOptions): Promise<EnvironmentProposal | null> {
  let submitted: EnvironmentProposal | null = null;
  const submit: AgentTool<any> = {
    name: "submit_environment",
    label: "submit_environment",
    description: "Submit the simplest environment for running this repository's tests: kind, language, install commands, test command, difficulty, risks, summary.",
    parameters: obj({
      kind: oneOf(["library", "service"] as const),
      language: oneOf(["python", "node"] as const),
      install: arr(str()),
      test: arr(str()),
      difficulty: oneOf(["simple", "medium", "hard"] as const),
      risks: arr(str()),
      summary: str(),
    }),
    execute: async (_i, a: unknown) => {
      const r = EnvironmentProposalSchema.safeParse(a);
      if (!r.success) return text(`Not accepted: ${r.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}. Submit again.`, true);
      submitted = r.data;
      return { ...text("Accepted."), terminate: true };
    },
  };
  const readTool: AgentTool<any> = {
    name: "read_file",
    label: "read_file",
    description: "Read lines of a repository file (at most 400 lines).",
    parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }),
    execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))),
  };
  const files = o.configTexts.map((f) => `### ${f.path}\n\n\`\`\`\n${f.text.slice(0, 6000)}\n\`\`\``).join("\n\n");
  const retry = o.previous
    ? `\n\n---\n\n# The last build failed\n\nYour previous proposal:\n\n\`\`\`json\n${JSON.stringify(o.previous.proposal, null, 2)}\n\`\`\`\n\nThe end of the build log:\n\n\`\`\`\n${o.previous.log.slice(-40).join("\n")}\n\`\`\`\n\nSay in one or two sentences what went wrong, then submit a changed environment that fixes it.`
    : "";
  const prompt = [
    `# Your role\n\n${roleText(o.rules, "feasibility")}`,
    `# Task: the environment for open execution (no Adapter)\n\nThe owner wants to continue to development on this repository. Propose the simplest environment in which its tests can run, then call submit_environment. Say first, in at most 60 words, whether it can be built here, how hard it is and what the main risk is.`,
    `## Facts about the image\n\n${BASE_IMAGE_FACTS.map((f) => `- ${f}`).join("\n")}`,
    `## What Studio code found\n\n- Language: ${o.facts.language}\n- Container configuration of the repository: ${o.facts.containerConfig.length ? o.facts.containerConfig.join(", ") : "none"}\n- Dependency files: ${o.facts.dependencyFiles.join(", ") || "none"}\n\nkind: "library" for a library, middleware or component that is used by other software (tests only); "service" for an application that runs on its own.`,
    files ? `## The files\n\n${files}` : "",
  ]
    .filter(Boolean)
    .join("\n\n---\n\n") + retry;
  const system = sharedSystemPrompt(o.rules, o.context);
  const r = await o.runTurn({ roleId: "feasibility", purpose: "statement", systemPrompt: system, prompt, tools: [readTool, submit], signal: o.signal, idPrefix: o.idPrefix, thinkingLevel: "low" });
  if (submitted || o.signal.aborted || r.stopReason === "error") return submitted;
  await o.emit({ type: "failure", actor: { kind: "role", roleId: "feasibility" }, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `Feasibility ended the turn without a valid submit_environment (${r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission")}); one retry` } });
  await o.runTurn({ roleId: "feasibility", purpose: "statement", systemPrompt: system, prompt: `${prompt}\n\nYou ended your turn without a valid submit_environment. Call it now.`, tools: [readTool, submit], signal: o.signal, idPrefix: `${o.idPrefix}r`, thinkingLevel: "low" });
  return submitted;
}
