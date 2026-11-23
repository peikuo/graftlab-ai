import { describe, expect, it } from "vitest";
import { resolveLlmConfig } from "./config.ts";
import { STUDIO_PROVIDER, buildStudioModel } from "./model.ts";

const env = { LLM_BASE_URL: "https://llm.example.test/v1", LLM_MODEL: "model-x", LLM_API_KEY: "test-value-0123456789" };

describe("buildStudioModel", () => {
  it("defines one OpenAI-compatible model from the profile and answers the key only for the Studio provider", () => {
    const m = buildStudioModel(resolveLlmConfig(env));
    expect(m.model).toMatchObject({ id: "model-x", api: "openai-completions", provider: STUDIO_PROVIDER, reasoning: true, maxTokens: 32768 });
    expect(m.getApiKey(STUDIO_PROVIDER)).toBe(env.LLM_API_KEY);
    expect(m.getApiKey("other")).toBeUndefined();
  });

  it("with the reasoning parameter omitted the model is not reasoning-configurable", () => {
    const m = buildStudioModel(resolveLlmConfig({ ...env, LLM_REASONING_PARAM: "omit" }));
    expect(m.model.reasoning).toBe(false);
  });
});
