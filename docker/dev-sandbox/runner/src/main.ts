// Code_Agent runner entry (design: PiCodeRuntime). Runs inside the Development_Sandbox, one process per story
// attempt, started by the backend with a Docker exec (cwd /work). Embeds pi-coding-agent with an allow-listed
// tool set, an in-memory session, no context files and the custom `ask_question` tool; the only credential it
// holds is the per-Task credential for the LLM_Proxy. Commands arrive on stdin, events leave on stdout (one JSON
// object per line, see packages/shared/src/runner.ts). Environment, set by the backend:
//   GL_PROXY_BASE         LLM_Proxy base address, for example http://llm-proxy:8787/v1
//   GL_PROXY_CREDENTIAL   per-Task credential
//   GL_MODEL_ID           model id as the upstream knows it
//   GL_REASONING_PARAM    "send" or "omit", GL_REASONING_EFFORT "send" or "omit": the same options as the server profile
//   GL_MAX_TOKENS         default 32768
//   GL_RULES_FILE         Code_Agent rules, default /context/rules.md (from runtime-rules/roles/code_agent.md)
//   GL_CONTEXT_FILES      comma-separated files given to pi as project context (the focus pack, R40.19)
//   WORK_DIR              default /work; RUNNER_HOME default /tmp/runner-home (tmpfs)
import { appendFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createAgentSession, createBashToolDefinition, createExtensionRuntime, createLocalBashOperations, ModelRuntime, SessionManager, SettingsManager, type BashOperations, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { RunnerEvent } from "@graftlab/shared";
import { Type } from "typebox";
import { ASK_QUESTION_DESCRIPTION, RunnerController, type SessionLike } from "./controller.ts";
import { loadRules } from "./rules.ts";

const PROVIDER = "studio";
/**
 * Built-in tools plus ask_question. A custom tool is active only if it is also in this list (task 1.8). grep, find
 * and ls are pi's own search tools with truncated output (enabled 2026-11-24, R40.19).
 */
/**
 * Every shell command ends after at most BASH_MAX_S seconds (found 2026-11-25: one `grep -r` over the whole file
 * system ran until the Feature's 10-minute budget was gone). A longer timeout asked for by the model is lowered.
 */
export const BASH_MAX_S = 120;
export function cappedBash(base: BashOperations): BashOperations {
  return { exec: (command, cwd, o) => base.exec(command, cwd, { ...o, timeout: Math.min(o.timeout ?? BASH_MAX_S, BASH_MAX_S) }) };
}
export const TOOLS = ["read", "bash", "edit", "write", "grep", "find", "ls", "ask_question"];

const out = (e: RunnerEvent) => process.stdout.write(`${JSON.stringify(e)}\n`);
// GL_RUNNER_RECORD=<file>: append every raw pi event to that file (fixture recording only; the file stays in the container).
const recordFile = process.env.GL_RUNNER_RECORD;
const controller = new RunnerController({
  out,
  exit: (code) => process.exit(code),
  ...(recordFile ? { record: (e: unknown) => appendFileSync(recordFile, `${JSON.stringify(e)}\n`) } : {}),
});

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    out({ type: "runner_error", message: `missing ${name}` });
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const cwd = process.env.WORK_DIR ?? "/work";
  const home = process.env.RUNNER_HOME ?? "/tmp/runner-home";
  const modelId = required("GL_MODEL_ID");
  const sendEffort = process.env.GL_REASONING_EFFORT === "send";
  const rules = await loadRules();
  const contextFiles = await Promise.all(
    (process.env.GL_CONTEXT_FILES ?? "").split(",").map((x) => x.trim()).filter(Boolean).map(async (path) => ({ path, content: await readFile(path, "utf8") })),
  );
  const modelRuntime = await ModelRuntime.create({ authPath: `${home}/auth.json`, modelsPath: null });
  modelRuntime.registerProvider(PROVIDER, {
    name: "Studio LLM_Proxy",
    baseUrl: required("GL_PROXY_BASE"),
    api: "openai-completions",
    authHeader: true,
    models: [
      {
        id: modelId,
        name: modelId,
        reasoning: process.env.GL_REASONING_PARAM === "send",
        input: ["text"],
        contextWindow: 200_000,
        maxTokens: Number(process.env.GL_MAX_TOKENS ?? 32_768),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        compat: { supportsStore: false, maxTokensField: "max_tokens", ...(sendEffort ? { thinkingFormat: "deepseek" as const, supportsReasoningEffort: true } : {}) },
      },
    ],
  });
  await modelRuntime.setRuntimeApiKey(PROVIDER, required("GL_PROXY_CREDENTIAL"));
  const model = modelRuntime.getModel(PROVIDER, modelId);
  if (!model) throw new Error("the model could not be registered");

  const askQuestion: ToolDefinition = {
    name: "ask_question",
    label: "Ask question",
    description: ASK_QUESTION_DESCRIPTION,
    parameters: Type.Object({
      kind: Type.Union([Type.Literal("technical"), Type.Literal("feature")]),
      text: Type.String(),
      options: Type.Optional(Type.Array(Type.String())),
    }),
    execute: async (toolCallId: string, params: unknown) => controller.askQuestion(toolCallId, params),
  } as unknown as ToolDefinition;

  // No extensions, skills or prompt templates; the only context files are the ones the Studio names (the focus pack).
  const resourceLoader = {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: contextFiles }),
    getSystemPrompt: () => rules,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
  const { session } = await createAgentSession({
    cwd,
    agentDir: home,
    model,
    thinkingLevel: "low",
    modelRuntime,
    resourceLoader: resourceLoader as never,
    tools: TOOLS,
    // A custom tool with a built-in name replaces the built-in one; this bash differs only in its time cap.
    customTools: [askQuestion, createBashToolDefinition(cwd, { operations: cappedBash(createLocalBashOperations()) }) as unknown as ToolDefinition],
    sessionManager: SessionManager.inMemory(cwd),
    // No compaction. One automatic retry at most; every retry is forwarded as a visible `notice` event.
    settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: true, maxRetries: 1 } }),
  });
  controller.attach(session as unknown as SessionLike, { model: model.id, tools: session.getActiveToolNames() });
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => controller.handleLine(line));
  rl.on("close", () => void controller.close());
}

main().catch((err: unknown) => {
  out({ type: "runner_error", message: String((err as Error)?.message ?? err).slice(0, 300) });
  out({ type: "final", outcome: "error", detail: "the runner could not start" });
  process.exit(1);
});
