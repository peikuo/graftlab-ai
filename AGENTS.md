# AGENTS.md

This file holds constraints and an index only. Details live in `.kiro/specs/graftlab-ai/`.

## Constraints

- `.kiro/specs` is the single source of truth: change the spec first, then the code. If code conflicts with the spec, the spec wins.
- Write everything ourselves; do not copy code or assets from other projects. List third-party dependencies and respect their licenses.
- Show failures honestly and do not hide them with retries. Replay MUST be labeled "Replay". Success is decided only by the independent Verifier, never by an LLM description.
- Keys and tokens stay out of the repository and live only in server-side environment variables; the repository holds only `.env.example`. The LLM uses the OpenAI-compatible format, configured by environment variables.
- Never read or commit any `.env` file. `.kiro/` MUST be committed and MUST NOT be ignored.
- Priority when trading off: UI interactivity and visible, honest agent activity take priority over breadth of features.
- Work in small scoped units: one story and one set of referenced documents at a time.
- Development agents have no decision power. Each story has a feature-level Feature_Contract (no file lists). A Tech_Manager reviews the changed files (an assessment, not a guarantee). Agents stop and ask instead of improvising or retrying forever. The Studio guarantees only what code can enforce; everything else is best effort and measured.
- Build stage by stage: use the real output of each stage as the input to debug the next, and test with real documents.
- Streamed text is not stored: the server persists only complete messages (an interrupted stream is persisted as incomplete with the reason).
- All hackathon materials and documents are written in English.

## Scope

- Analysis: any public GitHub repository (read-only).
- Execution: linkding only (sandboxed run, browser use, development, independent verification). Development may include source changes to a copy of linkding inside an isolated per-Task git worktree.
- Confine the code agent's file writes to the per-Task worktree (the code agent runs inside one container per Task, which provides the write confinement; network is limited only if the container policy sets it). The Studio repository never contains modified target code; linkding is only an unmodified external dependency.
- Never run arbitrary repository code. The first version has no computer use.
- Never read `.env` files.

## Three document layers

| Layer | Content | Location |
|---|---|---|
| A Dev docs | AGENTS.md, .kiro/steering, .kiro/specs, hooks | This file and `.kiro/` |
| B Runtime rules | Role duties, behavior rules, stage output schemas, linkding Adapter checklist, case library rules | `runtime-rules/` |
| C Output docs | Decision Doc, Product Backlog, Sprint Plan, Task Board, Definition of Done, Demo and Review Notes, Retrospective, plus requirements, design, tasks per analyzed repository | `data/tasks/<taskId>/docs/` (generated at run time, gitignored) |

## Index

- Requirements: `.kiro/specs/graftlab-ai/requirements.md` (R1-R41)
- Design: `.kiro/specs/graftlab-ai/design.md`
- Reference, first target: `.kiro/specs/graftlab-ai/reference-target-linkding.md` (how linkding is installed, run, provisioned, tested and verified; design.md is authoritative)
- Reference, deployment: `.kiro/specs/graftlab-ai/reference-deployment.md` (where and how the Studio is deployed, and the host facts from the spikes; design.md is authoritative)
- Tasks: `.kiro/specs/graftlab-ai/tasks.md`
- How we use Kiro (spec, steering, hooks; not product design): `docs/kiro-usage.md`
