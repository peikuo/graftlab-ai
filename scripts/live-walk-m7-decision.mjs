// Milestone 7 live check (tasks.md 7.8): meeting, then the decision step on linkding: choose an approach, reject
// one item with a reason, send back, review draft 2, freeze. Screenshots: data/ui-snaps/m7-*.png.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
mkdirSync("data/ui-snaps", { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/m7-${name}.png` });
  console.log(`saved m7-${name}.png at ${sec()} s`);
};
async function review(rejectUi) {
  const box = p.locator("#decision-review");
  const choice = box.locator(".ritem-options input[type=radio]:not([disabled])").first();
  if ((await choice.count()) && !(await choice.isChecked())) {
    await choice.check();
    await p.waitForTimeout(800);
  }
  for (let guard = 0; guard < 12; guard++) {
    const pending = box.locator(".ritem.pending").first();
    if (!(await pending.count())) break;
    const title = await pending.locator(".ritem-head strong").innerText();
    if (rejectUi && title === "What changes on screen") {
      await pending.getByRole("button", { name: "Reject…" }).click();
      await pending.locator("input").fill("Show the suggested tags as chips the user clicks to accept, not as a plain list.");
      await pending.getByRole("button", { name: "Reject", exact: true }).click();
    } else {
      await pending.getByRole("button", { name: "Accept" }).click();
    }
    await p.waitForTimeout(700);
  }
}
try {
  await p.goto(BASE);
  await p.locator("#url").fill("github.com/sissbruecker/linkding");
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor({ timeout: 60_000 });
  t0 = Date.now();
  // answer the meeting question quickly so the run is shorter
  for (let i = 0; i < 200; i++) {
    await p.waitForTimeout(3000);
    const card = p.locator(".icard.pending.kind-question").first();
    if (await card.count()) {
      await card.locator(".icard-options button").first().click();
      console.log(`answered the meeting question at ${sec()} s`);
      break;
    }
    if (await p.locator("#decision-review").count()) break;
  }
  await p.locator("#decision-review .ritem").first().waitFor({ timeout: 1_200_000 });
  await p.waitForFunction(() => document.querySelector(".nowbar")?.textContent?.includes("decision draft is ready"), null, { timeout: 120_000 });
  await p.locator("#decision-review").scrollIntoViewIfNeeded();
  await snap("1-draft1");
  await review(true);
  await snap("2-reviewed");
  await p.getByRole("button", { name: /Send back/ }).click();
  console.log(`sent back at ${sec()} s`);
  await p.locator("#decision-review h2", { hasText: "Decision draft 2" }).waitFor({ timeout: 900_000 });
  await p.waitForFunction(() => document.querySelector(".nowbar")?.textContent?.includes("decision draft is ready"), null, { timeout: 120_000 });
  await p.locator("#decision-review").scrollIntoViewIfNeeded();
  await snap("3-draft2");
  await review(false);
  await p.getByRole("button", { name: /Freeze the decision/ }).click();
  await p.getByText(/Decision version 1/).first().waitFor({ timeout: 60_000 });
  console.log(`frozen at ${sec()} s`);
  await p.getByRole("tab", { name: "Decision" }).click().catch(() => undefined);
  await snap("4-frozen");
  const end = p.getByRole("button", { name: "End the Task" });
  if (await end.isVisible()) await end.click();
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}
