// Secret redactor, the second guard (design.md, "Secret redactor"; R30.15, R27.12, R28.4).
// The first guard is that no code writes a secret anywhere. This module only catches what slipped through:
// every hit is reported to the caller, which records it as a visible rejected_by_safety_rule failure.
// Pure and platform-neutral: used by the event store, the SSE hub, the logger and the Replay exporter.

export const MIN_SECRET_LENGTH = 8;
const NAME = /^[a-z][a-z0-9_]{0,40}$/;

export interface RedactResult<T> {
  value: T;
  /** Registered names of the secrets that were found (one entry per secret, not per occurrence). */
  hits: string[];
}

export class SecretRegistry {
  #byName = new Map<string, string>();
  #ordered: { name: string; value: string }[] = [];

  /**
   * Registers a secret value under a plain name (for example "llm_key", "target_token").
   * Names appear in failure details, so they must be simple identifiers; values must be at least 8 characters,
   * because a short value would match ordinary text (configuration error).
   */
  register(name: string, value: string): void {
    if (!NAME.test(name)) throw new Error(`secret name must match ${NAME}: got an invalid name`);
    if (value.length < MIN_SECRET_LENGTH) throw new Error(`secret "${name}" is shorter than ${MIN_SECRET_LENGTH} characters`);
    this.#byName.set(name, value);
    // Longest first, so a value that contains another registered value is replaced as a whole.
    this.#ordered = [...this.#byName].map(([n, v]) => ({ name: n, value: v })).sort((a, b) => b.value.length - a.value.length);
  }

  unregister(name: string): void {
    this.#byName.delete(name);
    this.#ordered = this.#ordered.filter((s) => s.name !== name);
  }

  get names(): string[] {
    return [...this.#byName.keys()];
  }

  get size(): number {
    return this.#byName.size;
  }

  /** Replaces every registered value in one string. */
  redactText(text: string): RedactResult<string> {
    let out = text;
    const hits: string[] = [];
    for (const s of this.#ordered) {
      if (out.includes(s.value)) {
        out = out.split(s.value).join(`[REDACTED:${s.name}]`);
        hits.push(s.name);
      }
    }
    return { value: out, hits };
  }

  /** Walks every string (values and object keys) of a JSON-like value and redacts it. Returns a new value. */
  redact<T>(value: T): RedactResult<T> {
    const hits = new Set<string>();
    const walk = (v: unknown): unknown => {
      if (typeof v === "string") {
        const r = this.redactText(v);
        r.hits.forEach((h) => hits.add(h));
        return r.value;
      }
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[walk(k) as string] = walk(x);
        return out;
      }
      return v;
    };
    if (this.#ordered.length === 0) return { value, hits: [] };
    return { value: walk(value) as T, hits: [...hits] };
  }
}
