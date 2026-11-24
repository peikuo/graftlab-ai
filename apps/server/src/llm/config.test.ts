import { describe, expect, it } from "vitest";
import { LlmConfigError, resolveLlmConfig } from "./config.ts";

const KEY_D = "test-deepseek-value-01";
const KEY_G = "test-local-value-0001";
const base = { LLM_BASE_URL: "https://api.deepseek.com", LLM_MODEL: "deepseek-flash", LLM_API_KEY: KEY_D };
const local = { LLM_LOCAL_BASE_URL: "https://llm.example.test/v1", LLM_LOCAL_MODEL: "model-x", LLM_LOCAL_API_KEY: KEY_G };

describe("resolveLlmConfig", () => {
  it("uses the default values without a profile", () => {
    expect(resolveLlmConfig(base)).toMatchObject({ profile: "default", model: "deepseek-flash", baseUrl: "https://api.deepseek.com", apiKey: KEY_D });
  });

  it("uses the selected profile and lists every key for the redactor", () => {
    const c = resolveLlmConfig({ ...base, ...local, LLM_PROFILE: "local" });
    expect(c).toMatchObject({ profile: "local", model: "model-x", baseUrl: "https://llm.example.test/v1", apiKey: KEY_G });
    expect(c.allKeys.map((k) => k.value).sort()).toEqual([KEY_D, KEY_G].sort());
  });

  it("names the missing variable, never a value", () => {
    const e = (() => {
      try {
        resolveLlmConfig({ ...base, LLM_PROFILE: "local", LLM_LOCAL_MODEL: "model-x" });
      } catch (x) {
        return x as LlmConfigError;
      }
    })();
    expect(e).toBeInstanceOf(LlmConfigError);
    expect(e!.message).toMatch(/LLM_LOCAL_BASE_URL/);
    expect(e!.message).not.toContain(KEY_D);
  });

  it("refuses an invalid profile name and a non-https address", () => {
    expect(() => resolveLlmConfig({ ...base, LLM_PROFILE: "a-b" })).toThrow(/profile name/);
    expect(() => resolveLlmConfig({ ...base, LLM_BASE_URL: "http://api.deepseek.com" })).toThrow(/https/);
  });

  it("an unset key is allowed (no LLM calls) but reported", () => {
    const c = resolveLlmConfig({ LLM_BASE_URL: base.LLM_BASE_URL, LLM_MODEL: base.LLM_MODEL });
    expect(c.apiKey).toBeUndefined();
    expect(c.missingKey).toBe("LLM_API_KEY");
  });
});

describe("reasoning parameter", () => {
  it("defaults to send, accepts omit per profile, refuses other values", () => {
    expect(resolveLlmConfig(base).reasoningParam).toBe("send");
    expect(resolveLlmConfig({ ...base, LLM_REASONING_PARAM: "omit" }).reasoningParam).toBe("omit");
    expect(() => resolveLlmConfig({ ...base, LLM_REASONING_PARAM: "maybe" })).toThrow(/send or omit/);
    expect(resolveLlmConfig(base).keyVar).toBe("LLM_API_KEY");
  });
});
describe("price file (R30.19)", () => {
  it("gives the model's prices, nothing without file or entry, and refuses a broken entry", async () => {
    const { priceFromFile } = await import("./config.ts");
    const file = JSON.stringify({ m1: { currency: "USD", inputPerMTok: 0.3, cachedInputPerMTok: 0.006, outputPerMTok: 1.2, source: "price page" } });
    expect(priceFromFile(file, "m1")).toEqual({ currency: "USD", inputPerMTok: 0.3, cachedInputPerMTok: 0.006, outputPerMTok: 1.2 });
    expect(priceFromFile(file, "other")).toBeUndefined();
    expect(priceFromFile(null, "m1")).toBeUndefined();
    expect(() => priceFromFile(JSON.stringify({ m1: { currency: "USD", inputPerMTok: -1 } }), "m1")).toThrow(/m1/);
  });
});
