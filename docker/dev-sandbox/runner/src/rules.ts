// The Code_Agent rules come from the Runtime_Rules (`runtime-rules/roles/code_agent.md`), which the backend puts
// into the read-only story bundle; the runner never carries its own copy of the rules text.
import { readFile } from "node:fs/promises";

export const DEFAULT_RULES_FILE = "/context/rules.md";

export async function loadRules(path = process.env.GL_RULES_FILE ?? DEFAULT_RULES_FILE): Promise<string> {
  const text = (await readFile(path, "utf8")).trim();
  if (!text) throw new Error("the Code_Agent rules file is empty");
  return text;
}
