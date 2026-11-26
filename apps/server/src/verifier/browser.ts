// Verifier `browser_check` (design.md, "Verifier"; R22.2, R14.11): scripted Playwright steps, no LLM. Studio code
// logs in with the generated credentials first (the Adapter's `browserLogin`), then every step is one per-item
// result. Requests to other origins are aborted. A screenshot of the final page is saved for the Judge; with
// `stepShot`, one after the login and after every step as well (the demonstration at the confirmation point, R21.11).
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { AcceptanceCheckSpec, ItemResult } from "@graftlab/shared";

type BrowserCheck = Extract<AcceptanceCheckSpec, { kind: "browser_check" }>;
export interface BrowserLogin {
  path: string;
  usernameLabel: string;
  passwordLabel: string;
  submitLabel: string;
  username: string;
  password: string;
}

const describe = (s: BrowserCheck["steps"][number]) =>
  s.op === "goto" ? `open ${s.path}` : s.op === "expectText" ? `see "${s.text}"` : s.op === "expectRole" ? `see the ${s.role} "${s.name}"` : s.op === "click" ? `click the ${s.role} "${s.name}"` : `type into "${s.name}"`;

export interface StepShot {
  item: string;
  pass: boolean;
  file: string;
}
export async function runBrowserCheck(o: { baseUrl: string; check: BrowserCheck; login?: BrowserLogin; screenshot: string; timeoutMs?: number; stepShot?: (n: number) => string; onStep?: (step: StepShot, n: number) => Promise<void> }): Promise<{ items: ItemResult[]; screenshot: string | null; steps: StepShot[] }> {
  const { chromium } = await import("playwright");
  const timeout = o.timeoutMs ?? 15_000;
  const origin = new URL(o.baseUrl).origin;
  const browser = await chromium.launch();
  const items: ItemResult[] = [];
  const steps: StepShot[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    page.setDefaultTimeout(timeout);
    await page.route("**/*", (r) => (new URL(r.request().url()).origin === origin ? r.continue() : r.abort()));
    const url = (p: string) => new URL(p, o.baseUrl).toString();
    // After a step: a screenshot of the page as the step left it (only steps that ran; a skipped step has none).
    const shoot = async () => {
      const last = items.at(-1);
      if (!o.stepShot || !last || last.actual === "not run: an earlier step failed") return;
      const file = o.stepShot(steps.length + 1);
      await mkdir(dirname(file), { recursive: true });
      const ok = await page.screenshot({ path: file, type: "jpeg", quality: 70 }).then(() => true, () => false);
      if (!ok) return;
      const step = { item: last.item, pass: last.pass, file };
      steps.push(step);
      // Live: the caller shows each step as soon as it is done (R21.11), not after the whole check.
      await o.onStep?.(step, steps.length).catch(() => undefined);
    };
    if (o.login) {
      try {
        await page.goto(url(o.login.path));
        await page.getByLabel(o.login.usernameLabel).fill(o.login.username);
        await page.getByLabel(o.login.passwordLabel).fill(o.login.password);
        await page.getByRole("button", { name: o.login.submitLabel }).click();
        // Apps that submit forms in the background (linkding uses Turbo) change the URL only after the answer.
        const left = await page.waitForURL((u) => !u.pathname.startsWith(o.login!.path), { timeout }).then(() => true, () => false);
        items.push({ item: "log in (Studio code)", pass: left, expected: "logged in", actual: new URL(page.url()).pathname });
      } catch (e) {
        items.push({ item: "log in (Studio code)", pass: false, expected: "logged in", actual: (e as Error).message.split("\n")[0]!.slice(0, 200) });
      }
      await shoot();
    }
    for (const s of o.check.steps) {
      if (items.some((i) => !i.pass)) {
        items.push({ item: describe(s), pass: false, expected: "done", actual: "not run: an earlier step failed" });
        continue;
      }
      try {
        if (s.op === "goto") {
          const r = await page.goto(url(s.path));
          const ok = !!r && r.status() < 400;
          items.push({ item: describe(s), pass: ok, expected: "page opens", actual: r ? `HTTP ${r.status()}` : "no response" });
        } else if (s.op === "expectText") {
          await page.getByText(s.text, { exact: false }).first().waitFor();
          items.push({ item: describe(s), pass: true, expected: s.text, actual: "found" });
        } else if (s.op === "expectRole") {
          await page.getByRole(s.role as never, { name: s.name }).first().waitFor();
          items.push({ item: describe(s), pass: true, expected: `${s.role} ${s.name}`, actual: "found" });
        } else if (s.op === "click") {
          await page.getByRole(s.role as never, { name: s.name }).first().click();
          await page.waitForLoadState("networkidle").catch(() => undefined);
          items.push({ item: describe(s), pass: true, expected: "clicked", actual: "clicked" });
        } else {
          await page.getByRole(s.role as never, { name: s.name }).first().fill(s.value);
          items.push({ item: describe(s), pass: true, expected: "typed", actual: "typed" });
        }
      } catch (e) {
        items.push({ item: describe(s), pass: false, expected: "done", actual: (e as Error).message.split("\n")[0]!.slice(0, 200) });
      }
      await shoot();
    }
    await mkdir(dirname(o.screenshot), { recursive: true });
    await page.screenshot({ path: o.screenshot, type: "jpeg", quality: 70 });
    return { items, screenshot: o.screenshot, steps };
  } finally {
    await browser.close();
  }
}
