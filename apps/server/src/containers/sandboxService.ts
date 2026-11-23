// The running Sandbox of the current Task and its guard (design: Sandbox and test data; R29.2, R29.5, R18.13).
// Restore uses the same procedure as reset. After a failed start, reset or restore, no Agent action may run against
// the target baseline until a reset or restore succeeds; `guard()` is the check every such action calls.
import type { SandboxResult } from "./sandbox.ts";

export interface SandboxLike {
  start(): Promise<SandboxResult>;
  reset(): Promise<SandboxResult>;
  stop(): Promise<void>;
}

export type RestoreOutcome = { ok: true; result: SandboxResult } | { ok: false; status: 404 | 409; error: string };

export class SandboxService {
  #sandbox: SandboxLike | null = null;
  #blocked: string | null = null;
  #busy = false;

  constructor(private readonly onResult: (kind: "start" | "reset" | "restore", r: SandboxResult) => void | Promise<void> = () => {}) {}

  get running(): boolean {
    return this.#sandbox !== null;
  }

  /** null when Agent actions against the baseline may run; otherwise the reason they may not. */
  guard(): string | null {
    if (!this.#sandbox) return "no Sandbox is running";
    if (this.#busy) return "the Sandbox is being reset";
    return this.#blocked;
  }

  async start(sandbox: SandboxLike): Promise<SandboxResult> {
    this.#sandbox = sandbox;
    return this.#do("start", () => sandbox.start());
  }

  reset(): Promise<RestoreOutcome> {
    return this.#reset("reset");
  }

  /** POST /api/sandbox/restore (the caller has checked operator or admin). */
  restore(): Promise<RestoreOutcome> {
    return this.#reset("restore");
  }

  async stop(): Promise<void> {
    const s = this.#sandbox;
    this.#sandbox = null;
    this.#blocked = null;
    await s?.stop();
  }

  async #reset(kind: "reset" | "restore"): Promise<RestoreOutcome> {
    const s = this.#sandbox;
    if (!s) return { ok: false, status: 404, error: "no Sandbox is running" };
    if (this.#busy) return { ok: false, status: 409, error: "a reset or restore is already running" };
    return { ok: true, result: await this.#do(kind, () => s.reset()) };
  }

  async #do(kind: "start" | "reset" | "restore", fn: () => Promise<SandboxResult>): Promise<SandboxResult> {
    this.#busy = true;
    try {
      const r = await fn();
      this.#blocked = r.ok ? null : `the last ${kind} failed (${r.step}): ${r.reason}; a reset or restore must succeed first`;
      await this.onResult(kind, r);
      return r;
    } finally {
      this.#busy = false;
    }
  }
}
