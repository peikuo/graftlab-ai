// PiRuntime with pi-ai's scripted faux provider (tasks.md 6.8): no network, no paid call.
import { createFauxCore, fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { obj, str } from "@earendil-works/pi-schema";
import { describe, expect, it } from "vitest";
import type { StudioModel } from "../llm/model.ts";
import { runAgentTurn, type Emit } from "./pi.ts";

function setup(responses: Parameters<ReturnType<typeof createFauxCore>["setResponses"]>[0]) {
  const core = createFauxCore({ api: "faux-test", provider: "faux-test", tokensPerSecond: 100000 });
  core.setResponses(responses);
  const model: StudioModel = { model: core.getModel() as StudioModel["model"], streamFn: core.streamSimple as StudioModel["streamFn"], getApiKey: () => "unused-in-faux" };
  const events: { type: string; payload: Record<string, unknown> }[] = [];
  const deltas: { channel: string; text: string }[] = [];
  const emit: Emit = async (d) => {
    events.push({ type: d.type, payload: d.payload as Record<string, unknown> });
  };
  const hub = { delta: (_id: string, channel: string, text: string) => deltas.push({ channel, text }) };
  return { model, events, deltas, emit, hub, core };
}

const recordTool = (sink: unknown[]) => ({
  name: "record_finding",
  label: "Record finding",
  description: "Record a finding",
  parameters: obj({ text: str(), path: str() }),
  execute: async (_id: string, params: unknown) => {
    sink.push(params);
    return { content: [{ type: "text" as const, text: "recorded" }], details: {} };
  },
});

describe("runAgentTurn", () => {
  it("maps a streamed answer with reasoning and a tool call to Studio events; deltas are not events", async () => {
    const recorded: unknown[] = [];
    const s = setup([
      fauxAssistantMessage([fauxThinking("Look at the models."), fauxToolCall("record_finding", { text: "Bookmark model", path: "bookmarks/models.py" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxText("Done reading.")]),
    ]);
    const r = await runAgentTurn({ roleId: "reader", purpose: "statement", systemPrompt: "rules", prompt: "read", tools: [recordTool(recorded)], model: s.model, emit: s.emit, hub: s.hub, idPrefix: "t1-reader" });
    expect(r).toMatchObject({ stopReason: "stop", text: "Done reading.", toolCalls: 1, truncated: false });
    expect(recorded).toEqual([{ text: "Bookmark model", path: "bookmarks/models.py" }]);
    const types = s.events.map((e) => e.type);
    expect(types.filter((t) => t === "message_started")).toHaveLength(2);
    expect(types.filter((t) => t === "message_completed")).toHaveLength(2);
    expect(types).toContain("tool_started");
    expect(types).toContain("tool_finished");
    expect(types.some((t) => t === "message_progress")).toBe(true);
    // Streamed text and reasoning reach the hub only, never the event list (R3.11, R27.7).
    expect(s.deltas.map((d) => d.channel)).toEqual(expect.arrayContaining(["reasoning", "text"]));
    expect(types).not.toContain("delta");
    const done = s.events.filter((e) => e.type === "message_completed").at(-1)!.payload;
    expect(done).toMatchObject({ text: "Done reading.", finishReason: "stop" });
    expect(done.usage).toHaveProperty("cacheReadTokens");
  });

  it("blocks a tool that is not in the step's list", async () => {
    const s = setup([fauxAssistantMessage([fauxToolCall("delete_everything", {})], { stopReason: "toolUse" }), fauxAssistantMessage("ok")]);
    const r = await runAgentTurn({ roleId: "reader", purpose: "statement", systemPrompt: "rules", prompt: "go", tools: [recordTool([])], model: s.model, emit: s.emit, idPrefix: "t2" });
    expect(r.stopReason).toBe("stop");
    const finished = s.events.find((e) => e.type === "tool_finished");
    expect(finished?.payload).toMatchObject({ tool: "delete_everything", ok: false });
  });

  it("a truncated answer is recorded as a failure and marked unusable (R30.13)", async () => {
    const s = setup([fauxAssistantMessage("half an answ", { stopReason: "length" })]);
    const r = await runAgentTurn({ roleId: "reader", purpose: "statement", systemPrompt: "rules", prompt: "go", tools: [], model: s.model, emit: s.emit, idPrefix: "t3" });
    expect(r.truncated).toBe(true);
    expect(s.events.find((e) => e.type === "failure")?.payload).toMatchObject({ failureClass: "llm_output_format_invalid" });
  });

  it("a model error becomes an incomplete message and a failure", async () => {
    const s = setup([fauxAssistantMessage("partial", { stopReason: "error", errorMessage: "HTTP 500" })]);
    const r = await runAgentTurn({ roleId: "reader", purpose: "statement", systemPrompt: "rules", prompt: "go", tools: [], model: s.model, emit: s.emit, idPrefix: "t4" });
    expect(r.stopReason).toBe("error");
    expect(s.events.map((e) => e.type)).toEqual(expect.arrayContaining(["message_started", "message_incomplete", "failure"]));
    expect(s.events.find((e) => e.type === "message_incomplete")?.payload).toMatchObject({ reason: "HTTP 500" });
  });
});
