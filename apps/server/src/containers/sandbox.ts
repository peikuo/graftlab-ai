// Sandbox start, reset and restore over the Adapter contract (design: Sandbox and test data; R13.1-R13.6,
// R29.1-R29.5). Generic: fresh volume, per-start generated secretEnv values (registered with the redactor),
// readiness on the health path, the Adapter's provision hook, testData.seed, and the equality check by the Verifier
// with testData.equals. A failure is returned as a recorded result naming the step, so the caller decides the edge
// ("experience unavailable" in sandbox_start, "not executed" in target_check).
import { randomBytes } from "node:crypto";
import type { Adapter, BaselineHandle, ItemResult, SecretRegistry, TargetClient } from "@graftlab/shared";
import type { ContainerManager } from "./manager.ts";

export type SandboxStep = "start" | "readiness" | "provision" | "seed" | "equality";

export interface SandboxState {
  name: string;
  volume: string;
  hostPort: number;
  generation: number;
  secretEnv: Record<string, string>;
  credentials: Record<string, string>;
}

export type SandboxResult =
  | { ok: true; state: SandboxState; equality: ItemResult[]; ms: Record<SandboxStep, number> }
  | { ok: false; step: SandboxStep; reason: string; equality: ItemResult[]; state: SandboxState | null; ms: Partial<Record<SandboxStep, number>> };

export interface SandboxDeps {
  manager: ContainerManager;
  secrets: SecretRegistry;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  fetchFn?: typeof fetch;
}

const secretName = (envName: string) => `target_${envName.toLowerCase()}`.slice(0, 36);

/** A value per secretEnv name: letters and digits, long enough for the redactor. */
export function generateSecretEnv(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((n) => [n, `gl${randomBytes(12).toString("hex")}`]));
}

/** HTTP access to the Sandbox on the loopback port, with the provisioned credential added by Studio code. */
export function targetClient(adapter: Adapter, hostPort: number, credentials: Record<string, string>, fetchFn: typeof fetch = fetch): TargetClient {
  const auth = adapter.api.auth;
  const token = credentials[auth.credential];
  return {
    async request(method, path, body) {
      if (!path.startsWith("/")) throw new Error("target paths are relative");
      const res = await fetchFn(`http://127.0.0.1:${hostPort}${path}`, {
        method,
        headers: { ...(token ? { [auth.header]: `${auth.prefix}${token}` } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json };
    },
  };
}

async function waitHealthy(port: number, path: string, timeoutS: number, d: Required<Pick<SandboxDeps, "now" | "sleep" | "fetchFn">>): Promise<void> {
  const end = d.now() + timeoutS * 1000;
  for (;;) {
    const ok = await d
      .fetchFn(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.status === 200)
      .catch(() => false);
    if (ok) return;
    if (d.now() > end) throw new Error(`${path} did not answer 200 within ${timeoutS} s`);
    await d.sleep(1000);
  }
}

export class Sandbox {
  #state: SandboxState | null = null;
  readonly #d: Required<SandboxDeps>;

  constructor(
    readonly taskId: string,
    readonly adapter: Adapter,
    deps: SandboxDeps,
  ) {
    this.#d = { now: Date.now, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), fetchFn: fetch, ...deps };
  }

  get state(): SandboxState | null {
    return this.#state;
  }

  client(): TargetClient {
    if (!this.#state) throw new Error("the Sandbox is not running");
    return targetClient(this.adapter, this.#state.hostPort, this.#state.credentials, this.#d.fetchFn);
  }

  /** Starts on a fresh volume, then provision, seed and the equality check (sandbox_start). */
  start(): Promise<SandboxResult> {
    return this.#run(0);
  }

  /** Reset and restore: the Adapter's reset hook recreates container and volume, then the same checks (R29.2). */
  async reset(): Promise<SandboxResult> {
    const generation = (this.#state?.generation ?? -1) + 1;
    return this.#run(generation);
  }

  async stop(): Promise<void> {
    if (this.#state) await this.#d.manager.removeBaseline(this.#state.name, this.#state.volume);
    this.#state = null;
  }

  async #run(generation: number): Promise<SandboxResult> {
    const ms: Partial<Record<SandboxStep, number>> = {};
    let step: SandboxStep = "start";
    let t = this.#d.now();
    const mark = (next: SandboxStep) => {
      ms[step] = this.#d.now() - t;
      t = this.#d.now();
      step = next;
    };
    let equality: ItemResult[] = [];
    try {
      const b = this.adapter.baseline;
      if (!b.configDigest) throw new Error("the Adapter does not pin the baseline image ID (configDigest)");
      const secretEnv = generateSecretEnv(b.secretEnv);
      // One redactor name per generation, so the values of an earlier start stay registered too.
      for (const [k, v] of Object.entries(secretEnv)) this.#d.secrets.register(`${secretName(k)}_${generation}`, v);
      const start = async (gen: number) => {
        const prev = this.#state;
        if (prev) await this.#d.manager.removeBaseline(prev.name, prev.volume);
        const r = await this.#d.manager.startBaseline(this.taskId, { imageId: b.configDigest!, port: b.port, env: { ...b.env, ...secretEnv }, dataVolumePath: b.dataVolumePath }, gen);
        this.#state = { ...r, generation: gen, secretEnv, credentials: {} };
      };
      let gen = generation;
      const handle: BaselineHandle = {
        secretEnv,
        appDir: "/etc/linkding",
        exec: (cmd, opts) => this.#d.manager.docker.exec(this.#state!.name, cmd, opts ?? {}),
        recreate: async () => {
          await start(gen++);
          await waitHealthy(this.#state!.hostPort, b.healthPath, b.readinessTimeoutS, this.#d);
        },
      };
      if (generation === 0 || !this.#state) {
        await start(gen++);
        mark("readiness");
        await waitHealthy(this.#state!.hostPort, b.healthPath, b.readinessTimeoutS, this.#d);
      } else {
        await this.adapter.hooks.testData.reset(handle); // recreates container and volume and waits for readiness
        mark("readiness");
      }
      mark("provision");
      const creds = await this.adapter.hooks.provision(handle);
      for (const c of creds) {
        this.#d.secrets.register(`${c.name}_${generation}`.slice(0, 41), c.value);
        this.#state!.credentials[c.name] = c.value;
      }
      mark("seed");
      await this.adapter.hooks.testData.seed(this.client());
      mark("equality");
      equality = await this.adapter.hooks.testData.equals(this.client());
      ms.equality = this.#d.now() - t;
      const failed = equality.filter((e) => !e.pass);
      if (failed.length) return { ok: false, step: "equality", reason: `${failed.length} of ${equality.length} items differ from the fixed test data`, equality, state: this.#state, ms };
      return { ok: true, state: this.#state!, equality, ms: ms as Record<SandboxStep, number> };
    } catch (e) {
      ms[step] = this.#d.now() - t;
      return { ok: false, step, reason: (e as Error).message, equality, state: this.#state, ms };
    }
  }
}
