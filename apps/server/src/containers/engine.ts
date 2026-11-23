// Container engine availability (R25.8, Error Handling "Container engine unavailable"). Milestone 5 only pings
// the engine for the home page; the container manager follows in milestone 10.
import { request } from "node:http";
import { dockerSocketPath } from "./docker.ts";

/** Pings the Docker Engine API over its local socket (Unix socket or Windows named pipe). */
export function pingDocker(timeoutMs = 1500): Promise<{ available: boolean; reason?: string }> {
  const socketPath = dockerSocketPath();
  return new Promise((resolve) => {
    const req = request({ socketPath, path: "/_ping", method: "GET", timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200 ? { available: true } : { available: false, reason: `the container engine answered HTTP ${res.statusCode}` });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ available: false, reason: "the container engine did not answer" });
    });
    req.on("error", () => resolve({ available: false, reason: "no container engine is running on this server" }));
    req.end();
  });
}
