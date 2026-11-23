// Common secret patterns (R30.15, R27.12): the same list as scripts/secret-scan.mjs, used by the Replay exporter's
// second scan. A match is reported by pattern name only, never by value.
export const SECRET_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "key assignment with a value", re: /\b(LLM(?:_[A-Z0-9]+)?_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*['"]?[A-Za-z0-9_-]{16,}/ },
];
export function findSecretPatterns(text: string): string[] {
  return SECRET_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);
}
