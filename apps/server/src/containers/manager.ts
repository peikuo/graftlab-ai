// Container manager (design: Containers, Network policy, Deployment model; R38.2-R38.4, R39.1, R39.6, R25.8).
// Creates the per-Task containers with explicit memory limits, a read-only root and tmpfs where the design says so,
// on an internal-only network for everything that runs target or agent code. Every resource carries the labels
// `graftlab.managed=true` and `graftlab.task=<taskId>`, so a Task's resources (and orphans after a crash) can be
// removed by label. No container gets the engine socket.
import { DockerClient, type ContainerInspect } from "./docker.ts";

export type ContainerKind = "sandbox" | "dev" | "run" | "test" | "proxy";

/** Initial values from reference-deployment.md ("Docker Desktop and memory"); `GL_MEM_<KIND>_MB` overrides. */
export const DEFAULT_MEM_MB: Record<ContainerKind, number> = { sandbox: 512, dev: 768, run: 512, test: 768, proxy: 64 };

export function memLimitsFromEnv(env: Record<string, string | undefined> = process.env): Record<ContainerKind, number> {
  const out = { ...DEFAULT_MEM_MB };
  for (const k of Object.keys(out) as ContainerKind[]) {
    const v = env[`GL_MEM_${k.toUpperCase()}_MB`];
    if (v === undefined || v === "") continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 32 || n > 65536) throw new Error(`GL_MEM_${k.toUpperCase()}_MB must be a whole number of MB between 32 and 65536`);
    out[k] = n;
  }
  return out;
}

/** GL_EXECUTION_ENABLED=false turns live execution off (a backend without engine access, R25.8). */
export function executionEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.GL_EXECUTION_ENABLED !== "false";
}

const SAFE = /^[a-z0-9][a-z0-9_.-]{0,62}$/i;
export const PROXY_PORT = 8787;
export const RELAY_PORT = 18080;
export const PROXY_ALIAS = "llm-proxy";
export const APP_ALIAS = "app";

export function resourceName(taskId: string, kind: string): string {
  const n = `gl-${taskId}-${kind}`;
  if (!SAFE.test(n)) throw new Error("invalid task id for a container name");
  return n;
}

const MB = 1024 * 1024;

export interface ProxyStart {
  image: string;
  credential: string;
  upstreamUrl: string;
  upstreamKey: string;
  /** host:port on the internal network the relay forwards to (for example app:8000). */
  relayTarget?: string;
}

export interface DevSandboxStart {
  image: string;
  /** Host path of the Worktree, mounted read-write at /work (the only writable host path). */
  workDir: string;
  /** Host path of the story bundle, mounted read-only at /context. */
  contextDir?: string;
  /** The Adapter's devSandbox.prebuilt paths, copied from /opt/target-src into /work after the start. */
  prebuilt: string[];
}

export interface BaselineStart {
  /** Image ID (the Adapter's config digest); checked before use. */
  imageId: string;
  port: number;
  env: Record<string, string>;
  dataVolumePath: string;
}

export class ContainerManager {
  readonly mem: Record<ContainerKind, number>;
  constructor(
    readonly docker: DockerClient = new DockerClient(),
    mem?: Record<ContainerKind, number>,
  ) {
    this.mem = mem ?? memLimitsFromEnv();
  }

  labels(taskId: string, kind: string): Record<string, string> {
    return { "graftlab.managed": "true", "graftlab.task": taskId, "graftlab.kind": kind };
  }

  /** Every image is checked before use; `expectedId` pins it by its image ID. */
  async verifyImage(ref: string, expectedId?: string): Promise<string> {
    const img = await this.docker.imageInspect(ref);
    if (!img) throw new Error(`image ${ref} is not present on this host`);
    if (expectedId && img.Id !== expectedId) throw new Error(`image ${ref} has ID ${img.Id.slice(0, 19)}, expected ${expectedId.slice(0, 19)}`);
    return img.Id;
  }

  /** The internal-only network of a Task: no internet, no DNS outside it; the LLM_Proxy is the only gateway. */
  async ensureInternalNetwork(taskId: string): Promise<string> {
    const name = resourceName(taskId, "int");
    const existing = await this.docker.call("GET", `/networks/${name}`, undefined, { allow404: true });
    if (!existing) await this.docker.createNetwork(name, { internal: true, labels: this.labels(taskId, "network") });
    return name;
  }

  async #replace(name: string): Promise<void> {
    await this.docker.removeContainer(name);
  }

  /** The LLM_Proxy, also hosting the port relay: default bridge (to reach the LLM) plus the internal network. */
  async startProxy(taskId: string, o: ProxyStart): Promise<{ name: string; baseUrl: string; relayHostPort: number | null }> {
    const name = resourceName(taskId, "proxy");
    const network = await this.ensureInternalNetwork(taskId);
    await this.#replace(name);
    const relay = o.relayTarget ? { [`${RELAY_PORT}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "" }] } : {};
    await this.docker.createContainer(name, {
      Image: o.image,
      Entrypoint: ["node", "/opt/runner/llm-proxy.mjs"],
      Cmd: [],
      User: "65534:65534",
      Env: [
        `GL_PROXY_CREDENTIAL=${o.credential}`,
        `GL_PROXY_UPSTREAM_URL=${o.upstreamUrl}`,
        `GL_PROXY_UPSTREAM_KEY=${o.upstreamKey}`,
        `GL_PROXY_PORT=${PROXY_PORT}`,
        ...(o.relayTarget ? [`GL_RELAY_PORT=${RELAY_PORT}`, `GL_RELAY_TARGET=${o.relayTarget}`] : []),
      ],
      Labels: this.labels(taskId, "proxy"),
      ExposedPorts: o.relayTarget ? { [`${RELAY_PORT}/tcp`]: {} } : {},
      HostConfig: {
        Memory: this.mem.proxy * MB,
        MemorySwap: this.mem.proxy * MB,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,size=16m" },
        SecurityOpt: ["no-new-privileges"],
        CapDrop: ["ALL"],
        NetworkMode: "bridge",
        PortBindings: relay,
      },
    });
    await this.docker.connectNetwork(network, name, [PROXY_ALIAS]);
    await this.docker.startContainer(name);
    const info = await this.docker.inspectContainer(name);
    const port = info?.NetworkSettings.Ports[`${RELAY_PORT}/tcp`]?.[0]?.HostPort;
    return { name, baseUrl: `http://${PROXY_ALIAS}:${PROXY_PORT}/v1`, relayHostPort: port ? Number(port) : null };
  }

  /**
   * The Development_Sandbox: internal network only, read-only root, tmpfs /tmp (also the home directory), the
   * Worktree as the only writable host path (R38.2). It idles; the runner is started with an exec.
   */
  async startDevSandbox(taskId: string, o: DevSandboxStart): Promise<{ name: string }> {
    const name = resourceName(taskId, "dev");
    const network = await this.ensureInternalNetwork(taskId);
    await this.#replace(name);
    await this.docker.createContainer(name, {
      Image: o.image,
      Entrypoint: ["sleep", "infinity"],
      Cmd: [],
      WorkingDir: "/work",
      Env: ["HOME=/tmp/home", "RUNNER_HOME=/tmp/runner-home", "npm_config_cache=/tmp/npm", "PYTHONDONTWRITEBYTECODE=1"],
      Labels: this.labels(taskId, "dev"),
      HostConfig: {
        Memory: this.mem.dev * MB,
        MemorySwap: this.mem.dev * MB,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,exec,size=512m" },
        SecurityOpt: ["no-new-privileges"],
        NetworkMode: network,
        Mounts: [
          { Type: "bind", Source: o.workDir, Target: "/work", ReadOnly: false },
          ...(o.contextDir ? [{ Type: "bind", Source: o.contextDir, Target: "/context", ReadOnly: true }] : []),
        ],
      },
    });
    await this.docker.startContainer(name);
    for (const p of o.prebuilt) {
      // Positional arguments, no interpolation of the path into the shell text.
      const r = await this.docker.exec(name, ["sh", "-c", 'mkdir -p "$(dirname "/work/$1")" && rm -rf "/work/$1" && cp -a "/opt/target-src/$1" "/work/$1"', "sh", p]);
      if (r.code !== 0) throw new Error(`copying the prebuilt path ${p} into the Worktree failed (exit ${r.code})`);
    }
    return { name };
  }

  /**
   * The Sandbox: the unmodified baseline image by its ID, on its own bridge network, a fresh named volume at the
   * data path, the app port published on the loopback interface only.
   */
  async startBaseline(taskId: string, o: BaselineStart, generation: number): Promise<{ name: string; volume: string; hostPort: number }> {
    await this.verifyImage(o.imageId, o.imageId);
    const name = resourceName(taskId, "sandbox");
    const net = resourceName(taskId, "sbx");
    if (!(await this.docker.call("GET", `/networks/${net}`, undefined, { allow404: true }))) {
      await this.docker.createNetwork(net, { internal: false, labels: this.labels(taskId, "network") });
    }
    await this.#replace(name);
    const volume = resourceName(taskId, `sandbox-data-${generation}`);
    await this.docker.createVolume(volume, this.labels(taskId, "volume"));
    await this.docker.createContainer(name, {
      Image: o.imageId,
      Env: Object.entries(o.env).map(([k, v]) => `${k}=${v}`),
      Labels: this.labels(taskId, "sandbox"),
      ExposedPorts: { [`${o.port}/tcp`]: {} },
      HostConfig: {
        Memory: this.mem.sandbox * MB,
        MemorySwap: this.mem.sandbox * MB,
        SecurityOpt: ["no-new-privileges"],
        NetworkMode: net,
        PortBindings: { [`${o.port}/tcp`]: [{ HostIp: "127.0.0.1", HostPort: "" }] },
        Mounts: [{ Type: "volume", Source: volume, Target: o.dataVolumePath }],
      },
    });
    await this.docker.startContainer(name);
    const info = (await this.docker.inspectContainer(name)) as ContainerInspect;
    const hostPort = Number(info.NetworkSettings.Ports[`${o.port}/tcp`]?.[0]?.HostPort ?? 0);
    if (!hostPort) throw new Error("the Sandbox port was not published");
    return { name, volume, hostPort };
  }

  /**
   * A shell script that copies the read-only snapshot at /src to /tmp/app, adds the Adapter's prebuilt paths from
   * the image, and runs the given commands there. The paths and commands are passed as positional arguments and
   * environment, never pasted into the script text; the commands themselves run only inside the container.
   */
  static prepareScript = 'set -e; rm -rf /tmp/app; cp -a /src /tmp/app; for p in $GL_PREBUILT; do mkdir -p "$(dirname "/tmp/app/$p")"; rm -rf "/tmp/app/$p"; cp -a "/opt/target-src/$p" "/tmp/app/$p"; done; cd /tmp/app; eval "$GL_RUN"';

  #appContainer(taskId: string, kind: "run" | "test", o: { image: string; snapshotDir: string; prebuilt: string[]; run: string; alias?: string }) {
    return {
      Image: o.image,
      Entrypoint: ["sh", "-c", ContainerManager.prepareScript],
      Cmd: [],
      WorkingDir: "/tmp",
      Env: ["HOME=/tmp/home", "npm_config_cache=/tmp/npm", "PYTHONDONTWRITEBYTECODE=1", `GL_PREBUILT=${o.prebuilt.join(" ")}`, `GL_RUN=${o.run}`],
      Labels: this.labels(taskId, kind),
      HostConfig: {
        Memory: this.mem[kind] * MB,
        MemorySwap: this.mem[kind] * MB,
        ReadonlyRootfs: true,
        Tmpfs: { "/tmp": "rw,exec,size=1024m" },
        SecurityOpt: ["no-new-privileges"],
        NetworkMode: resourceName(taskId, "int"),
        Mounts: [{ Type: "bind", Source: o.snapshotDir, Target: "/src", ReadOnly: true }],
      },
    };
  }

  /** Verifier test container (R22.2): fresh, the snapshot read-only, internal network only; the exit code decides. */
  async runTests(taskId: string, o: { image: string; snapshotDir: string; prebuilt: string[]; command: string; timeoutS: number }): Promise<{ code: number; output: string; timedOut: boolean }> {
    await this.ensureInternalNetwork(taskId);
    const name = resourceName(taskId, "test");
    await this.#replace(name);
    await this.docker.createContainer(name, this.#appContainer(taskId, "test", { ...o, run: o.command }));
    await this.docker.startContainer(name);
    const end = Date.now() + o.timeoutS * 1000;
    let timedOut = false;
    for (;;) {
      const info = await this.docker.inspectContainer(name);
      if (!info?.State.Running) break;
      if (Date.now() > end) {
        timedOut = true;
        await this.docker.stopContainer(name, 1);
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const info = await this.docker.inspectContainer(name);
    const output = await this.docker.logs(name, 400).catch(() => "");
    await this.docker.removeContainer(name);
    return { code: timedOut ? -1 : (info?.State.ExitCode ?? -1), output, timedOut };
  }

  /** Run_Environment (R39.3-R39.5): a fresh container per attempt running the changed app, alias `app`. */
  async startRunEnvironment(taskId: string, o: { image: string; snapshotDir: string; prebuilt: string[]; commands: string }): Promise<{ name: string }> {
    const network = await this.ensureInternalNetwork(taskId);
    const name = resourceName(taskId, "run");
    await this.#replace(name);
    const spec = this.#appContainer(taskId, "run", { ...o, run: o.commands });
    await this.docker.createContainer(name, { ...spec, NetworkingConfig: { EndpointsConfig: { [network]: { Aliases: [APP_ALIAS] } } } });
    await this.docker.startContainer(name);
    return { name };
  }

  /** Removes a container and, when given, its data volume. */
  async removeBaseline(name: string, volume?: string): Promise<void> {
    await this.docker.removeContainer(name);
    if (volume) await this.docker.removeVolume(volume);
  }

  /** Removes every container, network and volume of one Task (Task end). */
  async removeTask(taskId: string): Promise<void> {
    await this.#removeByLabel(`graftlab.task=${taskId}`);
  }

  /** Removes every Studio resource (server start: orphans of a crashed run). */
  async removeAll(): Promise<void> {
    await this.#removeByLabel("graftlab.managed=true");
  }

  async #removeByLabel(label: string): Promise<void> {
    for (const c of (await this.docker.listContainers(label)) ?? []) await this.docker.removeContainer(c.Id);
    for (const n of (await this.docker.listNetworks(label)) ?? []) await this.docker.removeNetwork(n.Name);
    for (const v of (await this.docker.listVolumes(label))?.Volumes ?? []) await this.docker.removeVolume(v.Name);
  }
}
