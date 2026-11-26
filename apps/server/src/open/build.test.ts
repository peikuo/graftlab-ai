import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DockerClient } from "../containers/docker.ts";
import { buildOpenImage, prepareSource } from "./build.ts";

const SHA = "a".repeat(40);
async function tarball(): Promise<Buffer> {
  const d = await mkdtemp(join(tmpdir(), "gl-open-src-"));
  await mkdir(join(d, "proj-aaaa", "pkg"), { recursive: true });
  await writeFile(join(d, "proj-aaaa", "setup.py"), "from setuptools import setup\n");
  await writeFile(join(d, "proj-aaaa", "pkg", "__init__.py"), "X = 1\n");
  await writeFile(join(d, "proj-aaaa", ".gitignore"), "*.log\n");
  await writeFile(join(d, "proj-aaaa", "keep.log"), "ignored by the project but part of the tarball\n");
  execFileSync("tar", ["-czf", join(d, "t.tgz"), "-C", d, "proj-aaaa"]);
  return readFile(join(d, "t.tgz"));
}

describe("open execution source and build context (R42)", () => {
  it("commits the commit's tarball into a local repository once, and builds a context with the source", async () => {
    const data = await mkdtemp(join(tmpdir(), "gl-open-data-"));
    const tgz = await tarball();
    let downloads = 0;
    const fetchFn = (async (url: string) => {
      downloads++;
      expect(url).toBe(`https://codeload.github.com/o/proj/tar.gz/${SHA}`);
      return new Response(tgz);
    }) as unknown as typeof fetch;
    const a = await prepareSource(data, { owner: "o", repo: "proj", sha: SHA, fetchFn });
    const b = await prepareSource(data, { owner: "o", repo: "proj", sha: SHA, fetchFn });
    expect(b).toEqual(a);
    expect(downloads).toBe(1);
    expect(execFileSync("git", ["-C", a.path, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean).sort()).toEqual([".gitignore", "keep.log", "pkg/__init__.py", "setup.py"]);
    let sent: { tag: string; args: Record<string, string>; files: string[] } | null = null;
    const docker = {
      build: async (ctx: Buffer, tag: string, args: Record<string, string>) => {
        const files = execFileSync("tar", ["-tf", "-"], { input: ctx, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
        sent = { tag, args, files };
        return { ok: true, log: ["done"] };
      },
    } as unknown as DockerClient;
    const r = await buildOpenImage(docker, { dir: join(data, "ctx"), repo: a.path, commit: a.commit, dockerfile: "FROM x\n", setup: "#!/bin/sh\n", tag: "graftlab/open-t1:latest", buildArgs: { PYPI_INDEX: "https://pypi.example/simple" } });
    expect(r.ok).toBe(true);
    expect(sent!.tag).toBe("graftlab/open-t1:latest");
    expect(sent!.args).toEqual({ PYPI_INDEX: "https://pypi.example/simple" });
    expect(sent!.files).toEqual(expect.arrayContaining(["Dockerfile", "setup.sh", "target-src/setup.py", "target-src/pkg/__init__.py"]));
  });
  it("refuses unsafe names before any download", async () => {
    await expect(prepareSource("/tmp", { owner: "o/../x", repo: "r", sha: SHA })).rejects.toThrow(/invalid/);
  });
});
