// Browser_Use session (design.md, "Browser_Use"; R14.2, R14.4-R14.10). Headless Chromium in the backend against the
// loopback port of the Sandbox. A route filter aborts every request to another origin. Studio code logs in with the
// generated credentials; the operator never sees them. Every action returns a plain result and saves a JPEG.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "playwright";

export const SNAPSHOT_MAX = 8 * 1024;
export interface BrowserLoginSpec {
  path: string;
  usernameLabel: string;
  passwordLabel: string;
  submitLabel: string;
  username: string;
  password: string;
}
export interface ActionResult {
  ok: boolean;
  /** Plain words for the event and the model; never contains a credential. */
  detail: string;
  /** Path of the screenshot relative to the Task directory. */
  shot?: string;
}
/** A target as the operator names it: an ARIA role and name, or a visible text. */
export interface Target {
  role?: string;
  name?: string;
  text?: string;
}
const describe = (t: Target) => (t.role ? `the ${t.role} "${t.name ?? ""}"` : `"${t.text ?? t.name ?? ""}"`);

export class BrowserSession {
  #browser: Browser | null = null;
  #page: Page | null = null;
  #shots = 0;
  readonly origin: string;
  constructor(
    readonly baseUrl: string,
    private readonly o: { taskDir: string; timeoutMs?: number; prefix?: string },
  ) {
    this.origin = new URL(baseUrl).origin;
  }

  async start(login?: BrowserLoginSpec): Promise<ActionResult> {
    const { chromium } = await import("playwright");
    this.#browser = await chromium.launch();
    const page = await (await this.#browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
    page.setDefaultTimeout(this.o.timeoutMs ?? 10_000);
    // R14.5, R14.10: only the target's own origin; everything else is aborted.
    await page.route("**/*", (r) => (new URL(r.request().url()).origin === this.origin ? r.continue() : r.abort()));
    this.#page = page;
    if (!login) return this.#done(true, "opened the browser");
    try {
      await page.goto(this.#url(login.path));
      await page.getByLabel(login.usernameLabel).fill(login.username);
      await page.getByLabel(login.passwordLabel).fill(login.password);
      await page.getByRole("button", { name: login.submitLabel }).click();
      const left = await page.waitForURL((u) => !u.pathname.startsWith(login.path), { timeout: this.o.timeoutMs ?? 10_000 }).then(
        () => true,
        () => false,
      );
      return this.#done(left, left ? "logged in (Studio code, generated user)" : "the login did not succeed");
    } catch (e) {
      return this.#done(false, `the login failed: ${firstLine(e)}`);
    }
  }

  #url(path: string): string {
    if (!path.startsWith("/") || path.startsWith("//")) throw new Error("only paths inside the app are allowed, starting with /");
    return new URL(path, this.baseUrl).toString();
  }

  get #p(): Page {
    if (!this.#page) throw new Error("the browser is not started");
    return this.#page;
  }

  #locate(t: Target) {
    const p = this.#p;
    if (t.role) return p.getByRole(t.role as never, t.name ? { name: t.name } : {}).first();
    return p.getByText(t.text ?? t.name ?? "", { exact: false }).first();
  }

  async open(path: string): Promise<ActionResult> {
    try {
      const r = await this.#p.goto(this.#url(path));
      const ok = !!r && r.status() < 400;
      return this.#done(ok, `opened ${path} (${r ? `HTTP ${r.status()}` : "no answer"})`);
    } catch (e) {
      return this.#done(false, `could not open ${path}: ${firstLine(e)}`);
    }
  }

  async click(t: Target): Promise<ActionResult> {
    try {
      await this.#locate(t).click();
      await this.#p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      return this.#done(true, `clicked ${describe(t)}`);
    } catch (e) {
      return this.#done(false, `could not click ${describe(t)}: ${firstLine(e)}`);
    }
  }

  async fill(t: Target, value: string): Promise<ActionResult> {
    try {
      await this.#locate(t).fill(value);
      return this.#done(true, `typed "${value.slice(0, 80)}" into ${describe(t)}`);
    } catch (e) {
      return this.#done(false, `could not type into ${describe(t)}: ${firstLine(e)}`);
    }
  }

  async press(key: string): Promise<ActionResult> {
    if (!/^[A-Za-z0-9+]{1,20}$/.test(key)) return this.#done(false, `"${key}" is not a key name`);
    try {
      await this.#p.keyboard.press(key);
      await this.#p.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      return this.#done(true, `pressed ${key}`);
    } catch (e) {
      return this.#done(false, `could not press ${key}: ${firstLine(e)}`);
    }
  }

  /** The page as an ARIA snapshot (R14.7), cut to 8 KB, with the current path. */
  async snapshot(): Promise<{ path: string; text: string; truncated: boolean }> {
    const p = this.#p;
    const text = await p.locator("body").ariaSnapshot().catch((e: unknown) => `(no snapshot: ${firstLine(e)})`);
    return { path: new URL(p.url()).pathname, text: text.slice(0, SNAPSHOT_MAX), truncated: text.length > SNAPSHOT_MAX };
  }

  async #done(ok: boolean, detail: string): Promise<ActionResult> {
    const shot = await this.#shot();
    return { ok, detail, ...(shot ? { shot } : {}) };
  }

  async #shot(): Promise<string | undefined> {
    if (!this.#page) return undefined;
    const rel = join("artifacts", "shots", `${this.o.prefix ?? "x"}-${String(++this.#shots).padStart(3, "0")}.jpg`);
    try {
      await mkdir(join(this.o.taskDir, "artifacts", "shots"), { recursive: true });
      await this.#page.screenshot({ path: join(this.o.taskDir, rel), type: "jpeg", quality: 60 });
      return rel.split("\\").join("/");
    } catch {
      return undefined;
    }
  }

  async close(): Promise<void> {
    await this.#browser?.close().catch(() => undefined);
    this.#browser = null;
    this.#page = null;
  }
}

function firstLine(e: unknown): string {
  return ((e as Error)?.message ?? String(e)).split("\n")[0]!.slice(0, 200);
}
