// Open execution (R42): the repository's source as a local git repository (from the commit's tarball, because
// large clones are unreliable on some hosts) and the image built through the engine API from the generated context.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DockerClient } from "../containers/docker.ts";
const run = promisify(execFile);
const SAFE = /^[A-Za-z0-9._-]{1,100}$/;

/** Downloads the commit's tarball once and commits it into a local repository; returns its path and commit. */
export async function prepareSource(dataDir: string, o: { owner: string; repo: string; sha: string; fetchFn?: typeof fetch }): Promise<{ path: string; commit: string }> {
  if (!SAFE.test(o.owner) || !SAFE.test(o.repo) || !/^[0-9a-f]{40}$/.test(o.sha)) throw new Error("invalid repository name or commit");
  const dir = join(dataDir, "open", `${o.owner}-${o.repo}-${o.sha.slice(0, 12)}`.toLowerCase());
  const repo = join(dir, "repo");
  const gitEnv = { ...process.env, GIT_AUTHOR_NAME: "GraftLab Studio", GIT_AUTHOR_EMAIL: "studio@graftlab.invalid", GIT_COMMITTER_NAME: "GraftLab Studio", GIT_COMMITTER_EMAIL: "studio@graftlab.invalid" };
  if (existsSync(join(repo, ".git"))) {
    const { stdout } = await run("git", ["-C", repo, "rev-parse", "HEAD"]);
    return { path: repo, commit: stdout.trim() };
  }
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, "x"), { recursive: true });
  const res = await (o.fetchFn ?? fetch)(`https://codeload.github.com/${o.owner}/${o.repo}/tar.gz/${o.sha}`);
  if (!res.ok) throw new Error(`downloading the source failed (HTTP ${res.status})`);
  const tgz = join(dir, "src.tar.gz");
  await writeFile(tgz, Buffer.from(await res.arrayBuffer()));
  await run("tar", ["-xzf", tgz, "-C", join(dir, "x")], { maxBuffer: 64 * 1024 * 1024 });
  const top = (await readdir(join(dir, "x")))[0];
  if (!top) throw new Error("the source archive is empty");
  await run("git", ["init", "-q", "-b", "main", join(dir, "x", top)]);
  const src = join(dir, "x", top);
  await run("git", ["-C", src, "config", "core.autocrlf", "false"]);
  await run("git", ["-C", src, "add", "-A", "-f", "."], { maxBuffer: 64 * 1024 * 1024 });
  await run("git", ["-C", src, "commit", "-q", "-m", `Source of ${o.owner}/${o.repo} at ${o.sha} (GitHub tarball)`], { env: gitEnv });
  await run("git", ["clone", "-q", "--no-hardlinks", src, repo]);
  await rm(join(dir, "x"), { recursive: true, force: true });
  await rm(tgz, { force: true });
  const { stdout } = await run("git", ["-C", repo, "rev-parse", "HEAD"]);
  return { path: repo, commit: stdout.trim() };
}

/** Writes the build context (Dockerfile, setup.sh, target-src/) and builds it; returns the engine's result. */
export async function buildOpenImage(docker: DockerClient, o: { dir: string; repo: string; commit: string; dockerfile: string; setup: string; tag: string; buildArgs: Record<string, string> }): Promise<{ ok: boolean; log: string[] }> {
  await rm(o.dir, { recursive: true, force: true });
  await mkdir(join(o.dir, "target-src"), { recursive: true });
  await writeFile(join(o.dir, "Dockerfile"), o.dockerfile);
  await writeFile(join(o.dir, "setup.sh"), o.setup);
  const archive = join(o.dir, "..", `${o.tag.replace(/[^a-z0-9]/g, "-")}-src.tar`);
  await run("git", ["-C", o.repo, "archive", "--format=tar", "-o", archive, o.commit]);
  await run("tar", ["-xf", archive, "-C", join(o.dir, "target-src")], { maxBuffer: 64 * 1024 * 1024 });
  await rm(archive, { force: true });
  const { stdout } = await run("tar", ["-cf", "-", "-C", o.dir, "."], { encoding: "buffer", maxBuffer: 1024 * 1024 * 1024 });
  return docker.build(stdout as unknown as Buffer, o.tag, o.buildArgs);
}
