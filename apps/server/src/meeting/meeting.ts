// The meeting (design.md, "Meeting"; R11, R5.3, R24). Fixed turn order per round: the Facilitator opens, then
// User_Value, Feasibility and Risk speak, and the Facilitator closes; the last closing turn submits the meeting
// summary. Each turn is a fresh pi agent over the same cached prefix (shared rules, Task context) with the shared
// transcript at the end of the user message. Every finding's evidence is checked by code before its event.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { Actor, EvidenceRef, PayloadOf, RoleId } from "@graftlab/shared";
import { z } from "zod";
import { checkConclusion, type EvidenceFiles } from "../evidence/check.ts";
import { dirKey, renderMemo, searchMemo, type MemoTree } from "../reader/memo.ts";
import { readFileLines, renderReadFile, renderSearch, searchRepo } from "../reader/tools.ts";
import { systemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";

const ROLE_NAME: Record<string, string> = { facilitator: "Facilitator", user_value: "User_Value", feasibility: "Feasibility", risk: "Risk" };
export const PERSPECTIVES = ["user_value", "feasibility", "risk"] as const;
const readsFor = (round: number) => (round === 1 ? 5 : 3);
const MAX_QUESTIONS = 2; // per meeting; each can wait up to 2 minutes
const short = z.string().trim().min(1).max(1500);
const capped = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
const RefSchema = z.object({ path: z.string().trim().min(1).max(300), line: z.number().int().positive().optional(), snippet: z.string().max(2000) });
const FindingSchema = z.object({ claim: short, evidence: capped(RefSchema, 4) });
const WorkflowInSchema = z.object({ name: z.string().trim().min(1).max(160), purpose: z.enum(["A", "B", "unclear"]), description: z.string().max(1500), evidence: capped(RefSchema, 3).default([]) });
export const StatementSchema = z.object({ summary: short, findings: capped(FindingSchema, 6).default([]), workflows: capped(WorkflowInSchema, 4).optional() });
export const MeetingSummarySchema = z.object({ findings: capped(FindingSchema, 12), workflows: capped(WorkflowInSchema, 8), openQuestions: capped(z.string().trim().min(1).max(300), 6) });
export const AskSchema = z.object({ question: z.string().trim().min(1).max(300), options: capped(z.string().trim().min(1).max(80), 4).optional(), allowFreeText: z.boolean().optional() });

const refParams = obj({ path: str(), line: opt(int()), snippet: str() });
const findingParams = obj({ claim: str(), evidence: arr(refParams) });
const workflowParams = obj({ name: str(), purpose: oneOf(["A", "B", "unclear"] as const), description: str(), evidence: opt(arr(refParams)) });

export interface MeetingOptions {
  rules: RuntimeRules;
  /** Stable Task context (Repo_Brief and evidence summary as Markdown); identical for every turn. */
  context: string;
  files: Map<string, string>;
  evidence: EvidenceFiles;
  memo: MemoTree | null;
  emit: Emit;
  askJudgeFor: (card: Omit<PayloadOf<"card_opened">, "cardId">, waitMs: number, actor?: Actor) => Promise<{ optionId?: string; text?: string } | null>;
  /** One agent turn (PiRuntime in production, a scripted fake in tests). */
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  rounds?: number; // GL_MEETING_ROUNDS, default 2
  questionWaitMs?: number; // default 120 s
  /** Judge messages received during gathering, delivered at the start (R11.10). */
  queued?: { to: string; text: string }[];
}
export type MeetingResult = { ok: true; summary: PayloadOf<"meeting_summary"> } | { ok: false; reason: string };

type Checked<T> = T & { evidence: EvidenceRef[]; evidenceStatus: "passed" | "unverified" };

export async function runMeeting(o: MeetingOptions): Promise<MeetingResult> {
  const rounds = o.rounds ?? 2;
  const transcript: string[] = [];
  for (const m of o.queued ?? []) transcript.push(`### Judge (message sent during reading, to ${m.to})\n${m.text}`);
  let turnNo = 0;
  let questions = 0;
  let summary: PayloadOf<"meeting_summary"> | null = null;
  let lastError = "";
  const check = <T extends { evidence: z.infer<typeof RefSchema>[] }>(x: T): Checked<Omit<T, "evidence">> => {
    const r = checkConclusion(x.evidence, o.evidence);
    return { ...x, evidence: r.evidence, evidenceStatus: r.status };
  };
  const checkLine = (items: Checked<{ claim?: string; name?: string }>[]) =>
    items.map((f) => `- ${f.claim ?? f.name}: ${f.evidenceStatus === "passed" ? "evidence found" : `Unverified (${f.evidence.map((e) => `${e.path}: ${e.reason}`).join("; ") || "no evidence"})`}`).join("\n");

  async function turn(roleId: RoleId, round: number, kind: "open" | "speak" | "close" | "final"): Promise<void> {
    if (o.signal.aborted) return;
    turnNo++;
    const actor: Actor = { kind: "role", roleId };
    let reads = 0;
    let maxReads = readsFor(round);
    let accepted: string | null = null;
    let asked = false;
    const budget = () => (reads++ >= maxReads ? "read budget reached, submit now" : null);
    const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });
    const tools: AgentTool<any>[] = [
      { name: "read_file", label: "read_file", description: "Read lines of a repository file (at most 400 lines).", parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }), execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(budget() ?? renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))) },
      { name: "search_repo", label: "search_repo", description: "Literal search over the repository files.", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(budget() ?? renderSearch(a.query, searchRepo(o.files, a.query))) },
      { name: "read_memo", label: "read_memo", description: "The memo of a file or folder (an LLM description, not evidence).", parameters: obj({ path: str() }), execute: async (_i, a: { path: string }) => text(budget() ?? (o.memo ? renderMemo(o.memo, o.memo.records[a.path] ? a.path : dirKey(a.path.replace(/\/$/, ""))) : "no memo yet")) },
      { name: "search_memo", label: "search_memo", description: "Memos that mention a word (LLM descriptions, not evidence).", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(budget() ?? (o.memo ? searchMemo(o.memo, a.query).map((k) => renderMemo(o.memo!, k)).join("\n\n") || "no match" : "no memo yet")) },
    ];
    if (roleId === "facilitator")
      tools.push({
        name: "ask_judge",
        label: "ask_judge",
        description: "Ask the Judge one short question with 2 to 4 options. Waits up to 2 minutes.",
        parameters: obj({ question: str(), options: opt(arr(str())), allowFreeText: opt(bool()) }),
        execute: async (_i, a: unknown) => {
          const q = AskSchema.safeParse(a);
          if (!q.success) return text("Not accepted: a question and up to 4 short options are needed.", true);
          if (asked) return text("Only one question per turn.", true);
          if (questions >= MAX_QUESTIONS) return text(`The ${MAX_QUESTIONS} questions of this meeting are used. List further questions as open questions.`, true);
          asked = true;
          questions++;
          const options = (q.data.options ?? []).map((label, i) => ({ id: `o${i + 1}`, label }));
          const answer = await o.askJudgeFor({ kind: "question", title: q.data.question, body: "", options, allowFreeText: q.data.allowFreeText ?? true }, o.questionWaitMs ?? 120_000, actor);
          const said = answer ? (answer.text ?? options.find((x) => x.id === answer.optionId)?.label ?? "(empty answer)") : null;
          transcript.push(said ? `### Judge answered the Facilitator ("${q.data.question}")\n${said}` : `### No answer from the Judge to "${q.data.question}" within the wait`);
          return text(said ? `The Judge answered: ${said}` : "No answer within the wait. Do not ask it again; continue without it and list it as an open question.");
        },
      });
    if (kind === "final")
      tools.push({
        name: "submit_meeting_summary",
        label: "submit_meeting_summary",
        description: "Submit the meeting summary: findings with quoted evidence, workflows with A, B or unclear, open questions.",
        parameters: obj({ findings: arr(findingParams), workflows: arr(workflowParams), openQuestions: arr(str()) }),
        execute: async (_i, a: unknown) => {
          const p = MeetingSummarySchema.safeParse(a);
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
          const findings = p.data.findings.map(check);
          const workflows = p.data.workflows.map(check);
          summary = { findings, workflows, openQuestions: p.data.openQuestions };
          accepted = `Meeting summary submitted.`;
          return { ...text(`Accepted. Evidence check:\n${checkLine([...findings, ...workflows])}`), terminate: true };
        },
      });
    else
      tools.push({
        name: "submit_statement",
        label: "submit_statement",
        description: "Submit your statement: a one-sentence summary, findings with quoted evidence, optional workflows.",
        parameters: obj({ summary: str(), findings: opt(arr(findingParams)), workflows: opt(arr(workflowParams)) }),
        execute: async (_i, a: unknown) => {
          const p = StatementSchema.safeParse(a);
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
          const findings = p.data.findings.map(check);
          const workflows = (p.data.workflows ?? []).map(check);
          for (const f of findings) await o.emit({ type: "finding_recorded", actor, payload: { kind: "finding", text: f.claim, evidence: f.evidence, evidenceStatus: f.evidenceStatus } });
          await o.emit({ type: "statement_submitted", actor, payload: { roleId, round, summary: p.data.summary, workflows } });
          accepted = `Summary: ${p.data.summary}\nFindings:\n${checkLine(findings)}${workflows.length ? `\nWorkflows:\n${workflows.map((w) => `- [${w.purpose}] ${w.name}: ${w.description}`).join("\n")}` : ""}`;
          return { ...text(`Accepted. Evidence check:\n${checkLine(findings) || "(no findings)"}`), terminate: true };
        },
      });
    const ask =
      kind === "open" ? `Your turn: open round ${round} of ${rounds}.` : kind === "speak" ? `Your turn in round ${round} of ${rounds}: give your view.` : kind === "close" ? `Your turn: close round ${round} of ${rounds}.` : `Your turn: close the meeting (round ${round} of ${rounds}) and submit the meeting summary.`;
    const prompt = `# Meeting transcript so far\n\n${transcript.join("\n\n") || "(the meeting starts now)"}\n\n---\n\n${ask}`;
    const system = systemPrompt(o.rules, roleId, o.context);
    let r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt, tools, signal: o.signal, idPrefix: `${o.idPrefix}-t${turnNo}` });
    if (!accepted && !o.signal.aborted && r.stopReason !== "error") {
      // One visible retry (R23.5): name it, then a short follow-up turn without further reading.
      const submit = kind === "final" ? "submit_meeting_summary" : "submit_statement";
      const why = r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission");
      await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${ROLE_NAME[roleId]} ended the turn without a valid ${submit} (${why}); one retry` } });
      maxReads = 0;
      const said = r.text.trim();
      r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: `${prompt}${said ? `\n\n(Your previous answer: ${said})` : ""}\n\nYou ended your turn without a valid ${submit}. Call ${submit} now with what you already found. Do not read more files.`, tools, signal: o.signal, idPrefix: `${o.idPrefix}-t${turnNo}r` });
    }
    if (accepted) {
      transcript.push(`### ${ROLE_NAME[roleId]} (round ${round})\n${r.text.trim() ? `${r.text.trim()}\n` : ""}${accepted}`);
      return;
    }
    // R11.2: no schema-valid statement; the turn failed, visibly, and the role is not presented as contributing.
    lastError = r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission");
    if (!o.signal.aborted && r.stopReason !== "error")
      await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${ROLE_NAME[roleId]}'s turn failed: ${lastError}` } });
    transcript.push(`### ${ROLE_NAME[roleId]} (round ${round})\n(turn failed: no valid statement)`);
  }

  for (let round = 1; round <= rounds; round++) {
    await turn("facilitator", round, "open");
    for (const p of PERSPECTIVES) await turn(p, round, "speak");
    await turn("facilitator", round, round === rounds ? "final" : "close");
  }
  if (o.signal.aborted) return { ok: false, reason: "stopped" };
  if (!summary) return { ok: false, reason: `the Facilitator did not submit a valid meeting summary (${lastError || "no submission"})` };
  await o.emit({ type: "meeting_summary", actor: { kind: "role", roleId: "facilitator" }, payload: summary });
  return { ok: true, summary };
}
