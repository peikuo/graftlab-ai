// BrowserSession against a local page (R14.5, R14.6, R14.10): Studio login, other origins aborted, a failed action
// is a result (not an exception), every action saves a screenshot, and the password never appears in a result.
import { mkdtemp, readdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserSession } from "./session.ts";

let chromiumOk = false;
try {
  const { chromium } = await import("playwright");
  chromiumOk = !!chromium.executablePath();
  await import("node:fs").then((fs) => (chromiumOk = fs.existsSync(chromium.executablePath())));
} catch {
  chromiumOk = false;
}
let server: Server;
let other: Server;
let base = "";
let otherHits = 0;
const PASSWORD = "pw-value-0123456789";
beforeAll(async () => {
  other = createServer((_q, r) => {
    otherHits++;
    r.end("x");
  });
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
  const otherUrl = `http://localhost:${(other.address() as AddressInfo).port}/track.js`;
  server = createServer((q, r) => {
    r.setHeader("content-type", "text/html");
    if (q.url?.startsWith("/login") && q.method === "POST") {
      r.statusCode = 303;
      r.setHeader("location", "/home");
      return r.end();
    }
    if (q.url?.startsWith("/login")) return r.end(`<form method="post"><label>User <input name="u"></label><label>Pass <input name="p" type="password"></label><button>Sign in</button></form>`);
    r.end(`<h1>Home</h1><script src="${otherUrl}"></script><button onclick="document.body.append('clicked')">Go</button>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => other.close(r));
});
describe.skipIf(!chromiumOk)("BrowserSession", () => {
  it("logs in by Studio code, blocks other origins, records failures as results and saves screenshots", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gl-browser-"));
    const s = new BrowserSession(base, { taskDir: dir, prefix: "t", timeoutMs: 3000 });
    try {
      const login = await s.start({ path: "/login", usernameLabel: "User", passwordLabel: "Pass", submitLabel: "Sign in", username: "u1", password: PASSWORD });
      expect(login.ok).toBe(true);
      expect(JSON.stringify(login)).not.toContain(PASSWORD);
      expect((await s.snapshot()).text).toContain("Home");
      expect(otherHits).toBe(0);
      expect((await s.click({ role: "button", name: "Go" })).ok).toBe(true);
      const miss = await s.click({ role: "button", name: "Nope" });
      expect(miss.ok).toBe(false);
      expect(miss.detail).toMatch(/could not click/);
      expect((await s.open("https://elsewhere.example/")).ok).toBe(false);
      expect((await readdir(join(dir, "artifacts", "shots"))).length).toBeGreaterThanOrEqual(4);
    } finally {
      await s.close();
    }
  }, 30_000);
});
