// fast-check arbitraries for StudioEvents, shared by property tests (Properties 4, 5, 6, 7).
import fc from "fast-check";
import {
  EVENT_TYPES,
  FAILURE_CLASSES,
  FAILURE_SOURCES,
  ROLE_IDS,
  type Actor,
  type EventType,
  type PayloadOf,
  type StudioEvent,
} from "../events.ts";
import { NODE_IDS, TERMINAL_IDS } from "../flow/ids.ts";

const str = fc.string({ maxLength: 40 });
const ne = fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.length > 0);
const idA = fc.stringMatching(/^[a-z0-9][a-z0-9_-]{0,11}$/);
const nat = fc.nat({ max: 100_000 });
const pos = fc.integer({ min: 1, max: 50 });
const role = fc.constantFrom(...ROLE_IDS);
const node = fc.constantFrom(...NODE_IDS);
const path = fc.stringMatching(/^[a-z][a-z0-9_/]{0,30}\.(py|ts|md|html)$/);
const iso = fc
  .integer({ min: Date.UTC(2026, 10, 1), max: Date.UTC(2026, 11, 31) })
  .map((ms) => new Date(ms).toISOString());
const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });

const evidence = fc.record(
  {
    path,
    line: pos,
    snippet: str,
    status: fc.constantFrom("passed" as const, "unverified" as const),
    reason: str,
  },
  { requiredKeys: ["path", "snippet"] },
);

const workflow = fc.record({
  name: ne,
  purpose: fc.constantFrom("A" as const, "B" as const, "unclear" as const),
  description: str,
  evidence: fc.array(evidence, { maxLength: 2 }),
  evidenceStatus: fc.constantFrom("passed" as const, "unverified" as const),
});
/** Drops keys whose value is undefined, as JSON serialization does. */
function clean<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}

const P: { [K in EventType]: fc.Arbitrary<PayloadOf<K>> } = {
  task_created: fc.record({
    url: ne,
    owner: ne,
    repo: ne,
    repoKind: fc.constantFrom("adapted" as const, "other" as const),
    adapterId: opt(idA),
    runtimeRulesVersion: ne,
    commitSha: opt(fc.stringMatching(/^[0-9a-f]{40}$/)),
  }),
  node_entered: fc.record({ from: fc.option(node, { nil: null }), to: node, edgeId: idA }),
  transition_rejected: fc.record({ from: node, requestedEdgeId: str, reason: ne }),
  file_read: fc.record({ path, bytes: nat, artifactRef: opt(str) }),
  finding_recorded: fc.record({
    kind: fc.constantFrom("finding" as const, "endpoint" as const, "skipped" as const, "note" as const),
    text: ne,
    evidence: fc.array(evidence, { maxLength: 3 }),
    evidenceStatus: fc.constantFrom("passed" as const, "unverified" as const, "none" as const),
  }),
  message_started: fc.record({
    messageId: idA,
    roleId: opt(role),
    purpose: fc.constantFrom("statement" as const, "review" as const, "operator" as const, "code_agent_step" as const, "memo" as const),
  }),
  message_progress: fc.record({
    messageId: idA,
    phase: fc.constantFrom("waiting" as const, "thinking" as const, "speaking" as const, "tool_call" as const),
    textChars: nat,
    reasoningChars: nat,
  }),
  message_completed: fc.record({
    messageId: idA,
    text: str,
    reasoning: opt(str),
    finishReason: fc.constantFrom("stop", "tool_calls", "length"),
    usage: opt(fc.record({ inputTokens: nat, outputTokens: nat, reasoningTokens: opt(nat), cacheReadTokens: opt(nat) })),
  }),
  reading_planned: fc.record({ files: fc.array(fc.record({ path, why: str }), { maxLength: 4 }), byCode: fc.boolean(), dropped: fc.nat({ max: 5 }) }),
  repo_brief: fc.record({ content: fc.constant({}), fromCache: fc.boolean() }),
  index_progress: fc.record({ state: fc.constantFrom("started" as const, "finished" as const, "stopped" as const), done: fc.nat({ max: 50 }), total: fc.nat({ max: 50 }) }),
  card_expired: fc.record({ cardId: idA, waitedS: fc.nat({ max: 200 }) }),
  statement_submitted: fc.record({ roleId: fc.constantFrom("facilitator" as const, "user_value" as const, "feasibility" as const, "risk" as const), round: fc.nat({ max: 3 }), summary: ne, workflows: fc.array(workflow, { maxLength: 2 }) }),
  meeting_summary: fc.record({
    findings: fc.array(fc.record({ claim: ne, evidence: fc.array(evidence, { maxLength: 2 }), evidenceStatus: fc.constantFrom("passed" as const, "unverified" as const) }), { maxLength: 3 }),
    workflows: fc.array(workflow, { maxLength: 2 }),
    openQuestions: fc.array(str, { maxLength: 2 }),
  }),
  memo_written: fc.record({
    path: fc.oneof(fc.constant(""), path),
    level: fc.constantFrom("file" as const, "directory" as const, "root" as const),
    purpose: str,
    files: fc.nat({ max: 50 }),
    fromCache: fc.boolean(),
    mapOnly: fc.boolean(),
  }),
  message_incomplete: fc.record({ messageId: idA, partialText: str, reason: ne }),
  tool_started: fc.record({ callId: idA, tool: ne, inputSummary: str }),
  tool_finished: fc.record({ callId: idA, tool: ne, ok: fc.boolean(), outputSummary: str }),
  judge_message: fc.record({
    clientMsgId: idA,
    to: fc.oneof(fc.constant("all" as const), role),
    text: ne,
    status: fc.constantFrom("delivered" as const, "queued" as const),
    deliveredTo: fc.array(role, { maxLength: 3 }),
  }),
  judge_message_delivered: fc.record({ clientMsgIds: fc.array(idA, { maxLength: 3 }), deliveredTo: fc.array(role, { maxLength: 3 }) }),
  evidence_summary: fc.record({
    findings: fc.array(str, { maxLength: 3 }),
    skipped: fc.array(str, { maxLength: 3 }),
    experienceNotes: fc.array(str, { maxLength: 3 }),
    screenshotRefs: fc.array(str, { maxLength: 3 }),
    experienceUnavailable: opt(ne),
    partial: fc.boolean(),
  }),
  card_opened: fc.record({
    cardId: idA,
    kind: fc.constantFrom("question" as const, "confirm" as const, "checkpoint" as const, "reminder" as const, "new_version" as const),
    title: ne,
    body: str,
    options: fc.array(fc.record({ id: idA, label: ne }), { maxLength: 3 }),
    allowFreeText: fc.boolean(),
  }),
  card_answered: fc.record({ cardId: idA, optionId: opt(idA), text: opt(str) }),
  artifact_updated: fc.record({
    artifactKind: fc.constantFrom(
      "file" as const,
      "diagram" as const,
      "decision_doc" as const,
      "doc" as const,
      "task_board" as const,
      "worktree_handoff" as const,
      "patch" as const,
      "screenshot" as const,
      "demo_case" as const,
    ),
    ref: ne,
    title: ne,
  }),
  decision_doc_version: fc.record({ version: pos, content: fc.jsonValue().map(clean), hash: ne }),
  decision_doc_frozen: fc.record({ version: pos, hash: ne, confirmedBy: ne, confirmedAt: iso }),
  decision_item_reviewed: fc.oneof(
    fc.record({ draftId: idA, itemId: idA, itemHash: ne, verdict: fc.constant("accept" as const), reason: opt(str) }),
    fc.record({ draftId: idA, itemId: idA, itemHash: ne, verdict: fc.constant("reject" as const), reason: ne.filter((s) => s.trim().length > 0) }),
  ),
  browser_action: fc.record({ action: ne, target: str, ok: fc.boolean() }),
  browser_observation: fc.record({ snapshotSummary: str, screenshotRef: opt(str) }),
  code_change: fc.record({ storyId: idA, attempt: pos, changedFiles: fc.array(path, { maxLength: 4 }), diffRef: ne }),
  review_verdict: fc.record({
    storyId: idA,
    attempt: pos,
    verdict: fc.constantFrom("approve" as const, "request_changes" as const, "escalate" as const),
    reasons: fc.array(str, { maxLength: 3 }),
    label: fc.constant("reviewed by Reviewer (LLM judgment)" as const),
  }),
  question_opened: fc.record({
    questionId: idA,
    from: fc.oneof(fc.constant("code_agent" as const), role),
    askedParty: fc.constantFrom("reviewer" as const, "judge" as const),
    kind: fc.constantFrom("technical" as const, "feature" as const),
    text: ne,
  }),
  question_answered: fc.record({ questionId: idA, answer: str }),
  demo_case_validated: fc.record({
    storyId: idA,
    demoCaseId: idA,
    hash: ne,
    itemCount: fc.nat({ max: 10 }),
    derivedCheckId: idA,
    label: fc.constant("designed by Reviewer (LLM judgment)" as const),
  }),
  api_write: fc.record({
    storyId: idA,
    demoCaseId: idA,
    itemId: idA,
    method: fc.constantFrom("POST" as const, "PATCH" as const, "PUT" as const),
    endpoint: ne,
    status: fc.integer({ min: 100, max: 599 }),
  }),
  verifier_result: fc.record({
    storyId: idA,
    checkId: idA,
    items: fc.array(fc.record({ item: str, pass: fc.boolean(), expected: str, actual: str }), { maxLength: 3 }),
    pass: fc.boolean(),
  }),
  failure: fc.record({
    failureClass: fc.constantFrom(...FAILURE_CLASSES),
    source: fc.constantFrom(...FAILURE_SOURCES),
    detail: ne,
    relatedRef: opt(str),
  }),
  reminder: fc.record({ pending: fc.array(fc.record({ feature: ne, status: ne }), { maxLength: 3 }) }),
  terminal_reached: fc.record({
    terminal: fc.constantFrom(...TERMINAL_IDS),
    summary: fc.record({
      verifierPassed: nat,
      verifierFailed: nat,
      failuresByClass: fc.dictionary(fc.constantFrom(...FAILURE_CLASSES), nat, { maxKeys: 3 }),
      unconfirmed: fc.array(idA, { maxLength: 3 }),
      label: str,
    }),
  }),
};

export const actorArb: fc.Arbitrary<Actor> = fc.oneof(
  role.map((roleId) => ({ kind: "role" as const, roleId })),
  fc.constantFrom<Actor>({ kind: "judge" }, { kind: "system" }, { kind: "verifier" }, { kind: "code_agent" }),
);

export const eventTypeArb = fc.constantFrom(...EVENT_TYPES);

/** One event body without seq; ts and the payload are random. */
export const eventBodyArb: fc.Arbitrary<Omit<StudioEvent, "seq">> = eventTypeArb.chain((type) =>
  fc
    .record({ ts: iso, node, actor: actorArb, payload: P[type] as fc.Arbitrary<unknown> })
    .map((r) => clean({ v: 1 as const, taskId: "t1", type, ...r }) as Omit<StudioEvent, "seq">),
);

/** A valid Event_Stream: seq starts at 1 and increases by 1. */
export const eventStreamArb = (maxLength = 40): fc.Arbitrary<StudioEvent[]> =>
  fc.array(eventBodyArb, { maxLength }).map((bodies) => bodies.map((b, i) => ({ ...b, seq: i + 1 }) as StudioEvent));

/**
 * Coherent role activity: per role, message lifecycles (started, progress in a phase, then completed,
 * incomplete or still open), file reads, tool calls and failures, with increasing timestamps,
 * interleaved across roles. Used where random events would almost never form a lifecycle (Property 6).
 */
export const activityStreamArb: fc.Arbitrary<StudioEvent[]> = fc
  .array(
    fc.record({
      role,
      kind: fc.constantFrom("message", "message", "message", "file_read", "tool", "failure"),
      phase: fc.constantFrom("thinking" as const, "speaking" as const, "tool_call" as const, "waiting" as const),
      progressCount: fc.integer({ min: 0, max: 3 }),
      end: fc.constantFrom("completed", "incomplete", "open"),
      gapMs: fc.integer({ min: 200, max: 20_000 }),
    }),
    { minLength: 1, maxLength: 12 },
  )
  .map((episodes) => {
    const out: Omit<StudioEvent, "seq" | "ts">[] = [];
    const gaps: number[] = [];
    episodes.forEach((ep, i) => {
      const actor: Actor = { kind: "role", roleId: ep.role };
      const push = (type: string, payload: unknown) => {
        out.push({ v: 1, taskId: "t1", node: "meeting", actor, type, payload } as Omit<StudioEvent, "seq" | "ts">);
        gaps.push(ep.gapMs);
      };
      const id = `m${i}`;
      if (ep.kind === "message") {
        push("message_started", { messageId: id, roleId: ep.role, purpose: "statement" });
        for (let k = 0; k < ep.progressCount; k++) push("message_progress", { messageId: id, phase: ep.phase, textChars: k * 10, reasoningChars: k * 5 });
        if (ep.end === "completed") push("message_completed", { messageId: id, text: "done", finishReason: "stop" });
        if (ep.end === "incomplete") push("message_incomplete", { messageId: id, partialText: "part", reason: "stream closed" });
      } else if (ep.kind === "file_read") {
        push("file_read", { path: `src/f${i}.py`, bytes: 100 });
      } else if (ep.kind === "tool") {
        push("tool_started", { callId: `c${i}`, tool: "read_file", inputSummary: "" });
        if (ep.end !== "open") push("tool_finished", { callId: `c${i}`, tool: "read_file", ok: true, outputSummary: "" });
      } else {
        push("failure", { failureClass: "interface_call_failure", source: "llm", detail: "test failure" });
      }
    });
    let t = Date.UTC(2026, 10, 22, 10, 0, 0);
    return out.map((e, i) => {
      t += gaps[i]!;
      return { ...e, seq: i + 1, ts: new Date(t).toISOString() } as StudioEvent;
    });
  });
