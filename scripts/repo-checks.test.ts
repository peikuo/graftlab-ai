// Repository checks (design.md, "Repository checks"; R33.2-R33.4, R35.5, R39.10, R22.9).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain ESM script without types
import { listFiles, scan, scanText } from "./secret-scan.mjs";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("repository checks", () => {
  it("LICENSE is Apache-2.0", () => {
    expect(read("LICENSE")).toMatch(/Apache License\s+Version 2\.0/);
  });

  it(".kiro/ is not ignored", () => {
    // git check-ignore exits 1 when the path is not ignored.
    let ignored = true;
    try {
      git("check-ignore", "-q", ".kiro/specs/graftlab-ai/requirements.md");
    } catch {
      ignored = false;
    }
    expect(ignored).toBe(false);
  });

  it("no .env file is tracked, and .env.example exists with names only", () => {
    const tracked = git("ls-files").split("\n");
    expect(tracked.filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example"))).toEqual([]);
    const example = read(".env.example");
    for (const line of example.split("\n")) {
      if (/^(LLM_API_KEY|GITHUB_TOKEN)\s*=/.test(line)) expect(line.split("=")[1]!.trim()).toBe("");
    }
  });

  it("the secret scan is clean and detects a planted key", () => {
    process.chdir(root);
    const findings = scan(listFiles());
    expect(findings.map((f: { file: string; line: number }) => `${f.file}:${f.line}`)).toEqual([]);
    expect(scanText(`x = "sk-${"a".repeat(32)}"`)).toHaveLength(1);
    expect(scanText("LLM_API_KEY=")).toHaveLength(0);
  });

  it("no Adapter carries a start procedure for the modified target (R39.10)", () => {
    const forbidden = /^(start|startCommand|startCommands|run|runCommand|build|buildCommand|entrypoint|cmd|startProcedure|runEnvironment)$/i;
    const bad: string[] = [];
    const visit = (v: unknown, at: string) => {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
        if (forbidden.test(k)) bad.push(`${at}.${k}`);
        visit(x, `${at}.${k}`);
      }
    };
    for (const dir of readdirSync(join(root, "adapters"))) {
      const p = join("adapters", dir, "adapter.json");
      if (existsSync(join(root, p))) visit(JSON.parse(read(p)), dir);
    }
    expect(bad).toEqual([]);
  });

  it("the Verifier imports no LLM module (R22.9)", () => {
    const llm = /from\s+["'](@earendil-works\/pi-[^"']+|openai|[^"']*\/runtime\/[^"']*|[^"']*\/llm[^"']*)["']/;
    const files = walk(join(root, "apps/server/src/verifier")).filter((f) => /\.tsx?$/.test(f));
    expect(files.filter((f) => llm.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("the traceability table covers every requirement (R35.5)", () => {
    const req = read(".kiro/specs/graftlab-ai/requirements.md");
    const declared = [...req.matchAll(/^### Requirement (\d+):/gm)].map((m) => Number(m[1]));
    const table = req.slice(req.indexOf("## Traceability Table"));
    const traced = new Set([...table.matchAll(/^\| (\d+) /gm)].map((m) => Number(m[1])));
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((n) => !traced.has(n))).toEqual([]);
  });
});
