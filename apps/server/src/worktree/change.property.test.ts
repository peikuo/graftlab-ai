// Property 18 (design.md, "Correctness Properties"): every Code_Agent change is recorded and reviewed. For any
// sequence of attempts that add, modify and delete files in a temporary git repository, the recorded change of each
// attempt lists exactly the files git reports as changed against the base, with line counts, including untracked
// files, without touching the agent's own index; and a finished attempt always continues to the review.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { edgesFrom, initialTaskState, transition } from "@graftlab/shared";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { diffWorktree, git, type Worktree } from "./worktree.ts";

const FILES = ["a.py", "b.py", "pkg/c.py", "pkg/d.txt", "e.md"];
let root: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "gl-p18-"));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

type Op = { kind: "write"; file: string; lines: number } | { kind: "delete"; file: string } | { kind: "commit" };
const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ kind: fc.constant("write" as const), file: fc.constantFrom(...FILES), lines: fc.integer({ min: 1, max: 6 }) }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant("delete" as const), file: fc.constantFrom(...FILES) }) },
  { weight: 1, arbitrary: fc.constant({ kind: "commit" as const }) },
);
let n = 0;

describe("change recording", () => {
  // Feature: graftlab-ai, Property 18: Every Code_Agent change is recorded and reviewed
  it("the recorded changed files equal what git reports against the base, untracked files included", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(fc.array(opArb, { minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 3 }), async (attempts) => {
        const dir = join(root, `r${++n}`);
        await git(["init", "-q", "-b", "main", dir]);
        await git(["config", "user.email", "t@example.invalid"], { cwd: dir });
        await git(["config", "user.name", "t"], { cwd: dir });
        await writeFile(join(dir, "a.py"), "x = 1\n");
        await writeFile(join(dir, "e.md"), "# e\n");
        await git(["add", "."], { cwd: dir });
        await git(["commit", "-q", "-m", "base"], { cwd: dir });
        const base = (await git(["rev-parse", "HEAD"], { cwd: dir })).trim();
        const wt: Worktree = { taskId: "t", path: dir, branch: "main", base };
        const exists = new Map<string, string>([["a.py", "x = 1\n"], ["e.md", "# e\n"]]);
        for (const ops of attempts) {
          for (const op of ops) {
            if (op.kind === "write") {
              const body = Array.from({ length: op.lines }, (_, i) => `line ${i} ${n}`).join("\n") + "\n";
              const { mkdir } = await import("node:fs/promises");
              await mkdir(join(dir, op.file, ".."), { recursive: true });
              await writeFile(join(dir, op.file), body);
              exists.set(op.file, body);
            } else if (op.kind === "delete") {
              await rm(join(dir, op.file), { force: true });
              exists.delete(op.file);
            } else {
              await git(["add", "-A"], { cwd: dir });
              await git(["commit", "-q", "--allow-empty", "-m", "agent commit"], { cwd: dir });
            }
          }
          const indexBefore = await git(["diff", "--cached", "--name-only"], { cwd: dir });
          const d = await diffWorktree(wt, base);
          // What git reports, independently: a full add into a throwaway index compared with the base.
          const expected = new Set<string>();
          const atBase = new Map<string, string>([["a.py", "x = 1\n"], ["e.md", "# e\n"]]);
          for (const f of new Set([...atBase.keys(), ...exists.keys()])) if (atBase.get(f) !== exists.get(f)) expected.add(f);
          expect(new Set(d.changedFiles.map((c) => c.path))).toEqual(expected);
          expect(new Set(d.stats.map((s) => s.path))).toEqual(expected);
          for (const c of d.changedFiles) expect(c.status).toBe(!atBase.has(c.path) ? "added" : !exists.has(c.path) ? "deleted" : "modified");
          // The agent's own index is not touched (R38.5).
          expect(await git(["diff", "--cached", "--name-only"], { cwd: dir })).toBe(indexBefore);
        }
        await rm(dir, { recursive: true, force: true });
      }),
      { numRuns: 100 },
    );
  }, 180_000);
  it("a finished attempt always continues to the review", () => {
    const t = { ...initialTaskState({ taskId: "t", url: "u", owner: "o", repo: "r", repoKind: "adapted", runtimeRulesVersion: "1", startedAt: "2026-11-25T00:00:00.000Z", deadlineAt: "2026-11-25T02:00:00.000Z" }), node: "story_develop" as const, frozenVersion: 1, backlogValid: true, planConfirmed: true, docsComplete: true, targetCheckPassed: true, outcome: "done" as const };
    const taken = edgesFrom("story_develop").map((e) => transition(t, e.id)).filter((r) => r.ok);
    expect(taken.map((r) => r.task.node)).toEqual(["story_review"]);
  });
});
