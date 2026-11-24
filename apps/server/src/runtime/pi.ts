// PiRuntime: one agent turn on pi-agent-core, mapped to Studio events (design.md, "PiRuntime", "Prompt caching";
// R2.4, R2.8, R3.6-R3.13, R27.7, R30.12, R30.13). Streamed text goes to the SSE hub as deltas and is never
// persisted; complete messages, incomplete messages and lifecycle events are. Only the tools given here exist for
// the agent (a node's whitelist is enforced by construction and again in beforeToolCall).
import { Agent, type AgentEvent, type AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { Actor, PayloadOf, RoleId } from "@graftlab/shared";
import type { EventDraft } from "../events/store.ts";
import type { StudioModel } from "../llm/model.ts";

export type Emit = (draft: Omit<EventDraft, "node">) => Promise<void>;

export interface DeltaSink {
  delta(messageId: string, channel: "text" | "reasoning" | "toolcall", text: string): void;
}

export interface TurnOptions {
  roleId: RoleId;
  purpose: PayloadOf<"message_started">["purpose"];
  systemPrompt: string;
  prompt: string;
  tools: AgentTool<any>[];
  model: StudioModel;
  emit: Emit;
  hub?: DeltaSink;
  signal?: AbortSignal;
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** Prefix of message ids, unique per Task (for example "reader-3"). */
  idPrefix: string;
  /** message_progress at most this often while streaming (GL_PROGRESS_INTERVAL_S, default 5 s), and at each phase change. */
  progressEveryMs?: number;
  /** Stop the turn after this many rejected tool calls (including argument validation by pi), so a model cannot loop. */
  maxToolErrors?: number;
  now?: () => number;
}

export interface TurnResult {
  stopReason: AssistantMessage["stopReason"] | "none";
  text: string;
  toolCalls: number;
  truncated: boolean;
  error?: string;
}

function textOf(m: AssistantMessage): string {
  return m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("");
}

function reasoningOf(m: AssistantMessage): string {
  return m.content.flatMap((c) => (c.type === "thinking" ? [c.thinking] : [])).join("");
}

function summarize(v: unknown, max = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Runs one prompt to completion (the agent may call tools and take several model turns). */
export async function runAgentTurn(o: TurnOptions): Promise<TurnResult> {
  const actor: Actor = { kind: "role", roleId: o.roleId };
  const now = o.now ?? Date.now;
  const every = o.progressEveryMs ?? 5000;
  const allowed = new Set(o.tools.map((t) => t.name));
  const result: TurnResult = { stopReason: "none", text: "", toolCalls: 0, truncated: false };
  let seq = 0;
  let toolErrors = 0;
  let gaveUp: string | undefined;
  let current: { id: string; phase: string; lastProgress: number; text: number; reasoning: number } | null = null;

  const agent = new Agent({
    initialState: { systemPrompt: o.systemPrompt, model: o.model.model, thinkingLevel: o.thinkingLevel ?? "low", tools: o.tools },
    streamFn: o.model.streamFn,
    getApiKey: o.model.getApiKey,
    toolExecution: "sequential",
    beforeToolCall: async ({ toolCall }) => (allowed.has(toolCall.name) ? undefined : { block: true, reason: `the tool "${toolCall.name}" is not available in this step` }),
  });

  const progress = async (phase: "thinking" | "speaking" | "tool_call") => {
    if (!current) return;
    const t = now();
    if (current.phase === phase && t - current.lastProgress < every) return;
    current.phase = phase;
    current.lastProgress = t;
    await o.emit({ type: "message_progress", actor, payload: { messageId: current.id, phase, textChars: current.text, reasoningChars: current.reasoning } });
  };

  agent.subscribe(async (e: AgentEvent) => {
    switch (e.type) {
      case "message_start": {
        if (e.message.role !== "assistant") return;
        current = { id: `${o.idPrefix}-m${++seq}`, phase: "waiting", lastProgress: 0, text: 0, reasoning: 0 };
        await o.emit({ type: "message_started", actor, payload: { messageId: current.id, roleId: o.roleId, purpose: o.purpose } });
        return;
      }
      case "message_update": {
        if (!current) return;
        const a = e.assistantMessageEvent;
        if (a.type === "thinking_delta") {
          current.reasoning += a.delta.length;
          o.hub?.delta(current.id, "reasoning", a.delta);
          await progress("thinking");
        } else if (a.type === "text_delta") {
          current.text += a.delta.length;
          o.hub?.delta(current.id, "text", a.delta);
          await progress("speaking");
        } else if (a.type === "toolcall_start" || a.type === "toolcall_delta") {
          await progress("tool_call");
        }
        return;
      }
      case "message_end": {
        if (e.message.role !== "assistant" || !current) return;
        const m = e.message as AssistantMessage;
        const id = current.id;
        current = null;
        result.stopReason = m.stopReason;
        if (m.stopReason === "error" || m.stopReason === "aborted") {
          const reason = m.stopReason === "aborted" ? (gaveUp ?? "stopped") : summarize(m.errorMessage ?? "the model call failed", 300);
          result.error = reason;
          await o.emit({ type: "message_incomplete", actor, payload: { messageId: id, partialText: textOf(m), reason } });
          if (m.stopReason === "error") await o.emit({ type: "failure", actor, payload: { failureClass: "interface_call_failure", source: "llm", detail: `the model call failed: ${reason}` } });
          return;
        }
        const text = textOf(m);
        result.text += text;
        const reasoning = reasoningOf(m);
        const u = m.usage;
        await o.emit({
          type: "message_completed",
          actor,
          payload: {
            messageId: id,
            text,
            ...(reasoning ? { reasoning } : {}),
            finishReason: m.stopReason,
            usage: { inputTokens: u.input + u.cacheRead, outputTokens: u.output, ...(u.reasoning !== undefined ? { reasoningTokens: u.reasoning } : {}), cacheReadTokens: u.cacheRead },
          },
        });
        if (m.stopReason === "length") {
          // R30.13: a truncated answer is a failure and its output is not used.
          result.truncated = true;
          await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: "the model's answer was cut off before it finished" } });
        }
        return;
      }
      case "tool_execution_start": {
        result.toolCalls++;
        await o.emit({ type: "tool_started", actor, payload: { callId: e.toolCallId, tool: e.toolName, inputSummary: summarize(e.args) } });
        return;
      }
      case "tool_execution_end": {
        const ok = !(e as { isError?: boolean }).isError;
        const out = (e.result as { content?: { type: string; text?: string }[] } | undefined)?.content?.find((c) => c.type === "text")?.text ?? "";
        await o.emit({ type: "tool_finished", actor, payload: { callId: e.toolCallId, tool: e.toolName, ok, outputSummary: summarize(out) } });
        // Only refused submissions and malformed arguments count; a read of a missing file is ordinary work.
        const rejected = !ok && (e.toolName.startsWith("submit_") || /^(Validation failed|Invalid arguments)/.test(out));
        if (rejected && o.maxToolErrors !== undefined && ++toolErrors >= o.maxToolErrors && !gaveUp) {
          gaveUp = `gave up after ${toolErrors} rejected tool calls`;
          agent.abort();
        }
        return;
      }
      default:
        return;
    }
  });

  const onAbort = () => agent.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (o.signal?.aborted) return { ...result, stopReason: "aborted", error: "stopped" };
    await agent.prompt(o.prompt);
    await agent.waitForIdle();
  } finally {
    o.signal?.removeEventListener("abort", onAbort);
  }
  if (gaveUp) return { ...result, stopReason: "aborted", error: gaveUp };
  return result;
}
