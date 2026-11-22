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
