import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { SecretRegistry } from "@graftlab/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueProxyCredential, PROXY_SECRET_NAME } from "./credential.js";
import { createProxyServer, parseUsage, routePath } from "./proxy.js";

const CREDENTIAL = "glp_test-credential-0123456789";
const REAL_KEY = "test-upstream-key-abcdef123";
const APP_CREDENTIAL = "glp_app-credential-0123456789";

let upstream: Server;
let proxy: Server;
let proxyUrl: string;
let seen: { method?: string; url?: string; headers: IncomingHttpHeaders; body: string }[];
let logs: string[];

function listen(s: Server): Promise<number> {
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
}

beforeEach(async () => {
  seen = [];
  logs = [];
  upstream = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url?.endsWith("/chat/completions")) {
        // A streamed answer in three chunks, sent with a delay between them.
        res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "x=1" });
        res.write("data: one\n\n");
        setTimeout(() => res.write('data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":100}}}\n\n'), 20);
        setTimeout(() => res.end("data: [DONE]\n\n"), 40);
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "m" }] }));
      }
    });
  });
  const up = await listen(upstream);
  proxy = createProxyServer({
    credential: CREDENTIAL,
    appCredential: APP_CREDENTIAL,
    upstreamBaseUrl: `http://127.0.0.1:${up}/api/v4/`,
    upstreamKey: REAL_KEY,
    maxBodyBytes: 1024,
    log: (l) => logs.push(l),
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

afterEach(async () => {
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

const chat = (auth: string, path = "/chat/completions", body = '{"model":"m","stream":true}') =>
  fetch(`${proxyUrl}${path}`, { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body });

describe("LLM_Proxy", () => {
  it("rejects a wrong or missing credential without calling the upstream", async () => {
    expect((await chat("Bearer wrong-credential-000000000")).status).toBe(401);
    expect((await fetch(`${proxyUrl}/models`)).status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it("forwards an allowed path with the real key and streams the answer unchanged", async () => {
    const res = await chat(`Bearer ${CREDENTIAL}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("set-cookie")).toBeNull();
    const chunks: string[] = [];
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new TextDecoder().decode(value));
    }
    expect(chunks.join("")).toBe('data: one\n\ndata: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":7,"prompt_tokens_details":{"cached_tokens":100}}}\n\ndata: [DONE]\n\n');
    expect(chunks.length).toBeGreaterThan(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("/api/v4/chat/completions");
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${REAL_KEY}`);
    expect(seen[0]!.body).toBe('{"model":"m","stream":true}');
  });

  it("accepts the /v1 prefix and GET /models", async () => {
    const res = await fetch(`${proxyUrl}/v1/models`, { headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(res.status).toBe(200);
    expect(seen[0]!.url).toBe("/api/v4/models");
  });

  it("refuses other paths, wrong methods and large bodies", async () => {
    expect((await chat(`Bearer ${CREDENTIAL}`, "/embeddings")).status).toBe(404);
    expect((await fetch(`${proxyUrl}/models`, { method: "DELETE", headers: { authorization: `Bearer ${CREDENTIAL}` } })).status).toBe(405);
    expect((await chat(`Bearer ${CREDENTIAL}`, "/chat/completions", "x".repeat(2000))).status).toBe(413);
    expect(seen).toHaveLength(0);
  });

  it("logs method, path and status only", async () => {
    await chat(`Bearer ${CREDENTIAL}`).then((r) => r.text());
    await chat("Bearer nope-nope-nope-nope", "/secret/path/abc");
    expect(logs).toEqual(["POST /chat/completions 200 #1 agents in=120 cached=100 out=7", "POST (other) 401"]);
    expect(logs.join("\n")).not.toContain(REAL_KEY);
    expect(logs.join("\n")).not.toContain(CREDENTIAL);
  });

  it("answers 502 when the upstream is unreachable, without the address", async () => {
    const p = createProxyServer({ credential: CREDENTIAL, upstreamBaseUrl: "http://127.0.0.1:1", upstreamKey: REAL_KEY, log: () => {} });
    const url = `http://127.0.0.1:${await listen(p)}`;
    const res = await fetch(`${url}/models`, { headers: { authorization: `Bearer ${CREDENTIAL}` } });
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain("127.0.0.1");
    await new Promise((r) => p.close(r));
  });

  it("routePath strips the query and one /v1 prefix", () => {
    expect(routePath("/v1/chat/completions?x=1")).toBe("/chat/completions");
    expect(routePath("/v1/v1/models")).toBe("/v1/models");
  });

  it("the issued credential is registered with the redactor", () => {
    const secrets = new SecretRegistry();
    const c = issueProxyCredential(secrets);
    expect(secrets.names).toContain(PROXY_SECRET_NAME);
    expect(secrets.redactText(`token ${c}`).value).toBe(`token [REDACTED:${PROXY_SECRET_NAME}]`);
  });
  it("tells the app's calls apart from the agents' calls by credential", async () => {
    await chat(`Bearer ${APP_CREDENTIAL}`).then((r) => r.text());
    expect(logs).toEqual(["POST /chat/completions 200 #1 app in=120 cached=100 out=7"]);
    expect(logs.join("\n")).not.toContain(APP_CREDENTIAL);
  });
  it("reads usage from a JSON answer and from the last streamed chunk that has it", () => {
    expect(parseUsage('{"usage":{"prompt_tokens":10,"completion_tokens":3,"prompt_cache_hit_tokens":4}}', "application/json")).toEqual({ input: 10, cached: 4, output: 3 });
    expect(parseUsage('data: {"usage":null}\n\ndata: {"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\ndata: [DONE]\n', "text/event-stream")).toEqual({ input: 5, cached: 0, output: 2 });
    expect(parseUsage("not json", "application/json")).toBeNull();
  });
});
