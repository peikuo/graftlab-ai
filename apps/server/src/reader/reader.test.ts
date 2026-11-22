// Repo_Reader tests with a fake GitHub (tasks.md 5.6; R10.5, R10.6, R34.2, R34.3, R34.4).
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretRegistry } from "@graftlab/shared";
import { Lease } from "../queue/lease.ts";
import { TaskService } from "../tasks/service.ts";
import { GitHub, GitHubError } from "./github.ts";
import { DEFAULT_LIMITS, RepoCache, planReading, priority, readRepository } from "./reader.ts";

const SHA = "a".repeat(40);
const TOKEN = "ghp_" + "x".repeat(36);
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp() {
  const d = await mkdtemp(join(tmpdir(), "gl-reader-"));
  dirs.push(d);
  return d;
}

interface FakeRepo {
  files: Record<string, string>;
  private?: boolean;
  missing?: boolean;
  rateLimited?: boolean;
  failFile?: string;
}

/** A fake fetch that answers like the GitHub REST API and the raw host, and records every request. */
function fakeGitHub(repo: FakeRepo) {
  const calls: { url: string; auth: boolean }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, auth: !!headers.authorization });
    const json = (body: unknown, status = 200, h: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...h } });
    if (repo.rateLimited) return json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1795400000" });
    if (url.startsWith("https://api.github.com/repos/o/r/branches/")) return json({ commit: { sha: SHA } });
    if (url.startsWith("https://api.github.com/repos/o/r/git/trees/")) return json({ tree: Object.entries(repo.files).map(([path, text]) => ({ path, type: "blob", size: text.length })), truncated: false });
    if (url === "https://api.github.com/repos/o/r") return repo.missing ? json({ message: "Not Found" }, 404) : json({ name: "r", owner: { login: "o" }, private: !!repo.private, visibility: repo.private ? "private" : "public", default_branch: "main" });
    const rawPrefix = `https://raw.githubusercontent.com/o/r/${SHA}/`;
    if (url.startsWith(rawPrefix)) {
      const path = decodeURIComponent(url.slice(rawPrefix.length));
      if (path === repo.failFile) return new Response("boom", { status: 500 });
      const text = repo.files[path];
      return text === undefined ? new Response("missing", { status: 404 }) : new Response(text, { status: 200 });
    }
    return json({ message: "unexpected " + url }, 500);
  }) as typeof fetch;
  return { gh: new GitHub({ token: TOKEN, fetchImpl }), calls };
}

const files = { "README.md": "# r", "src/app.py": "print(1)", "src/models.py": "class A: pass", "docs/guide.md": "guide", "logo.png": "\u0000PNG" };
const noop = { onPlan: async () => {}, onFile: async () => {}, onSkippedAfterRead: async () => {} };

describe("Repo_Reader", () => {
  it("reads README first, then docs, models, the rest; binary files are skipped", () => {
    const plan = planReading(Object.entries(files).map(([path, t]) => ({ path, size: t.length })));
    expect(plan.read.map((e) => e.path)).toEqual(["README.md", "docs/guide.md", "src/models.py", "src/app.py"]);
    expect(plan.skipped).toEqual([{ path: "logo.png", reason: "binary" }]);
    expect(priority("README.md")).toBeLessThan(priority("docs/x.md"));
  });

  it("lists the skipped parts when the read-volume limit is reached (R10.6, R34.3)", () => {
    const entries = Array.from({ length: 10 }, (_, i) => ({ path: `f${i}.py`, size: 100 }));
    const plan = planReading(entries, { ...DEFAULT_LIMITS, maxFiles: 3 });
    expect(plan.read).toHaveLength(3);
    expect(plan.skipped).toHaveLength(7);
    expect(plan.skipped.every((s) => s.reason === "read-volume limit reached")).toBe(true);
    const big = planReading([{ path: "big.json", size: 300 * 1024 }]);
    expect(big.skipped[0]?.reason).toMatch(/larger than 200 KB/);
  });

  it("a second read of the same commit comes only from the cache (R34.2)", async () => {
    const { gh, calls } = fakeGitHub({ files });
    const cache = new RepoCache(await tmp());
    const meta = await gh.meta("o", "r");
    const first = await readRepository(gh, cache, meta, noop);
    expect(first.fromCache).toBe(false);
    const before = calls.length;
    const second = await readRepository(gh, cache, meta, noop);
    expect(second.fromCache).toBe(true);
    expect(calls.length).toBe(before); // no request at all
    expect(second.files.map((f) => f.path)).toEqual(first.files.map((f) => f.path));
  });

  it("the token goes only to the API host, never to the raw host", async () => {
    const { gh, calls } = fakeGitHub({ files });
    await readRepository(gh, new RepoCache(await tmp()), await gh.meta("o", "r"), noop);
    expect(calls.filter((c) => c.url.startsWith("https://raw.")).every((c) => !c.auth)).toBe(true);
    expect(calls.filter((c) => c.url.startsWith("https://api.")).every((c) => c.auth)).toBe(true);
  });

  it("refuses missing and private repositories with GitHub's reason (R9.4)", async () => {
    await expect(fakeGitHub({ files, missing: true }).gh.meta("o", "r")).rejects.toMatchObject({ kind: "not_found" });
    await expect(fakeGitHub({ files, private: true }).gh.meta("o", "r")).rejects.toMatchObject({ kind: "not_public" });
  });

  it("reports the rate limit state and fabricates nothing (R34.4)", async () => {
    const e = (await fakeGitHub({ files, rateLimited: true }).gh.meta("o", "r").catch((x: unknown) => x)) as GitHubError;
    expect(e).toBeInstanceOf(GitHubError);
    expect(e.kind).toBe("rate_limited");
    expect(e.message).toMatch(/rate limit reached.*remaining 0/);
  });

  it("refuses a file path that would leave the cache directory", async () => {
    const cache = new RepoCache(await tmp());
    expect(() => cache.filePath({ owner: "o", repo: "r", defaultBranch: "main", sha: SHA }, "../../etc/passwd")).toThrow(/outside the repository/);
  });
});

describe("reading step in a Task", () => {
  async function service(repo: FakeRepo) {
    const dataDir = await tmp();
    const secrets = new SecretRegistry();
    secrets.register("github_token", TOKEN);
    const { gh } = fakeGitHub(repo);
    const lease = new Lease();
    let store: import("../events/store.ts").EventStore | null = null;
    const s = new TaskService({ dataDir, secrets, github: gh, adapters: [{ id: "linkding", match: { owner: "sissbruecker", repo: "linkding" } }], runtimeRulesVersion: "0.1.0", lease, onStore: (x) => (store = x) });
    return { s, dataDir, store: () => store! };
  }
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(cond()).toBe(true);
  };

  it("every file read is an event, the Task is Other_Repo, and the token is in no event", async () => {
    const { s, store } = await service({ files });
    const r = await s.create("github.com/o/r");
    expect(r.ok).toBe(true);
    await waitFor(() => store().events().some((e) => e.type === "node_entered" && e.payload.to === "failure_review"));
    const events = store().events();
    expect(events[0]).toMatchObject({ type: "task_created", payload: { repoKind: "other", commitSha: SHA } });
    expect(events.filter((e) => e.type === "file_read").map((e) => (e.payload as { path: string }).path)).toEqual(["README.md", "docs/guide.md", "src/models.py", "src/app.py"]);
    expect(events.some((e) => e.type === "finding_recorded" && e.payload.kind === "skipped")).toBe(true);
    // The meeting is not built yet in milestone 5: an honest stop for the Judge.
    expect(events.find((e) => e.type === "failure")?.payload).toMatchObject({ detail: 'the step "meeting" is not built yet in this version' });
    const file = await readFile(join(store().dir, "events.jsonl"), "utf8");
    expect(file.includes(TOKEN)).toBe(false);
  });

  it("a download failure is recorded with the reason and stops for the Judge (R10.5)", async () => {
    const { s, store } = await service({ files, failFile: "src/models.py" });
    await s.create("https://github.com/o/r");
    await waitFor(() => store().events().some((e) => e.type === "node_entered" && e.payload.to === "failure_review"));
    const failure = store().events().find((e) => e.type === "failure");
    expect(failure?.payload).toMatchObject({ failureClass: "interface_call_failure", source: "github", detail: "GitHub returned HTTP 500 while reading src/models.py" });
    expect(store().events().filter((e) => e.type === "file_read")).toHaveLength(2);
  });

  it("refuses an invalid URL and a private repository without creating a Task", async () => {
    const { s, dataDir } = await service({ files, private: true });
    expect(await s.create("not a url")).toMatchObject({ ok: false, status: 400 });
    expect(await s.create("github.com/o/r")).toMatchObject({ ok: false, status: 403, error: "GitHub says this repository is not public" });
    const { readdir } = await import("node:fs/promises");
    expect(await readdir(join(dataDir, "tasks")).catch(() => [])).toEqual([]);
  });
});
