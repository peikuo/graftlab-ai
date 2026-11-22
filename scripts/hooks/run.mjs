#!/usr/bin/env node
// Entry point for every Kiro hook in .kiro/hooks/. It runs the named hook and appends one line per run to
// data/hook-runs.log (gitignored), because Kiro shows no output for a successful PostFileSave or PreToolUse hook.
// Usage: node scripts/hooks/run.mjs <related-tests|secret-scan|flow-check|pre-commit-scan>
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";

const name = process.argv[2] ?? "";
const scripts = {
  "related-tests": ["node", ["scripts/hooks/related-tests.mjs"]],
  "secret-scan": ["node", ["scripts/secret-scan.mjs"]],
  "flow-check": ["npm", ["run", "-s", "flow:check"]],
  "pre-commit-scan": ["node", ["scripts/hooks/pre-commit-scan.mjs"]],
};
if (!(name in scripts)) {
  console.error(`hooks/run: unknown hook "${name}"`);
  process.exit(1);
}

const input = readFileSync(0, "utf8");
const started = Date.now();
const [cmd, args] = scripts[name];
const r = spawnSync(cmd, args, { input, encoding: "utf8" });
const status = r.status ?? 1;

// Only file paths and the tool name go into the log, never command text or file contents.
let context = "";
try {
  const ctx = JSON.parse(input || "{}");
  const paths = [];
  const walk = (v) => {
    // A path-like string only: no whitespace, so command text never matches.
    if (typeof v === "string" && /^[\w./@-]+\.[a-z]{1,5}$/i.test(v) && v.length < 300) paths.push(v);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  // For tool hooks only the tool name is logged; for file hooks the saved paths.
  if (name !== "pre-commit-scan") walk(ctx);
  const tool = ctx.tool_name ?? ctx.toolName ?? "";
  context = [tool, ...new Set(paths)].filter(Boolean).slice(0, 5).join(" ");
} catch {
  context = "(no JSON context)";
}
mkdirSync("data", { recursive: true });
appendFileSync("data/hook-runs.log", `${new Date().toISOString()} ${name} exit=${status} ${Date.now() - started}ms ${context}\n`);

process.stdout.write(r.stdout ?? "");
process.stderr.write(r.stderr ?? "");
process.exit(status);
