#!/usr/bin/env node
// Kiro hook helper: run the vitest tests related to the saved TypeScript file.
// The hook passes session context as JSON on stdin; we take every .ts/.tsx path found in it.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

function paths(value, out = []) {
  if (typeof value === "string" && /\.(ts|tsx)$/.test(value) && !value.includes("node_modules")) out.push(value);
  else if (value && typeof value === "object") for (const v of Object.values(value)) paths(v, out);
  return out;
}

let input = {};
try {
  input = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  // no usable context: fall through to an empty file list
}
const files = [...new Set(paths(input))].filter((f) => !f.includes("/spike/") && !f.startsWith("spike/"));
if (files.length === 0) {
  console.log("related-tests: no TypeScript file in the hook context, nothing to run");
  process.exit(0);
}
const r = spawnSync("npx", ["vitest", "related", "--run", "--passWithNoTests", ...files], { stdio: "inherit" });
process.exit(r.status ?? 1);
