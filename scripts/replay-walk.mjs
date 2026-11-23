// Milestone 9 check (tasks.md 9.6, 9.8): play a Replay from the static host with the backend stopped; check the
// permanent Replay label, seeking and the final view; record the screen to data/ui-snaps/m9-replay-<id>.webm.
import { mkdirSync, renameSync } from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.UI_BASE ?? "http://localhost:5173";
const ID = process.argv[2];
if (!ID) throw new Error("usage: node scripts/replay-walk.mjs <taskId>");
mkdirSync("data/ui-snaps/video", { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: "data/ui-snaps/video", size: { width: 1440, height: 900 } } });
const p = await context.newPage();
const errors = [];
p.on("pageerror", (e) => errors.push(e.message));
const checks = [];
const check = (name, ok) => checks.push(`${ok ? "PASS" : "FAIL"} ${name}`);
try {
  await p.goto(`${BASE}/replay/${encodeURIComponent(ID)}`);
  await p.locator(".replay-bar").waitFor({ timeout: 20_000 });
  check("Replay label visible", await p.locator(".replay-label", { hasText: "REPLAY" }).isVisible());
  await p.locator("#replay-speed").selectOption("16");
  await p.waitForTimeout(6000);
  // seek to the middle and back on
  const max = Number(await p.locator("#replay-seek").getAttribute("max"));
  await p.locator("#replay-seek").evaluate((el, v) => {
    const input = el;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, String(v));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, Math.round(max / 2));
  await p.waitForTimeout(1500);
  await p.screenshot({ path: `data/ui-snaps/m9-replay-${ID}-middle.png` });
  check("seek moves the playhead", (await p.locator(".replay-bar .mono").innerText()).startsWith(`${Math.floor(Math.round(max / 2000) / 60)}:`));
  await p.locator(".final").waitFor({ timeout: 240_000 });
  await p.waitForTimeout(4000);
  await p.screenshot({ path: `data/ui-snaps/m9-replay-${ID}-final.png` });
  check("final view shown", await p.locator(".final").isVisible());
  check("Replay label still visible at the end", await p.locator(".replay-label").isVisible());
  check("no command possible (no composer, no Start)", (await p.locator("#msg").count()) === 0);
} finally {
  console.log(checks.join("\n"));
  console.log(errors.length ? `page errors: ${errors.join(" | ")}` : "no page errors");
  const video = p.video();
  await context.close();
  await browser.close();
  if (video) {
    renameSync(await video.path(), `data/ui-snaps/m9-replay-${ID}.webm`);
    console.log(`video: data/ui-snaps/m9-replay-${ID}.webm`);
  }
}
