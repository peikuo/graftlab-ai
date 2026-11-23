// Milestone 6 live check (tasks.md 6.9, 6.10, 6.14): preparation, a discussion by speaking signals, a
// non-blocking question answered 40 s late, and an interjection to Risk. Screenshots: data/ui-snaps/m6-meeting-*.png.
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
const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
const snap = async (name) => {
  await p.screenshot({ path: `data/ui-snaps/m6-meeting-${name}.png` });
  console.log(`saved m6-meeting-${name}.png at ${sec()} s`);
};
try {
  await p.goto(BASE);
  await p.locator("#url").fill(URL);
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor({ timeout: 60_000 });
  t0 = Date.now();
  await p.getByText("Proposals on the table").waitFor({ timeout: 600_000 });
  await snap("1-prepared");
  let cardSeenAt = null;
  let answered = false;
  let interjected = false;
  for (let i = 0; i < 200; i++) {
    await p.waitForTimeout(3_000);
    const card = p.locator(".icard.pending.kind-question").first();
    if (!answered && (await card.count()) > 0) {
      cardSeenAt ??= Date.now();
      if (Date.now() - cardSeenAt > 40_000) {
        await card.scrollIntoViewIfNeeded();
        await snap("2-question-open-team-talking");
        await card.locator(".icard-options button").first().click();
        answered = true;
        console.log(`answered the question at ${sec()} s`);
      }
    }
    if (answered && !interjected && (await p.locator(".step-text", { hasText: "speaks next" }).count()) >= 3) {
      await p.locator("#to").selectOption("risk");
      await p.locator("#msg").fill("Risk, what if all AI calls stay on a local model inside the container?");
      await p.locator(".composer-send").click();
      interjected = true;
      console.log(`interjected at ${sec()} s`);
      await p.waitForTimeout(1500);
      await snap("3-interjected");
    }
    if (await p.getByText("Meeting result").count()) break;
  }
  await snap("4-result");
  await p.locator(".details-body").evaluate((el) => el.scrollTo(0, 0));
  const ev = p.locator(".proposal .evidence summary").first();
  if (await ev.count()) {
    await ev.click();
    await snap("5-why-we-think-so");
  }
  const end = p.getByRole("button", { name: "End the Task" });
  if (await end.isVisible()) await end.click();
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  await browser.close();
}
