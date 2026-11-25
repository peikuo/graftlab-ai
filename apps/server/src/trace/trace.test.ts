// Local prompt trace (R35): a finished turn is written with its full prompts, messages and tool results, and a
// registered secret is redacted in the file.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { obj, str } from "@earendil-works/pi-schema";
import { SecretRegistry } from "@graftlab/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { StudioModel } from "../llm/model.ts";
import { runAgentTurn, setTurnTraceSink } from "../runtime/pi.ts";
import { TraceWriter } from "./trace.ts";
afterEach(() => setTurnTraceSink(null));
describe("prompt trace", () => {
  it("writes every turn with prompts, tool calls with full arguments and results, redacted", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gl-trace-"));
    const secrets = new SecretRegistry();
    secrets.register("llm_key", "sk-secret-value-123456");
    const w = new TraceWriter(dataDir, secrets, () => "t1");
    setTurnTraceSink((t) => w.turn(t));
    const core = createFauxCore({ api: "faux-tr", provider: "faux-tr", tokensPerSecond: 1_000_000 });
    const longArg = "x".repeat(500);
    core.setResponses([fauxAssistantMessage([fauxToolCall("submit_x", { value: longArg })], { stopReason: "toolUse" }), fauxAssistantMessage("done")]);
    const model: StudioModel = { model: core.getModel() as StudioModel["model"], streamFn: core.streamSimple as StudioModel["streamFn"], getApiKey: () => "unused" };
    const tool = { name: "submit_x", label: "submit_x", description: "submit", parameters: obj({ value: str() }), execute: async () => ({ content: [{ type: "text" as const, text: "Not accepted: the key sk-secret-value-123456 leaked" }], details: {}, isError: true }) };
    await runAgentTurn({ roleId: "planner", purpose: "statement", systemPrompt: "SYSTEM RULES", prompt: "THE PROMPT", tools: [tool], model, emit: async () => {}, idPrefix: "t1-plan1" });
    const files = await readdir(join(dataDir, "tasks", "t1", "traces"));
    expect(files).toHaveLength(1);
    const text = await readFile(join(dataDir, "tasks", "t1", "traces", files[0]!), "utf8");
    const t = JSON.parse(text);
    expect(t.systemPrompt).toBe("SYSTEM RULES");
    expect(t.prompt).toBe("THE PROMPT");
    expect(t.messages[0].toolCalls[0]).toEqual({ name: "submit_x", arguments: { value: longArg } });
    expect(t.toolResults[0]).toMatchObject({ name: "submit_x", ok: false });
    expect(text).not.toContain("sk-secret-value-123456");
    expect(t.redactedSecrets).toEqual(["llm_key"]);
  });
});
