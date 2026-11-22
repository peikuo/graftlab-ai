#!/usr/bin/env node
// Kiro PreToolUse hook helper: before an agent shell command that runs `git commit`,
// scan the staged files for secrets and block the command (exit 2) on any finding.
import { readFileSync } from "node:fs";
import { listFiles, scan } from "../secret-scan.mjs";

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  // ignore
}
const text = JSON.stringify(input);
if (!/git[^"]*\bcommit\b/.test(text)) process.exit(0);

// git add may run in the same command before the commit, so scan staged and not-ignored files.
const files = [...new Set([...listFiles({ staged: true }), ...listFiles()])];
const findings = scan(files);
if (findings.length > 0) {
  for (const x of findings) console.error(`secret-scan: ${x.file}:${x.line} ${x.pattern}`);
  console.error("Commit blocked by the secret scan. Remove the secret, then commit again.");
  process.exit(2);
}
console.log(`secret-scan before commit: ${files.length} files, 0 findings`);
