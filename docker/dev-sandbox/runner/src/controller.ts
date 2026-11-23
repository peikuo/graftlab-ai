// Runner controller: the command and turn logic of the Code_Agent runner, separated from the pi wiring in main.ts
// so it can be tested with recorded pi events and a fake session (design: PiCodeRuntime, command protocol).
// One process per story attempt. The process stays alive while a question is open, so `answer` continues the
// same session (R40.13). Any other final outcome ends the process.
import { AskQuestionArgs, createPiEventMapper, parseRunnerCommand, type PiEventLike, type RunnerEvent } from "@graftlab/shared";

/** The part of pi's AgentSession the runner uses. */
export interface SessionLike {
  subscribe(listener: (e: PiEventLike) => void): () => void;
  prompt(text: string): Promise<void>;
  steer(text: string): Promise<void>;
  followUp(text: string): Promise<void>;
  abort(): Promise<void>;
  waitForIdle(): Promise<void>;
  readonly isStreaming: boolean;
  dispose(): void;
}

export interface ToolResult {
  content: { type: "text"; text: string }[];
  details: Record<string, never>;
  terminate?: boolean;
}

export const ASK_QUESTION_DESCRIPTION =
  "Stop and ask when the story is unclear, requirements or tests contradict each other, the work would need more than the story allows, or you keep failing. Do not guess. kind=technical for implementation questions, kind=feature for questions about what the feature should do. After calling it, stop and wait: the answer arrives as the next user message.";

export class RunnerController {
  readonly #out: (e: RunnerEvent) => void;
  readonly #exit: (code: number) => void;
  readonly #mapper = createPiEventMapper();
  #session: SessionLike | null = null;
  #pending: { questionId: string } | null = null;
  #running: Promise<void> | null = null;
  #aborted = false;
  #ended = false;

  readonly #record: ((e: PiEventLike) => void) | undefined;

  /** `record` receives every raw pi event (used only to record test fixtures). */
  constructor(o: { out: (e: RunnerEvent) => void; exit: (code: number) => void; record?: (e: PiEventLike) => void }) {
    this.#out = o.out;
    this.#exit = o.exit;
    this.#record = o.record;
  }

  attach(session: SessionLike, ready: { model: string; tools: string[] }): void {
    this.#session = session;
    session.subscribe((e) => {
      this.#record?.(e);
      for (const ev of this.#mapper.map(e)) this.#out(ev);
    });
    this.#out({ type: "ready", model: ready.model, tools: ready.tools });
  }

  /** The `execute` of the custom `ask_question` tool. A valid call emits `question` and ends the turn. */
  askQuestion(toolCallId: string, args: unknown): ToolResult {
    const r = AskQuestionArgs.safeParse(args);
    if (!r.success) {
      return { content: [{ type: "text", text: `Invalid ask_question arguments: ${r.error.issues.map((i) => i.message).join("; ")}` }], details: {} };
    }
    this.#pending = { questionId: toolCallId };
    this.#out({ type: "question", questionId: toolCallId, kind: r.data.kind, text: r.data.text, ...(r.data.options ? { options: r.data.options } : {}) });
    return { content: [{ type: "text", text: "Question sent. Stop now and wait; the answer arrives as the next user message." }], details: {}, terminate: true };
  }

  get pendingQuestion(): string | null {
    return this.#pending?.questionId ?? null;
  }

  /** Handles one stdin line. Returns when the command has been accepted (a turn keeps running in the background). */
  handleLine(line: string): void {
    const parsed = parseRunnerCommand(line);
    if (parsed === null || this.#ended) return;
    if (!parsed.ok) return this.#reject(parsed.reason);
    const s = this.#session;
    if (!s) return this.#reject("the session is not ready yet");
    const c = parsed.command;
    switch (c.cmd) {
      case "prompt":
        if (this.#running) return this.#reject("a turn is running; use steer");
        if (this.#pending) return this.#reject("a question is open; use answer");
        return this.#turn(() => s.prompt(c.text));
      case "answer":
        if (!this.#pending) return this.#reject("no question is open");
        if (c.questionId !== this.#pending.questionId) return this.#reject("the answer does not match the open question");
        // The question is cleared when the answer is executed, not when it is read (finding of task 1.8).
        if (this.#running && s.isStreaming) {
          this.#pending = null;
          void s.followUp(`Answer to your question: ${c.text}`);
          return;
        }
        if (this.#running) return this.#reject("the turn is still ending; send the answer again");
        return this.#turn(() => {
          this.#pending = null;
          return s.prompt(`Answer to your question: ${c.text}`);
        });
      case "steer":
        if (!this.#running || !s.isStreaming) return this.#reject("no turn is running");
        void s.steer(c.text);
        return;
      case "abort":
        this.#aborted = true;
        if (!this.#running) {
          this.#final({ type: "final", outcome: "aborted" });
          return;
        }
        void s.abort();
        return;
    }
  }

  /** stdin closed: stop whatever runs and end. */
  async close(): Promise<void> {
    if (this.#ended) return;
    this.#aborted = true;
    if (this.#running) {
      await this.#session?.abort();
      await this.#running;
    }
    if (!this.#ended) this.#final({ type: "final", outcome: "aborted", detail: "the command stream closed" });
  }

  #reject(reason: string): void {
    this.#out({ type: "command_rejected", reason });
  }

  #turn(run: () => Promise<void>): void {
    const s = this.#session!;
    this.#running = (async () => {
      try {
        await run();
        await s.waitForIdle();
      } catch (err) {
        this.#out({ type: "runner_error", message: String((err as Error)?.message ?? err).slice(0, 300) });
        this.#running = null;
        return this.#final({ type: "final", outcome: "error", detail: "the runner failed" });
      }
      this.#running = null;
      if (this.#aborted || this.#mapper.lastStopReason === "aborted") return this.#final({ type: "final", outcome: "aborted" });
      if (this.#mapper.lastStopReason === "error") return this.#final({ type: "final", outcome: "error", detail: this.#mapper.lastError ?? "the model call failed" });
      if (this.#pending) return this.#out({ type: "final", outcome: "question" });
      this.#final({ type: "final", outcome: "completed" });
    })();
  }

  #final(e: RunnerEvent & { type: "final" }): void {
    this.#ended = true;
    this.#out(e);
    try {
      this.#session?.dispose();
    } finally {
      this.#exit(e.outcome === "completed" ? 0 : 1);
    }
  }
}
