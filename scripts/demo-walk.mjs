// Walks the /demo flow like a person would (development check) and saves screenshots to data/ui-snaps/demo-*.png.
// Run with Vite on :5173. Usage: node scripts/demo-walk.mjs
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const BASE = process.env.UI_BASE ?? "http://localhost:5173";
mkdirSync("data/ui-snaps", { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/demo-${name}.png` });
  console.log(`saved demo-${name}.png`);
};
const T = { timeout: 120_000 };

await p.goto(`${BASE}/demo`);
await snap("1-home");
await p.getByRole("button", { name: "Start" }).click();
await p.getByRole("button", { name: "4×" }).click();
await p.waitForTimeout(2500);
await snap("2-reading");
await p.getByText("The Explorer is using the app").waitFor(T);
await p.waitForTimeout(1500);
await snap("3-trying");

await p.getByRole("button", { name: "Only after I click them" }).waitFor(T);
await p.waitForTimeout(300);
await snap("4-meeting-question");
await p.getByRole("button", { name: "Only after I click them" }).click();

await p.getByRole("region", { name: "Decision review" }).waitFor(T);
await p.waitForTimeout(400);
await snap("5-decision");
const review = p.getByRole("region", { name: "Decision review" });
await review.getByRole("radio", { name: /Suggest tags” button/ }).check();
const items = review.locator(".ritem");
const count = await items.count();
for (let i = 0; i < count; i++) {
  const it = items.nth(i);
  if ((await it.locator("strong").innerText()).startsWith("4 ")) {
    await it.getByRole("button", { name: "Reject…" }).click();
    await it.getByRole("textbox").fill("Show suggestions as chips, not a dropdown");
    await it.getByRole("button", { name: "Reject", exact: true }).click();
  } else {
    await it.getByRole("button", { name: "Accept" }).click();
  }
}
await snap("6-decision-reviewed");
await review.getByRole("button", { name: /Send back/ }).click();
await p.getByText("Decision draft 2").waitFor(T);
await p.waitForTimeout(400);
await snap("7-draft-2");
const r2 = p.getByRole("region", { name: "Decision review" });
await r2.locator(".ritem.pending").getByRole("button", { name: "Accept" }).click();
await r2.getByRole("button", { name: /Freeze the decision/ }).click();

await p.getByRole("button", { name: "Yes, all my tags" }).waitFor(T);
await p.waitForTimeout(300);
await snap("8-dev-question");
await p.getByRole("button", { name: "Yes, all my tags" }).click();

await p.getByRole("button", { name: "Yes, this is right" }).waitFor(T);
await p.locator(".mock-suggest").click();
await p.locator(".mock-suggestions .chip").first().click();
await p.waitForTimeout(300);
await snap("9-checkpoint");
await p.getByRole("button", { name: "Yes, this is right" }).click();
await p.getByText("The Verifier (code, no AI) confirmed").waitFor(T);
await p.waitForTimeout(500);
await snap("10-result");
console.log(errors.length ? `page errors:\n${errors.join("\n")}` : "no page errors");
await browser.close();
