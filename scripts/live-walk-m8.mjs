// Checkpoint M1 (tasks.md 8) live demo with a screen recording: a repository from URL to a frozen Decision_Doc
// (linkding), or an Other_Repo that the Judge ends before the freeze as "Analysis only".
// Usage: REPO=github.com/sindresorhus/p-limit MODE=end node scripts/live-walk-m8.mjs
// Video: data/ui-snaps/m8-<name>.webm (converted to mp4 afterwards).
import { mkdirSync, renameSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const REPO = process.env.REPO ?? "github.com/sissbruecker/linkding";
const MODE = process.env.MODE ?? "freeze"; // freeze | end
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
  const box = p.locator("#decision-review");
  await box.scrollIntoViewIfNeeded();
  await p.waitForTimeout(3000);
  if (MODE === "end") {
    await p.getByRole("button", { name: "End with the analysis only" }).click();
    await p.waitForFunction(() => document.querySelector(".nowbar")?.textContent?.includes("Analysis only"), null, { timeout: 60_000 });
    mark("ended as Analysis only");
  } else {
    const choice = box.locator(".ritem-options input[type=radio]:not([disabled])").first();
    await choice.check();
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
    await p.getByRole("tab", { name: "Decision" }).waitFor({ timeout: 60_000 });
    await p.getByRole("tab", { name: "Decision" }).click();
    mark("frozen");
  }
  await p.waitForTimeout(6000);
} finally {
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  const video = p.video();
  await context.close();
  await browser.close();
  if (video) {
    const path = await video.path();
    renameSync(path, `data/ui-snaps/m8-${NAME}.webm`);
    console.log(`video: data/ui-snaps/m8-${NAME}.webm`);
  }
}
