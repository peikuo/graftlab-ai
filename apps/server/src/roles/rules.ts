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

/**
 * Meeting system prompt: shared rules and the Task context only, identical for every meeting role, so all roles
 * share it and the transcript as one cached prefix; the role text goes at the end of the user message.
 */
export function sharedSystemPrompt(rules: RuntimeRules, context: string): string {
  return [rules.shared, context.trim() ? `# Task context\n\n${context.trim()}` : ""].filter(Boolean).join("\n\n---\n\n");
}
export function roleText(rules: RuntimeRules, role: string): string {
  const t = rules.roles[role];
  if (t === undefined) throw new Error(`no runtime rules for the role "${role}"`);
  return t;
}
/** System prompt in the fixed caching order. `context` must not contain anything that changes per call. */
export function systemPrompt(rules: RuntimeRules, role: string, context = ""): string {
  const roleText = rules.roles[role];
  if (roleText === undefined) throw new Error(`no runtime rules for the role "${role}"`);
  return [rules.shared, context.trim() ? `# Task context\n\n${context.trim()}` : "", roleText].filter(Boolean).join("\n\n---\n\n");
}
