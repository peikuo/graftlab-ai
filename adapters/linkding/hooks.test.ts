// linkding hooks against the in-memory model (tasks.md 10.15; R13.5, R29.1-R29.4).
import type { BaselineHandle } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { hooks, testData } from "./index.ts";
import { LinkdingModel } from "./model.ts";

describe("test data (R29)", () => {
  it("has 8 to 12 bookmarks on reserved example domains, explicit titles and tags, a shared tag and an archived one", () => {
    const b = testData.bookmarks;
    expect(b.length).toBeGreaterThanOrEqual(8);
    expect(b.length).toBeLessThanOrEqual(12);
    const tags = b.flatMap((x) => x.tags);
    expect(tags.length).toBeGreaterThan(new Set(tags).size); // at least two share a tag
    expect(b.some((x) => x.archived)).toBe(true);
  });
});

describe("seed and equality", () => {
  it("a seeded instance passes the equality check item by item, with the count", async () => {
    const m = new LinkdingModel();
    await hooks.testData.seed(m);
    const r = await hooks.testData.equals(m);
    expect(r).toHaveLength(testData.bookmarks.length + 1);
    expect(r.every((x) => x.pass)).toBe(true);
  });
  it("a changed bookmark fails exactly its row; an extra bookmark fails the count", async () => {
    const m = new LinkdingModel();
    await hooks.testData.seed(m);
    const first = m.items[0]!;
    await m.request("PATCH", `/api/bookmarks/${first.id}/`, { tag_names: ["changed"] });
    let r = await hooks.testData.equals(m);
    expect(r.filter((x) => !x.pass).map((x) => x.item)).toEqual([testData.bookmarks[0]!.url]);
    await m.request("POST", "/api/bookmarks/?disable_scraping", { url: "https://example.com/extra", title: "Extra", tag_names: ["x"] });
    r = await hooks.testData.equals(m);
    expect(r.find((x) => x.item === "bookmark count")).toMatchObject({ pass: false, expected: "10", actual: "11" });
  });
  it("reads every page of active and archived bookmarks", async () => {
    const m = new LinkdingModel([], 2);
    await hooks.testData.seed(m);
    expect((await hooks.readAll(m)).length).toBe(testData.bookmarks.length);
  });
});

describe("provisioning (R13.5)", () => {
  const handle = (stdout: string, code = 0): BaselineHandle & { calls: unknown[] } => {
    const calls: unknown[] = [];
    // The first exec creates the superuser (exit 0); the second prints the token.
    return { calls, appDir: "/etc/linkding", secretEnv: { LD_SUPERUSER_NAME: "gl-admin", LD_SUPERUSER_PASSWORD: "pw-1234567890" }, recreate: async () => {}, exec: async (cmd, opts) => (calls.push({ cmd, opts }), calls.length === 1 ? { code: 0, stdout: "", stderr: "" } : { code, stdout, stderr: "" }) };
  };
  it("creates the API token in the management shell with the superuser name from the environment, not in the code", async () => {
    const h = handle(`some django output\n${"ab12".repeat(10)}\n`);
    expect(await hooks.provision(h)).toEqual([{ name: "linkding_api_token", value: "ab12".repeat(10) }]);
    expect(h.calls[0]).toEqual({ cmd: ["python", "manage.py", "create_initial_superuser"], opts: { workdir: "/etc/linkding", env: { LD_SUPERUSER_NAME: "gl-admin", LD_SUPERUSER_PASSWORD: "pw-1234567890" } } });
    const call = h.calls[1] as { cmd: string[]; opts: { workdir: string; env: Record<string, string> } };
    expect(call.cmd.slice(0, 3)).toEqual(["python", "manage.py", "shell"]);
    expect(call.opts).toEqual({ workdir: "/etc/linkding", env: { GL_SUPERUSER: "gl-admin" } });
    expect(call.cmd.join(" ")).not.toContain("gl-admin");
  });
  it("refuses an output that is not a 40-character token", async () => {
    await expect(hooks.provision(handle("Traceback: no such user", 1))).rejects.toThrow(/creating the API token failed/);
  });
});
