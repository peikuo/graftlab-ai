// Builds the pi-ai model for the active LLM profile (design.md, "LLM configuration", "Prompt caching").
// One generic OpenAI-compatible provider, configured only from the profile. The key is not stored here: the
// agent asks for it per request through getApiKey, which reads it from the LlmConfig held by the server.
import { createModels, createProvider, envApiKeyAuth, type Api, type Model } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { LlmConfig } from "./config.ts";

export const STUDIO_PROVIDER = "studio";

export interface StudioModel {
  model: Model<Api>;
  streamFn: ReturnType<typeof createModels>["streamSimple"];
  /** Returns the key for the Studio provider only. */
  getApiKey: (provider: string) => string | undefined;
}

export function buildStudioModel(cfg: LlmConfig, opts: { contextWindow?: number; maxTokens?: number } = {}): StudioModel {
  const reasoningConfigurable = cfg.reasoningParam === "send";
  const provider = createProvider({
    id: STUDIO_PROVIDER,
    name: "Studio LLM",
    baseUrl: cfg.baseUrl,
    // Not used for requests (getApiKey answers first); kept because a provider must declare an auth method.
    auth: { apiKey: envApiKeyAuth("Studio LLM key", [cfg.keyVar]) },
    models: [
      {
        id: cfg.model,
        name: cfg.model,
        api: "openai-completions",
        baseUrl: cfg.baseUrl,
        provider: STUDIO_PROVIDER,
        reasoning: reasoningConfigurable,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: opts.contextWindow ?? 200_000,
        // GL_MAX_TOKENS (R30.12). Reasoning and the answer share this; large enough that thinking never cuts the answer.
        maxTokens: opts.maxTokens ?? 32_768,
        // reasoningEffort "send": thinking.type plus reasoning_effort, so low, medium and high differ (measured
        // 2026-11-23: without it, one endpoint received only thinking enabled for every level).
        compat: { supportsStore: false, maxTokensField: "max_tokens", ...(cfg.reasoningEffort === "send" ? { thinkingFormat: "deepseek" as const, supportsReasoningEffort: true } : {}) },
        type: "chat",
      },
    ],
    api: openAICompletionsApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  const model = models.getModel(STUDIO_PROVIDER, cfg.model);
  if (!model) throw new Error(`the model of profile "${cfg.profile}" could not be set up`);
  return {
    model,
    streamFn: models.streamSimple.bind(models),
    getApiKey: (p) => (p === STUDIO_PROVIDER ? cfg.apiKey : undefined),
  };
}
