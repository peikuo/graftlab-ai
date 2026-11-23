// Worktree manager (design: Worktree manager, Development stage steps 3 and 7; R25.6, R38.1, R38.5, R38.6, R38.9).
// One bare mirror per Adapter, one local clone per Task (never a linked `git worktree`, whose metadata holds
// host-absolute paths that do not resolve inside a container). Diffs and snapshots use a temporary index
// (`GIT_INDEX_FILE`) so untracked files are included and the Code_Agent's own index is untouched.
// Nothing is ever pushed.
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const COMMIT = /^[0-9a-f]{40}$/;

/** Fixed identity for snapshot commits, so no host git identity is read or needed. */
const GIT_ENV = {
  GIT_AUTHOR_NAME: "GraftLab Studio",
  GIT_AUTHOR_EMAIL: "studio@graftlab.invalid",
  GIT_COMMITTER_NAME: "GraftLab Studio",
  GIT_COMMITTER_EMAIL: "studio@graftlab.invalid",
  GIT_TERMINAL_PROMPT: "0",
};

export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly code: number | null,
    stderr: string,
  ) {
    // The message names the git subcommand and the first stderr line only (no environment, no URL credentials).
    super(`git ${args[0] ?? ""} failed (exit ${code ?? "?"}): ${stderr.split("\n")[0]?.slice(0, 200) ?? ""}`);
  }
}

export function git(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { cwd: opts.cwd, env: { ...process.env, ...GIT_ENV, ...opts.env }, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) reject(new GitError(args, typeof err.code === "number" ? err.code : null, String(stderr)));
        else resolve(String(stdout));
      },
    );
  });
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

function check(id: string, what: string): void {
  if (!SAFE_ID.test(id)) throw new Error(`invalid ${what}`);
}

export interface MirrorSpec {
  adapterId: string;
  /** The Adapter's upstream repository (or a local path in tests). */
  upstreamUrl: string;
  /** The pinned commit, 40 hex characters. */
  commit: string;
}

export function mirrorPath(dataDir: string, adapterId: string): string {
  check(adapterId, "adapter id");
  return join(dataDir, "mirror", `${adapterId}.git`);
}

export function worktreePath(dataDir: string, taskId: string): string {
  check(taskId, "task id");
  return join(dataDir, "tasks", taskId, "work");
}

async function hasCommit(repo: string, commit: string): Promise<boolean> {
  return git(["cat-file", "-e", `${commit}^{commit}`], { cwd: repo }).then(
    () => true,
    () => false,
  );
}

/** Creates the bare mirror once; fetches when the pinned commit is missing. Returns the mirror path. */
export async function ensureMirror(dataDir: string, spec: MirrorSpec): Promise<string> {
  if (!COMMIT.test(spec.commit)) throw new Error("the pinned commit must be 40 hex characters");
  const path = mirrorPath(dataDir, spec.adapterId);
  if (!(await exists(path))) {
    await mkdir(dirname(path), { recursive: true });
    await git(["clone", "--mirror", "--", spec.upstreamUrl, path]);
  }
  if (!(await hasCommit(path, spec.commit))) {
    await git(["fetch", "--prune", "origin"], { cwd: path });
    if (!(await hasCommit(path, spec.commit))) throw new Error("the pinned commit is not in the upstream repository");
  }
  return path;
}

export interface Worktree {
  taskId: string;
  path: string;
  branch: string;
  /** The pinned commit every diff is taken against. */
  base: string;
}

/**
 * Creates the per-Task clone on branch `graftlab/<taskId>` at the pinned commit (R38.9: one per Task, created when
 * the flow first needs it). Calling it again returns the existing clone.
 */
export async function createWorktree(dataDir: string, taskId: string, spec: MirrorSpec): Promise<Worktree> {
  const path = worktreePath(dataDir, taskId);
  const branch = `graftlab/${taskId}`;
  const wt = { taskId, path, branch, base: spec.commit };
  if (await exists(join(path, ".git"))) return wt;
  const mirror = await ensureMirror(dataDir, spec);
  await mkdir(dirname(path), { recursive: true });
  // No --shared alternates and no hardlinks: the clone must be self-contained when bind-mounted into a container.
  await git(["clone", "--no-hardlinks", "--no-checkout", "--config", "core.fileMode=false", "--config", "core.autocrlf=false", "--", mirror, path]);
  await git(["checkout", "-q", "-b", branch, spec.commit], { cwd: path });
  return wt;
}

/** Runs `fn` with a fresh temporary index that holds the whole working tree (tracked and untracked files). */
async function withWorkingIndex<T>(wt: Worktree, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gl-index-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    await git(["read-tree", wt.base], { cwd: wt.path, env });
    await git(["add", "-A", "--", "."], { cwd: wt.path, env });
    return await fn(env);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface ChangedFile {
  status: "added" | "modified" | "deleted";
  path: string;
}

const STATUS: Record<string, ChangedFile["status"]> = { A: "added", M: "modified", D: "deleted", T: "modified" };

function parseNameStatus(out: string): ChangedFile[] {
  // -z output: status NUL path NUL ...; renames are off (--no-renames), so every entry has one path.
  const parts = out.split("\0").filter((p) => p !== "");
  const files: ChangedFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const status = STATUS[parts[i]![0]!] ?? "modified";
    files.push({ status, path: parts[i + 1]! });
  }
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export interface WorktreeDiff {
  changedFiles: ChangedFile[];
  /** Unified diff against the pinned commit, binary-safe. */
  patch: string;
}

/** Changed files and diff against the pinned commit, including untracked files (design step 3, R38.5). */
export async function diffWorktree(wt: Worktree): Promise<WorktreeDiff> {
  return withWorkingIndex(wt, async (env) => {
    const names = await git(["diff", "--cached", "--no-renames", "--name-status", "-z", wt.base], { cwd: wt.path, env });
    const patch = await git(["diff", "--cached", "--no-renames", "--binary", wt.base], { cwd: wt.path, env });
    return { changedFiles: parseNameStatus(names), patch };
  });
}

/** Writes the Patch_Artifact to `data/tasks/<id>/docs/patches/<storyId>.patch` (R38.6). Returns the path. */
export async function writePatchArtifact(dataDir: string, wt: Worktree, storyId: string): Promise<{ path: string; diff: WorktreeDiff }> {
  check(storyId, "story id");
  const diff = await diffWorktree(wt);
  const path = join(dataDir, "tasks", wt.taskId, "docs", "patches", `${storyId}.patch`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, diff.patch, "utf8");
  return { path, diff };
}

export interface Snapshot {
  /** Commit that records the snapshot tree (parent: the pinned commit); kept under `refs/graftlab/snapshots/`. */
  commit: string;
  path: string;
}

/**
 * Copies the current working tree to `data/tasks/<id>/snapshots/<label>/` and records it as a commit, without
 * touching the Worktree's branch, HEAD or index (design step 7, R39.6, R39.7). The caller mounts the copy read-only.
 */
export async function snapshotWorktree(dataDir: string, wt: Worktree, label: string): Promise<Snapshot> {
  check(label, "snapshot label");
  const path = join(dataDir, "tasks", wt.taskId, "snapshots", label);
  if (await exists(path)) throw new Error(`snapshot ${label} already exists`);
  return withWorkingIndex(wt, async (env) => {
    const tree = (await git(["write-tree"], { cwd: wt.path, env })).trim();
    const commit = (await git(["commit-tree", tree, "-p", wt.base, "-m", `snapshot ${label}`], { cwd: wt.path, env })).trim();
    await git(["update-ref", `refs/graftlab/snapshots/${label}`, commit], { cwd: wt.path });
    await mkdir(path, { recursive: true });
    // checkout-index writes the index content into another directory; the trailing separator is required.
    await git(["checkout-index", "-a", "-f", `--prefix=${path}/`], { cwd: wt.path, env });
    return { commit, path };
  });
}
