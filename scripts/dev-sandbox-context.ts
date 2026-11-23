// Assembles the build context of the Development_Sandbox image for one Adapter (design: Images, task 10.1).
// Usage: npx tsx scripts/dev-sandbox-context.ts <adapterId> [outDir]
//   GL_DATA_DIR                 data directory holding the mirror (default ./data)
//   GL_MIRROR_SOURCE_<ID>       local path or git bundle to create the mirror from (hosts with unreliable clones)
// Output: <outDir>/ (default data/build/dev-sandbox-<id>/) with Dockerfile, adapter/setup.sh, target-src/, runner/,
// build-args.json, and <outDir>.tar (no macOS metadata) for transfer. The script never runs Docker.
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AdapterJsonSchema } from "@graftlab/shared";
import { ensureMirror, mirrorSourceFromEnv } from "../apps/server/src/worktree/worktree.ts";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const id = process.argv[2];
if (!id) throw new Error("usage: dev-sandbox-context.ts <adapterId> [outDir]");
const adapter = AdapterJsonSchema.parse(JSON.parse(readFileSync(join(root, "adapters", id, "adapter.json"), "utf8")));
const dataDir = resolve(process.env.GL_DATA_DIR ?? join(root, "data"));
const out = resolve(process.argv[3] ?? join(dataDir, "build", `dev-sandbox-${id}`));

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "adapter"), { recursive: true });
mkdirSync(join(out, "target-src"), { recursive: true });
mkdirSync(join(out, "runner"), { recursive: true });

copyFileSync(join(root, "docker/dev-sandbox/Dockerfile"), join(out, "Dockerfile"));
copyFileSync(join(root, "adapters", id, adapter.devSandbox.dependencySetup), join(out, "adapter/setup.sh"));

// The image's source and every Worktree come from the same pinned commit of the same mirror.
const source = mirrorSourceFromEnv(id);
const mirror = await ensureMirror(dataDir, { adapterId: id, upstreamUrl: adapter.source.upstreamUrl, commit: adapter.source.commit, ...(source ? { source } : {}) });
const archive = execFileSync("git", ["-C", mirror, "archive", "--format=tar", adapter.source.commit], { maxBuffer: 512 * 1024 * 1024 });
execFileSync("tar", ["-xf", "-", "-C", join(out, "target-src")], { input: archive });

// The runner and the LLM_Proxy as one file each; the pi packages from their own lock file.
const run = (args: string[]) => execFileSync("npm", args, { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
run(["run", "-s", "build", "-w", "docker/dev-sandbox/runner"]);
run(["run", "-s", "build:proxy", "-w", "apps/server"]);
copyFileSync(join(root, "docker/dev-sandbox/runner/dist/runner.mjs"), join(out, "runner/runner.mjs"));
copyFileSync(join(root, "apps/server/dist/llm-proxy.mjs"), join(out, "runner/llm-proxy.mjs"));
for (const f of ["package.json", "package-lock.json"]) copyFileSync(join(root, "docker/dev-sandbox/image", f), join(out, "runner", f));

// The runner's pi version must be the one the image installs, so the shared event mapping serves one version.
const want = JSON.parse(readFileSync(join(root, "docker/dev-sandbox/runner/package.json"), "utf8")).dependencies["@earendil-works/pi-coding-agent"];
const got = JSON.parse(readFileSync(join(root, "docker/dev-sandbox/image/package.json"), "utf8")).dependencies["@earendil-works/pi-coding-agent"];
if (want !== got) throw new Error(`pi-coding-agent ${want} in the runner but ${got} in the image`);

const buildArgs = {
  image: `graftlab/dev-sandbox-${id}`,
  baseConfigDigest: adapter.baseline.configDigest ?? null,
  EXTRA_PATH: [...adapter.devSandbox.path, "/opt/node/bin"].join(":"),
};
writeFileSync(join(out, "build-args.json"), `${JSON.stringify(buildArgs, null, 2)}\n`);
execFileSync("tar", ["-cf", `${out}.tar`, "-C", dirname(out), out.split("/").pop()!], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
console.log(`context ${out} (${adapter.source.commit.slice(0, 12)}), archive ${out}.tar`);
