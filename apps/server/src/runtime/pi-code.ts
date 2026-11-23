// PiCodeRuntime (design.md, "PiCodeRuntime"; R30.16, R38.3, R38.7, R38.8, R40.11, R40.13). Starts the Code_Agent
// runner with an attached exec in the Development_Sandbox, writes commands to its stdin, parses its stdout with the
// shared protocol, and maps the runner events to Studio events (actor code_agent). A question keeps the same
// process alive until it is answered. The budget timer aborts the runner and then kills the exec. Lines that are
// not protocol events are counted, never silently dropped.
import { parseRunnerLine, type RunnerEvent } from "@graftlab/shared";
import type { AttachedExec } from "../containers/docker.ts";
import type { DeltaSink, Emit } from "./pi.ts";

export interface CodeAttemptOptions {
  /** Starts the runner exec (container manager, `node /opt/runner/runner.mjs`, cwd /work). */
  start: () => Promise<AttachedExec>;
  prompt: string;
  emit: Emit;
  hub?: DeltaSink;
  /** A valid ask_question call: open the question and resolve with the answer text (R40.11, R40.13). */
  onQuestion: (q: { questionId: string; kind: "technical" | "feature"; text: string; options?: string[] }) => Promise<string>;
  budgetMs: number;
  signal: AbortSignal;
  idPrefix: string;
  /** Time between abort and kill when the runner does not end by itself. */
  killAfterMs?: number;
  setTimer?: (fn: () => void, ms: number) => () => void;
}

export interface CodeAttemptResult {
  outcome: "completed" | "error" | "aborted" | "budget_exceeded";
  detail?: string;
  questions: number;
  toolCalls: number;
  unknownLines: number;
  /** Tool results that reported a read-only file system outside /work and /tmp (R38.8). */
  confinementHits: string[];
  finalText: string;
}

const READ_ONLY = /Read-only file system|EROFS/i;

export async function runCodeAttempt(o: CodeAttemptOptions): Promise<CodeAttemptResult> {
  const setTimer = o.setTimer ?? ((fn, ms) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  });
  const actor = { kind: "code_agent" as const };
  const res: CodeAttemptResult = { outcome: "error", questions: 0, toolCalls: 0, unknownLines: 0, confinementHits: [], finalText: "" };
  const x = await o.start();
  const send = (c: object) => x.stdin.write(`${JSON.stringify(c)}\n`);
  const ids = new Map<string, string>();
  const sid = (m: string) => {
    if (!ids.has(m)) ids.set(m, `${o.idPrefix}-${m}`);
    return ids.get(m)!;
  };
  let budgetHit = false;
  let stopped = false;
  let final: RunnerEvent | null = null;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    send({ cmd: "abort" });
    setTimer(() => x.kill(), o.killAfterMs ?? 8000);
  };
  const cancelBudget = setTimer(() => {
    budgetHit = true;
    stop();
  }, o.budgetMs);
  const onAbort = () => stop();
  o.signal.addEventListener("abort", onAbort, { once: true });
  // Events are handled in order, one at a time, so the Studio events keep the runner's order.
  let chain = Promise.resolve();
  const handle = async (e: RunnerEvent) => {
    switch (e.type) {
      case "ready":
        send({ cmd: "prompt", text: o.prompt });
        return;
      case "message_start":
        await o.emit({ type: "message_started", actor, payload: { messageId: sid(e.messageId), purpose: "code_agent_step" } });
        return;
      case "delta":
        o.hub?.delta(sid(e.messageId), e.channel, e.text);
        return;
      case "message_end":
        await o.emit({ type: "message_completed", actor, payload: { messageId: sid(e.messageId), text: e.text, ...(e.reasoning ? { reasoning: e.reasoning } : {}), finishReason: e.finishReason, ...(e.usage ? { usage: e.usage } : {}) } });
        if (e.text.trim()) res.finalText = e.text;
        return;
      case "message_incomplete":
        await o.emit({ type: "message_incomplete", actor, payload: { messageId: sid(e.messageId), partialText: e.partialText, reason: e.reason } });
        return;
      case "tool_start":
        res.toolCalls++;
        await o.emit({ type: "tool_started", actor, payload: { callId: e.callId, tool: e.tool, inputSummary: e.inputSummary } });
        return;
      case "tool_end":
        await o.emit({ type: "tool_finished", actor, payload: { callId: e.callId, tool: e.tool, ok: e.ok, outputSummary: e.outputSummary } });
        if (READ_ONLY.test(e.outputSummary)) {
          res.confinementHits.push(e.outputSummary);
          await o.emit({ type: "failure", actor, payload: { failureClass: "rejected_by_safety_rule", source: "docker", detail: `a write outside /work was refused by the container: ${e.outputSummary.slice(0, 160)}` } });
        }
        return;
      case "question": {
        res.questions++;
        const answer = await o.onQuestion({ questionId: e.questionId, kind: e.kind, text: e.text, ...(e.options ? { options: e.options } : {}) });
        if (!stopped) send({ cmd: "answer", questionId: e.questionId, text: answer });
        return;
      }
      case "notice":
        await o.emit({ type: "finding_recorded", actor, payload: { kind: "note", text: `Code_Agent runtime: ${e.piType}${e.detail ? ` (${e.detail})` : ""}`, evidence: [], evidenceStatus: "none" } });
        return;
      case "final":
        if (e.outcome !== "question") {
          final = e;
          x.stdin.end();
        }
        return;
      case "command_rejected":
      case "runner_error":
        await o.emit({ type: "failure", actor, payload: { failureClass: "interface_call_failure", source: "code_agent", detail: `the Code_Agent runner: ${e.type === "runner_error" ? e.message : e.reason}` } });
        return;
    }
  };
  let buf = "";
  x.onStdout((d) => {
    buf += d.toString("utf8");
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      const e = parseRunnerLine(line);
      if (!e) {
        if (line.trim()) res.unknownLines++;
        continue;
      }
      chain = chain.then(() => handle(e)).catch(() => undefined);
    }
  });
  x.onStderr(() => {});
  await x.exited;
  await chain;
  cancelBudget();
  o.signal.removeEventListener("abort", onAbort);
  if (res.unknownLines) await o.emit({ type: "finding_recorded", actor, payload: { kind: "note", text: `Code_Agent runner: ${res.unknownLines} output lines were not protocol events`, evidence: [], evidenceStatus: "none" } });
  const f = final as Extract<RunnerEvent, { type: "final" }> | null;
  if (budgetHit) return { ...res, outcome: "budget_exceeded", detail: `the Feature's time budget of ${Math.round(o.budgetMs / 60000)} min ran out` };
  if (!f) return { ...res, outcome: o.signal.aborted ? "aborted" : "error", detail: "the runner ended without a final event" };
  if (f.outcome === "completed") return { ...res, outcome: "completed" };
  if (f.outcome === "aborted") return { ...res, outcome: "aborted" };
  return { ...res, outcome: "error", ...(f.detail ? { detail: f.detail } : {}) };
}
