import { mkdtemp, readFile, rm, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktree, diffWorktree, git, mirrorPath, snapshotWorktree, worktreePath, writePatchArtifact, type MirrorSpec } from "./worktree.js";

let root: string;
let upstream: string;
let dataDir: string;
let spec: MirrorSpec;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "gl-wt-"));
  upstream = join(root, "upstream");
  dataDir = join(root, "data");
  await mkdir(upstream);
  await git(["init", "-q", "-b", "main"], { cwd: upstream });
  await writeFile(join(upstream, "a.txt"), "one\n");
  await writeFile(join(upstream, "b.txt"), "two\n");
  await git(["add", "."], { cwd: upstream });
  await git(["commit", "-q", "-m", "init"], { cwd: upstream });
  const commit = (await git(["rev-parse", "HEAD"], { cwd: upstream })).trim();
  spec = { adapterId: "toy", upstreamUrl: upstream, commit };
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("worktree manager", () => {
  it("clones from the mirror onto graftlab/<taskId> at the pinned commit with the required config", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    expect(wt.path).toBe(worktreePath(dataDir, "t1"));
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: wt.path })).trim()).toBe("graftlab/t1");
    expect((await git(["rev-parse", "HEAD"], { cwd: wt.path })).trim()).toBe(spec.commit);
    expect((await git(["config", "core.fileMode"], { cwd: wt.path })).trim()).toBe("false");
    expect((await git(["config", "core.autocrlf"], { cwd: wt.path })).trim()).toBe("false");
    expect((await git(["rev-parse", "--is-bare-repository"], { cwd: mirrorPath(dataDir, "toy") })).trim()).toBe("true");
    // Self-contained: no alternates file pointing at a host path.
    await expect(readFile(join(wt.path, ".git", "objects", "info", "alternates"), "utf8")).rejects.toThrow();
    // A second call returns the same clone.
    expect(await createWorktree(dataDir, "t1", spec)).toEqual(wt);
  });

  it("fetches into the mirror when the pinned commit is newer", async () => {
    await createWorktree(dataDir, "t1", spec);
    await writeFile(join(upstream, "c.txt"), "three\n");
    await git(["add", "."], { cwd: upstream });
    await git(["commit", "-q", "-m", "more"], { cwd: upstream });
    const newer = (await git(["rev-parse", "HEAD"], { cwd: upstream })).trim();
    const wt = await createWorktree(dataDir, "t2", { ...spec, commit: newer });
    expect((await git(["rev-parse", "HEAD"], { cwd: wt.path })).trim()).toBe(newer);
  });

  it("rejects an unsafe task id and an unknown commit", async () => {
    await expect(createWorktree(dataDir, "../x", spec)).rejects.toThrow("invalid task id");
    await expect(createWorktree(dataDir, "t1", { ...spec, commit: "f".repeat(40) })).rejects.toThrow("not in the upstream");
  });

  it("diff includes added, modified and deleted files and leaves the agent's index untouched", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    await writeFile(join(wt.path, "a.txt"), "changed\n");
    await unlink(join(wt.path, "b.txt"));
    await mkdir(join(wt.path, "new"));
    await writeFile(join(wt.path, "new", "c.txt"), "untracked\n");
    const before = await git(["status", "--porcelain"], { cwd: wt.path });
    const diff = await diffWorktree(wt);
    expect(diff.changedFiles).toEqual([
      { status: "modified", path: "a.txt" },
      { status: "deleted", path: "b.txt" },
      { status: "added", path: "new/c.txt" },
    ]);
    expect(diff.patch).toContain("+changed");
    expect(diff.patch).toContain("+untracked");
    expect(await git(["status", "--porcelain"], { cwd: wt.path })).toBe(before);
  });

  it("diff against the pinned commit also covers commits the agent made", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    await writeFile(join(wt.path, "a.txt"), "committed\n");
    await git(["commit", "-q", "-am", "agent commit"], { cwd: wt.path });
    expect((await diffWorktree(wt)).changedFiles).toEqual([{ status: "modified", path: "a.txt" }]);
  });

  it("writes the Patch_Artifact under docs/patches", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    await writeFile(join(wt.path, "a.txt"), "changed\n");
    const { path } = await writePatchArtifact(dataDir, wt, "S1");
    expect(path).toBe(join(dataDir, "tasks", "t1", "docs", "patches", "S1.patch"));
    expect(await readFile(path, "utf8")).toContain("+changed");
  });

  it("snapshot copies the working tree, records a commit and leaves HEAD alone", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    await writeFile(join(wt.path, "a.txt"), "snap\n");
    await writeFile(join(wt.path, "d.txt"), "new\n");
    const snap = await snapshotWorktree(dataDir, wt, "S1-1");
    expect(await readFile(join(snap.path, "a.txt"), "utf8")).toBe("snap\n");
    expect(await readFile(join(snap.path, "d.txt"), "utf8")).toBe("new\n");
    expect(await readFile(join(snap.path, "b.txt"), "utf8")).toBe("two\n");
    expect((await git(["rev-parse", "HEAD"], { cwd: wt.path })).trim()).toBe(spec.commit);
    expect((await git(["rev-parse", "refs/graftlab/snapshots/S1-1"], { cwd: wt.path })).trim()).toBe(snap.commit);
    expect((await git(["rev-parse", `${snap.commit}^`], { cwd: wt.path })).trim()).toBe(spec.commit);
    await expect(snapshotWorktree(dataDir, wt, "S1-1")).rejects.toThrow("already exists");
  });
});
