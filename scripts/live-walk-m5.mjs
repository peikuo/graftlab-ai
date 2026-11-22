// Milestone 5 live check (tasks.md 5.8): real GitHub, real backend. Saves screenshots to data/ui-snaps/m5-*.png.
// Run with the backend on :8080 (with GITHUB_TOKEN in its environment) and Vite on :5173.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.UI_BASE ?? "http://localhost:5173";
mkdirSync("data/ui-snaps", { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/m5-${name}.png` });
  console.log(`saved m5-${name}.png`);
};
const T = { timeout: 180_000 };

async function run(url, label) {
  await p.goto(BASE);
  await p.locator("#url").fill(url);
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor(T);
  const t0 = Date.now();
  await p.waitForTimeout(1200);
  await snap(`${label}-reading`);
  // The meeting is not built yet in milestone 5: the Task stops in failure_review for the Judge.
  await p.getByRole("button", { name: "End the Task" }).waitFor(T);
  const seconds = ((Date.now() - t0) / 1000).toFixed(1);
  const note = await p.locator(".step-text").filter({ hasText: /Reading \d+ files/ }).first().innerText().catch(() => "?");
  console.log(`${label}: ${note.replace(/\s+/g, " ")} · stopped for the Judge after ${seconds} s`);
  await snap(`${label}-stopped`);
  await p.getByRole("button", { name: "End the Task" }).click();
  await p.getByRole("button", { name: "New Task" }).waitFor(T);
  await p.getByRole("button", { name: "New Task" }).click();
}

try {
await p.goto(BASE);
await p.locator("#url").fill("github.com/sissbruecker");
await p.waitForTimeout(200);
console.log("invalid:", await p.locator(".home-check").innerText());
await p.locator("#url").fill("https://github.com/peikuo/this-repo-does-not-exist-graftlab");
await p.getByRole("button", { name: "Start" }).click();
await p.locator(".home-error").waitFor(T);
console.log("missing:", await p.locator(".home-error").innerText());
await snap("home-error");

await run("https://github.com/sissbruecker/linkding", "linkding");
await run("https://github.com/sissbruecker/linkding", "linkding-again");
await run("https://github.com/sindresorhus/is", "other");
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
} finally {
  // Leave the queue even when a step fails, so the next run is not blocked by this session.
  await p.close({ runBeforeUnload: true }).catch(() => {});
  await browser.close();
}
