// Code_Agent runner protocol (design: PiCodeRuntime; R38.7, R40.2, R40.11, R40.13). Shared by the runner inside
// the Development_Sandbox (writes events, reads commands) and the backend (writes commands, reads events), and both
// sides validate with these schemas. `createPiEventMapper` is the one place where a pi session event becomes a
// normalized runner event. It is structural (no pi import), so this package stays platform-neutral.
import { z } from "zod";

const Text = z.string().min(1).max(20_000);

/** stdin: one JSON object per line. */
export const RunnerCommand = z.discriminatedUnion("cmd", [
  z.strictObject({ cmd: z.literal("prompt"), text: Text }),
  z.strictObject({ cmd: z.literal("answer"), questionId: z.string().min(1).max(200), text: Text }),
  z.strictObject({ cmd: z.literal("steer"), text: Text }),
  z.strictObject({ cmd: z.literal("abort") }),
]);
export type RunnerCommand = z.infer<typeof RunnerCommand>;

/** Arguments of the custom `ask_question` tool (validated again in the runner, not only by the model's schema). */
export const AskQuestionArgs = z.strictObject({
  kind: z.enum(["technical", "feature"]),
  text: z.string().min(1).max(2000),
  options: z.array(z.string().min(1).max(300)).max(6).optional(),
});
export type AskQuestionArgs = z.infer<typeof AskQuestionArgs>;

const Usage = z.strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cacheReadTokens: z.number().int().nonnegative(),
});

/** stdout: one JSON object per line. */
export const RunnerEvent = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("ready"), model: z.string(), tools: z.array(z.string()) }),
  z.strictObject({ type: z.literal("message_start"), messageId: z.string() }),
  z.strictObject({ type: z.literal("delta"), messageId: z.string(), channel: z.enum(["text", "reasoning"]), text: z.string() }),
  z.strictObject({
    type: z.literal("message_end"),
    messageId: z.string(),
    text: z.string(),
    reasoning: z.string().optional(),
    finishReason: z.string(),
    usage: Usage.optional(),
  }),
  z.strictObject({ type: z.literal("message_incomplete"), messageId: z.string(), partialText: z.string(), reason: z.string() }),
  /** `input` and `output` are the full texts (cut at 20 KB) for the local prompt trace only (R35); never events. */
  z.strictObject({ type: z.literal("tool_start"), callId: z.string(), tool: z.string(), inputSummary: z.string(), input: z.string().max(20_100).optional() }),
  z.strictObject({ type: z.literal("tool_end"), callId: z.string(), tool: z.string(), ok: z.boolean(), outputSummary: z.string(), output: z.string().max(20_100).optional() }),
  z.strictObject({
    type: z.literal("question"),
    questionId: z.string(),
    kind: z.enum(["technical", "feature"]),
    text: z.string(),
    options: z.array(z.string()).optional(),
  }),
  /** Queue, retry and compaction events: not mapped to Studio messages, counted and shown in Engineering_Details. */
  z.strictObject({ type: z.literal("notice"), piType: z.string(), detail: z.string().optional() }),
  /**
   * End of one prompt or answer. `question`: the turn ended on `ask_question` and the process waits for `answer`.
   * Any other outcome ends the process.
   */
  z.strictObject({ type: z.literal("final"), outcome: z.enum(["completed", "question", "error", "aborted"]), detail: z.string().optional() }),
  z.strictObject({ type: z.literal("command_rejected"), reason: z.string() }),
  z.strictObject({ type: z.literal("runner_error"), message: z.string() }),
]);
export type RunnerEvent = z.infer<typeof RunnerEvent>;

/** Parses one stdout line from the runner; `null` for a line that is not a protocol event (the caller counts it). */
export function parseRunnerLine(line: string): RunnerEvent | null {
  const s = line.replace(/^\uFEFF/, "").trim();
  if (!s) return null;
  try {
    const r = RunnerEvent.safeParse(JSON.parse(s));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

/** Parses one stdin line in the runner. Blank lines and a leading BOM are tolerated (PowerShell adds them). */
export function parseRunnerCommand(line: string): { ok: true; command: RunnerCommand } | { ok: false; reason: string } | null {
  const s = line.replace(/^\uFEFF/, "").trim();
  if (!s) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return { ok: false, reason: "the command is not JSON" };
  }
  const r = RunnerCommand.safeParse(raw);
  if (!r.success) return { ok: false, reason: `invalid command: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ").slice(0, 300)}` };
  return { ok: true, command: r.data };
}

function summarize(v: unknown, max = 160): string {
  const s = typeof v === "string" ? v : JSON.stringify(v ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// Structural view of the pi session events the mapper reads (pi-agent-core AgentEvent plus AgentSession events).
interface PiContent {
  type: string;
  text?: string;
  thinking?: string;
}
interface PiMessage {
  role: string;
  content?: PiContent[] | string;
  stopReason?: string;
  errorMessage?: string;
  usage?: { input: number; output: number; cacheRead?: number; reasoning?: number };
}
export interface PiEventLike {
  type: string;
  message?: PiMessage;
  assistantMessageEvent?: { type: string; delta?: string };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: { content?: PiContent[] };
  isError?: boolean;
  [k: string]: unknown;
}

const NOTICE_TYPES = new Set(["queue_update", "auto_retry_start", "auto_retry_end", "compaction_start", "compaction_end"]);

function parts(m: PiMessage, kind: "text" | "thinking"): string {
  if (!Array.isArray(m.content)) return kind === "text" && typeof m.content === "string" ? m.content : "";
  return m.content.flatMap((c) => (c.type === kind ? [kind === "text" ? (c.text ?? "") : (c.thinking ?? "")] : [])).join("");
}

function noticeDetail(e: PiEventLike): string | undefined {
  if (e.type === "auto_retry_start") return `attempt ${String(e.attempt)} of ${String(e.maxAttempts)}: ${summarize(e.errorMessage, 200)}`;
  if (e.type === "auto_retry_end") return e.success ? "retry succeeded" : `retry failed: ${summarize(e.finalError, 200)}`;
  if (e.type === "compaction_start" || e.type === "compaction_end") return String(e.reason);
  return undefined;
}

export interface PiEventMapper {
  map(e: PiEventLike): RunnerEvent[];
  /** Stop reason of the last assistant message ("stop", "toolUse", "length", "error", "aborted"), if any. */
  readonly lastStopReason: string | undefined;
  readonly lastError: string | undefined;
}

/** Maps pi session events to runner events; message ids are `<prefix><n>`, unique per runner process. */
export function createPiEventMapper(prefix = "code-m"): PiEventMapper {
  let seq = 0;
  let current: string | null = null;
  let lastStopReason: string | undefined;
  let lastError: string | undefined;
  return {
    get lastStopReason() {
      return lastStopReason;
    },
    get lastError() {
      return lastError;
    },
    map(e) {
      switch (e.type) {
        case "message_start":
          if (e.message?.role !== "assistant") return [];
          current = `${prefix}${++seq}`;
          return [{ type: "message_start", messageId: current }];
        case "message_update": {
          const a = e.assistantMessageEvent;
          if (!current || !a?.delta) return [];
          if (a.type === "text_delta") return [{ type: "delta", messageId: current, channel: "text", text: a.delta }];
          if (a.type === "thinking_delta") return [{ type: "delta", messageId: current, channel: "reasoning", text: a.delta }];
          return [];
        }
        case "message_end": {
          const m = e.message;
          if (m?.role !== "assistant" || !current) return [];
          const id = current;
          current = null;
          lastStopReason = m.stopReason;
          if (m.stopReason === "error" || m.stopReason === "aborted") {
            const reason = m.stopReason === "aborted" ? "stopped" : summarize(m.errorMessage ?? "the model call failed", 300);
            if (m.stopReason === "error") lastError = reason;
            return [{ type: "message_incomplete", messageId: id, partialText: parts(m, "text"), reason }];
          }
          const reasoning = parts(m, "thinking");
          const u = m.usage;
          return [
            {
              type: "message_end",
              messageId: id,
              text: parts(m, "text"),
              ...(reasoning ? { reasoning } : {}),
              finishReason: m.stopReason ?? "stop",
              ...(u
                ? {
                    usage: {
                      inputTokens: u.input + (u.cacheRead ?? 0),
                      outputTokens: u.output,
                      ...(u.reasoning !== undefined ? { reasoningTokens: u.reasoning } : {}),
                      cacheReadTokens: u.cacheRead ?? 0,
                    },
                  }
                : {}),
            },
          ];
        }
        case "tool_execution_start":
          return [{ type: "tool_start", callId: String(e.toolCallId), tool: String(e.toolName), inputSummary: summarize(e.args), input: summarize(e.args, 20_000) }];
        case "tool_execution_end": {
          const out = e.result?.content?.find((c) => c.type === "text")?.text ?? "";
          return [{ type: "tool_end", callId: String(e.toolCallId), tool: String(e.toolName), ok: !e.isError, outputSummary: summarize(out), output: summarize(out, 20_000) }];
        }
        default:
          if (NOTICE_TYPES.has(e.type)) {
            const detail = noticeDetail(e);
            return [{ type: "notice", piType: e.type, ...(detail ? { detail } : {}) }];
          }
          return [];
      }
    },
  };
}
