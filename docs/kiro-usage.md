# How we use Kiro

This file describes how the project uses Kiro as a development tool. It is not part of the product design (`.kiro/specs/graftlab-ai/design.md`). It also feeds the Kiroween write-up (tasks.md 18.5).

## Spec

`.kiro/specs/graftlab-ai/` holds the requirements, the design, the tasks, the two reference documents and the UI mocks. The spec is the single source of truth: we change the spec first, then the code (AGENTS.md).

## Steering

`.kiro/steering/` holds three always-included files:

- `product.md`: product purpose, honesty rules, UI priority, what the Studio guarantees versus best effort.
- `tech.md`: stack, versions, commands, testing rules, the secret rules, mirrors.
- `structure.md`: repository layout and the three document layers.

## Hooks

Four hooks in `.kiro/hooks/` (task 2.2):

| Hook | Trigger | What it runs |
|---|---|---|
| Run related tests on save | PostFileSave, `\.(ts|tsx)$` | `vitest related --run` for the saved files |
| Secret scan on save | PostFileSave, any file | `scripts/secret-scan.mjs` |
| Flow_Graph reachability check | PostFileSave, `packages/shared/src/flow/` | `npm run flow:check` |
| Secret scan before commit | PreToolUse, `execute_bash` | blocks a `git commit` (exit code 2) when the scan finds anything |

Facts verified on 2026-11-22:

- Kiro's file triggers fire only for files the agent writes. A manual save in the editor does not trigger them.
- Hooks created during a session were active in the same session.
- The file-event matcher receives the absolute path, so matchers are not anchored at the start.
- A successful hook shows no output. A failing hook (exit code not 0) shows its stderr.

Because a successful run is invisible, every hook runs through `scripts/hooks/run.mjs`. It appends one line per run to `data/hook-runs.log` (gitignored): time, hook, exit code, duration, and the saved paths or the tool name. It never logs command text or file contents.

## Write-up notes

The Kiroween write-up will describe how the spec drove the build, how steering kept the rules stable across sessions, how hooks enforced tests and the secret scan, and how spike results fed the design decisions.
