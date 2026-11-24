// LLM configuration with profiles (design.md, "LLM configuration and SSRF validation"; R30.1, R30.3, R30.5, R30.18).
// LLM_PROFILE selects which set of variables the server uses; the default set is LLM_BASE_URL, LLM_MODEL,
// LLM_API_KEY. Keys are only returned to the caller, which registers them with the redactor and passes them to
// the LLM client. No key is ever part of an error message.

export interface LlmConfig {
  profile: string;
  baseUrl: string;
  model: string;
  /** Undefined when no key is set: the server starts, but agent steps report the missing key honestly. */
  apiKey: string | undefined;
  /** Name of the missing key variable, when apiKey is undefined. */
  missingKey?: string;
  /** Every LLM key found in the environment (all profiles), for the redactor. */
  allKeys: { name: string; value: string }[];
  /** Name of the key variable of the active profile (never its value). */
  keyVar: string;
  /** "omit": no reasoning request parameter is sent (it can turn prompt caching off on some endpoints). */
  reasoningParam: "send" | "omit";
  /** send: thinking levels reach the endpoint as reasoning_effort (only for endpoints shown to accept it). */
  reasoningEffort: "send" | "omit";
}

export class LlmConfigError extends Error {}

const PROFILE = /^[a-z][a-z0-9]{0,15}$/;
const DEFAULTS = { baseUrl: "https://api.deepseek.com", model: "deepseek-flash" };

function vars(profile: string) {
  const p = profile === "default" ? "LLM" : `LLM_${profile.toUpperCase()}`;
  return { base: `${p}_BASE_URL`, model: `${p}_MODEL`, key: `${p}_API_KEY`, reasoning: `${p}_REASONING_PARAM`, effort: `${p}_REASONING_EFFORT` };
}

export function resolveLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const profile = (env.LLM_PROFILE ?? "default").trim().toLowerCase() || "default";
  if (!PROFILE.test(profile)) throw new LlmConfigError("LLM_PROFILE must be a short lowercase profile name, for example local");
  const v = vars(profile);
  const baseUrl = env[v.base] ?? (profile === "default" ? DEFAULTS.baseUrl : undefined);
  const model = env[v.model] ?? (profile === "default" ? DEFAULTS.model : undefined);
  if (!baseUrl) throw new LlmConfigError(`LLM profile "${profile}" needs ${v.base}`);
  if (!model) throw new LlmConfigError(`LLM profile "${profile}" needs ${v.model}`);
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new LlmConfigError(`${v.base} is not a valid address`);
  }
  if (url.protocol !== "https:") throw new LlmConfigError(`${v.base} must use https`);
  if (url.username || url.password) throw new LlmConfigError(`${v.base} must not contain credentials`);

  const allKeys = Object.entries(env)
    .filter(([name, value]) => /^LLM(_[A-Z0-9]+)?_API_KEY$/.test(name) && !!value)
    .map(([name, value]) => ({ name: name.toLowerCase(), value: value! }));
  const apiKey = env[v.key] || undefined;
  const rp = (env[v.reasoning] ?? "send").trim().toLowerCase();
  if (rp !== "send" && rp !== "omit") throw new LlmConfigError(`${v.reasoning} must be send or omit`);
  const re = (env[v.effort] ?? "omit").trim().toLowerCase();
  if (re !== "send" && re !== "omit") throw new LlmConfigError(`${v.effort} must be send or omit`);
  return { profile, baseUrl: baseUrl.replace(/\/$/, ""), model, apiKey, ...(apiKey ? {} : { missingKey: v.key }), allKeys, keyVar: v.key, reasoningParam: rp, reasoningEffort: re };
}

/** Prices for the cost estimate (R30.19): `LLM_PRICE_CURRENCY` and the three per-million-token prices; all or none. */
export interface LlmPrice {
  currency: string;
  inputPerMTok: number;
  cachedInputPerMTok: number;
  outputPerMTok: number;
}
export function resolveLlmPrice(env: Record<string, string | undefined>): LlmPrice | undefined {
  const names = ["LLM_PRICE_INPUT_PER_MTOK", "LLM_PRICE_CACHED_INPUT_PER_MTOK", "LLM_PRICE_OUTPUT_PER_MTOK"] as const;
  const currency = env.LLM_PRICE_CURRENCY?.trim();
  const set = names.filter((n) => (env[n] ?? "").trim() !== "");
  if (!currency && set.length === 0) return undefined;
  if (!currency || set.length !== names.length) throw new Error(`set LLM_PRICE_CURRENCY and ${names.join(", ")} together, or none of them`);
  const v = names.map((n) => Number(env[n]));
  if (v.some((x) => !Number.isFinite(x) || x < 0)) throw new Error("LLM prices must be non-negative numbers");
  return { currency, inputPerMTok: v[0]!, cachedInputPerMTok: v[1]!, outputPerMTok: v[2]! };
}
