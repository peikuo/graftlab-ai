import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SecretRegistry } from "@graftlab/shared";
import { createStudio } from "../http/app.ts";
import { publishedReplays, publishReplay } from "./export.ts";

const replay = (taskId: string, extra = "") => JSON.stringify({ header: { schemaVersion: 1, taskId, repo: "o/r", runtimeRulesVersion: "x", createdAt: "2026-11-26T00:00:00Z", label: "Replay" }, events: [{ type: "finding_recorded", payload: { text: `hello ${extra}` } }, { type: "terminal_reached", payload: { terminal: "success" } }] });

describe("automatic Replay publishing (R27.15)", () => {
  it("lists a clean Replay and refuses one with private facts, naming only the rule", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gl-pub-"));
    await mkdir(join(dir, "replays"), { recursive: true });
    await writeFile(join(dir, "replays", "a.json"), replay("a"));
    await writeFile(join(dir, "replays", "b.json"), replay("b", "D:\\\\graftlab\\\\data"));
    expect(await publishReplay(dir, join(dir, "replays", "a.json"))).toEqual({ ok: true });
    const bad = await publishReplay(dir, join(dir, "replays", "b.json"));
    expect(bad).toEqual({ ok: false, problems: ["private: Windows drive path"] });
    expect(await publishedReplays(dir)).toEqual([{ taskId: "a", repo: "o/r", terminal: "success", createdAt: "2026-11-26T00:00:00Z" }]);
    const studio = createStudio({ secrets: new SecretRegistry(), heartbeatMs: 60_000, dataDir: dir, publishReplays: true });
    const pub = (url: string) => studio.app.inject({ method: "GET", url, headers: { "x-gl-public": "https" } });
    expect((await studio.app.inject({ method: "GET", url: "/api/replays" })).json()).toHaveLength(1);
    expect((await pub("/replays/a.json")).statusCode).toBe(200);
    expect((await pub("/replays/b.json")).statusCode).toBe(404);
    // Local work (no X-GL-Public) still plays every exported Replay.
    expect((await studio.app.inject({ method: "GET", url: "/replays/b.json" })).statusCode).toBe(200);
    await studio.app.close();
  });
});
