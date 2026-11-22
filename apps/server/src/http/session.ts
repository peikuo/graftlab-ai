// Anonymous session cookie and same-origin check (design.md, "HTTP API"; R28.6).
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export const SESSION_COOKIE = "gl_sid";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readSession(req: FastifyRequest): string | undefined {
  const header = req.headers.cookie ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) {
      const id = v.join("=");
      return UUID.test(id) ? id : undefined;
    }
  }
  return undefined;
}

export function ensureSession(req: FastifyRequest, reply: FastifyReply, secure: boolean): string {
  const existing = readSession(req);
  if (existing) return existing;
  const id = randomUUID();
  const attrs = [`${SESSION_COOKIE}=${id}`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=86400"];
  if (secure) attrs.push("Secure");
  reply.header("set-cookie", attrs.join("; "));
  return id;
}

/** True when the request's Origin header equals its own origin or one of the allowed origins. */
export function sameOrigin(req: FastifyRequest, allowed: readonly string[]): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  const host = req.headers.host;
  const own = host ? [`http://${host}`, `https://${host}`] : [];
  return [...own, ...allowed].includes(origin);
}

export function tokenEquals(given: string | undefined, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
