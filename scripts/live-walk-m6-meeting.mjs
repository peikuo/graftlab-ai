// Milestone 6 live check (tasks.md 6.9, 6.14): a real meeting on the Repo_Brief. Answers the first question card
// with its first option; screenshots go to data/ui-snaps/m6-meeting-*.png.
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const URL = process.env.REPO ?? "github.com/sissbruecker/linkding";
mkdirSync("data/ui-snaps", { recursive: true });
const browser = await chromium.launch();
const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let t0 = Date.now();
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/m6-meeting-${name}.png` });
  console.log(`saved m6-meeting-${name}.png at ${((Date.now() - t0) / 1000).toFixed(0)} s`);
};
try {
  await p.goto(BASE);
  await p.locator("#url").fill(URL);
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor({ timeout: 60_000 });
  t0 = Date.now();
  await p.getByText("Meeting", { exact: true }).locator("visible=true").first().waitFor({ timeout: 600_000 }).catch(() => undefined);
  let answered = false;
  for (let i = 0; i < 180; i++) {
    await p.waitForTimeout(5_000);
    if (i % 24 === 0) await snap(`t${i}`);
    const card = p.locator(".icard.pending.kind-question").first();
    if (!answered && (await card.count()) > 0) {
      await card.scrollIntoViewIfNeeded();
      await snap("question");
      await card.locator(".icard-options button").first().click();
      answered = true;
      console.log(`answered a question at ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
    if (await p.getByRole("button", { name: "End the Task" }).isVisible()) break;
  }
  await snap("end");
  const end = p.getByRole("button", { name: "End the Task" });
  if (await end.isVisible()) await end.click();
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}
