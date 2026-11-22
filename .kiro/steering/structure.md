# Structure

## Repository layout

```text
apps/server/            Node + TypeScript backend (Fastify, SSE, task runner, Verifier)
apps/server/src/proxy/  LLM_Proxy entry point
apps/web/               React + Vite SPA (Workspace, Replay player)
packages/shared/        Event types, zod schemas, UI reducer, Flow_Graph data, guards
runtime-rules/          Layer B: VERSION, roles/, rules/, schemas/, adapters/<id>-checklist.md, cases/
adapters/<adapterId>/   One Adapter per target: adapter.json, hooks, test-data.json, own tests
docker/dev-sandbox/     Image layer for Development_Sandbox, Run_Environment, Verifier tests, LLM_Proxy
docker/llm-proxy/       LLM_Proxy container entry and README
scripts/                Repository scripts (secret scan, image transfer helpers)
data/                   Runtime state, gitignored
.kiro/specs/graftlab-ai Requirements, design, tasks, reference documents, UI mocks (ui/)
.kiro/steering/         These steering files
.kiro/hooks/            Kiro hooks
```

## Three document layers

| Layer | Content | Location |
|---|---|---|
| A Dev docs | AGENTS.md, steering, specs, hooks | `AGENTS.md`, `.kiro/` |
| B Runtime rules | Role duties, behavior rules, stage output schemas, Adapter checklists, case rules | `runtime-rules/` |
| C Output docs | Decision_Doc, backlog, sprint plan, task board, documents per analyzed repository | `data/tasks/<taskId>/docs/` (generated, gitignored) |

## Placement rules

- Code shared by server and web (events, reducer, Flow_Graph, schemas, pure helpers) goes into `packages/shared`. It has no Node-only or browser-only imports.
- Target-specific values and code go into `adapters/<adapterId>/`. Studio modules use only the Adapter contract in `packages/shared/src/adapter.ts`.
- Tests live next to the code: `foo.ts` and `foo.test.ts`; property tests are `foo.property.test.ts`.
- The repository never contains modified target code.
- `spike/` is gitignored throwaway work; product code never imports from it.
