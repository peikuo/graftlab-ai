// Milestone 6 live check (tasks.md 6.4d): real GitHub, real LLM, real backend. Screenshots of the reading step
// with the Reader's plan, the Repo_Brief and the background index go to data/ui-snaps/m6-*.png.
// Run with the backend on :8080 (LLM profile configured) and Vite on :5173.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const URL = process.env.REPO ?? "github.com/sissbruecker/linkding";
mkdirSync("data/ui-snaps", { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/m6-${name}.png` });
  console.log(`saved m6-${name}.png at ${((Date.now() - t0) / 1000).toFixed(0)} s`);
};
let t0 = Date.now();
try {
  await p.goto(BASE);
  await p.locator("#url").fill(URL);
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor({ timeout: 60_000 });
  t0 = Date.now();
  await p.waitForTimeout(5000);
  await snap("brief-1-start");
  await p.getByText(/Reading plan: \d+ files/).first().waitFor({ timeout: 180_000 });
  await snap("brief-2-plan");
  await p.locator(".brief-what").waitFor({ timeout: 600_000 });
  await snap("brief-3-brief");
  await p.locator(".brief-index").waitFor({ timeout: 60_000 }).catch(() => undefined);
  await p.waitForTimeout(30_000);
  await snap("brief-4-index");
  await p.locator(".details-body").evaluate((el) => el.scrollTo(0, 600));
  await snap("brief-5-brief-scrolled");
  const end = p.getByRole("button", { name: "End the Task" });
  if (await end.isVisible()) await end.click();
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}
