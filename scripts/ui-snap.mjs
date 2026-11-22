// Development helper: opens the Workspace in two headless browsers (operator and queued viewer), plays the
// synthetic fixture, and saves screenshots at chosen moments to data/ui-snaps/. Run with the backend on :8080
// and Vite on :5173. Usage: node scripts/ui-snap.mjs [seconds...]
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const moments = process.argv.slice(2).map(Number).filter((n) => n > 0);
const at = moments.length > 0 ? moments : [6, 18, 34];
mkdirSync("data/ui-snaps", { recursive: true });

const browser = await chromium.launch();
const operator = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const viewer = await (await browser.newContext()).newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
for (const [name, p] of [["operator", operator], ["viewer", viewer]]) {
  p.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
}

await operator.goto(BASE);
await operator.getByRole("button", { name: "Join queue" }).click();
await viewer.goto(BASE);
await viewer.getByRole("button", { name: "Join queue" }).click();
await operator.waitForTimeout(800);
await operator.getByRole("button", { name: "Play synthetic fixture" }).click();

const start = Date.now();
for (const s of at) {
  const wait = s * 1000 - (Date.now() - start);
  if (wait > 0) await operator.waitForTimeout(wait);
  await operator.screenshot({ path: `data/ui-snaps/operator-${s}s.png` });
  console.log(`saved operator-${s}s.png`);
}
await viewer.screenshot({ path: `data/ui-snaps/viewer-end.png` });
const viewerInput = await viewer.locator("#msg").getAttribute("placeholder");
console.log("viewer input placeholder:", viewerInput);
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
