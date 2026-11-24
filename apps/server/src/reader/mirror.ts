// Repository files of an Adapted_Repo from the Adapter's local mirror at the pinned commit (design.md, "Repo_Reader";
// R10.1). The Worktree is cloned from the same mirror, so the analyzed files are exactly the developed files, and
// reading does not depend on GitHub's raw file host (unreachable from the first deployment host).
import { execFile } from "node:child_process";
import type { RepoMeta, TreeEntry } from "./github.ts";
import { ensureMirror, type MirrorSpec } from "../worktree/worktree.ts";

function gitBuffer(args: string[], cwd: string): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => (err ? reject(new Error(`git ${args[0]} failed in the mirror`)) : resolve(stdout))),
  );
}

export class MirrorSource {
  #path: Promise<string>;
  constructor(dataDir: string, spec: MirrorSpec) {
    this.#path = ensureMirror(dataDir, spec);
  }

  async tree(meta: RepoMeta): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const out = (await gitBuffer(["ls-tree", "-r", "-l", "-z", meta.sha], await this.#path)).toString("utf8");
    const entries: TreeEntry[] = [];
    for (const rec of out.split("\0")) {
      // "<mode> <type> <sha> <size>\t<path>"
      const m = /^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/s.exec(rec);
      if (m) entries.push({ path: m[2]!, size: Number(m[1]) });
    }
    return { entries, truncated: false };
  }

  async file(meta: RepoMeta, path: string): Promise<Uint8Array> {
    return new Uint8Array(await gitBuffer(["cat-file", "blob", `${meta.sha}:${path}`], await this.#path));
  }
}
