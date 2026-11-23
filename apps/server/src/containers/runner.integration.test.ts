// Code_Agent runner inside the built dev-sandbox image, through the LLM_Proxy, against the real model (task 10.14).
// Paid: runs only with GL_DOCKER_TESTS=1 and GL_LIVE_LLM=1, and the LLM profile variables in the environment.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRunnerLine, SecretRegistry, type RunnerEvent } from "@graftlab/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveLlmConfig } from "../llm/config.ts";
import { issueProxyCredential } from "../proxy/credential.ts";
import { createWorktree, diffWorktree, git, type Worktree } from "../worktree/worktree.ts";
import { ContainerManager } from "./manager.ts";

const enabled = process.env.GL_DOCKER_TESTS === "1" && process.env.GL_LIVE_LLM === "1";
const IMAGE = "graftlab/dev-sandbox-linkding:latest";
const taskId = `rt${Date.now().toString(36)}`;
const manager = new ContainerManager();

const GREETER = 'def greet(name):\n    return f"Hello, {name}"\n';
const TEST = 'from greeter import greet\n\n\ndef test_greet():\n    assert greet("Ann").startswith("Hello")\n';

interface Run {
  events: RunnerEvent[];
  code: number;
  ms: number;
  unknownLines: number;
}

describe.runIf(enabled)("Code_Agent runner in the image (10.14)", { timeout: 600_000 }, () => {
  const cfg = resolveLlmConfig(process.env);
  const secrets = new SecretRegistry();
  let root: string;
  let wt: Worktree;
  let dev: string;
  let proxyName: string;
  let credential: string;

  beforeAll(async () => {
    root = await mkdtemp(join(process.env.GL_IT_DIR ?? tmpdir(), "gl-rt-"));
    const up = join(root, "toy");
    await mkdir(join(up, "tests"), { recursive: true });
    await writeFile(join(up, "greeter.py"), GREETER);
    await writeFile(join(up, "tests", "test_greeter.py"), TEST);
    await writeFile(join(up, "conftest.py"), "");
    await git(["init", "-q", "-b", "main"], { cwd: up });
    await git(["add", "."], { cwd: up });
    await git(["commit", "-q", "-m", "toy"], { cwd: up });
    const commit = (await git(["rev-parse", "HEAD"], { cwd: up })).trim();
    wt = await createWorktree(join(root, "data"), taskId, { adapterId: "toy", upstreamUrl: up, commit });
    const ctx = join(root, "data", "tasks", taskId, "context", "S1");
    await mkdir(ctx, { recursive: true });
    await writeFile(join(ctx, "rules.md"), await readFile(join(import.meta.dirname, "../../../../runtime-rules/roles/code_agent.md"), "utf8"));
    await writeFile(
      join(ctx, "story.md"),
      "# Story S1: friendlier greeting\nChange `greet` in greeter.py so the greeting ends with an exclamation mark.\nBefore you change anything, ask with ask_question which greeting word is wanted (Hello or Hi). Then make the change and run the tests with `python -m pytest -q -p no:cacheprovider`.\n",
    );
    credential = issueProxyCredential(secrets);
    proxyName = (await manager.startProxy(taskId, { image: IMAGE, credential, upstreamUrl: cfg.baseUrl, upstreamKey: cfg.apiKey! })).name;
    dev = (await manager.startDevSandbox(taskId, { image: IMAGE, workDir: wt.path, contextDir: ctx, prebuilt: [] })).name;
  });

  afterAll(async () => {
    await manager.removeTask(taskId);
    await rm(root, { recursive: true, force: true });
  });

  async function runRunner(react: (e: RunnerEvent, send: (c: object) => void) => void): Promise<Run> {
    const t0 = Date.now();
    const x = await manager.docker.execAttach(dev, ["node", "/opt/runner/runner.mjs"], {
      workdir: "/work",
      env: {
        GL_PROXY_BASE: `http://llm-proxy:8787/v1`,
        GL_PROXY_CREDENTIAL: credential,
        GL_MODEL_ID: cfg.model,
        GL_REASONING_PARAM: cfg.reasoningParam,
        GL_REASONING_EFFORT: cfg.reasoningEffort,
        GL_RULES_FILE: "/context/rules.md",
        WORK_DIR: "/work",
      },
    });
    const events: RunnerEvent[] = [];
    let unknownLines = 0;
    let buf = "";
    const send = (c: object) => x.stdin.write(`${JSON.stringify(c)}\n`);
    x.onStdout((d) => {
      buf += d.toString("utf8");
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const e = parseRunnerLine(line);
        if (!e) {
          if (line.trim()) unknownLines++;
          continue;
        }
        events.push(e);
        if (e.type !== "delta") console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${JSON.stringify(e).slice(0, 160)}`);
        react(e, send);
        if (e.type === "final" && e.outcome !== "question") x.stdin.end();
      }
    });
    const code = await x.exited;
    return { events, code, ms: Date.now() - t0, unknownLines };
  }

  it("asks with ask_question, gets the answer in the same process, completes the story through the LLM_Proxy", async () => {
    let asked = 0;
    let pending = "";
    const r = await runRunner((e, send) => {
      if (e.type === "ready") {
        expect(e.tools).toEqual(["read", "bash", "edit", "write", "ask_question"]);
        send({ cmd: "prompt", text: "Read /context/story.md and do the story." });
      }
      if (e.type === "question") {
        asked++;
        pending = e.questionId;
      }
      if (e.type === "final" && e.outcome === "question") send({ cmd: "answer", questionId: pending, text: "Use Hi." });
    });
    expect(asked).toBeGreaterThanOrEqual(1);
    const finals = r.events.filter((e) => e.type === "final").map((e) => (e as { outcome: string }).outcome);
    expect(finals.at(-1)).toBe("completed");
    expect(finals.slice(0, -1).every((o) => o === "question")).toBe(true);
    expect(r.unknownLines).toBe(0);
    const diff = await diffWorktree(wt);
    expect(diff.changedFiles.map((f) => f.path)).toContain("greeter.py");
    expect(diff.changedFiles.every((f) => !f.path.startsWith("tests/"))).toBe(true);
    console.log("story done in", r.ms, "ms; changed", diff.changedFiles);
  });

  it("an abort during the turn ends the runner as aborted", async () => {
    const r = await runRunner((e, send) => {
      if (e.type === "ready") send({ cmd: "prompt", text: "List the files in /work with bash, then explain each in detail." });
      if (e.type === "tool_start") send({ cmd: "abort" });
    });
    expect(r.events.at(-1)).toEqual({ type: "final", outcome: "aborted" });
  });

  it("the container holds no real key, only /work and /tmp were writable, and the proxy logged method, path and status only", async () => {
    const env = (await manager.docker.exec(dev, ["env"])).stdout;
    expect(env).not.toContain(cfg.apiKey!);
    const ro = await manager.docker.exec(dev, ["sh", "-c", "touch /opt/runner/x 2>&1; touch /etc/x 2>&1; touch /work/.probe && touch /tmp/.probe && echo writable"]);
    expect(ro.stdout).toMatch(/Read-only file system[\s\S]*Read-only file system[\s\S]*writable/);
    const logs = await manager.docker.logs(proxyName);
    const lines = logs.trim().split("\n").filter((l) => !l.startsWith("llm-proxy listening"));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => /^(POST|GET) \/(chat\/completions|models) \d{3}$/.test(l))).toBe(true);
    expect(logs).not.toContain(cfg.apiKey!);
    console.log("proxy log:", [...new Set(lines)]);
  });
});
