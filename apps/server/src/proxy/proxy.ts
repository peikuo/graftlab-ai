// LLM_Proxy (design: LLM_Proxy; R30.5, R30.16). The only holder of the real LLM key during development work.
// Containers on the internal network call it with a per-Task credential; it checks the credential, forwards only
// allow-listed OpenAI-compatible paths to the configured upstream with the real key, and streams the answer back
// unchanged. It logs method, path and status only, never headers, bodies or the environment.
// Self-contained (node built-ins only), because it is bundled into one file and run on the dev-sandbox image.
import { timingSafeEqual } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";

/** Path (after the proxy root) to allowed method. Chat completions and models only (design). */
export const ALLOWED_PATHS: Record<string, string> = {
  "/chat/completions": "POST",
  "/models": "GET",
};

export interface ProxyConfig {
  /** The per-Task bearer credential the containers hold. */
  credential: string;
  /** The real OpenAI-compatible base address, for example https://api.deepseek.com or a base ending in /v1. */
  upstreamBaseUrl: string;
  /** The real key; it is only ever put on the upstream request. */
  upstreamKey: string;
  /** Largest accepted request body in bytes. */
  maxBodyBytes?: number;
  /** One line per request: method, path, status. */
  log?: (line: string) => void;
}

const FORWARD_REQUEST_HEADERS = ["content-type", "accept"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "x-request-id"];

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Normalizes the request path: strips the query and one optional `/v1` prefix, so both client styles work. */
export function routePath(url: string | undefined): string {
  const path = (url ?? "/").split("?")[0]!;
  return path.startsWith("/v1/") ? path.slice(3) : path;
}

export function createProxyServer(config: ProxyConfig): Server {
  if (config.credential.length < 16) throw new Error("the proxy credential is too short");
  if (!config.upstreamKey) throw new Error("the upstream key is missing");
  const base = new URL(config.upstreamBaseUrl);
  if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("the upstream base address must be http or https");
  const basePath = base.pathname.replace(/\/+$/, "");
  const maxBody = config.maxBodyBytes ?? 8 * 1024 * 1024;
  const log = config.log ?? ((line: string) => process.stdout.write(`${line}\n`));

  const finish = (req: IncomingMessage, res: ServerResponse, path: string, status: number, message?: string) => {
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: message ?? "error", type: "llm_proxy" } }));
    } else res.end();
    log(`${req.method} ${path} ${status}`);
  };

  return createServer((req, res) => {
    const path = routePath(req.url);
    const shownPath = ALLOWED_PATHS[path] ? path : "(other)"; // unknown paths are not echoed into the log
    const auth = req.headers.authorization ?? "";
    const given = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!sameSecret(given, config.credential)) {
      req.resume();
      return finish(req, res, shownPath, 401, "invalid credential");
    }
    const method = ALLOWED_PATHS[path];
    if (!method) {
      req.resume();
      return finish(req, res, shownPath, 404, "path not allowed");
    }
    if (req.method !== method) {
      req.resume();
      return finish(req, res, path, 405, "method not allowed");
    }
    const declared = Number(req.headers["content-length"] ?? 0);
    if (declared > maxBody) {
      req.resume();
      return finish(req, res, path, 413, "request too large");
    }

    const headers: Record<string, string> = { authorization: `Bearer ${config.upstreamKey}` };
    for (const h of FORWARD_REQUEST_HEADERS) {
      const v = req.headers[h];
      if (typeof v === "string") headers[h] = v;
    }
    if (req.headers["content-length"]) headers["content-length"] = String(req.headers["content-length"]);
    const send = base.protocol === "https:" ? httpsRequest : httpRequest;
    const upstream = send(
      {
        protocol: base.protocol,
        hostname: base.hostname,
        port: base.port || undefined,
        path: `${basePath}${path}`,
        method,
        headers,
      },
      (up) => {
        const out: Record<string, string> = {};
        for (const h of FORWARD_RESPONSE_HEADERS) {
          const v = up.headers[h];
          if (typeof v === "string") out[h] = v;
        }
        res.writeHead(up.statusCode ?? 502, out);
        up.pipe(res);
        up.on("end", () => log(`${method} ${path} ${up.statusCode ?? 502}`));
        up.on("error", () => finish(req, res, path, 502));
      },
    );
    // The upstream error text can contain the address; only the status is reported.
    upstream.on("error", () => finish(req, res, path, 502, "upstream unreachable"));
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBody) {
        upstream.destroy();
        req.destroy();
        finish(req, res, path, 413, "request too large");
      }
    });
    // A client that goes away stops the upstream generation too.
    res.on("close", () => {
      if (!res.writableFinished) upstream.destroy();
    });
    req.pipe(upstream);
  });
}
