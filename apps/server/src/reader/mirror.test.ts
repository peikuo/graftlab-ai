import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { git } from "../worktree/worktree.ts";
import { MirrorSource } from "./mirror.ts";

let root = "";
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe("MirrorSource (R10.1)", () => {
  it("lists the tree and reads files at the pinned commit, not at a later one", async () => {
    root = await mkdtemp(join(tmpdir(), "gl-mirror-"));
    const up = join(root, "up");
    await mkdir(join(up, "docs"), { recursive: true });
    await writeFile(join(up, "README.md"), "pinned\n");
    await writeFile(join(up, "docs", "a b.md"), "space\n");
    await git(["init", "-q", "-b", "main"], { cwd: up });
    await git(["add", "."], { cwd: up });
    await git(["commit", "-q", "-m", "one"], { cwd: up });
    const pinned = (await git(["rev-parse", "HEAD"], { cwd: up })).trim();
    await writeFile(join(up, "README.md"), "later\n");
    await git(["commit", "-qam", "two"], { cwd: up });
    const m = new MirrorSource(join(root, "data"), { adapterId: "toy", upstreamUrl: up, commit: pinned });
    const meta = { owner: "o", repo: "r", defaultBranch: "main", sha: pinned };
    const tree = await m.tree(meta);
    expect(tree.entries.map((e) => e.path).sort()).toEqual(["README.md", "docs/a b.md"]);
    expect(tree.entries.find((e) => e.path === "README.md")?.size).toBe(7);
    expect(new TextDecoder().decode(await m.file(meta, "README.md"))).toBe("pinned\n");
  });
});
