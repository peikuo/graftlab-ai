// Replay export and its second secret scan (tasks.md 9.1, 9.2; R27.11-R27.13, R30.15).
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretRegistry, type StudioEvent } from "@graftlab/shared";
import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { exportReplay } from "./export.ts";

const dirs: string[] = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), "gl-replay-"));
  dirs.push(d);
  return d;
};
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
const event = (seq: number, text: string): StudioEvent => ({ v: 1, seq, ts: new Date(Date.UTC(2026, 10, 24, 10, 0, seq)).toISOString(), taskId: "t1", node: "meeting", actor: { kind: "system" }, type: "finding_recorded", payload: { kind: "note", text, evidence: [], evidenceStatus: "none" } }) as StudioEvent;

describe("Replay export", () => {
  // Feature: graftlab-ai, Property 12: Secret redaction (the exported Replay_File: a registered value or a common key pattern anywhere refuses the export and writes no file; otherwise the file holds no secret)
  it("never writes a Replay_File that contains a registered secret or a key pattern", async () => {
    const piece = fc.oneof(fc.string({ maxLength: 16 }), fc.constantFrom("REGISTERED", "PATTERN"));
    await fc.assert(
      fc.asyncProperty(fc.stringMatching(/^zq[a-z0-9]{12,18}$/), fc.array(fc.array(piece, { maxLength: 4 }), { minLength: 1, maxLength: 6 }), async (secret, texts) => {
        const registry = new SecretRegistry();
        registry.register("llm_key", secret);
        const pattern = `sk-${"a1".repeat(12)}`;
        const events = texts.map((parts, i) => event(i + 1, parts.map((p) => (p === "REGISTERED" ? secret : p === "PATTERN" ? pattern : p)).join(" ")));
        const leaked = texts.flat().some((p) => p === "REGISTERED" || p === "PATTERN");
        const dataDir = await tmp();
        const publicDir = join(dataDir, "public");
        const r = await exportReplay({ events, repo: "o/r", runtimeRulesVersion: "0.1.0", registry, dataDir, publicDir });
        expect(r.ok).toBe(!leaked);
        const written = await readdir(join(dataDir, "replays")).catch(() => []);
        if (leaked) {
          expect(written).toEqual([]);
          if (!r.ok) expect(r.found.join()).not.toContain(secret); // names only, never the value
        } else {
          const text = await readFile(join(dataDir, "replays", "t1.json"), "utf8");
          expect(text.includes(secret)).toBe(false);
          expect(JSON.parse(text).header).toMatchObject({ schemaVersion: 1, taskId: "t1", label: "Replay" });
          expect(JSON.parse(await readFile(join(publicDir, "index.json"), "utf8"))[0]).toMatchObject({ taskId: "t1", repo: "o/r" });
        }
      }),
      { numRuns: 100 },
    );
  });
});
describe("Replay screenshots (R26)", () => {
  it("copies the screenshots the events name next to the Replay_File", async () => {
    const { mkdtemp, mkdir, writeFile, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { SecretRegistry } = await import("@graftlab/shared");
    const { exportReplay, screenshotNames } = await import("./export.ts");
    const dataDir = await mkdtemp(join(tmpdir(), "gl-rp-"));
    const publicDir = join(dataDir, "public");
    await mkdir(join(dataDir, "tasks", "t1", "artifacts", "shots"), { recursive: true });
    await writeFile(join(dataDir, "tasks", "t1", "artifacts", "shots", "explore-001.jpg"), "x");
    const base = { v: 1 as const, taskId: "t1", node: "browser_experience" as const, ts: "2026-11-25T00:00:00.000Z" };
    const events = [
      { ...base, seq: 1, actor: { kind: "system" as const }, type: "task_created" as const, payload: { url: "u", owner: "o", repo: "r", repoKind: "adapted" as const, runtimeRulesVersion: "1" } },
      { ...base, seq: 2, actor: { kind: "role" as const, roleId: "explorer" as const }, type: "browser_observation" as const, payload: { snapshotSummary: "s", screenshotRef: "artifacts/shots/explore-001.jpg" } },
      { ...base, seq: 3, actor: { kind: "role" as const, roleId: "explorer" as const }, type: "browser_observation" as const, payload: { snapshotSummary: "s", screenshotRef: "artifacts/shots/../../x.jpg" } },
    ];
    expect(screenshotNames(events as never)).toEqual(["explore-001.jpg", "x.jpg"]);
    const r = await exportReplay({ events: events as never, repo: "o/r", runtimeRulesVersion: "1", registry: new SecretRegistry(), dataDir, publicDir });
    expect(r).toMatchObject({ ok: true, shots: 1 });
    expect(await readdir(join(publicDir, "t1", "shots"))).toEqual(["explore-001.jpg"]);
  });
});
