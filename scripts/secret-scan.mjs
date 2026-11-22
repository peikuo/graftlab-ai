#!/usr/bin/env node
// Secret scan (R30.5, R33.4). Scans tracked, staged and untracked-but-not-ignored files for secret patterns.
// It never reads .env files: they are refused by name, and a tracked or staged .env is itself a finding.
// Usage: node scripts/secret-scan.mjs [--staged]   Exit code 1 when anything is found.
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const PATTERNS = [
  { name: "OpenAI-style key", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/ },
  { name: "GitHub fine-grained token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "Slack token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: "key assignment with a value", re: /\b(LLM_API_KEY|GITHUB_TOKEN|OPENAI_API_KEY|DEEPSEEK_API_KEY)\s*=\s*['"]?[A-Za-z0-9_-]{16,}/ },
];

const SKIP = [/^package-lock\.json$/, /\.(png|jpg|jpeg|gif|webp|ico|pdf|woff2?|ttf|zip|gz|tgz)$/i];
const isEnvFile = (f) => /(^|\/)\.env(\..+)?$/.test(f) && !f.endsWith(".env.example");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);
}

export function listFiles({ staged = false } = {}) {
  if (staged) return git(["diff", "--cached", "--name-only", "--diff-filter=ACMR"]);
  return [...new Set(git(["ls-files", "--cached", "--others", "--exclude-standard"]))];
}

export function scanText(text) {
  const hits = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const p of PATTERNS) if (p.re.test(lines[i])) hits.push({ line: i + 1, pattern: p.name });
  }
  return hits;
}

export function scan(files) {
  const findings = [];
  for (const f of files) {
    if (isEnvFile(f)) {
      findings.push({ file: f, line: 0, pattern: ".env file must not be tracked or staged" });
      continue; // never read it
    }
    if (SKIP.some((re) => re.test(f))) continue;
    let st;
    try {
      st = statSync(f);
    } catch {
      continue; // deleted in the work tree
    }
    if (!st.isFile() || st.size > 2_000_000) continue;
    const text = readFileSync(f, "utf8");
    if (text.includes("\u0000")) continue; // binary
    for (const h of scanText(text)) findings.push({ file: f, ...h });
  }
  return findings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = listFiles({ staged: process.argv.includes("--staged") });
  const findings = scan(files);
  // Findings name the file, line and pattern only; the matched value is never printed.
  for (const x of findings) console.error(`secret-scan: ${x.file}:${x.line} ${x.pattern}`);
  console.log(`secret-scan: ${files.length} files scanned, ${findings.length} findings`);
  process.exit(findings.length > 0 ? 1 : 0);
}
