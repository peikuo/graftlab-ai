import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createRelay, parseTarget } from "./relay.js";

const servers: { close(cb: () => void): void }[] = [];
const listen = (s: Server | ReturnType<typeof createRelay>) =>
  new Promise<number>((r) => {
    servers.push(s);
    s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port));
  });
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

describe("port relay", () => {
  it("forwards a connection to the target", async () => {
    const app = createServer((_q, res) => res.end("from app"));
    const appPort = await listen(app);
    const relayPort = await listen(createRelay({ host: "127.0.0.1", port: appPort }));
    expect(await (await fetch(`http://127.0.0.1:${relayPort}/health`, { headers: { connection: "close" } })).text()).toBe("from app");
  });

  it("closes the client when the target is down", async () => {
    const lines: string[] = [];
    const relayPort = await listen(createRelay({ host: "127.0.0.1", port: 1 }, (l) => lines.push(l)));
    await expect(fetch(`http://127.0.0.1:${relayPort}/`)).rejects.toThrow();
    expect(lines).toEqual(["relay: 127.0.0.1:1 unreachable"]);
  });

  it("parses host:port", () => {
    expect(parseTarget("app:8000")).toEqual({ host: "app", port: 8000 });
    expect(() => parseTarget("app")).toThrow();
    expect(() => parseTarget("a b:1")).toThrow();
  });
});
