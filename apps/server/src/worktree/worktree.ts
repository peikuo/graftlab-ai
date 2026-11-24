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
  /**
   * Where the mirror is cloned and fetched from instead of the upstream: a local path or a git bundle, for hosts
   * where large clones are unreliable (reference-deployment.md, "Network facts"). Set by `GL_MIRROR_SOURCE_<ID>`.
   */
  source?: string;
}

/** The mirror source override for an Adapter from the environment (`GL_MIRROR_SOURCE_LINKDING`), if any. */
export function mirrorSourceFromEnv(adapterId: string, env: Record<string, string | undefined> = process.env): string | undefined {
  return env[`GL_MIRROR_SOURCE_${adapterId.toUpperCase().replace(/-/g, "_")}`] || undefined;
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
    await git(["clone", "--mirror", "--", spec.source ?? spec.upstreamUrl, path]);
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
  // R38.10: the pinned commit is the Task's `main`; Features branch off it and merge back.
  const branch = "main";
  const wt = { taskId, path, branch, base: spec.commit };
  if (await exists(join(path, ".git"))) return wt;
  const mirror = await ensureMirror(dataDir, spec);
  await mkdir(dirname(path), { recursive: true });
  // No --shared alternates and no hardlinks: the clone must be self-contained when bind-mounted into a container.
  await git(["clone", "--no-hardlinks", "--no-checkout", "--config", "core.fileMode=false", "--config", "core.autocrlf=false", "--", mirror, path]);
  // A fresh clone may already have a local `main` (the upstream default branch); point it at the pinned commit.
  await git(["checkout", "-q", "-B", branch, spec.commit], { cwd: path });
  return wt;
}

/** Runs `fn` with a fresh temporary index that holds the whole working tree (tracked and untracked files). */
async function withWorkingIndex<T>(wt: Worktree, fn: (env: Record<string, string>) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "gl-index-"));
  const env = { GIT_INDEX_FILE: join(dir, "index") };
  try {
    await git(["read-tree", "HEAD"], { cwd: wt.path, env });
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

/**
 * Changed files and diff of the working tree against `base` (default: the pinned commit), including untracked
 * files (design step 3, R38.5). For a Feature, `base` is the commit of `main` the Feature started from.
 */
export async function diffWorktree(wt: Worktree, base = wt.base): Promise<WorktreeDiff> {
  return withWorkingIndex(wt, async (env) => {
    const names = await git(["diff", "--cached", "--no-renames", "--name-status", "-z", base], { cwd: wt.path, env });
    const patch = await git(["diff", "--cached", "--no-renames", "--binary", base], { cwd: wt.path, env });
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

/**
 * Paths among `paths` that the target's own ignore rules do NOT ignore. The Adapter's `prebuilt` paths must all be
 * ignored, so the copies made at sandbox start never reach a diff, a snapshot or a Patch_Artifact (design: Images).
 */
export async function notIgnored(wt: Worktree, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  // --no-index: decide by the ignore rules alone, also for paths that do not exist yet. A path that does not exist
  // cannot be known to be a directory, so it is also asked with a trailing slash ("node_modules/" rules).
  const asked = paths.flatMap((p) => [p, `${p.replace(/\/+$/, "")}/`]);
  const out = await git(["check-ignore", "--no-index", "--", ...asked], { cwd: wt.path }).catch((e: unknown) => {
    if (e instanceof GitError && e.code === 1) return ""; // exit 1: none of the paths is ignored
    throw e;
  });
  const ignored = new Set(out.split("\n").filter(Boolean));
  return paths.filter((p) => !ignored.has(p) && !ignored.has(`${p.replace(/\/+$/, "")}/`));
}

// ---- Feature branches (R38.10) ----

export interface FeatureBranch {
  featureId: string;
  branch: string;
  /** The commit of `main` the Feature started from; its diff is taken against it. */
  base: string;
}

const head = async (wt: Worktree, ref = "HEAD") => (await git(["rev-parse", ref], { cwd: wt.path })).trim();

/** Starts (or resumes) `feature/<id>` from the current `main`. */
export async function startFeature(wt: Worktree, featureId: string): Promise<FeatureBranch> {
  check(featureId, "Feature id");
  const branch = `feature/${featureId}`;
  const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: wt.path }).then(() => true, () => false);
  if (exists) {
    await git(["checkout", "-q", branch], { cwd: wt.path });
    return { featureId, branch, base: (await git(["merge-base", "main", branch], { cwd: wt.path })).trim() };
  }
  await git(["checkout", "-q", "main"], { cwd: wt.path });
  const base = await head(wt);
  await git(["checkout", "-q", "-b", branch], { cwd: wt.path });
  return { featureId, branch, base };
}

/** Commits everything left in the working tree on the Feature branch (the Code_Agent may have committed already). */
export async function commitFeature(wt: Worktree, f: FeatureBranch, message: string): Promise<string | null> {
  await git(["add", "-A", "--", "."], { cwd: wt.path });
  const staged = await git(["diff", "--cached", "--name-only"], { cwd: wt.path });
  if (!staged.trim()) return null;
  await git(["commit", "-q", "--no-verify", "-m", message], { cwd: wt.path });
  return head(wt);
}

export type MergeResult = { ok: true; commit: string } | { ok: false; reason: string };

/** Merges the Feature into `main` with a merge commit; a conflict is aborted and reported, `main` stays as it was. */
export async function mergeFeature(wt: Worktree, f: FeatureBranch, title: string): Promise<MergeResult> {
  await commitFeature(wt, f, `${f.featureId}: work in progress`);
  await git(["checkout", "-q", "main"], { cwd: wt.path });
  try {
    await git(["merge", "--no-ff", "--no-verify", "-q", "-m", `Merge Feature ${f.featureId}: ${title}`, f.branch], { cwd: wt.path });
    return { ok: true, commit: await head(wt) };
  } catch (e) {
    await git(["merge", "--abort"], { cwd: wt.path }).catch(() => undefined);
    return { ok: false, reason: `merging ${f.branch} into main failed: ${(e as Error).message}` };
  }
}

/** Leaves a failed Feature unmerged: its state is kept on its branch, and `main` is checked out clean. */
export async function abandonFeature(wt: Worktree, f: FeatureBranch): Promise<void> {
  await commitFeature(wt, f, `${f.featureId}: unfinished (not merged)`);
  await git(["checkout", "-q", "main"], { cwd: wt.path });
}

/** Files `main` changed since the pinned commit (the work of earlier Features). */
export async function changedOnMain(wt: Worktree): Promise<string[]> {
  return (await git(["diff", "--name-only", wt.base, "main"], { cwd: wt.path })).split("\n").filter(Boolean);
}

/** Every tracked path of `main`. */
export async function pathsOnMain(wt: Worktree): Promise<string[]> {
  return (await git(["ls-tree", "-r", "--name-only", "main"], { cwd: wt.path })).split("\n").filter(Boolean);
}
