# GraftLab AI

> Give any software a spark of AI.

> Status: in development for Kiroween 2026. This README is a stub and will be completed before submission.

Paste a GitHub repository URL. A team of AI roles reads it, discusses it with you like a meeting, and helps you decide how to make that software AI-powered. For the one supported target (linkding) the Studio can run it in a sandbox, develop the change in an isolated worktree, and verify the result independently.

## Where the plan lives
- Requirements, design, tasks and UI mocks: `.kiro/specs/graftlab-ai/`
- Project rules for agents and contributors: `AGENTS.md` and `.kiro/steering/`

## Development
Node 24 or later.

```sh
npm install           # all workspaces
npm test              # all tests once (vitest, fast-check)
npm run typecheck     # all workspaces
npm run flow:print    # Flow_Graph nodes and edges
npm run secret-scan   # scan tracked and not-ignored files for secrets
npm run dev -w apps/web
```

## License
Apache License 2.0. See `LICENSE`.

## Third-party notices
Direct dependencies so far (the full list, including the pi packages, Playwright and external services, is completed before submission):

| Component | License | Use |
|---|---|---|
| zod | MIT | Schemas at every trust boundary |
| Fastify | MIT | Backend HTTP and SSE |
| React, React DOM | MIT | Web app |
| Vite, @vitejs/plugin-react | MIT | Web build and dev server |
| Vitest | MIT | Tests |
| fast-check | MIT | Property-based tests |
| TypeScript | Apache-2.0 | Type checking |
| tsx | MIT | Running the TypeScript backend |
| pi-ai, pi-agent-core (@earendil-works) | MIT | Agent loop and LLM streaming in the backend |
| Playwright (@playwright/test) | Apache-2.0 | Browser checks and UI screenshots in development |
| Testing Library (@testing-library/react, @testing-library/dom) | MIT | Workspace UI tests |
| jsdom | MIT | DOM for UI tests |
| linkding | MIT | First adapted target, used only as an unmodified external dependency |
