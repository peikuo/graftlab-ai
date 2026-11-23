import { mkdtemp, readFile, rm, unlink, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { abandonFeature, createWorktree, diffWorktree, mergeFeature, startFeature, git, mirrorPath, mirrorSourceFromEnv, notIgnored, snapshotWorktree, worktreePath, writePatchArtifact, type MirrorSpec } from "./worktree.js";

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
  it("clones from the mirror onto main at the pinned commit with the required config", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    expect(wt.path).toBe(worktreePath(dataDir, "t1"));
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: wt.path })).trim()).toBe("main");
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

  it("creates the mirror from a git bundle when a source override is set", async () => {
    await git(["tag", "v1"], { cwd: upstream });
    const bundle = join(root, "up.bundle");
    await git(["bundle", "create", bundle, "v1"], { cwd: upstream });
    const wt = await createWorktree(dataDir, "t1", { ...spec, upstreamUrl: "https://example.invalid/repo", source: bundle });
    expect((await git(["rev-parse", "HEAD"], { cwd: wt.path })).trim()).toBe(spec.commit);
    expect(mirrorSourceFromEnv("link-ding", { GL_MIRROR_SOURCE_LINK_DING: bundle })).toBe(bundle);
    expect(mirrorSourceFromEnv("linkding", {})).toBeUndefined();
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

  it("reports prebuilt paths that the target's ignore rules do not ignore, and ignored copies stay out of the diff", async () => {
    await writeFile(join(upstream, ".gitignore"), "node_modules/\n/static/bundle.js*\n");
    await git(["add", "."], { cwd: upstream });
    await git(["commit", "-q", "-m", "ignore"], { cwd: upstream });
    const commit = (await git(["rev-parse", "HEAD"], { cwd: upstream })).trim();
    const wt = await createWorktree(dataDir, "t3", { ...spec, commit });
    expect(await notIgnored(wt, ["node_modules", "static/bundle.js", "static/bundle.js.map", "a.txt"])).toEqual(["a.txt"]);
    expect(await notIgnored(wt, ["a.txt"])).toEqual(["a.txt"]);
    await mkdir(join(wt.path, "node_modules", "x"), { recursive: true });
    await writeFile(join(wt.path, "node_modules", "x", "i.js"), "1");
    expect((await diffWorktree(wt)).changedFiles).toEqual([]);
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

  it("a Feature is built on its branch, diffed against its base and merged into main with a merge commit", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    const f1 = await startFeature(wt, "F1");
    expect(f1).toMatchObject({ branch: "feature/F1", base: spec.commit });
    await writeFile(join(wt.path, "a.txt"), "f1\n");
    expect((await diffWorktree(wt, f1.base)).changedFiles).toEqual([{ status: "modified", path: "a.txt" }]);
    const m1 = await mergeFeature(wt, f1, "change a");
    expect(m1.ok).toBe(true);
    expect((await git(["rev-parse", "--abbrev-ref", "HEAD"], { cwd: wt.path })).trim()).toBe("main");
    expect((await git(["log", "-1", "--format=%s %p"], { cwd: wt.path })).trim()).toMatch(/^Merge Feature F1: change a [0-9a-f]+ [0-9a-f]+$/);
    // The next Feature starts from the merged main and sees only its own change.
    const f2 = await startFeature(wt, "F2");
    expect(f2.base).toBe(m1.ok ? m1.commit : "");
    await writeFile(join(wt.path, "b.txt"), "f2\n");
    expect((await diffWorktree(wt, f2.base)).changedFiles).toEqual([{ status: "modified", path: "b.txt" }]);
    // The Task's patch covers main against the pinned commit.
    expect((await diffWorktree(wt)).changedFiles.map((c) => c.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("an abandoned Feature stays on its branch and main stays at the last merged state", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    const f1 = await startFeature(wt, "F1");
    await writeFile(join(wt.path, "a.txt"), "broken\n");
    await abandonFeature(wt, f1);
    expect(await readFile(join(wt.path, "a.txt"), "utf8")).toBe("one\n");
    expect((await git(["rev-parse", "main"], { cwd: wt.path })).trim()).toBe(spec.commit);
    expect((await git(["show", "feature/F1:a.txt"], { cwd: wt.path }))).toBe("broken\n");
  });

  it("a merge conflict is aborted and reported; main is unchanged", async () => {
    const wt = await createWorktree(dataDir, "t1", spec);
    const f1 = await startFeature(wt, "F1");
    await writeFile(join(wt.path, "a.txt"), "from F1\n");
    await git(["commit", "-qam", "F1"], { cwd: wt.path });
    await git(["checkout", "-q", "main"], { cwd: wt.path });
    await writeFile(join(wt.path, "a.txt"), "from main\n");
    await git(["commit", "-qam", "main moved"], { cwd: wt.path });
    const before = (await git(["rev-parse", "main"], { cwd: wt.path })).trim();
    const m = await mergeFeature(wt, f1, "conflict");
    expect(m.ok).toBe(false);
    expect((await git(["rev-parse", "main"], { cwd: wt.path })).trim()).toBe(before);
    expect((await git(["status", "--porcelain"], { cwd: wt.path })).trim()).toBe("");
  });
});
