// Port relay hosted by the LLM_Proxy container (design: Network policy; reference-deployment.md, "Docker Desktop
// facts"). A container on an internal-only network cannot publish a port, so the proxy container, which is on the
// internal and the default network, publishes one port on the host loopback and forwards it to the app port on the
// internal network (Run_Environment or Verifier test container, reached by its network alias).
import { connect, createServer, type Server } from "node:net";

export function createRelay(target: { host: string; port: number }, log: (line: string) => void = () => {}): Server {
  return createServer((client) => {
    const upstream = connect(target.port, target.host);
    client.pipe(upstream).pipe(client);
    const close = () => {
      client.destroy();
      upstream.destroy();
    };
    upstream.on("error", () => {
      log(`relay: ${target.host}:${target.port} unreachable`);
      close();
    });
    client.on("error", close);
  });
}

/** Parses `host:port` (GL_RELAY_TARGET). */
export function parseTarget(value: string): { host: string; port: number } {
  const m = /^([a-z0-9.-]+):(\d{1,5})$/i.exec(value);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 65535) throw new Error("GL_RELAY_TARGET must be host:port");
  return { host: m[1]!, port: Number(m[2]) };
}
