import { describe, expect, it } from "vitest";
import type { SandboxResult } from "./sandbox.ts";
import { SandboxService, type SandboxLike } from "./sandboxService.ts";

const ok = (): SandboxResult => ({ ok: true, state: { name: "s", volume: "v", hostPort: 1, generation: 0, secretEnv: {}, credentials: {} }, equality: [{ item: "a", pass: true, expected: "x", actual: "as expected" }], ms: { start: 0, readiness: 0, provision: 0, seed: 0, equality: 0 } });
const fail = (): SandboxResult => ({ ok: false, step: "equality", reason: "1 of 2 items differ from the fixed test data", equality: [], state: null, ms: {} });

function fake(results: SandboxResult[]): SandboxLike & { calls: string[] } {
  const calls: string[] = [];
  return { calls, start: async () => (calls.push("start"), results.shift()!), reset: async () => (calls.push("reset"), results.shift()!), stop: async () => void calls.push("stop") };
}

describe("SandboxService", () => {
  it("a failed restore blocks Agent actions until a reset succeeds", async () => {
    const seen: string[] = [];
    const svc = new SandboxService((kind, r) => void seen.push(`${kind}:${r.ok}`));
    expect(svc.guard()).toBe("no Sandbox is running");
    expect(await svc.restore()).toEqual({ ok: false, status: 404, error: "no Sandbox is running" });
    await svc.start(fake([ok(), fail(), ok()]));
    expect(svc.guard()).toBeNull();
    const r = await svc.restore();
    expect(r.ok && r.result.ok).toBe(false);
    expect(svc.guard()).toMatch(/^the last restore failed \(equality\)/);
    await svc.reset();
    expect(svc.guard()).toBeNull();
    expect(seen).toEqual(["start:true", "restore:false", "reset:true"]);
  });

  it("a second restore while one runs is refused", async () => {
    let release!: () => void;
    const s: SandboxLike = { start: async () => ok(), reset: () => new Promise((r) => (release = () => r(ok()))), stop: async () => {} };
    const svc = new SandboxService();
    await svc.start(s);
    const first = svc.restore();
    expect(svc.guard()).toBe("the Sandbox is being reset");
    expect(await svc.restore()).toEqual({ ok: false, status: 409, error: "a reset or restore is already running" });
    release();
    expect((await first).ok).toBe(true);
  });
});
