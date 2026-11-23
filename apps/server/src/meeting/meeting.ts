// The meeting (design.md, "Meeting"; R11, R5.3, R24; revised with the user 2026-11-24). Preparation: the three
// Meeting_Perspectives work at the same time and submit positions into the Proposal_Board and the Evidence_Pool.
// Discussion: after every statement or Judge input the perspectives signal whether they want to speak; code picks
// the next speaker. Questions to the Judge do not block. Code ends the discussion and builds the summary.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { arr, bool, int, obj, oneOf, opt, str } from "@earendil-works/pi-schema";
import type { Actor, PayloadOf, RoleId } from "@graftlab/shared";
import { z } from "zod";
import type { EvidenceFiles } from "../evidence/check.ts";
import { dirKey, renderMemo, searchMemo, type MemoTree } from "../reader/memo.ts";
import { readFileLines, renderReadFile, renderSearch, searchRepo } from "../reader/tools.ts";
import { roleText, sharedSystemPrompt, type RuntimeRules } from "../roles/rules.ts";
import type { Emit, TurnOptions, TurnResult } from "../runtime/pi.ts";
import { stripIds } from "@graftlab/shared";
import { Board, PERSPECTIVES, pickNext, type Change, type Perspective, type Signal } from "./board.ts";

const NAME: Record<string, string> = { facilitator: "Facilitator", user_value: "User_Value", feasibility: "Feasibility", risk: "Risk", judge: "Judge" };
const MAX_QUESTIONS = 2;
const line = (max: number) => z.string().trim().min(1).max(max);
const capped = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
const Purpose = z.enum(["A", "B", "unclear"]);
const Stance = z.enum(["support", "against", "conditional"]);
const QuoteSchema = z.object({ path: line(300), line: z.number().int().positive().optional(), snippet: z.string().max(2000) });
const EntrySchema = z.object({ id: z.string().max(20).optional(), path: z.string().max(300).optional(), line: z.number().int().positive().optional(), snippet: z.string().max(2000).optional() });
export const PositionSchema = z.object({
  quotes: capped(QuoteSchema, 8).default([]),
  proposals: capped(
    z.object({ kind: z.enum(["improve", "new"]), title: line(120), userChange: line(400), purpose: Purpose, quotes: z.array(z.number().int().positive()).default([]), stance: z.enum(["support", "conditional"]).default("support"), reason: line(400), conditions: z.string().max(300).optional() }),
    2,
  ),
});
const ChangeIn = z.object({
  kind: z.enum(["add", "stance", "merge"]),
  idea: z.enum(["improve", "new"]).optional(),
  proposal: z.string().max(200).optional(),
  stance: Stance.optional(),
  reason: z.string().max(400).optional(),
  conditions: z.string().max(300).optional(),
  title: z.string().max(120).optional(),
  userChange: z.string().max(400).optional(),
  purpose: Purpose.optional(),
  keep: z.string().max(200).optional(),
  drop: z.string().max(200).optional(),
  evidence: capped(EntrySchema, 4).default([]),
});
export const TurnSchema = z.object({ respondsTo: z.enum(["facilitator", "user_value", "feasibility", "risk", "judge"]).optional(), changes: capped(ChangeIn, 4).default([]), endDiscussion: z.boolean().optional() });
export const SignalSchema = z.object({ speak: z.boolean(), kind: z.enum(["disagree", "answer", "add", "agree"]).optional(), about: z.string().max(200).optional(), intent: z.string().max(200).optional() });
export const CloseSchema = z.object({
  merges: capped(z.object({ keep: line(200), drop: line(200) }), 6).default([]),
  decisions: capped(z.object({ proposal: line(200), verdict: z.enum(["recommend", "drop", "park"]), reason: line(400), rank: z.number().int().positive().optional(), conditions: capped(line(200), 4).default([]) }), 8),
  openQuestions: capped(line(300), 4).default([]),
});
export const AskSchema = z.object({ question: line(300), options: capped(line(80), 4).optional(), allowFreeText: z.boolean().optional() });

const entryParams = obj({ id: opt(str()), path: opt(str()), line: opt(int()), snippet: opt(str()) });
const changeParams = obj({
  kind: oneOf(["add", "stance", "merge"] as const),
  idea: opt(oneOf(["improve", "new"] as const)),
  proposal: opt(str()),
  stance: opt(oneOf(["support", "against", "conditional"] as const)),
  reason: opt(str()),
  conditions: opt(str()),
  title: opt(str()),
  userChange: opt(str()),
  purpose: opt(oneOf(["A", "B", "unclear"] as const)),
  keep: opt(str()),
  drop: opt(str()),
  evidence: opt(arr(entryParams)),
});

/** A Judge input the meeting must hear: a message from the composer or an answer to a question card. */
export interface JudgeInput {
  text: string;
  to: string; // "all" or a role id
  question?: string;
  clientMsgId?: string;
}
export interface MeetingCard {
  cardId: string;
  answer: Promise<{ optionId?: string; text?: string }>;
  close(): Promise<boolean>;
}
export interface MeetingOptions {
  rules: RuntimeRules;
  /** Stable Task context (Repo_Brief and evidence summary); identical for every turn (one cached prefix). */
  context: string;
  files: Map<string, string>;
  evidence: EvidenceFiles;
  memo: MemoTree | null;
  emit: Emit;
  openCard: (card: Omit<PayloadOf<"card_opened">, "cardId" | "blocking">, actor?: Actor) => Promise<MeetingCard>;
  /** New Judge messages since the last call (from the composer; includes those sent during gathering). */
  takeJudgeMessages: () => JudgeInput[];
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel">) => Promise<TurnResult>;
  signal: AbortSignal;
  idPrefix: string;
  maxStatements?: number; // GL_MEETING_MAX_STATEMENTS, default 10
  maxMs?: number; // GL_MEETING_MAX_MIN, default 8 min
  now?: () => number;
}
export type MeetingResult = { ok: true; summary: PayloadOf<"meeting_summary">; stats: MeetingStats } | { ok: false; reason: string; stats: MeetingStats };
export interface MeetingStats {
  statements: number;
  responses: number;
  idsRemoved: number;
  failedTurns: number;
}

export async function runMeeting(o: MeetingOptions): Promise<MeetingResult> {
  const now = o.now ?? Date.now;
  const started = now();
  const maxStatements = o.maxStatements ?? 10;
  const maxMs = o.maxMs ?? 8 * 60_000;
  const board = new Board(o.evidence);
  const system = sharedSystemPrompt(o.rules, o.context);
  const transcript: string[] = [];
  const inbox: JudgeInput[] = [];
  const cards: { card: MeetingCard; question: string; answered: boolean }[] = [];
  const openQuestions: string[] = [];
  const stats: MeetingStats = { statements: 0, responses: 0, idsRemoved: 0, failedTurns: 0 };
  let turnNo = 0;
  let last: RoleId | null = null;
  let addressed: Perspective | null = null;
  let endRequested = false;
  let discussed = 0;

  const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], details: {}, ...(isError ? { isError: true } : {}) });
  const readTools = (budget: { left: number }): AgentTool<any>[] => {
    const spend = () => (budget.left-- <= 0 ? "read budget reached, submit now" : null);
    return [
      { name: "read_file", label: "read_file", description: "Read lines of a repository file (at most 400 lines).", parameters: obj({ path: str(), fromLine: opt(int()), toLine: opt(int()) }), execute: async (_i, a: { path: string; fromLine?: number; toLine?: number }) => text(spend() ?? renderReadFile(readFileLines(o.files, a.path, a.fromLine, a.toLine))) },
      { name: "search_repo", label: "search_repo", description: "Literal search over the repository files.", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(spend() ?? renderSearch(a.query, searchRepo(o.files, a.query))) },
      { name: "read_memo", label: "read_memo", description: "The memo of a file or folder (an LLM description, not evidence).", parameters: obj({ path: str() }), execute: async (_i, a: { path: string }) => text(spend() ?? (o.memo ? renderMemo(o.memo, o.memo.records[a.path] ? a.path : dirKey(a.path.replace(/\/$/, ""))) : "no memo yet")) },
      { name: "search_memo", label: "search_memo", description: "Memos that mention a word (LLM descriptions, not evidence).", parameters: obj({ query: str() }), execute: async (_i, a: { query: string }) => text(spend() ?? (o.memo ? searchMemo(o.memo, a.query).map((k) => renderMemo(o.memo!, k)).join("\n\n") || "no match" : "no memo yet")) },
    ];
  };
  const askTool = (actor: Actor, asked: { done: boolean }): AgentTool<any> => ({
    name: "ask_judge",
    label: "ask_judge",
    description: "Ask the Judge one short question with 2 to 4 options. Does not wait: the answer arrives later in the transcript.",
    parameters: obj({ question: str(), options: opt(arr(str())), allowFreeText: opt(bool()) }),
    execute: async (_i, a: unknown) => {
      const p = AskSchema.safeParse(a);
      if (!p.success) return text("Not accepted: a question and up to 4 short options are needed.", true);
      if (asked.done) return text("Only one question per turn.", true);
      if (cards.length >= MAX_QUESTIONS) return text(`The ${MAX_QUESTIONS} questions of this meeting are used. List further questions as open questions when you close.`, true);
      asked.done = true;
      const options = (p.data.options ?? []).map((label, i) => ({ id: `o${i + 1}`, label }));
      const card = await o.openCard({ kind: "question", title: p.data.question, body: "The meeting continues; your answer reaches the team when you give it.", options, allowFreeText: p.data.allowFreeText ?? true }, actor);
      const rec = { card, question: p.data.question, answered: false };
      cards.push(rec);
      void card.answer.then((ans) => {
        rec.answered = true;
        const said = ans.text ?? options.find((x) => x.id === ans.optionId)?.label ?? "(empty answer)";
        inbox.push({ text: said, to: "all", question: p.data.question });
      });
      return text("The question is on the Judge's screen. Continue; the answer will appear in the transcript.");
    },
  });
  const deliver = async () => {
    const msgs = o.takeJudgeMessages();
    for (const m of msgs) inbox.push(m);
    if (inbox.length === 0) return false;
    const ids: string[] = [];
    for (const m of inbox.splice(0)) {
      transcript.push(m.question ? `### Judge answered the question "${m.question}"\n${m.text}` : `### Judge (to ${m.to === "all" ? "everyone" : NAME[m.to] ?? m.to})\n${m.text}`);
      if (m.clientMsgId) ids.push(m.clientMsgId);
      if ((PERSPECTIVES as readonly string[]).includes(m.to)) addressed = m.to as Perspective;
    }
    if (ids.length) await o.emit({ type: "judge_message_delivered", actor: { kind: "system" }, payload: { clientMsgIds: ids, deliveredTo: ["facilitator", ...PERSPECTIVES] } });
    return true;
  };
  const prompt = (roleId: RoleId, ask: string) => `# Meeting transcript so far\n\n${transcript.join("\n\n") || "(nothing said yet)"}\n\n---\n\n${board.render()}\n\n---\n\n# Your role\n\n${roleText(o.rules, roleId)}\n\n---\n\n${ask}`;
  const say = (roleId: RoleId, phase: string, said: string, lines: string[]) => {
    const clean = stripIds(said.trim());
    stats.idsRemoved += clean.removed;
    transcript.push(`### ${NAME[roleId]} (${phase})\n${clean.text || "(no words)"}${lines.length ? `\nBoard changes: ${lines.join("; ")}` : ""}`);
  };

  /** One statement with one visible retry (R23.5); returns true when accepted. */
  async function statement(roleId: RoleId, phase: PayloadOf<"statement_submitted">["phase"], ask: string, reads: number): Promise<boolean> {
    if (o.signal.aborted) return false;
    turnNo++;
    const actor: Actor = { kind: "role", roleId };
    const budget = { left: reads };
    const asked = { done: false };
    let accepted: { lines: string[]; respondsTo?: RoleId | "judge" } | null = null;
    const publish = async (res: ReturnType<Board["apply"]>, respondsTo?: RoleId | "judge") => {
      if (res.added.length) await o.emit({ type: "evidence_added", actor, payload: { items: res.added } });
      if (res.lines.length) await o.emit({ type: "board_updated", actor, payload: { proposals: board.snapshot() } });
      await o.emit({ type: "statement_submitted", actor, payload: { roleId, phase, ...(respondsTo ? { respondsTo } : {}), changes: res.lines, evidence: res.evidence } });
      accepted = { lines: res.lines, ...(respondsTo ? { respondsTo } : {}) };
    };
    const tools: AgentTool<any>[] = reads > 0 ? readTools(budget) : [];
    if (roleId === "facilitator" && phase !== "close") tools.push(askTool(actor, asked));
    if (phase === "prepare") {
      tools.push({
        name: "submit_position",
        label: "submit_position",
        description: "Submit your position: quotes copied exactly from files, and up to 2 proposals that cite quotes by their number (1 = first quote). At least one proposal must be kind new: a capability the software cannot offer today.",
        parameters: obj({ quotes: opt(arr(obj({ path: str(), line: opt(int()), snippet: str() }))), proposals: arr(obj({ kind: oneOf(["improve", "new"] as const), title: str(), userChange: str(), purpose: oneOf(["A", "B", "unclear"] as const), quotes: opt(arr(int())), stance: opt(oneOf(["support", "conditional"] as const)), reason: str(), conditions: opt(str()) })) }),
        execute: async (_i, a: unknown) => {
          const p = PositionSchema.safeParse(a);
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
          // R11.15: every perspective brings at least one new capability, not only improvements.
          if (!p.data.proposals.some((x) => x.kind === "new")) return text("Not accepted: at least one proposal must be kind new, a capability the software cannot offer today that AI makes possible. Quote the gap (a stated limit or a missing step) and where it would attach. Submit again.", true);
          // Perspectives prepare at the same time: a proposal another one already added becomes a stance on it.
          const changes: Change[] = p.data.proposals.map((x) => {
            const evidence = x.quotes.flatMap((n) => (p.data.quotes[n - 1] ? [p.data.quotes[n - 1]!] : []));
            const cond = x.conditions ? { conditions: x.conditions } : {};
            const existing = board.find(x.title);
            return existing ? { kind: "stance", proposal: existing.id, stance: x.stance, reason: x.reason, ...cond, evidence } : { kind: "add", idea: x.kind, title: x.title, userChange: x.userChange, purpose: x.purpose, stance: x.stance, reason: x.reason, ...cond, evidence };
          });
          const res = board.apply(roleId, changes);
          if (res.lines.length === 0) return text(`Not accepted: ${res.errors.join("; ") || "no proposal"}. Submit again.`, true);
          await publish(res);
          return { ...text(`Accepted.${res.errors.length ? ` Skipped: ${res.errors.join("; ")}.` : ""}`), terminate: true };
        },
      });
    } else if (phase === "close") {
      tools.push({
        name: "submit_close",
        label: "submit_close",
        description: "Close the meeting: merge remaining duplicates, give every proposal a verdict (recommend with rank and binding conditions, drop, or park for the Judge), and list only the questions only the Judge can answer.",
        parameters: obj({ merges: opt(arr(obj({ keep: str(), drop: str() }))), decisions: arr(obj({ proposal: str(), verdict: oneOf(["recommend", "drop", "park"] as const), reason: str(), rank: opt(int()), conditions: opt(arr(str())) })), openQuestions: opt(arr(str())) }),
        execute: async (_i, a: unknown) => {
          const p = CloseSchema.safeParse(a ?? {});
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
          const merged = board.apply(roleId, p.data.merges.map((m) => ({ kind: "merge" as const, keep: m.keep, drop: m.drop })));
          const decided = board.apply(roleId, p.data.decisions.map((d) => ({ kind: "decide" as const, proposal: d.proposal, verdict: d.verdict, reason: d.reason, conditions: d.conditions, ...(d.rank ? { rank: d.rank } : {}) })));
          const res = { lines: [...merged.lines, ...decided.lines], errors: [...merged.errors, ...decided.errors], evidence: [...merged.evidence, ...decided.evidence], added: [] };
          const left = board.undecided();
          if (left.length > 0) {
            if (res.lines.length) await o.emit({ type: "board_updated", actor, payload: { proposals: board.snapshot() } });
            return text(`Not accepted yet: ${[...res.errors, `no verdict yet for ${left.join(", ")}`].join("; ")}. Submit again with a verdict for each of them.`, true);
          }
          openQuestions.push(...p.data.openQuestions);
          await publish(res);
          return { ...text("Accepted."), terminate: true };
        },
      });
    } else {
      tools.push({
        name: "submit_turn",
        label: "submit_turn",
        description: "Submit what your statement changes on the board: add a proposal, give or change a stance (perspectives), merge two proposals (Facilitator). Evidence: a pool id or a new quote.",
        parameters: obj({ respondsTo: opt(oneOf(["facilitator", "user_value", "feasibility", "risk", "judge"] as const)), changes: opt(arr(changeParams)), ...(roleId === "facilitator" && phase === "steer" ? { endDiscussion: opt(bool()) } : {}) }),
        execute: async (_i, a: unknown) => {
          const p = TurnSchema.safeParse(a ?? {});
          if (!p.success) return text(`Not accepted: ${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message}. Submit again.`, true);
          const changes: Change[] = [];
          const errors: string[] = [];
          for (const c of p.data.changes) {
            if (c.kind === "merge" && c.keep && c.drop) changes.push({ kind: "merge", keep: c.keep, drop: c.drop });
            else if (c.kind === "stance" && c.proposal && c.stance && c.reason) changes.push({ kind: "stance", proposal: c.proposal, stance: c.stance, reason: c.reason, ...(c.conditions ? { conditions: c.conditions } : {}), evidence: c.evidence });
            else if (c.kind === "add" && c.title && c.userChange && c.purpose) changes.push({ kind: "add", ...(c.idea ? { idea: c.idea } : {}), title: c.title, userChange: c.userChange, purpose: c.purpose, evidence: c.evidence, ...(c.stance ? { stance: c.stance } : {}), ...(c.reason ? { reason: c.reason } : {}), ...(c.conditions ? { conditions: c.conditions } : {}) });
            else errors.push(`a ${c.kind} change is missing fields`);
          }
          const res = board.apply(roleId, changes);
          res.errors.unshift(...errors);
          // A perspective's discussion turn must change the board; the Facilitator may only talk.
          if (roleId !== "facilitator" && res.lines.length === 0) return text(`Not accepted: ${res.errors.join("; ") || "no change"}. Every statement gives or changes at least one stance or adds a proposal. Submit again.`, true);
          // R11.14: the Facilitator may end the discussion once at least one discussion statement was made.
          if (roleId === "facilitator" && phase === "steer" && p.data.endDiscussion) {
            if (discussed > 0) endRequested = true;
            else res.errors.push("the discussion can end only after at least one statement");
          }
          await publish(res, p.data.respondsTo);
          return { ...text(`Accepted.${res.errors.length ? ` Skipped: ${res.errors.join("; ")}.` : ""}`), terminate: true };
        },
      });
    }
    const submit = tools.at(-1)!.name;
    let r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: prompt(roleId, ask), tools, signal: o.signal, idPrefix: `${o.idPrefix}-t${turnNo}`, thinkingLevel: "low" });
    if (!accepted && !o.signal.aborted && r.stopReason !== "error") {
      const why = r.error ?? (r.toolCalls === 0 ? "it answered without the submit tool" : "no valid submission");
      await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]} ended the turn without a valid ${submit} (${why}); one retry` } });
      budget.left = 0;
      const said = r.text.trim();
      r = await o.runTurn({ roleId, purpose: "statement", systemPrompt: system, prompt: `${prompt(roleId, ask)}${said ? `\n\n(What you said: ${said})` : ""}\n\nYou ended your turn without a valid ${submit}. Call ${submit} now. Do not read more files.`, tools, signal: o.signal, idPrefix: `${o.idPrefix}-t${turnNo}r`, thinkingLevel: "low" });
    }
    if (!accepted) {
      stats.failedTurns++;
      if (!o.signal.aborted && r.stopReason !== "error") await o.emit({ type: "failure", actor, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]}'s statement failed: ${r.error ?? "no valid submission"}` } });
      transcript.push(`### ${NAME[roleId]} (${phase})\n(statement failed)`);
      return false;
    }
    const acc = accepted as { lines: string[]; respondsTo?: RoleId | "judge" };
    stats.statements++;
    if (acc.respondsTo) stats.responses++;
    say(roleId, phase, r.text, acc.lines);
    last = roleId;
    return true;
  }

  /** One speaking round: every perspective except the last speaker signals at the same time (thinking off). */
  async function signals(): Promise<Signal[]> {
    const who = PERSPECTIVES.filter((r) => r !== last);
    turnNo++;
    const out = await Promise.all(
      who.map(async (roleId) => {
        let got: Signal | null = null;
        const tools: AgentTool<any>[] = [
          {
            name: "submit_signal",
            label: "submit_signal",
            description: "Say whether you want to speak next, and why in a few words.",
            parameters: obj({ speak: bool(), kind: opt(oneOf(["disagree", "answer", "add", "agree"] as const)), about: opt(str()), intent: opt(str()) }),
            execute: async (_i, a: unknown) => {
              const p = SignalSchema.safeParse(a);
              if (!p.success) return text("Not accepted: speak (true or false) is needed.", true);
              got = { roleId, speak: p.data.speak, ...(p.data.kind ? { kind: p.data.kind } : {}), ...(p.data.about ? { about: p.data.about } : {}), ...(p.data.intent ? { intent: stripIds(p.data.intent).text } : {}) };
              return { ...text("Noted."), terminate: true };
            },
          },
        ];
        const miss = board.missing()[roleId];
        const ask = `Do you want to speak next? Speak when you disagree with something just said, can answer a question, or have something new.${miss.length ? ` You have no stance yet on: ${miss.join(", ")}.` : ""} Answer only with submit_signal.`;
        const r = await o.runTurn({ roleId, purpose: "signal", systemPrompt: system, prompt: prompt(roleId, ask), tools, signal: o.signal, idPrefix: `${o.idPrefix}-s${turnNo}-${roleId}`, thinkingLevel: "off" });
        if (!got && !o.signal.aborted && r.stopReason !== "error") await o.emit({ type: "failure", actor: { kind: "role", roleId }, payload: { failureClass: "llm_output_format_invalid", source: "llm", detail: `${NAME[roleId]}'s speaking signal was not usable; counted as not speaking` } });
        return got ?? ({ roleId, speak: false } as Signal);
      }),
    );
    return out;
  }

  const timeUp = () => now() - started >= maxMs;
  const closeCards = async () => {
    for (const c of cards) if (!c.answered && (await c.card.close())) openQuestions.push(c.question);
  };

  // 1. Preparation: the three perspectives at the same time (R11.1).
  await deliver();
  await Promise.all(PERSPECTIVES.map((r) => statement(r, "prepare", "Prepare your position for the meeting: read what you need, then submit_position with up to 2 proposals from your viewpoint; each reason in at most 25 words. Say your view to the Judge in at most 100 words.", 6)));
  if (o.signal.aborted) return { ok: false, reason: "stopped", stats };
  // 2. Opening: the Facilitator merges duplicates, frames the differences, usually asks the Judge one question.
  await deliver();
  await statement("facilitator", "open", "Open the discussion: merge proposals that mean the same thing (merge), so that at most 5 remain and both kinds (improvements and new capabilities) stay on the board, then tell the Judge in at most 100 words what is on the board and where the perspectives differ. Ask the Judge one question with ask_judge when the answer would change the direction. Then submit_turn.", 0);
  // 3. Discussion, driven by speaking signals; code picks the speaker and ends it.
  let sinceSteer = 0;
  while (!o.signal.aborted && !endRequested && discussed < maxStatements && !timeUp()) {
    const heard = await deliver();
    const sig = await signals();
    if (o.signal.aborted) break;
    const pick = pickNext({ signals: sig, last, addressed, missing: board.missing() });
    addressed = null;
    await o.emit({ type: "signals_collected", actor: { kind: "system" }, payload: { signals: sig, next: pick.next, reason: pick.reason } });
    if (!pick.next) {
      if (!heard || last === "facilitator") break;
      // The Judge said something nobody wants to take up: the Facilitator answers it, then the team is asked again.
      await statement("facilitator", "steer", "The Judge just spoke. Respond in at most 60 words and say what it changes for the board. Then submit_turn.", 0);
      continue;
    }
    const miss = board.missing()[pick.next];
    const want = sig.find((s) => s.roleId === pick.next);
    const ask = `Your statement now (at most 80 words, to the Judge and the others). ${want?.intent ? `You wanted to: ${want.intent}. ` : ""}${miss.length ? `The board still needs your stance on: ${miss.join(", ")}. ` : ""}Respond to one statement (respondsTo), cite evidence by pool id or a new quote, and submit_turn.`;
    await statement(pick.next, "discuss", ask, 2);
    discussed++;
    if (++sinceSteer >= 4) {
      sinceSteer = 0;
      await deliver();
      await statement("facilitator", "steer", "Steer in at most 60 words: sum up what changed and name what is still open. Merge duplicates if needed. If you have heard enough to decide, set endDiscussion. Then submit_turn.", 0);
    }
  }
  // 4. Close: open questions, unanswered cards closed; the summary is built by code from the board (R11.12).
  await deliver();
  await closeCards();
  await statement("facilitator", "close", "Close the meeting as its decider. In at most 120 words tell the Judge what you recommend and in which order, what you drop and why, and what only the Judge can decide. Then submit_close: merge any remaining duplicates, give every proposal a verdict (recommend with rank 1, 2, … and the conditions that bind it; drop; or park for the Judge), and list only the questions you cannot decide yourself.", 0);
  if (o.signal.aborted) return { ok: false, reason: "stopped", stats };
  const proposals = board.snapshot();
  if (proposals.length === 0) return { ok: false, reason: "the meeting ended without any proposal on the board", stats };
  const summary = { proposals, openQuestions: [...new Set(openQuestions)] };
  await o.emit({ type: "meeting_summary", actor: { kind: "role", roleId: "facilitator" }, payload: summary });
  return { ok: true, summary, stats };
}
