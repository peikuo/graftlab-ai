// Milestone 14 live demo with a screen recording: linkding from URL through meeting, decision, plan, documents and
// the technical design into development: Code_Agent per Feature, review, Verifier, merge, the running app and the
// checkpoint. The Judge answers feature questions with the first option and confirms checkpoints.
// Usage: node scripts/live-walk-m14.mjs   Video: data/ui-snaps/m14-<name>.webm; screenshots data/ui-snaps/m14-*.png.
import { mkdirSync, renameSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const REPO = process.env.REPO ?? "github.com/sissbruecker/linkding";
const SEND_BACK = "";
const NAME = process.env.NAME ?? REPO.split("/").pop();
mkdirSync("data/ui-snaps/video", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "data/ui-snaps/video", size: { width: 1440, height: 900 } } });
const p = await context.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
let t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(0);
const mark = (what) => console.log(`${sec().padStart(5)} s  ${what}`);
const ready = () => p.waitForFunction(() => document.querySelector(".nowbar")?.textContent?.includes("decision draft is ready"), null, { timeout: 1_500_000 });
try {
  await p.goto(BASE);
  await p.waitForTimeout(1500);
  await p.locator("#url").fill(REPO);
  await p.waitForTimeout(800);
  await p.getByRole("button", { name: "Start" }).click();
  await p.locator(".nowbar").waitFor({ timeout: 60_000 });
  t0 = Date.now();
  mark("Task started");
  let answered = false;
  for (let i = 0; i < 600 && !(await p.locator("#decision-review .ritem").count()); i++) {
    await p.waitForTimeout(2000);
    const card = p.locator(".icard.pending.kind-question").first();
    if (!answered && (await card.count())) {
      await card.scrollIntoViewIfNeeded();
      await p.waitForTimeout(4000); // let the viewer read the question
      await card.locator(".icard-options button").first().click();
      answered = true;
      mark("answered the Facilitator's question");
    }
  }
  await ready();
  mark("decision draft ready");
  const freeze = async () => {
    const box = p.locator("#decision-review");
    await box.scrollIntoViewIfNeeded();
    await p.waitForTimeout(3000);
    const choice = box.locator(".ritem-options input[type=radio]:not([disabled])").first();
    // The selection is confirmed by the server, so the radio turns on only after the round trip.
    if (await choice.count()) {
      await choice.click();
      await p.waitForFunction(() => !!document.querySelector("#decision-review .ritem-options input[type=radio]:checked"), null, { timeout: 30_000 });
    }
    await p.waitForTimeout(1500);
    for (let guard = 0; guard < 12; guard++) {
      const pending = box.locator(".ritem.pending").first();
      if (!(await pending.count())) break;
      await pending.scrollIntoViewIfNeeded();
      await p.waitForTimeout(1200);
      await pending.getByRole("button", { name: "Accept" }).click();
      await p.waitForTimeout(800);
    }
    await p.getByRole("button", { name: /Freeze the decision/ }).click();
    mark("frozen");
  };
  await freeze();
  const planCard = () => p.locator(".icard.pending.kind-confirm").filter({ has: p.locator(".plan") }).first();
  let sentBack = false;
  for (;;) {
    await planCard().waitFor({ timeout: 1_200_000 });
    mark("plan ready for review");
    await planCard().scrollIntoViewIfNeeded();
    await p.waitForTimeout(5000);
    await p.screenshot({ path: `data/ui-snaps/m14-${NAME}-plan${sentBack ? "2" : "1"}.png`, fullPage: false });
    if (SEND_BACK && !sentBack) {
      await planCard().locator("textarea").fill(SEND_BACK);
      await p.waitForTimeout(1500);
      await planCard().getByRole("button", { name: "Send back to the meeting" }).click();
      sentBack = true;
      mark(`sent back: ${SEND_BACK}`);
      await ready();
      mark("new decision draft ready");
      await freeze();
      continue;
    }
    await planCard().getByRole("button", { name: /Start development|Write the documents/ }).click();
    mark("plan confirmed");
    break;
  }
  // Development: answer what the team asks until the Task ends.
  let shots = 0;
  for (let i = 0; i < 1800 && !(await p.locator(".final").count()); i++) {
    await p.waitForTimeout(2000);
    const card = p.locator(".icard.pending").first();
    if (!(await card.count())) continue;
    const title = (await card.locator(".icard-title").textContent()) ?? "";
    await card.scrollIntoViewIfNeeded();
    await p.waitForTimeout(3000);
    await p.screenshot({ path: `data/ui-snaps/m14-${NAME}-card${++shots}.png` });
    if (/Something went wrong|not built yet|What should happen/.test(title)) {
      mark(`failure review: ${title}`);
      await card.getByRole("button", { name: "End the Task" }).click();
      continue;
    }
    if (await card.locator("textarea").count()) {
      const first = card.locator(".icard-options button").first();
      if (/Looks right/.test((await first.textContent()) ?? "")) {
        await first.click();
        mark(`checkpoint confirmed: ${title}`);
        continue;
      }
    }
    const opt = card.locator(".icard-options button").first();
    if (await opt.count()) {
      await opt.click();
      mark(`answered: ${title.slice(0, 80)}`);
      continue;
    }
    await card.locator("input").fill("Keep it simple and stay inside the Feature.");
    await card.getByRole("button", { name: "Send" }).click();
    mark(`answered in words: ${title.slice(0, 80)}`);
  }
  await p.locator(".final").waitFor({ timeout: 60_000 });
  mark("Task ended");
  await p.screenshot({ path: `data/ui-snaps/m14-${NAME}-final.png` });
  await p.waitForTimeout(6000);
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  const video = p.video();
  await context.close();
  await browser.close();
  if (video) {
    const path = await video.path();
    renameSync(path, `data/ui-snaps/m14-${NAME}.webm`);
    console.log(`video: data/ui-snaps/m14-${NAME}.webm`);
  }
}
