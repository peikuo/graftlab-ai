// Event envelope and payloads (design.md, "Event envelope"; R27.1, R27.4, R27.9, R27.10, R23.2).
// Every event that enters the Event_Stream is validated by EventSchema. No stream chunk is an event (R3.11, R27.7).
import { z } from "zod";
import { NODE_IDS, TERMINAL_IDS } from "./flow/ids.ts";

export const EVENT_SCHEMA_VERSION = 1 as const;

export const ROLE_IDS = [
  // Function agents, one per flow step (requirements.md, "Roles and Queue Rules", decided 2026-11-22).
  "reader",
  "explorer",
  "facilitator",
  "planner",
  "reviewer",
  // Meeting_Perspectives: speak only in the meeting.
  "user_value",
  "feasibility",
  "risk",
] as const;
export const MEETING_PERSPECTIVES = ["user_value", "feasibility", "risk"] as const satisfies readonly (typeof ROLE_IDS)[number][];
export const RoleIdSchema = z.enum(ROLE_IDS);
export type RoleId = z.infer<typeof RoleIdSchema>;

export const NodeIdSchema = z.enum(NODE_IDS);
export const TerminalIdSchema = z.enum(TERMINAL_IDS);

export const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("role"), roleId: RoleIdSchema }),
  z.object({ kind: z.literal("judge") }),
  z.object({ kind: z.literal("system") }),
  z.object({ kind: z.literal("verifier") }),
  z.object({ kind: z.literal("code_agent") }),
]);
export type Actor = z.infer<typeof ActorSchema>;

export const FAILURE_CLASSES = [
  "interface_call_failure",
  "readback_mismatch",
  "llm_output_format_invalid",
  "rejected_by_safety_rule",
  "budget_exceeded",
  "blocked_unanswered_question",
] as const;
export const FailureClassSchema = z.enum(FAILURE_CLASSES);
export type FailureClass = z.infer<typeof FailureClassSchema>;

export const FAILURE_SOURCES = [
  "llm",
  "docker",
  "github",
  "verifier",
  "browser",
  "code_agent",
  "persistence",
  "tunnel",
] as const;
export const FailureSourceSchema = z.enum(FAILURE_SOURCES);

// R24: status and reason are set by the evidence checker, never by the model.
export const EvidenceRefSchema = z.object({
  path: z.string().min(1),
  line: z.number().int().positive().optional(),
  snippet: z.string(),
  status: z.enum(["passed", "unverified"]).optional(),
  reason: z.string().optional(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

const nonEmpty = z.string().min(1);
const id = nonEmpty;
const count = z.number().int().nonnegative();

// Payload schemas, one per event type (design.md, "Event types and payloads").
export const PAYLOADS = {
  task_created: z.object({
    url: nonEmpty,
    owner: nonEmpty,
    repo: nonEmpty,
    repoKind: z.enum(["adapted", "other"]),
    adapterId: z.string().optional(),
    runtimeRulesVersion: nonEmpty,
    commitSha: z.string().optional(),
    llmProfile: z.string().optional(),
    llmModel: z.string().optional(),
  }),
  node_entered: z.object({ from: NodeIdSchema.nullable(), to: NodeIdSchema, edgeId: id }),
  transition_rejected: z.object({ from: NodeIdSchema, requestedEdgeId: z.string(), reason: nonEmpty }),
  file_read: z.object({ path: nonEmpty, bytes: count, artifactRef: z.string().optional() }),
  finding_recorded: z.object({
    kind: z.enum(["finding", "endpoint", "skipped", "note"]),
    text: nonEmpty,
    evidence: z.array(EvidenceRefSchema),
    evidenceStatus: z.enum(["passed", "unverified", "none"]),
  }),
  message_started: z.object({
    messageId: id,
    roleId: RoleIdSchema.optional(),
    purpose: z.enum(["statement", "review", "operator", "code_agent_step"]),
  }),
  // Carries no text (design.md, "Gaps found"): it only proves the stream is alive.
  message_progress: z.object({
    messageId: id,
    phase: z.enum(["waiting", "thinking", "speaking", "tool_call"]),
    textChars: count,
    reasoningChars: count,
  }),
  message_completed: z.object({
    messageId: id,
    text: z.string(),
    reasoning: z.string().optional(),
    finishReason: nonEmpty,
    usage: z
      .object({ inputTokens: count, outputTokens: count, reasoningTokens: count.optional() })
      .optional(),
  }),
  message_incomplete: z.object({ messageId: id, partialText: z.string(), reason: nonEmpty }),
  tool_started: z.object({ callId: id, tool: nonEmpty, inputSummary: z.string() }),
  tool_finished: z.object({ callId: id, tool: nonEmpty, ok: z.boolean(), outputSummary: z.string() }),
  judge_message: z.object({
    clientMsgId: id,
    to: z.union([z.literal("all"), RoleIdSchema]),
    text: nonEmpty,
    status: z.enum(["delivered", "queued"]),
    deliveredTo: z.array(RoleIdSchema),
  }),
  judge_message_delivered: z.object({ clientMsgIds: z.array(id), deliveredTo: z.array(RoleIdSchema) }),
  evidence_summary: z.object({
    findings: z.array(z.string()),
    skipped: z.array(z.string()),
    experienceNotes: z.array(z.string()),
    screenshotRefs: z.array(z.string()),
    experienceUnavailable: z.string().optional(),
    partial: z.boolean(),
  }),
  card_opened: z.object({
    cardId: id,
    kind: z.enum(["question", "confirm", "checkpoint", "reminder", "new_version"]),
    title: nonEmpty,
    body: z.string(),
    options: z.array(z.object({ id: id, label: nonEmpty })),
    allowFreeText: z.boolean(),
  }),
  card_answered: z.object({ cardId: id, optionId: z.string().optional(), text: z.string().optional() }),
  artifact_updated: z.object({
    artifactKind: z.enum([
      "file",
      "diagram",
      "decision_doc",
      "doc",
      "task_board",
      "worktree_handoff",
      "patch",
      "screenshot",
      "demo_case",
    ]),
    ref: nonEmpty,
    title: nonEmpty,
  }),
  // The content is validated by the Decision_Doc schema of the decision milestone (schemas/decisionDoc.ts).
  decision_doc_version: z.object({ version: z.number().int().positive(), content: z.unknown(), hash: nonEmpty }),
  decision_doc_frozen: z.object({
    version: z.number().int().positive(),
    hash: nonEmpty,
    confirmedBy: nonEmpty,
    confirmedAt: z.iso.datetime(),
  }),
  decision_item_reviewed: z
    .object({
      draftId: id,
      itemId: id,
      itemHash: nonEmpty,
      verdict: z.enum(["accept", "reject"]),
      reason: z.string().optional(),
    })
    .refine((p) => p.verdict === "accept" || (p.reason ?? "").trim().length > 0, {
      message: "a rejection needs a reason",
      path: ["reason"],
    }),
  browser_action: z.object({ action: nonEmpty, target: z.string(), ok: z.boolean() }),
  browser_observation: z.object({ snapshotSummary: z.string(), screenshotRef: z.string().optional() }),
  code_change: z.object({
    storyId: id,
    attempt: z.number().int().positive(),
    changedFiles: z.array(nonEmpty),
    diffRef: nonEmpty,
  }),
  review_verdict: z.object({
    storyId: id,
    attempt: z.number().int().positive(),
    verdict: z.enum(["approve", "request_changes", "escalate"]),
    reasons: z.array(z.string()),
    label: z.literal("reviewed by Reviewer (LLM judgment)"),
  }),
  question_opened: z.object({
    questionId: id,
    from: z.union([z.literal("code_agent"), RoleIdSchema]),
    askedParty: z.enum(["reviewer", "judge"]),
    kind: z.enum(["technical", "feature"]),
    text: nonEmpty,
  }),
  question_answered: z.object({ questionId: id, answer: z.string() }),
  demo_case_validated: z.object({
    storyId: id,
    demoCaseId: id,
    hash: nonEmpty,
    itemCount: count,
    derivedCheckId: id,
    label: z.literal("designed by Reviewer (LLM judgment)"),
  }),
  api_write: z.object({
    storyId: id,
    demoCaseId: id,
    itemId: id,
    method: z.enum(["POST", "PATCH", "PUT"]),
    endpoint: nonEmpty,
    status: z.number().int(),
  }),
  verifier_result: z.object({
    storyId: id,
    checkId: id,
    items: z.array(z.object({ item: z.string(), pass: z.boolean(), expected: z.string(), actual: z.string() })),
    pass: z.boolean(),
  }),
  failure: z.object({
    failureClass: FailureClassSchema,
    source: FailureSourceSchema,
    detail: nonEmpty,
    relatedRef: z.string().optional(),
  }),
  reminder: z.object({ pending: z.array(z.object({ feature: nonEmpty, status: nonEmpty })) }),
  terminal_reached: z.object({
    terminal: TerminalIdSchema,
    summary: z.object({
      verifierPassed: count,
      verifierFailed: count,
      failuresByClass: z.partialRecord(FailureClassSchema, count),
      unconfirmed: z.array(z.string()),
      label: z.string(),
    }),
  }),
} as const;

export type EventType = keyof typeof PAYLOADS;
export const EVENT_TYPES = Object.keys(PAYLOADS) as EventType[];
export type PayloadOf<T extends EventType> = z.infer<(typeof PAYLOADS)[T]>;

const envelope = {
  v: z.literal(EVENT_SCHEMA_VERSION),
  seq: z.number().int().positive(),
  ts: z.iso.datetime(),
  taskId: nonEmpty,
  node: NodeIdSchema,
  actor: ActorSchema,
};

function variant<T extends EventType>(type: T) {
  return z.object({ ...envelope, type: z.literal(type), payload: PAYLOADS[type] });
}

const variants = EVENT_TYPES.map((t) => variant(t));
export const EventSchema = z.discriminatedUnion(
  "type",
  variants as unknown as [ReturnType<typeof variant<EventType>>, ...ReturnType<typeof variant<EventType>>[]],
);

export type StudioEvent<T extends EventType = EventType> = {
  [K in T]: {
    v: typeof EVENT_SCHEMA_VERSION;
    seq: number;
    ts: string;
    taskId: string;
    node: z.infer<typeof NodeIdSchema>;
    actor: Actor;
    type: K;
    payload: PayloadOf<K>;
  };
}[T];

export type ParseResult = { ok: true; event: StudioEvent } | { ok: false; error: string };

/** Validates one unknown value as a StudioEvent. */
export function validateEvent(value: unknown): ParseResult {
  const r = EventSchema.safeParse(value);
  if (!r.success) return { ok: false, error: z.prettifyError(r.error) };
  return { ok: true, event: r.data as StudioEvent };
}

/** Parses one JSONL line. */
export function parseEvent(line: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (e) {
    return { ok: false, error: `not JSON: ${(e as Error).message}` };
  }
  return validateEvent(value);
}

/** Serializes one event to a single JSONL line (no trailing newline). Throws on an invalid event. */
export function serializeEvent(event: StudioEvent): string {
  const r = EventSchema.safeParse(event);
  if (!r.success) throw new Error(`invalid event: ${z.prettifyError(r.error)}`);
  return JSON.stringify(r.data);
}

export function serializeEvents(events: readonly StudioEvent[]): string {
  return events.map((e) => serializeEvent(e) + "\n").join("");
}

/** Parses a JSONL document; blank lines are ignored, any invalid line fails the whole parse. */
export function parseEvents(text: string): { ok: true; events: StudioEvent[] } | { ok: false; line: number; error: string } {
  const events: StudioEvent[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === "") continue;
    const r = parseEvent(line);
    if (!r.ok) return { ok: false, line: i + 1, error: r.error };
    events.push(r.event);
  }
  return { ok: true, events };
}
