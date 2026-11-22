# Tech

## Stack

- TypeScript everywhere, ESM, Node 24 (`node >= 24`).
- npm workspaces: `apps/server` (Fastify 5, SSE), `apps/web` (React 19, Vite), `packages/shared`.
- zod 4 for every schema at a trust boundary (events, stage outputs, HTTP bodies, runner protocol).
- Agents: `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` in the backend; `@earendil-works/pi-coding-agent` in the per-Task container. The LLM uses the OpenAI-compatible format, configured by `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`.
- Tests: vitest, fast-check, React Testing Library, Playwright.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install all workspaces |
| `npm test` | Run all tests once (`vitest --run`) |
| `npm run typecheck` | Type-check all workspaces |
| `npm run flow:check` | Flow_Graph reachability test only |
| `npm run secret-scan` | Scan tracked and staged files for secrets |
| `npm run dev -w apps/web` | Vite dev server (run it yourself in a terminal) |

Never start watchers or dev servers from an agent tool call; run tests with `--run`.

## Rules

- Secrets live only in server-side environment variables. Never read, print or commit `.env`. The repository has only `.env.example`.
- Load environment in Node with `process.loadEnvFile()` on the server only. Never send a key to the browser or into a container (the LLM_Proxy holds the real key).
- Streamed text is not stored. Only complete messages, incomplete messages with a reason, and lifecycle events are persisted.
- The UI state is a pure function of the event list (`foldEvents`). Live and Replay use the same reducer.
- Leaving a Flow_Graph node happens only through `transition()` with a guard over validated state, never through free model text.
- No dependency is added without a reason; record third-party components and licenses in the README.

## Testing rules

- One fast-check test per Correctness Property, `numRuns` at least 100.
- Each property test carries the tag comment `// Feature: graftlab-ai, Property <n>: <property text>`.
- Timers use a fake clock; the normal test run makes no paid LLM calls (live tests only behind an explicit environment variable).
- Debug each stage with the real output of the previous stage; recorded fixtures are sanitized and secret-scanned before commit.

## Mirrors (deployment host in China)

npm `registry.npmmirror.com` with a lock file resolved against `registry.npmjs.org` (sha512 integrity); PyPI `pypi.tuna` with hash-checked installs; apt `mirrors.aliyun.com`; Playwright browsers via `PLAYWRIGHT_DOWNLOAD_HOST=https://registry.npmmirror.com/-/binary/playwright`. Details in `.kiro/specs/graftlab-ai/reference-deployment.md`.
