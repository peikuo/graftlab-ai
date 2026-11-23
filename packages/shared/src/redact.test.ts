import { describe, expect, it } from "vitest";
import { SecretRegistry } from "./redact.ts";

describe("SecretRegistry", () => {
  it("refuses short values and invalid names", () => {
    const r = new SecretRegistry();
    expect(() => r.register("llm_key", "short")).toThrow(/shorter than 8/);
    expect(() => r.register("Bad Name", "long-enough-value")).toThrow(/secret name/);
  });

  it("redacts values, nested strings and keys, and reports each secret once by name", () => {
    const r = new SecretRegistry();
    r.register("llm_key", "sk-test-0123456789");
    r.register("target_token", "tok_abcdefgh");
    const { value, hits } = r.redact({ a: "x sk-test-0123456789 y sk-test-0123456789", b: [{ c: "tok_abcdefgh" }], tok_abcdefgh: 1 });
    expect(value).toEqual({ a: "x [REDACTED:llm_key] y [REDACTED:llm_key]", b: [{ c: "[REDACTED:target_token]" }], "[REDACTED:target_token]": 1 });
    expect(hits.sort()).toEqual(["llm_key", "target_token"]);
  });

  it("replaces a longer value that contains a shorter one as a whole", () => {
    const r = new SecretRegistry();
    r.register("short_one", "abcdefgh");
    r.register("long_one", "xxabcdefghyy");
    expect(r.redactText("xxabcdefghyy").value).toBe("[REDACTED:long_one]");
  });

  it("terminates on circular and non-plain objects", () => {
    const r = new SecretRegistry();
    r.register("llm_key", "sk-test-0123456789");
    const a: Record<string, unknown> = { s: "sk-test-0123456789" };
    a.self = a;
    const d = new Date(0);
    const { value, hits } = r.redact<unknown>({ a, d });
    expect(hits).toEqual(["llm_key"]);
    expect(value).toEqual({ a: { s: "[REDACTED:llm_key]", self: "[Circular]" }, d });
    expect((value as { d: Date }).d).toBe(d);
  });

  it("returns the input unchanged and no hits when nothing matches", () => {
    const r = new SecretRegistry();
    r.register("llm_key", "sk-test-0123456789");
    const input = { a: "plain" };
    expect(r.redact(input)).toEqual({ value: { a: "plain" }, hits: [] });
  });
});

describe("redact: shared references and cycles", () => {
  it("keeps an object that appears twice (not a cycle) and still ends a real cycle", () => {
    const r = new SecretRegistry();
    r.register("k", "test-secret-value-123");
    const shared = { path: "a.py", snippet: "x = 1" };
    const out = r.redact({ content: { evidence: [shared] }, items: [{ evidence: [shared] }] }).value;
    expect(out.items[0]!.evidence[0]).toEqual(shared);
    const loop: Record<string, unknown> = { a: 1 };
    loop.self = loop;
    expect((r.redact(loop).value as Record<string, unknown>).self).toBe("[Circular]");
  });
});
