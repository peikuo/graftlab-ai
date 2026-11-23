// Integration tests against a real container engine (tasks 10.10 and 10.11). They run only with GL_DOCKER_TESTS=1 on
// a host that has the linkding baseline image (by its config digest) and graftlab/dev-sandbox-linkding; the mirror
// comes from GL_MIRROR_SOURCE_LINKDING when the upstream cannot be cloned.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretRegistry } from "@graftlab/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAdapters } from "../adapters/registry.ts";
import { createWorktree, diffWorktree, mirrorSourceFromEnv, notIgnored } from "../worktree/worktree.ts";
import { ContainerManager } from "./manager.ts";
import { Sandbox } from "./sandbox.ts";

const enabled = process.env.GL_DOCKER_TESTS === "1";
const DEV_IMAGE = "graftlab/dev-sandbox-linkding:latest";
const taskId = `it${Date.now().toString(36)}`;
const manager = new ContainerManager();

describe.runIf(enabled)("containers (real engine)", { timeout: 300_000 }, () => {
  let dataDir: string;
  let adapter: Awaited<ReturnType<typeof loadAdapters>>[number];
  const secrets = new SecretRegistry();

  beforeAll(async () => {
    dataDir = await mkdtemp(join(process.env.GL_IT_DIR ?? tmpdir(), "gl-it-"));
    adapter = (await loadAdapters(join(import.meta.dirname, "../../../../adapters"))).find((a) => a.id === "linkding")!;
    expect(await manager.docker.ping()).toBe(true);
  });

  afterAll(async () => {
    await manager.removeTask(taskId);
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("Sandbox (10.11)", () => {
    const sandbox = () => new Sandbox(taskId, adapter, { manager, secrets });
    let sbx: Sandbox;

    it("starts from the pinned image, provisions, seeds and passes the equality check", async () => {
      sbx = sandbox();
      const r = await sbx.start();
      if (!r.ok) throw new Error(`${r.step}: ${r.reason}`);
      expect(r.equality.every((e) => e.pass)).toBe(true);
      expect(r.equality.length).toBeGreaterThanOrEqual(9);
      console.log("sandbox start ms", r.ms);
      const info = await manager.docker.inspectContainer(r.state.name);
      expect(info!.Config.Image).toBe(adapter.baseline.configDigest);
      expect(info!.HostConfig.Memory).toBe(manager.mem.sandbox * 1024 * 1024);
      expect(info!.Mounts.some((m) => m.Source.includes("docker.sock") || m.Destination.includes("docker.sock"))).toBe(false);
      // The credentials are registered with the redactor.
      const token = r.state.credentials.linkding_api_token!;
      expect(secrets.redactText(`x ${token}`).value).not.toContain(token);
    });

    it("a changed item fails the equality check and a reset passes it again", async () => {
      const c = sbx.client();
      const list = (await c.request("GET", "/api/bookmarks/?limit=100")).json as { results: { id: number }[] };
      const id = list.results[0]!.id;
      expect((await c.request("PATCH", `/api/bookmarks/${id}/`, { title: "changed by the test" })).status).toBe(200);
      const changed = await adapter.hooks.testData.equals(c);
      expect(changed.filter((e) => !e.pass)).toHaveLength(1);
      const r = await sbx.reset();
      if (!r.ok) throw new Error(`${r.step}: ${r.reason}`);
      expect(r.equality.every((e) => e.pass)).toBe(true);
      expect(r.state.generation).toBe(1);
      console.log("sandbox reset ms", r.ms);
    });

    it("a start failure is returned as a recorded result, not thrown", async () => {
      const broken = new Sandbox(`${taskId}x`, { ...adapter, baseline: { ...adapter.baseline, configDigest: `sha256:${"0".repeat(64)}` } }, { manager, secrets });
      const r = await broken.start();
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.step).toBe("start");
        expect(r.reason).toMatch(/not present/);
      }
      await manager.removeTask(`${taskId}x`);
      await sbx.stop();
    });
  });

  describe("Development_Sandbox confinement (10.10)", () => {
    it("writes reach only the Worktree, the root is read-only, no internet, the LLM_Proxy is reachable", async () => {
      const src = mirrorSourceFromEnv("linkding");
      const wt = await createWorktree(dataDir, taskId, { adapterId: "linkding", upstreamUrl: adapter.source.upstreamUrl, commit: adapter.source.commit, ...(src ? { source: src } : {}) });
      expect(await notIgnored(wt, adapter.devSandbox.prebuilt)).toEqual([]);
      const ctx = join(dataDir, "tasks", taskId, "context", "S1");
      await mkdir(ctx, { recursive: true });
      await writeFile(join(ctx, "story.md"), "# Story\n");
      const proxy = await manager.startProxy(taskId, { image: DEV_IMAGE, credential: "glp_integration-test-credential", upstreamUrl: "https://example.invalid", upstreamKey: "integration-upstream-key" });
      const { name } = await manager.startDevSandbox(taskId, { image: DEV_IMAGE, workDir: wt.path, contextDir: ctx, prebuilt: adapter.devSandbox.prebuilt });
      const sh = (script: string) => manager.docker.exec(name, ["sh", "-c", script]);

      // The prebuilt copies are in /work and stay out of the diff.
      expect((await sh("test -f /work/bookmarks/static/bundle.js && test -d /work/node_modules/lit && echo ok")).stdout.trim()).toBe("ok");
      expect((await diffWorktree(wt)).changedFiles).toEqual([]);

      // A write to /work reaches the host Worktree.
      expect((await sh("echo from-container > /work/probe.txt")).code).toBe(0);
      expect(await readFile(join(wt.path, "probe.txt"), "utf8")).toBe("from-container\n");
      expect((await diffWorktree(wt)).changedFiles).toEqual([{ status: "added", path: "probe.txt" }]);
      // /context is read-only, the root filesystem is read-only, /tmp is writable.
      expect((await sh("echo x > /context/story.md")).code).not.toBe(0);
      const etc = await sh("echo x > /etc/probe");
      expect(etc.code).not.toBe(0);
      expect(etc.stderr).toMatch(/Read-only file system/);
      expect((await sh("echo x > /tmp/probe && echo ok")).stdout.trim()).toBe("ok");
      // No internet; the proxy answers (401 for a wrong credential means it is reachable).
      expect((await sh("curl -sS -m 8 -o /dev/null https://example.com; echo $?")).stdout.trim()).not.toBe("0");
      expect((await sh(`curl -s -m 8 -o /dev/null -w '%{http_code}' ${proxy.baseUrl}/models`)).stdout.trim()).toBe("401");
      // No LLM key and no engine socket in the container.
      const env = (await sh("env")).stdout;
      expect(env).not.toContain("integration-upstream-key");
      expect((await sh("test -e /var/run/docker.sock && echo present || echo absent")).stdout.trim()).toBe("absent");
      const info = await manager.docker.inspectContainer(name);
      expect(info!.HostConfig.ReadonlyRootfs).toBe(true);
      expect(info!.HostConfig.Memory).toBe(manager.mem.dev * 1024 * 1024);
      expect(existsSync(join(wt.path, "etc"))).toBe(false);

      // Linkding's tests run offline in /work (one targeted file, as the Verifier would).
      const t = await manager.docker.exec(name, ["python", "-m", "pytest", "-q", "-p", "no:cacheprovider", "bookmarks/tests/test_bookmark_validation.py"], { workdir: "/work" });
      console.log("targeted test:", t.code, t.stdout.trim().split("\n").at(-1));
      expect(t.code).toBe(0);
    });
  });
});
