// Minimal Docker Engine API client over the engine's local endpoint (Unix socket or Windows named pipe), with no
// dependency (design: Containers, Deployment model; R38.2, R39.1). Only the backend talks to the engine; no
// container ever gets the socket. Errors carry the method, the path and the engine's message, never request bodies
// (a container create body holds environment values).
import { request, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

export function dockerSocketPath(env: Record<string, string | undefined> = process.env, platform = process.platform): string {
  const host = env.DOCKER_HOST ?? "";
  if (host.startsWith("unix://")) return host.slice("unix://".length);
  if (host.startsWith("npipe://")) return host.slice("npipe:".length).replace(/\//g, "\\");
  return platform === "win32" ? "\\\\.\\pipe\\docker_engine" : "/var/run/docker.sock";
}

export class DockerError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    engineMessage: string,
  ) {
    super(`container engine: ${method} ${path.split("?")[0]} answered ${status}: ${engineMessage.slice(0, 300)}`);
  }
}

/** Splits the engine's multiplexed stream (8-byte frame headers, stream 1 stdout, 2 stderr) into its streams. */
export class Demux {
  #buf: Buffer = Buffer.alloc(0);
  constructor(private readonly onFrame: (stream: 1 | 2, data: Buffer) => void) {}
  push(chunk: Buffer): void {
    this.#buf = this.#buf.length ? Buffer.concat([this.#buf, chunk]) : chunk;
    while (this.#buf.length >= 8) {
      const size = this.#buf.readUInt32BE(4);
      if (this.#buf.length < 8 + size) return;
      const stream = this.#buf[0] === 2 ? 2 : 1;
      this.onFrame(stream, this.#buf.subarray(8, 8 + size));
      this.#buf = this.#buf.subarray(8 + size);
    }
  }
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  workdir?: string;
  env?: Record<string, string>;
  user?: string;
}

/** An interactive exec: stdin is writable, stdout and stderr arrive demultiplexed; `exited` resolves with the code. */
export interface AttachedExec {
  stdin: { write(data: string): void; end(): void };
  onStdout(fn: (data: Buffer) => void): void;
  onStderr(fn: (data: Buffer) => void): void;
  exited: Promise<number>;
  kill(): void;
}

export class DockerClient {
  constructor(
    readonly socketPath: string = dockerSocketPath(),
    private readonly timeoutMs = 120_000,
  ) {}

  /** One JSON request. 404 answers `null` when `allow404` is set. */
  async call<T = unknown>(method: string, path: string, body?: unknown, opts: { allow404?: boolean; ok?: number[] } = {}): Promise<T | null> {
    const { status, text } = await this.#raw(method, path, body);
    if (status === 404 && opts.allow404) return null;
    if (status >= 300 && !(opts.ok ?? []).includes(status)) {
      let msg = text;
      try {
        msg = (JSON.parse(text) as { message?: string }).message ?? text;
      } catch {
        /* plain text */
      }
      throw new DockerError(status, method, path, msg);
    }
    return text ? (JSON.parse(text) as T) : (null as T | null);
  }

  #raw(method: string, path: string, body?: unknown): Promise<{ status: number; text: string; res?: IncomingMessage }> {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath: this.socketPath,
          path,
          method,
          timeout: this.timeoutMs,
          headers: payload ? { "content-type": "application/json", "content-length": payload.length } : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error(`container engine: ${method} ${path.split("?")[0]} timed out`)));
      req.on("error", (e) => reject(e.message.startsWith("container engine") ? e : new Error(`container engine unreachable (${method} ${path.split("?")[0]})`)));
      req.end(payload);
    });
  }

  /**
   * Builds an image from a tar build context (R42: open execution). The engine streams JSON lines; the result is
   * the success and the last lines of the log (the `stream` texts and any `error`), never the build arguments.
   */
  build(context: Buffer, tag: string, buildArgs: Record<string, string>, timeoutMs = 20 * 60_000): Promise<{ ok: boolean; log: string[] }> {
    const path = `/build?t=${encodeURIComponent(tag)}&rm=1&forcerm=1&buildargs=${encodeURIComponent(JSON.stringify(buildArgs))}`;
    return new Promise((resolve, reject) => {
      const log: string[] = [];
      let error: string | null = null;
      let rest = "";
      const take = (chunk: string) => {
        rest += chunk;
        const lines = rest.split("\n");
        rest = lines.pop() ?? "";
        for (const l of lines) {
          if (!l.trim()) continue;
          try {
            const j = JSON.parse(l) as { stream?: string; error?: string; status?: string };
            if (j.error) error = j.error;
            const t = (j.stream ?? j.error ?? j.status ?? "").trimEnd();
            if (t) log.push(...t.split("\n"));
          } catch {
            log.push(l);
          }
          if (log.length > 400) log.splice(0, log.length - 400);
        }
      };
      const req = request({ socketPath: this.socketPath, path, method: "POST", timeout: timeoutMs, headers: { "content-type": "application/x-tar", "content-length": context.length } }, (res) => {
        res.setEncoding("utf8");
        res.on("data", (c: string) => take(c));
        res.on("end", () => {
          take("\n");
          const ok = (res.statusCode ?? 0) < 300 && error === null;
          resolve({ ok, log: log.slice(-80) });
        });
        res.on("error", reject);
      });
      req.on("timeout", () => req.destroy(new Error(`container engine: image build timed out after ${Math.round(timeoutMs / 60_000)} min`)));
      req.on("error", (e) => reject(e.message.startsWith("container engine") ? e : new Error("container engine unreachable (POST /build)")));
      req.end(context);
    });
  }
  async ping(): Promise<boolean> {
    return this.#raw("GET", "/_ping").then(
      (r) => r.status === 200,
      () => false,
    );
  }

  imageInspect(ref: string) {
    return this.call<{ Id: string; RepoTags: string[] }>("GET", `/images/${encodeURIComponent(ref)}/json`, undefined, { allow404: true });
  }

  createNetwork(name: string, opts: { internal: boolean; labels: Record<string, string> }) {
    return this.call<{ Id: string }>("POST", "/networks/create", { Name: name, Driver: "bridge", Internal: opts.internal, Labels: opts.labels, CheckDuplicate: true });
  }
  connectNetwork(network: string, container: string, aliases: string[] = []) {
    return this.call("POST", `/networks/${encodeURIComponent(network)}/connect`, { Container: container, EndpointConfig: { Aliases: aliases } });
  }
  removeNetwork(name: string) {
    return this.call("DELETE", `/networks/${encodeURIComponent(name)}`, undefined, { allow404: true });
  }
  listNetworks(label: string) {
    return this.call<{ Name: string; Labels: Record<string, string> }[]>("GET", `/networks?filters=${encodeURIComponent(JSON.stringify({ label: [label] }))}`);
  }

  createVolume(name: string, labels: Record<string, string>) {
    return this.call("POST", "/volumes/create", { Name: name, Labels: labels });
  }
  removeVolume(name: string) {
    return this.call("DELETE", `/volumes/${encodeURIComponent(name)}?force=true`, undefined, { allow404: true });
  }
  listVolumes(label: string) {
    return this.call<{ Volumes: { Name: string }[] | null }>("GET", `/volumes?filters=${encodeURIComponent(JSON.stringify({ label: [label] }))}`);
  }

  createContainer(name: string, spec: Record<string, unknown>) {
    return this.call<{ Id: string }>("POST", `/containers/create?name=${encodeURIComponent(name)}`, spec);
  }
  startContainer(name: string) {
    return this.call("POST", `/containers/${encodeURIComponent(name)}/start`, undefined, { ok: [304] });
  }
  stopContainer(name: string, timeoutS = 10) {
    return this.call("POST", `/containers/${encodeURIComponent(name)}/stop?t=${timeoutS}`, undefined, { ok: [304], allow404: true });
  }
  removeContainer(name: string) {
    return this.call("DELETE", `/containers/${encodeURIComponent(name)}?force=true&v=true`, undefined, { allow404: true });
  }
  inspectContainer(name: string) {
    return this.call<ContainerInspect>("GET", `/containers/${encodeURIComponent(name)}/json`, undefined, { allow404: true });
  }
  listContainers(label: string) {
    return this.call<{ Id: string; Names: string[]; Labels: Record<string, string>; State: string }[]>(
      "GET",
      `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ label: [label] }))}`,
    );
  }
  async logs(name: string, tail = 200): Promise<string> {
    const { status, text } = await this.#rawBinary("GET", `/containers/${encodeURIComponent(name)}/logs?stdout=true&stderr=true&tail=${tail}`);
    if (status !== 200) throw new DockerError(status, "GET", "/containers/{name}/logs", "logs unavailable");
    let out = "";
    new Demux((_s, d) => (out += d.toString("utf8"))).push(text);
    return out;
  }

  #rawBinary(method: string, path: string): Promise<{ status: number; text: Buffer }> {
    return new Promise((resolve, reject) => {
      const req = request({ socketPath: this.socketPath, path, method, timeout: this.timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks) }));
      });
      req.on("error", reject);
      req.end();
    });
  }

  async #createExec(container: string, cmd: string[], opts: ExecOptions, stdin: boolean): Promise<string> {
    const r = await this.call<{ Id: string }>("POST", `/containers/${encodeURIComponent(container)}/exec`, {
      AttachStdin: stdin,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Cmd: cmd,
      ...(opts.env ? { Env: Object.entries(opts.env).map(([k, v]) => `${k}=${v}`) } : {}),
      ...(opts.workdir ? { WorkingDir: opts.workdir } : {}),
      ...(opts.user ? { User: opts.user } : {}),
    });
    return r!.Id;
  }

  async #execCode(id: string): Promise<number> {
    for (let i = 0; i < 50; i++) {
      const s = await this.call<{ Running: boolean; ExitCode: number | null }>("GET", `/exec/${id}/json`);
      if (s && !s.Running) return s.ExitCode ?? -1;
      await new Promise((r) => setTimeout(r, 100));
    }
    return -1;
  }

  /** Runs a command to completion (argument array, no shell); stdout and stderr are collected. */
  async exec(container: string, cmd: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    const id = await this.#createExec(container, cmd, opts, false);
    const { status, text } = await this.#rawBinaryJson("POST", `/exec/${id}/start`, { Detach: false, Tty: false });
    if (status !== 200) throw new DockerError(status, "POST", "/exec/{id}/start", text.toString("utf8"));
    let stdout = "";
    let stderr = "";
    new Demux((s, d) => (s === 1 ? (stdout += d.toString("utf8")) : (stderr += d.toString("utf8")))).push(text);
    return { code: await this.#execCode(id), stdout, stderr };
  }

  #rawBinaryJson(method: string, path: string, body: unknown): Promise<{ status: number; text: Buffer }> {
    const payload = Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const req = request(
        { socketPath: this.socketPath, path, method, headers: { "content-type": "application/json", "content-length": payload.length } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
  }

  /** Starts an interactive exec over a hijacked connection (stdin open), for the Code_Agent runner. */
  async execAttach(container: string, cmd: string[], opts: ExecOptions = {}): Promise<AttachedExec> {
    const id = await this.#createExec(container, cmd, opts, true);
    const payload = Buffer.from(JSON.stringify({ Detach: false, Tty: false }));
    const socket = await new Promise<Duplex>((resolve, reject) => {
      const req = request({
        socketPath: this.socketPath,
        path: `/exec/${id}/start`,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": payload.length, connection: "Upgrade", upgrade: "tcp" },
      });
      req.on("upgrade", (_res, sock, head) => {
        if (head.length) sock.unshift(head);
        resolve(sock);
      });
      req.on("response", (res) => reject(new DockerError(res.statusCode ?? 0, "POST", "/exec/{id}/start", "the engine did not upgrade the connection")));
      req.on("error", reject);
      req.end(payload);
    });
    const outFns: ((d: Buffer) => void)[] = [];
    const errFns: ((d: Buffer) => void)[] = [];
    const demux = new Demux((s, d) => (s === 1 ? outFns : errFns).forEach((f) => f(d)));
    socket.on("data", (c: Buffer) => demux.push(c));
    const exited = new Promise<number>((resolve) => {
      socket.on("close", () => void this.#execCode(id).then(resolve, () => resolve(-1)));
    });
    return {
      stdin: { write: (d) => void socket.write(d), end: () => void socket.end() },
      onStdout: (f) => void outFns.push(f),
      onStderr: (f) => void errFns.push(f),
      exited,
      kill: () => socket.destroy(),
    };
  }
}

export interface ContainerInspect {
  Id: string;
  Name: string;
  State: { Status: string; Running: boolean; ExitCode: number; OOMKilled: boolean };
  NetworkSettings: { Ports: Record<string, { HostIp: string; HostPort: string }[] | null> };
  HostConfig: { Memory: number; ReadonlyRootfs: boolean; Binds: string[] | null };
  Mounts: { Type: string; Source: string; Destination: string; RW: boolean }[];
  Config: { Env: string[] | null; Image: string };
}
