// Verifier browser_check with a screenshot per step (R22.2, R21.11) against a local page: the login and every step
// that ran get a screenshot with its result; steps after a failure are not run and have none.
import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runBrowserCheck } from "./browser.ts";
let chromiumOk = false;
try {
  const { chromium } = await import("playwright");
  chromiumOk = existsSync(chromium.executablePath());
} catch {
  chromiumOk = false;
}
let server: Server;
let base = "";
beforeAll(async () => {
  server = createServer((q, r) => {
    r.setHeader("content-type", "text/html");
    if (q.url?.startsWith("/login") && q.method === "POST") {
      r.statusCode = 303;
      r.setHeader("location", "/form");
      return r.end();
    }
    if (q.url?.startsWith("/login")) return r.end(`<form method="post"><label>User <input name="u"></label><label>Pass <input name="p" type="password"></label><button>Sign in</button></form>`);
    r.end(`<label>URL <input id="u"></label><button onclick="document.body.append('Suggested: recipes')">Suggest</button>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});
const login = { path: "/login", usernameLabel: "User", passwordLabel: "Pass", submitLabel: "Sign in", username: "u", password: "pw-0123456789" };
describe.skipIf(!chromiumOk)("runBrowserCheck with step screenshots", () => {
  it("saves a screenshot after the login and after every step, with the step's result", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gl-demo-"));
    const r = await runBrowserCheck({
      baseUrl: base,
      login,
      screenshot: join(dir, "final.jpg"),
      stepShot: (n) => join(dir, `s${n}.jpg`),
      timeoutMs: 3000,
      check: { id: "c1", kind: "browser_check", target: "run_environment", steps: [{ op: "goto", path: "/form" }, { op: "fill", role: "textbox", name: "URL", value: "https://example.com" }, { op: "click", role: "button", name: "Suggest" }, { op: "expectText", text: "Suggested: recipes" }] },
    });
    expect(r.items.every((i) => i.pass)).toBe(true);
    expect(r.steps.map((s) => s.item)).toEqual(["log in (Studio code)", "open /form", 'type into "URL"', 'click the button "Suggest"', 'see "Suggested: recipes"']);
    for (const s of r.steps) expect(existsSync(s.file)).toBe(true);
    expect(JSON.stringify(r)).not.toContain(login.password);
  });
  it("marks a failed step, and steps after it get no screenshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gl-demo-"));
    const r = await runBrowserCheck({
      baseUrl: base,
      login,
      screenshot: join(dir, "final.jpg"),
      stepShot: (n) => join(dir, `s${n}.jpg`),
      timeoutMs: 1500,
      check: { id: "c1", kind: "browser_check", target: "run_environment", steps: [{ op: "goto", path: "/form" }, { op: "expectText", text: "not on the page" }, { op: "click", role: "button", name: "Suggest" }] },
    });
    expect(r.steps.map((s) => [s.item, s.pass])).toEqual([["log in (Studio code)", true], ["open /form", true], ['see "not on the page"', false]]);
    expect(r.items.at(-1)).toMatchObject({ pass: false, actual: "not run: an earlier step failed" });
  });
  it("takes no step screenshots without stepShot (verification)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gl-demo-"));
    const r = await runBrowserCheck({ baseUrl: base, login, screenshot: join(dir, "final.jpg"), timeoutMs: 3000, check: { id: "c1", kind: "browser_check", target: "run_environment", steps: [{ op: "goto", path: "/form" }] } });
    expect(r.steps).toEqual([]);
    expect(existsSync(join(dir, "final.jpg"))).toBe(true);
  });
});
