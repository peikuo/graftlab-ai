// Runtime_Rules loader and prompt assembly (design.md, "roles/", "Prompt caching"; R35.3, R35.4).
// Prompts come only from runtime-rules/ (layer B). The order is fixed so prompt prefixes are byte-identical:
// shared rules, then the stable Task context, then the role text; the variable part goes into the user message.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface RuntimeRules {
  version: string;
  shared: string;
  roles: Record<string, string>;
}

export async function loadRuntimeRules(root: string, roles: string[]): Promise<RuntimeRules> {
  const version = (await readFile(join(root, "VERSION"), "utf8")).trim();
  const shared = (await readFile(join(root, "rules", "shared.md"), "utf8")).trim();
  const out: Record<string, string> = {};
  for (const r of roles) out[r] = (await readFile(join(root, "roles", `${r}.md`), "utf8")).trim();
  return { version, shared, roles: out };
}

/** System prompt in the fixed caching order. `context` must not contain anything that changes per call. */
export function systemPrompt(rules: RuntimeRules, role: string, context = ""): string {
  const roleText = rules.roles[role];
  if (roleText === undefined) throw new Error(`no runtime rules for the role "${role}"`);
  return [rules.shared, context.trim() ? `# Task context\n\n${context.trim()}` : "", roleText].filter(Boolean).join("\n\n---\n\n");
}
