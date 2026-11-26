// Access codes for operating (design.md, "Queue"; R28.7). Watching needs no code. Kept in memory on purpose:
// a backend restart asks for the code again and resets the daily counts.
import { timingSafeEqual } from "node:crypto";

export interface AccessOptions {
  codes: readonly string[];
  dailyTasks?: number; // GL_ACCESS_CODE_DAILY_TASKS, default 3
  maxWrong?: number; // wrong codes per client address before back-off, default 5
  windowMs?: number; // window for counting wrong codes and the back-off length, default 15 min
  now?: () => number;
}
export type UnlockResult = { ok: true; codeIndex: number } | { ok: false; status: 401 | 429; error: string; retryAfterS?: number };
export type TaskAllowance = { ok: true } | { ok: false; status: 403 | 429; error: string };

/** Parses GL_ACCESS_CODES; a code shorter than 8 characters is a configuration error, not silently dropped. */
export function parseAccessCodes(raw: string | undefined): string[] {
  const codes = (raw ?? "").split(",").map((c) => c.trim()).filter(Boolean);
  const short = codes.findIndex((c) => c.length < 8);
  if (short >= 0) throw new Error(`GL_ACCESS_CODES: code ${short + 1} is shorter than 8 characters`);
  return codes;
}

export class AccessCodes {
  #codes: Buffer[];
  #daily: number;
  #maxWrong: number;
  #windowMs: number;
  #now: () => number;
  #unlocked = new Map<string, number>(); // sessionId -> code index
  #owners = new Set<string>(); // sessions unlocked with the admin token (R42: the owner)
  #wrong = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();
  #used = new Map<string, number>(); // `${day}:${index}` -> Tasks created
  constructor(opts: AccessOptions) {
    this.#codes = opts.codes.map((c) => Buffer.from(c));
    this.#daily = opts.dailyTasks ?? 3;
    this.#maxWrong = opts.maxWrong ?? 5;
    this.#windowMs = opts.windowMs ?? 15 * 60_000;
    this.#now = opts.now ?? Date.now;
  }
  get required(): boolean {
    return this.#codes.length > 0;
  }
  unlocked(sessionId: string | undefined): boolean {
    return !this.required || (!!sessionId && (this.#unlocked.has(sessionId) || this.#owners.has(sessionId)));
  }
  /** R42: the owner unlocked with the admin token (no daily cap); without access codes every session is the owner. */
  unlockOwner(sessionId: string): void {
    this.#owners.add(sessionId);
  }
  isOwner(sessionId: string | undefined): boolean {
    return !this.required || (!!sessionId && this.#owners.has(sessionId));
  }
  unlock(sessionId: string, given: string, client: string): UnlockResult {
    const now = this.#now();
    const w = this.#wrong.get(client);
    if (w && w.blockedUntil > now) {
      const retryAfterS = Math.ceil((w.blockedUntil - now) / 1000);
      return { ok: false, status: 429, error: `too many wrong codes; try again in ${Math.ceil(retryAfterS / 60)} min`, retryAfterS };
    }
    const index = this.#match(given);
    if (index >= 0) {
      this.#unlocked.set(sessionId, index);
      this.#wrong.delete(client);
      return { ok: true, codeIndex: index };
    }
    const cur = w && now - w.firstAt <= this.#windowMs ? w : { count: 0, firstAt: now, blockedUntil: 0 };
    cur.count += 1;
    if (cur.count >= this.#maxWrong) cur.blockedUntil = now + this.#windowMs;
    this.#wrong.set(client, cur);
    return { ok: false, status: 401, error: "this access code is not valid" };
  }
  /** Counts a Task against the session's code; refuses when the code reached its daily cap. */
  takeTask(sessionId: string | undefined): TaskAllowance {
    if (!this.required || (sessionId !== undefined && this.#owners.has(sessionId))) return { ok: true };
    const index = sessionId === undefined ? undefined : this.#unlocked.get(sessionId);
    if (index === undefined) return { ok: false, status: 403, error: "an access code is needed to operate" };
    const key = `${new Date(this.#now()).toISOString().slice(0, 10)}:${index}`;
    const n = this.#used.get(key) ?? 0;
    if (n >= this.#daily) return { ok: false, status: 429, error: `this access code has started ${this.#daily} Tasks today (UTC), the daily limit` };
    this.#used.set(key, n + 1);
    return { ok: true };
  }
  /** Gives a counted Task back when creation failed afterwards (for example an invalid repository). */
  returnTask(sessionId: string | undefined): void {
    const index = sessionId === undefined ? undefined : this.#unlocked.get(sessionId);
    if (index === undefined) return;
    const key = `${new Date(this.#now()).toISOString().slice(0, 10)}:${index}`;
    const n = this.#used.get(key) ?? 0;
    if (n > 0) this.#used.set(key, n - 1);
  }
  // Compares against every code without stopping early, so timing does not tell which one matched.
  #match(given: string): number {
    const g = Buffer.from(given);
    let found = -1;
    this.#codes.forEach((c, i) => {
      const same = g.length === c.length && timingSafeEqual(g, c);
      if (same && found < 0) found = i;
    });
    return found;
  }
}
