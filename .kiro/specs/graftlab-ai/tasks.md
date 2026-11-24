# Implementation Plan: GraftLab AI

## Overview

The plan follows the schedule from today (2026-11-20 evening) to the real last working day 2026-12-04 (deadline 2026-12-05 06:00 Beijing time), for one developer. Each top-level task is a milestone with its target date in the title. The spike milestone comes first: it verifies the design's TO VERIFY items that block later work, each with a clear pass or fail and the fallback from design.md ("TO VERIFY list"). After that, each stage is built with the real output of the previous stage (Process Principle 6), all in TypeScript.

Conventions:

- Each sub-task is sized for one focused session and names the design section it implements ("Design: ..."). Target-specific details are in `reference-target-linkding.md` and deployment-specific details in `reference-deployment.md`; a task that needs them names the reference section after the design section.
- Every feature milestone ends with a "Demo and verify" sub-task (layer A process note): what to show the user and how to check it.
- Property-based tests use fast-check with vitest, at least 100 runs, tagged `// Feature: graftlab-ai, Property <n>: <property text>`. These property tests are required: Property 1 and 2 (Flow_Graph reachability and transition validity), Property 4 (live versus Replay reducer equality), Property 11 (the Adapter comparator agrees with a model of the target's write semantics), Property 12 (secret redaction) and Property 19 (Demo_Case write constraints). All other test sub-tasks are optional and marked with `*`.
- Actions only the user can do (upgrading Node, pulling images on another machine, creating accounts, tunnel credentials, DNS, uploading the video, submitting on Devpost) are notes inside the relevant task, not tasks.
- No real key, token, private IP, private hostname, account name or e-mail address is written into any committed file; `.env` files are never read or committed.

## Tasks

- [x] 1. Spike milestone: verify blocking TO VERIFY items (target 2026-11-21 to 2026-11-22)
  - [x] 1.1 Check Node >=22.19 on the PC (TO VERIFY 12, Open item 47)
    - Run `node --version` on the PC and rerun `spike/pi/smoke.mjs` against `deepseek-flash` (streaming, tool call, abort)
    - Pass: version >=22.19.0 and the smoke test completes. Fail: stop; there is no fallback (required)
    - Done 2026-11-21: Node v24.22.3 (portable, checksum verified against nodejs.org) installed under the project tools directory on the PC; the system Node and PATH were not changed; pi packages 1.5.2 ran streaming, an in-process tool call and abort against deepseek-flash (first delta 730 ms, abort stopped the run at 4.0 s). The backend start script must call this Node explicitly.
    - Record the result in `spike/results/S-node.md`
    - Design: TO VERIFY list, Deployment model; reference-deployment.md (Node)
    - _Requirements: 32.6, 30.9_
  - [x] 1.2 Check package mirror reachability from the PC at image build time (TO VERIFY 13)
    - Done 2026-11-21 (`spike/results/S-mirrors.md`): apt, PyPI, npm, nodejs.org and GitHub are reachable during `docker build` on the PC. Docker Hub is not. Docker commands over SSH need an empty `DOCKER_CONFIG` and a minimal `PATH`, because the credential helper fails without a desktop logon session. Large `git clone` from GitHub is unreliable on the PC: fetch sources on the Mac and transfer them.
    - Throwaway Dockerfile in `spike/mirrors/` on `ubuntu:latest` that runs `apt-get update`, a `pip download`, an `npm view`, a fetch from nodejs.org and a `git ls-remote` against GitHub; separately run the Playwright Chromium download on the host
    - Pass: every source is reachable during `docker build`. Fail fallback: download on another machine and transfer, as for images
    - Record per-source results in `spike/results/S-mirrors.md`
    - Design: Images, TO VERIFY list; reference-deployment.md (Network facts, Operational notes)
    - _Requirements: 39.2_
  - [x] 1.3 Verify linkding image transfer by docker save/load and digest check (Open item 48)
    - Done 2026-11-21 (`spike/results/S-linkding-image.md`): the official image is published on ghcr.io as well; index digest `sha256:e35cb50e0581178f245125ffaa909c565416c94c9f22ace305a7d234a4345522` (tag 1.47.0 = latest), linux/amd64 config `sha256:0f9a8582286a2efc50d51724869b48d845fed52032b8d0b45f02ee6ee649a9f3`, 392 MB. `docker pull` failed on both machines; `scripts/fetch-oci.mjs` (per-blob sha256 check) plus `scripts/make-docker-load-manifest.mjs`, a tar without xattrs, scp and `docker load` worked. Image ID on the PC equals the config digest. `/health` and `/login/` answer 200; idle memory 85 MiB.
    - Load the transferred tar with `docker load`; compare `docker image inspect` RepoDigests with the digest recorded on the other machine; record digest, version tag and platform for `adapters/linkding/adapter.json`
    - Pass: digest matches and the image starts and answers on port 9090. Fail: re-transfer; no other fallback (the Sandbox depends on it)
    - Note: the user pulls with `--platform linux/amd64` and runs `docker save` on another machine
    - Record in `spike/results/S-linkding-image.md`
    - Design: Images; reference-target-linkding.md (Version pin); reference-deployment.md (Image transfer)
    - _Requirements: 13.3, 25.6_
  - [x] 1.4 Spike B part 1: Docker Desktop internal network, published port and bind mount (TO VERIFY 4, 5)
    - Done 2026-11-21 (`spike/results/S-docker-network.md`): a container on an internal-only network cannot publish a port; the designed fallback works (relay container on both networks, host to relay to app 200), and the internal container has no internet or DNS. Bind mount works: writes visible on the host, LF preserved, 200 small writes in 329 ms, `git status` 1.1 s on 442 files. All files show as mode 755 in the container, so the Worktree manager must set `core.fileMode=false`.
    - Create a network with `internal: true`, start a test container on it only with a port published to `127.0.0.1`, curl it from the host; check that the container cannot reach the internet
    - Bind mount a host directory holding a linkding clone with `core.autocrlf=false` at `/work`; write from the container; check host visibility, file mode, LF line endings, and the time of `git status`
    - Pass: curl answers, internet blocked, writes visible with LF and acceptable speed. Fail fallback: LLM_Proxy container relays the app port; Worktree in a named volume with a helper container for diffs
    - Record in `spike/results/S-docker-network.md`
    - Design: Network policy, Worktree manager, TO VERIFY list; reference-deployment.md (Docker Desktop facts)
    - _Requirements: 38.4, 39.6_
  - [x] 1.5 Spike C part 1: linkding API token creation and API allow-list paths (TO VERIFY 6)
    - Done 2026-11-21 (`spike/results/S-linkding-api.md`): only the `bookmarks.ApiToken` model works (`ApiToken.objects.create(user=..., name="graftlab")` in `manage.py shell`, workdir `/etc/linkding`); `authtoken.Token` returns 401. Wait for `/health` (34 s) before management commands, because the SQLite database is locked during startup migrations. Every allow-list endpoint answered as documented (`?disable_scraping` on create). Correction: a POST with an existing URL returns 201 with the same id and REPLACES title and tags; auto-tagging rules add their tag on create and keep it on a PATCH without `tag_names`.
    - Start the pinned image with a generated superuser password, create a token with a Django management shell command inside the container, then call `GET /api/bookmarks/`, `POST /api/bookmarks/`, `PATCH /api/bookmarks/{id}/`, `POST /api/bookmarks/{id}/archive/` and `GET /api/tags/`; confirm the same-URL update behavior and tag merging
    - Pass: token works and every allow-list endpoint answers as documented. Fail fallback: create the token through the settings page with Playwright; correct the allow-list to the observed paths
    - Record in `spike/results/S-linkding-api.md` (no token values)
    - Design: Adapter contract; reference-target-linkding.md (Baseline run, Provisioning, API facts and the Adapter allow-list, Write semantics for the comparator)
    - _Requirements: 13.2, 18.10, 29.1_
  - [x] 1.6 Spike C part 2: run linkding from source in a dev-sandbox-like image (TO VERIFY 7, 8)
    - Done 2026-11-21 (`spike/results/S-linkding-source.md`): linkding 1.47.0 needs Python >=3.13, so the dev-sandbox prototype is built FROM the digest-pinned official image (Python 3.13.7, runtime deps incl. compiled uwsgi) plus git, Node 24, uv, the dev dependency group with `--require-hashes`, `npm ci` and `npm run build` (1.03 GB). Use mirrors.aliyun.com for apt and pypi.tuna for Python packages (official sources are about 0.01 MB/s from the PC). From source: migrate 29 s, `runserver` `/health` 200 after 2 s; `pytest -n 4 bookmarks/tests`: 1380 passed in 300 s under 768 MiB. The full suite is too slow for every story attempt: run targeted test files. Image tag and source tag are the same release.
    - Throwaway Dockerfile in `spike/dev-sandbox/` on `ubuntu:latest` with Python 3, Node and git; clone linkding at the commit of the pinned image tag; preinstall Python and Node dependencies; run migrations, the frontend build, the dev server with a health path, and the linkding test command
    - Pass: the app answers on its health path and the test command runs; the image tag and the commit are the same release. Fail fallback: pin a Python version linkding supports; choose a tag that exists for both
    - Record the working commands (they inform the Agent_Roles' `runEnvironment` analysis, not an Adapter recipe) in `spike/results/S-linkding-source.md`
    - Design: Images, TO VERIFY list; reference-target-linkding.md (Development_Sandbox for linkding, Running from source, Tests); reference-deployment.md (Network facts, Integrity rules)
    - _Requirements: 39.2, 39.9, 39.10_
  - [x] 1.7 Spike A part 1: pi-coding-agent embedded runner in a container with read-only root, reaching the model through the LLM_Proxy (custom base address) (TO VERIFY 1, 2)
    - Done 2026-11-22 (`spike/results/S-pi-code-linux.md`): the embedded runner works in a container with a read-only root, tmpfs `/tmp` and home, and `/work` as the only writable bind mount, on an internal network; it reaches the model only through the proxy. Custom provider: `modelRuntime.registerProvider(id, { baseUrl: <proxy>/v1, api: "openai-completions", authHeader: true, models: [...] })` plus `setRuntimeApiKey(id, <per-Task credential>)`; the proxy saw only `POST /v1/chat/completions` (200). The "fix failing tests" story finished in 24 s; independent check: all tests pass, `tests/` unchanged. Probe: writes outside `/work` and `/tmp` denied, internet blocked, no LLM variables in the container, the real key in no output. npm packages come from a mirror with sha512 integrity from a lock file generated against the official registry.
    - Put the pi packages (pinned versions, installed from the npm registry) and a first version of the runner into the spike image; run it with read-only root filesystem, tmpfs `/tmp` and the session and home directory, `/work` writable, on an internal network with a throwaway logging proxy that logs method, path and status only; define a custom provider and model entry whose base address is the proxy
    - Run the "fix failing tests" scenario from `spike/bench/` (toy repository fixtures) through the proxy with only the per-Task credential in the container; read the proxy log to check the base address form and paths
    - Pass: the runner completes a small story on the toy repository through the proxy, no real key is in the container, and writes land only under `/work` and `/tmp`. Fail fallback: pi RPC mode; second fallback: the DeepSeek Harness runtime (design fallback)
    - Record in `spike/results/S-pi-code-linux.md`, with sanitized event samples for later fixtures
    - Design: PiCodeRuntime, LLM_Proxy, TO VERIFY list
    - _Requirements: 30.16, 38.2, 38.8_
  - [x] 1.8 Spike A part 2: custom ask_question tool, resuming in the same process, steer and abort over stdin, and the toy-trap contradiction fixture (TO VERIFY 3, 15, 16)
    - Done 2026-11-22 (`spike/results/S-pi-code-ask.md`): a custom tool must also be listed in the `tools` allow-list, otherwise it is silently inactive. With that fixed, `ask_question` ends the turn and an `answer` resumes the same process and session; `steer` is queued and applied in the same run; `abort` stops in 15 ms. On the toy-trap fixture with the Code_Agent rules, the agent asked about the contradiction and, after the answer, left the outdated test failing with no special case (independently checked). On an ambiguous story it sometimes infers intent from the tests instead of asking, so asking stays best effort and the code-side trigger (retry limit) stays.
    - Run the ambiguous-story fixture (and a prompt that says to stop and ask) from `spike/bench/`; check that the custom `ask_question` tool ends the turn and that an `answer` command resumes the same process; send `steer` and `abort` over stdin
    - Run the `toy-trap` fixture (contradictory tests) from `spike/bench/` with the Code_Agent rules (never special-case code to satisfy tests, report contradictions by asking) and record whether the contradiction is reported; this is a recorded result, not a guarantee
    - Pass: the runner asks a question on the ambiguous-story fixture or when told to stop and ask, resumes with an answer, and honors abort within a few seconds. Fail fallback: question opened by code plus a new prompt in the same session, or pi RPC mode `follow_up`; then the harness runtime fallback
    - Record in `spike/results/S-pi-code-ask.md`
    - Design: PiCodeRuntime
    - _Requirements: 40.11, 40.13_
  - [x] 1.9 Spike B part 2: memory fit under the 2 GB cap (TO VERIFY 11)
    - Done 2026-11-22 (reference-deployment.md, "Docker Desktop and memory"): all four containers together peaked at 917 MiB of the 1971 MiB WSL VM; per container 35 to 120 MiB; no OOM kill. The limits stay as they are.
    - Run the Sandbox, a Run_Environment from the 1.6 image, and the logging proxy together with the design's memory limits, then run the pi-coding-agent scenario from 1.7; sample `docker stats`
    - Pass: no container is OOM-killed and the peak stays under the WSL cap. Fail fallback: lower limits or stop the Sandbox earlier
    - Record peaks in `spike/results/S-memory.md`
    - Design: Containers, Initial values; reference-deployment.md (Docker Desktop and memory)
    - _Requirements: 38.3_
  - [x] 1.10 Spike D part 1: ARIA snapshot quality on linkding and screenshot reading (TO VERIFY 9, Open item 45)
    - Done 2026-11-22 (reference-target-linkding.md, "Browser_Use notes"): snapshots give usable role and name targets; one operator turn added a bookmark in 9.4 s with 0 tool errors; a real screenshot was read correctly. The settings page exceeds the 8 KB snapshot cap, so snapshot a region there. Playwright and Chromium install on the PC through the npm mirror (18 s and 44 s).
    - With Playwright against the 1.5 Sandbox, take ARIA snapshots of login, bookmark list, add form, tag view and settings; run one operator turn with `deepseek-flash` that adds a bookmark using snapshot targets; send one real screenshot and ask what is on the page
    - Pass: snapshots give usable role and name targets and the turn adds the bookmark. Fail fallback: screenshots as the main input where snapshots are poor
    - Record in `spike/results/S-aria.md`
    - Design: Browser_Use; reference-target-linkding.md (Browser_Use notes)
    - _Requirements: 14.7, 14.8, 14.9_
  - [x] 1.11 Spike D part 2: pi-agent-core steer and followUp (TO VERIFY 10)
    - Done 2026-11-22: `steer()` entered the same run after the current tool call (sent at 1.5 s, applied at 4.2 s) and the answer covered it; `followUp()` ran after the answer. Judge interjections reach the speaking role at the next tool boundary.
    - Extend `spike/pi/` with a run that calls `steer()` while a turn streams and `followUp()` after it ends
    - Pass: the steered message is taken into the running turn and the follow-up runs after it. Fail fallback: deliver interjections only before the next turn
    - Record in `spike/results/S-pi-steer.md`
    - Design: PiRuntime
    - _Requirements: 12.2, 5.2_
  - [x] 1.12 Record spike outcomes in design.md and the references
    - Done 2026-11-22: TO VERIFY items 1, 2, 3, 9, 10, 11, 15 and 16 updated in design.md; PiCodeRuntime notes on tool activation and plain-text questions; memory and Playwright facts in reference-deployment.md; snapshot facts in reference-target-linkding.md.
    - Update the TO VERIFY list (status per item with the recording reference section, chosen fallback) and the dependent design sections (Containers, PiCodeRuntime, Runtime selection, Adapter contract, Browser_Use); record target-specific results in `reference-target-linkding.md` and host-specific results in `reference-deployment.md`; sanitize spike outputs (no local paths, machine names, account names or secrets)
    - Note: the results of 1.1-1.6 are already recorded there; 1.7-1.11 remain
    - Design: TO VERIFY list
    - _Requirements: 35.5_
  - [x] 1.13 Demo and verify: spike results
    - Done 2026-11-22: every result file exists in `spike/results/` (S-node, S-mirrors, S-linkding-image, S-docker-network, S-linkding-api, S-linkding-source, S-pi-code-linux, S-pi-code-ask; 1.9 to 1.11 are recorded in the references); the secret scan finds neither the real key nor secret-like strings. Only TO VERIFY item 14 stays open (task 17.1).
    - Show the user the pass or fail table per spike with the chosen fallbacks; check that every result file exists and that the secret scan finds nothing in `spike/results/`
    - _Requirements: 23.1, 33.4_

- [x] 2. Foundations (target 2026-11-21)
  - [x] 2.1 Create the steering files
    - `.kiro/steering/product.md` (purpose, honesty rules, UI priority, Studio guarantees versus best effort), `tech.md` (stack, versions, commands, testing rules, fast-check tag format), `structure.md` (repository layout, three document layers)
    - docs/kiro-usage.md (Steering); Design: Repository layout
    - _Requirements: 35.1, 35.5, 35.10_
  - [x] 2.2 Create the Kiro hooks
    - `.kiro/hooks/`: run related vitest tests on save of TypeScript files; run the secret scan on save and before commits; run the Flow_Graph reachability test when `packages/shared/src/flow/` changes
    - docs/kiro-usage.md
    - _Requirements: 30.5, 33.4, 36.7_
  - [x] 2.3 Scaffold the monorepo
    - npm workspaces `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`; directories `runtime-rules/` with `VERSION`, `adapters/linkding/` (placeholder `adapter.json` with the digest and commit from 1.3 and 1.6 and the `api` allow-list from 1.5; the contract and hooks follow in 10.15), `docker/dev-sandbox/`, `docker/llm-proxy/`; vitest and fast-check; `data/` in `.gitignore`; `.env.example` with variable names only
    - Design: Repository layout, Adapter contract, Data directory; reference-target-linkding.md (Adapter JSON example)
    - _Requirements: 32.1, 32.2, 32.3, 33.3, 33.4, 35.1, 35.2_
  - [x]* 2.4 Write repository checks
    - LICENSE is Apache-2.0, `.kiro/` not ignored, no `.env` tracked, `.env.example` present, Adapter has no start procedure field, Verifier imports no LLM module, traceability mapping complete
    - Design: Testing Strategy (Repository checks)
    - _Requirements: 33.2, 33.3, 33.4, 35.5, 39.10, 22.9_
  - [x] 2.5 Define the shared event schema
    - `packages/shared/src/events.ts`: envelope and every payload type of the Data Models table (including `message_progress`, `demo_case_validated`, `api_write`) as a zod discriminated union; Failure_Class enum; `parseEvent`, `serializeEvent`
    - Design: Event envelope, Data Models
    - _Requirements: 27.1, 27.4, 27.9, 27.10, 23.2_
  - [x]* 2.6 Write property test for event serialization round trip
    - Done for serialization; the event-store append part (seq from 1, no gaps) is added with the event store (task 3)
    - **Property 7: Event serialization round trip**
    - **Validates: Requirements 27.4, 27.9**
  - [x] 2.7 Implement the reducer skeleton
    - `packages/shared/src/reducer.ts`: `reduce`, `foldEvents`, UI state shape (presence, feed, artifacts, cards, current node, failure counts), ignoring events with `seq` at or below the last applied seq
    - Design: packages/shared, Web app
    - _Requirements: 26.7, 27.3, 27.14, 36.8_
  - [x] 2.8 Implement Flow_Graph data and transition
    - `packages/shared/src/flow/graph.ts`, `guards.ts`, `transition.ts`: all nodes of the main graph (evidence gathering before `meeting`, the gathering edges to `meeting` with `experienceUnavailable` and `gatheringPartial`, `target_check`) and the API-operation sub-path with kind, tool whitelist and timeout; guarded edges; global edges `timeout`, `unrecoverable_error`, `judge_abort`; `transition()` appends `node_entered` or `transition_rejected`
    - Design: Flow_Graph (node table, rules)
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.6, 36.9, 15.4, 15.5, 19.4_
    - Added 2026-11-22 (R36.6): `failure_review` user loop; unexpected failures and node timeouts stop for the Judge (retry, skip story, end Task); the Task timeout still ends the Task
  - [x] 2.9 Write property test for terminal reachability
    - **Property 1: A terminal is reachable from every node, and terminals are absorbing**
    - Exhaustive over the graph plus 100 random walks; also wired as the build-time check used by the hook
    - **Validates: Requirements 36.5, 36.7**
  - [x] 2.10 Write property test for transition validity
    - **Property 2: Transitions happen only along edges whose guard holds**
    - **Validates: Requirements 36.2, 36.3, 36.4, 36.9, 15.4, 15.5, 15.7, 18.2, 18.3, 18.4, 19.4, 21.1, 25.3, 40.12**
  - [x] 2.11 Demo and verify: foundations
    - Show the user the steering files, the hooks firing on save, and a printed node list with one accepted and one rejected transition; check that `npm test` passes and the secret scan is clean
    - _Requirements: 36.4, 35.1_

- [ ] 3. Event store, SSE, redactor, queue lease and Workspace UI skeleton (target 2026-11-22)
  - [x] 3.1 Implement the secret redactor
    - `packages/shared/src/redact.ts`: registry of known secret values (refuses values shorter than 8 characters), `redact(event)` over every payload string, the same function for SSE `delta` frames
    - Design: Secret redactor
    - _Requirements: 30.15, 28.4, 30.5_
  - [ ] 3.2 Create sanitized fixture events
    - Status 2026-11-22: a SYNTHETIC fixture (`synthetic-gathering-meeting.jsonl`, labeled as such) drives the Workspace for now. The real spike outputs (pi-coding-agent runner traces, ARIA snapshots) are on the PC; copying them to the Mac needs the user (see the session notes)
    - Turn the spike outputs (pi event traces, runner protocol output) into sanitized Studio event fixtures in `packages/shared/test/fixtures/`, one per stage kind; run the secret scan over them
    - Design: Recorded-event fixture suite
    - _Requirements: 27.1, 30.5_
  - [x] 3.3 Implement the event store
    - `apps/server/src/events/store.ts`: single writer per Task, seq assignment, redaction before append and broadcast, JSONL append, fsync after decisions, card answers, terminals and failures, append failure marks the Task incomplete and takes the `unrecoverable_error` edge
    - Design: Persistence and live delivery
    - _Requirements: 27.1, 27.6, 27.9, 30.15_
  - [x] 3.4 Implement Role_Status derivation
    - `roleStatus(state, roleId, now)` with the rule table, Recency_Window 15 s (`GL_RECENCY_WINDOW_S`), waiting for LLM with elapsed seconds, waiting for answer, blocked with reason
    - Design: Role_Status derivation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 2.10_
  - [x] 3.5 Implement the SSE hub
    - `apps/server/src/sse/`: event frames with `id: seq`, ephemeral `delta` frames, `buffer` on connect from in-progress buffers, `queue` and `error` frames, 15 s comment heartbeats, resume with `Last-Event-ID`
    - Design: Persistence and live delivery, HTTP API
    - _Requirements: 2.8, 3.6, 3.11, 27.3, 28.3_
  - [x]* 3.6 Write property test for Role_Status
    - **Property 6: Role_Status never shows work without a recent event**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.8**
  - [x] 3.7 Write property test for secret redaction (persisted and broadcast forms)
    - **Property 12: Secret redaction**
    - Covers the JSONL line and the SSE frame now; the Replay_File part is added in 9.2 to the same test
    - **Validates: Requirements 30.15, 27.12, 28.4, 30.5, 13.5**
  - [x] 3.8 Implement session and queue lease
    - `apps/server/src/queue/` and `http/`: anonymous session cookie, join, heartbeat, leave, single operator lease held during an active Task, idle release 120 s, promotion at Task end, Origin and lease checks on every command endpoint (HTTP 403), admin switch
    - Design: Queue, HTTP API
    - _Requirements: 28.1, 28.2, 28.3, 28.5, 28.6_
  - [x]* 3.9 Write integration tests for the queue
    - A queued session is rejected server-side on every command endpoint; a Viewer receives the stream read-only; promotion after Task end
    - _Requirements: 28.2, 28.5, 28.6_
  - [x] 3.10 Build Presence_Cards and the Activity_Feed driven by fixture events
    - `apps/web`: Presence_Card per role with avatar, name, description and status text; Activity_Feed entries with role, timestamp and source path; the web app loads fixture events from a file in development
    - Design: Web app
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.7, 3.1, 3.2, 3.3, 3.5, 8.4_
  - [x] 3.11 Build the Artifact_Area with the collapsed Engineering details view
    - Tabs for files, diagram, Decision_Doc and browser view; notifications that do not take focus; unavailable reason; Engineering details closed by default and opened only by a Judge action; current Flow_Graph node and progress line (real value or indeterminate with reason)
    - Design: Web app
    - _Requirements: 1.3, 4.1, 4.3, 4.6, 4.7, 4.8, 7.1, 7.2, 7.3, 36.8_
  - [x] 3.12 Build Interaction_Cards and the Interjection_Input
    - Question card (options plus free text), confirm/reject card in feature words, reminder card; Interjection_Input with addressee selector; "received", "delivered" and failure states next to the input; keyboard operation and visible focus
    - Design: Web app, HTTP API (acknowledgement)
    - _Requirements: 5.1, 5.3, 5.4, 5.8, 6.1, 6.4, 6.5, 8.2, 8.3_
  - [x]* 3.13 Write property test for feed entries
    - **Property 5: Every Activity_Feed entry maps to an event**
    - **Validates: Requirements 3.1, 3.3, 3.5**
  - [x]* 3.14 Write UI example tests for the Workspace skeleton
    - All areas present; Engineering details collapsed by default; cards contain no file names, paths or diffs; reduced motion disables non-essential animation; keyboard-only card operation; status text present
    - _Requirements: 1.3, 4.7, 4.8, 5.4, 8.1, 8.2, 8.4_
  - [x] 3.15 Demo and verify: Workspace skeleton
    - Done 2026-11-22: fixture over SSE with a queued second browser (HTTP 403 on commands, "queue position 1"), resume with `Last-Event-ID`, mid-stream reload shows the buffer, secret scan clean; the user reviewed the UI through `/demo`
    - Show the user the Workspace playing the fixture events live over SSE, a second browser as a queued Viewer, and a reload that resumes from `Last-Event-ID`; check `events.jsonl` contains no registered secret and the queued browser gets HTTP 403 on a command
    - _Requirements: 1.1, 2.1, 28.3, 30.15_

  - [x] 3.16 UI demo on mock data and redesign (added 2026-11-22 after the user tried the Workspace)
    - `/demo`: the full linkding story on mock data in the browser (engine, script, decision review, checkpoint mock screen), labeled "DEMO · mock data"; uses the same reducer and components as the live app
    - Agents split by function plus three Meeting_Perspectives (requirements "Roles and Queue Rules"); light redesign (stepper, Now bar, folded timeline, chat bubbles, segmented Details, modern cards); progressive disclosure (R1.9); screenshots in `ui/`
    - _Requirements: 1.2, 1.3, 1.9, 5.7, 11.1, 37.2_

- [x] 4. Checkpoint: Workspace skeleton (target 2026-11-22)
  - Done 2026-11-22: all tests pass; the user tried the demo and accepted the current UI ("keep it as it is for now"). Open from milestone 3: 3.2 (real fixtures, needs the PC files), to be done before milestone 6
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. F1-F2: home input, URL validation, Repo_Reader and immersive reading view (target 2026-11-23)
  - [x] 5.1 Implement GitHub URL parsing and Adapter matching
    - `packages/shared/src/url.ts`: accepted forms (with or without scheme, `www.`, trailing slash, `.git`), normalization, case-insensitive Adapter match
    - Design: packages/shared
    - _Requirements: 9.2, 9.3, 9.5_
  - [x] 5.2 Implement the task runner skeleton
    - `apps/server/src/tasks/runner.ts`: holds TaskState, runs node handlers, applies `transition`, node and Task timeouts with an injectable clock, abort endpoint, backend restart handling (`failure` "backend restarted" and `terminal_reached` failed)
    - Design: apps/server modules, Error Handling
    - _Requirements: 36.2, 36.5, 36.6, 36.8_
  - [x]* 5.3 Write property test for URL validation
    - **Property 14: Home URL validation round trip**
    - **Validates: Requirements 9.2, 9.3, 9.5**
  - [x] 5.4 Build the home page and Task creation
    - Single URL input; error naming the expected form; `POST /api/tasks` checks existence and visibility on GitHub and shows GitHub's reason; `task_created` with repoKind and Runtime_Rules version; the home page states when live execution is unavailable (no Docker engine)
    - Design: HTTP API, Web app
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 25.8, 35.3_
  - [x] 5.5 Implement the Repo_Reader
    - `apps/server/src/reader/`: read-only token, metadata, commit SHA, recursive tree, prioritized reading order, limits 500 files or 4 MB (`GL_READ_MAX_FILES`, `GL_READ_MAX_BYTES`), skip binary and files above 200 KB, cache by SHA, rate limit failure, download failure stops the Task, `file_read` events
    - Design: Repo_Reader
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 34.1, 34.2, 34.3, 34.4, 34.5_
  - [x]* 5.6 Write unit tests for the Repo_Reader
    - Cache hit for the same SHA, skipped list at the limit, rate limit state shown without fabricated content, download failure recorded and Task stopped (fake GitHub server)
    - _Requirements: 10.5, 10.6, 34.2, 34.3, 34.4_
  - [x] 5.7 Build the immersive reading view
    - Artifact_Area file view with the path and the portion read so far; feed narration of each file read; skipped parts list; progress as files read out of the planned count
    - Design: Web app, Repo_Reader
    - _Requirements: 4.4, 10.2, 10.6, 7.1_
  - [x] 5.8 Demo and verify: URL to reading
    - Done 2026-11-23 against real GitHub with a browser walk (`scripts/live-walk-m5.mjs`): invalid URL and missing repository refused without a Task; linkding planned 300 files (limit) and 296 `file_read` events (4 binary after download); a second submit of the same commit read only from the cache; `sindresorhus/is` read as Other_Repo; no token in any `events.jsonl`. In milestone 5 the download is Studio code (shown as "Downloaded"); the Reader agent joins in milestone 6. Steps not built yet stop honestly in failure_review
    - Show the user the linkding URL and one Other_Repo URL being read live, an invalid URL error and a private repository error; check that a second submit of the same commit reads from the cache and that every file read is in `events.jsonl`
    - _Requirements: 9.3, 9.4, 10.2, 34.2_

- [ ] 6. F3: PiRuntime, meeting after evidence gathering with streaming, thinking panel, interjection, question cards, evidence checker (target 2026-11-24)
  - [ ] 6.1 Implement LLM configuration
    - `apps/server/src/llm/`: server default base address and `deepseek-flash` from environment, max_tokens 32768 (`GL_MAX_TOKENS`, raised from 16384 on 2026-11-23), finish reason check, Judge-supplied configuration behind `GL_ALLOW_JUDGE_LLM` (off)
    - Design: LLM configuration and SSRF validation
    - _Requirements: 30.1, 30.2, 30.3, 30.5, 30.12, 30.14_
  - [ ] 6.2 Implement the Runtime_Rules loader and role prompts
    - `runtime-rules/roles/*.md` for the function agents (Reader, Explorer, Facilitator, Planner, Reviewer) and the Meeting_Perspectives (User_Value, Feasibility, Risk); shared behavior rules; `VERSION`; schema export script into `runtime-rules/schemas/`; loader records the version at Task start
    - Design: Repository layout, apps/server modules (`roles/`)
    - _Requirements: 35.2, 35.3, 35.4, 35.6, 35.10_
  - [x] 6.3 Implement the evidence checker
    - Done 2026-11-23: `apps/server/src/evidence/check.ts`; live meeting on linkding: 40 of 40 findings passed
    - `apps/server/src/evidence/`: whitespace-normalized snippet match with at least 8 non-whitespace characters, reasons `file_missing`, `not_downloaded`, `snippet_absent`, `snippet_too_short`
    - Design: Evidence checker
    - _Requirements: 24.1, 24.2, 24.3, 24.5, 24.6_
  - [ ] 6.4 Implement the AgentRuntime interface and PiRuntime
    - Prompt caching per design "Prompt caching": fixed prompt order (shared rules, Task context, role text, variable part), fixed tool order, append-only transcripts; verify that pi-ai reports DeepSeek's cache-hit tokens and record them in `usage`
    - `packages/shared/src/runtime.ts` types; `apps/server/src/runtime/pi.ts`: event mapping table, `message_progress` every 5 s and at the first delta, deltas as SSE frames only, `message_incomplete` plus `failure` on a break, non-streaming fallback note, `beforeToolCall` whitelist, abort
    - Design: AgentRuntime interface, PiRuntime
    - _Requirements: 3.6, 3.7, 3.8, 3.9, 3.11, 27.7, 27.10, 30.9, 30.10, 23.7_
  - [x] 6.4a Implement the Repo_Map and the agent read tools
    - Done 2026-11-23 (`read_memo` and `search_memo` follow with the memo in 6.4b): on the cached linkding download (300 files) the map takes 11 ms; 97 test and 57 generated files are map only, so 146 files (684 of 1840 KB) get an LLM memo
    - `apps/server/src/reader/map.ts`: path, size, lines, language, top-level symbols by per-language regular expressions; map-only classification for tests, vendored and generated files; tools `read_file` with line ranges (400 lines or 16 KB), `search_repo` (30 matches with context), `read_memo`, `search_memo`, all confined to the download
    - Design: Repo_Memo
    - _Requirements: 10.3, 10.7_
  - [x] 6.4b Implement the Repo_Memo builder
    - Done 2026-11-23 (builder and pi memo writer; wiring into the `reading` handler follows): first live run on the cached linkding download (300 files, 27 directories) took 388 s with 64 model messages and 0 failures; 166 LLM memos, 154 map-only, 7 marked "no memo" (root-level config files the model left out of one batch); 304k input tokens of which 18 % cached (provider cache behavior, see the controlled cache test), 75k output tokens
    - Bottom-up: batched file memos per directory (48 KB), directory rollups from children only, root memo; zod schemas; `memo_written` events; concurrency 4; time-short fallback to map-only rollups with the root memo still written; cache by commit and prompt version
    - Design: Repo_Memo
    - _Requirements: 10.7, 10.8, 10.9_
  - [x]* 6.4c Write tests for the Repo_Memo
    - Done 2026-11-23: 8 tests with a scripted fake model
    - Every read file covered by a memo or a map entry; every directory memo covers its children; root exists; cache hit on the same commit; a memo is never accepted as evidence; a missing file memo is marked, not invented (scripted fake model)
    - _Requirements: 10.7, 10.9, 24_
  - [x] 6.4d Implement the Repo_Brief (foreground reading)
    - Progress 2026-11-23: `reader/brief.ts` (ranking, docs outline, plan check and fallback, brief schema, source check, coverage, rendering), writer submit tools, `reading_planned` event, rejected-tool-call cap, 7 tests. Live on linkding (300-file download): plan at 59 s, first memo at 81 s, brief at 157 s (first run with longer brief rules: 259 s); 8 model messages, 0 failures, 2 rejected submissions recovered by the model, 29 % cached input. Done 2026-11-23: cache per commit and prompt version, wired into `reading` with the `briefReady` guard, Workspace view (brief, plan, phase in the now bar). Live UI walk on linkding (421 files, download cached): plan at 7 s, brief at 122 s; a second Task on the same commit shows the brief from the cache at once (`scripts/live-walk-m6-brief.mjs`)
    - Code ranking (README and manifests, entry points and routes, import in-degree) and docs outline; `submit_reading_plan` with caps enforced by code (30 files, 160 KB) and a labeled code-ranking fallback; planned file memos with `features[]`, one visible retry for left-out files in a batch of their own, a visible `failure` when a call ends without a valid submission; `submit_repo_brief` in the generic format with source paths checked against the map; coverage computed by code; cache per commit and prompt version
    - Tests with a scripted fake model: plan caps and unknown paths rejected, fallback labeled, left-out file retried once then marked, brief validates, unknown source paths dropped and counted, coverage matches the map
    - Live check on linkding: time to the first shown result, time to the brief, call count, cache hits, failures
    - Design: Repo_Memo
    - _Requirements: 10.7, 10.8, 10.9, 10.10, 10.11_
  - [x] 6.4e Implement the background Repo_Index
    - Done 2026-11-23: starts after the brief, concurrency 2, stopped at Task end, abort or a new Task (`index_progress`); the meeting does not wait
    - Remaining non-map-only files and directory rollups after the brief, concurrency 2, reuse of foreground memos, progress from `memo_written`, stop recorded at Task end or abort; the reading node does not wait for it
    - _Requirements: 10.8, 10.12_
  - [x]* 6.5 Write property test for evidence marks
    - Done 2026-11-23: `check.property.test.ts`, 300 runs
    - **Property 9: Evidence check marks**
    - **Validates: Requirements 24.2, 24.3, 24.4, 24.5, 11.5, 11.6, 37.6**
  - [ ] 6.6 Implement structured output through submit tools
    - zod validation of `submit_<stage>` arguments, missing submit or truncation counted as LLM output format invalid, one visible retry shown as its own attempt, then the role turn fails
    - Design: PiRuntime
    - _Requirements: 11.2, 23.5, 23.6, 30.4, 30.13_
  - [ ]* 6.7 Write property test for structured output validation
    - **Property 17: Structured output validation**
    - **Validates: Requirements 30.4, 30.13, 23.6, 35.6, 15.2, 40.6, 11.2**
  - [ ]* 6.8 Write unit tests for PiRuntime with a scripted fake model
    - Stream break keeps partial text and records the failure; truncation is discarded; blocked tool recorded as rejected by a safety rule; reasoning persisted with the complete message
    - _Requirements: 3.9, 3.12, 23.7, 30.13_
  - [ ] 6.9 Implement the reading skim and the meeting
    - Done before the revision (2026-11-23): fixed-order meeting, evidence checker in every finding, timed cards; live on linkding 18 min, 40/40 findings passed, little response between perspectives
    - Revision (decided with the user 2026-11-23): parallel preparation into the Evidence_Pool and the Proposal_Board; discussion by speaking signals with code-picked speakers; non-blocking question cards; end condition and summary by code; prompt order with the role text after the transcript; thinking off for signals; background index paused during the meeting; plain-language display per design table (no ids or paths in statements, quotes behind a fold, board in the Details panel)
    - Tests with a scripted turn runner: speaker rules (addressed role, disagree first, never the previous speaker, missing stance named), board changes validated (unknown proposal, missing evidence), quotes checked into the pool, end condition and limits, non-blocking card answer delivered as Judge input, summary built from the board, ids removed from displayed text
    - Live on linkding: total time, statements, responses that name another statement, stances complete, cache hits
    - Facilitator verdicts (decided by the user 2026-11-23): `submit_close` with merges and a verdict per proposal (recommend with rank and conditions, drop, park), `endDiscussion` in a steering turn, recommend refused without a passed quote, board text cleaned of ids; board view sorted by verdict
    - Two kinds of proposals (decided by the user 2026-11-23): `kind: improve | new`, at least one new capability per perspective enforced by code, gap and attach-point evidence, two groups in the board view, Facilitator verdicts on both kinds; measure how many new capabilities appear and are recommended
      - Live 2026-11-23 on linkding: 363 s; 2 of 3 proposals were new capabilities ("Ask your library a question" #2, "Answers and summaries from your archived page copies" #3), both recommended with quotes that show the gap and the attach point; 0 open questions; 1 refused discussion change (missing fields), corrected by the role
    - Progress 2026-11-23: implemented (`meeting/board.ts`, `meeting/meeting.ts`, Board and Evidence views, signals on presence cards, non-blocking cards, index pause), 18 meeting tests. Live on linkding: run 1 (no readability limits) 507 s, 7 proposals, every discussion statement responded to someone, an interjection to Risk made Risk speak next, 0 ids in statements, statements 12.8 s on average, signals 0.7 s, 65 % cached input; run 2 (limits) 242 s, 4 proposals with all three views, ended by code, 0 failures, longest reason 146 characters. Open: one duplicate proposal pair was not merged; the Facilitator once talked about tool fields while correcting a refused merge (rule added, to be measured); little disagreement in run 2 (best effort, measured)
    - Design: Meeting
    - _Requirements: 10.2, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.11, 11.12, 11.13, 5.3, 15.1, 18.1, 18.6_
  - [ ] 6.10 Implement interjection delivery
    - In the meeting, a Judge message enters the transcript, triggers a speaking round, and the addressed role speaks next (revision 2026-11-23)
    - `POST /api/tasks/:id/messages` acknowledges within 1 s (`GL_ACK_BOUND_MS`); `steer()` to the current speaker or prepend to the addressee's next turn; `judge_message` with `deliveredTo`; delivery failure next to the input; `propose_new_version` card
    - During evidence gathering: the message is acknowledged and recorded with status `queued` ("received, delivered when the meeting starts"), and delivered at the meeting start with `judge_message_delivered`; no question card is opened during gathering
    - Design: Meeting, HTTP API, PiRuntime, Flow_Graph (rules)
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 11.10, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
  - [ ] 6.11 Build the live streaming text and the thinking panel
    - Live text with a "live" marker replaced by the complete message; collapsible "model-provided reasoning"; "thinking, N s" when no reasoning arrives; "waiting for LLM, N s"; incomplete mark with reason
    - Design: Web app
    - _Requirements: 2.3, 3.6, 3.8, 3.9, 3.10, 3.12, 3.13_
  - [ ] 6.12 Wire question cards to the answer endpoint
    - `POST /api/tasks/:id/cards/:cardId/answer`, `card_answered` delivered to the asking role, resulting state shown
    - Design: HTTP API, Meeting
    - _Requirements: 5.3, 5.6, 6.5_
  - [ ]* 6.13 Write unit tests for interjection and question flows
    - Message addressed to a role reaches that role first; interjection enters the Event_Stream; unanswered question recorded and the meeting continues; a message sent during reading is queued and delivered at the meeting start; no card is opened during reading
    - _Requirements: 5.2, 11.4, 11.10, 12.3, 12.5, 12.6_
  - [ ] 6.14 Demo and verify: meeting
    - Show the user a real meeting on linkding with `deepseek-flash`: the gathered-evidence summary at the start, a Judge message sent during reading and delivered at the meeting start, streaming text, reasoning panel, an interjection mid-stream, an answered question card, an Unverified mark on a missing snippet, and a reload mid-stream that shows the buffer; check `events.jsonl` has complete messages only and no chunks
    - _Requirements: 3.11, 11.6, 11.9, 12.2, 12.5, 27.7_

- [x] 7. F6: decision step, Decision_Doc schema, versions, hash and freeze (target 2026-11-25)
  - [x] 7.1 Implement the Decision_Doc schema, canonical hash and versions
    - Done 2026-11-23: `packages/shared/src/decision.ts`, `apps/server/src/decision/hash.ts`
    - zod schema for every R15.2 section; canonical JSON (sorted keys, UTF-8) and sha256 over content only; immutable frozen versions; version n+1 on change
    - Design: Decision_Doc
    - _Requirements: 15.2, 15.6, 16.1, 16.4, 16.5_
  - [x]* 7.2 Write property test for hash recomputation
    - Done 2026-11-23: `decision.property.test.ts`, 200 runs
    - **Property 8: Decision_Doc hash recomputation**
    - **Validates: Requirements 16.5**
  - [x] 7.3 Implement the deciding node
    - Done 2026-11-23: `decision/draft.ts`, 3 tests
    - Plan (2026-11-23): Facilitator draft from the meeting summary, then Feasibility and Risk assessments in parallel, merged and checked by code; effort small | medium | large with large flagged as engineering risk (R37.9), also on the meeting board
    - Meeting_Perspectives propose Approach_Options; Feasibility and Risk add Assessments and the Facilitator adds the executable Acceptance_Checks labeled "LLM assessment, not a guarantee"; `submit_decision_draft`; `assessment.complete` computed by code; evidence check of claims and endpoints
    - Design: Decision step
    - _Requirements: 15.1, 15.2, 15.8, 15.9, 15.10, 24.4, 37.1, 37.2, 37.3, 37.5, 37.6, 37.7_
  - [x] 7.4 Implement confirmation and freeze
    - Done 2026-11-23: `decision/desk.ts`, `decision/items.ts`, HTTP actions, 5 tests
    - Item review per `ui/screen-4-decide.png`: draft split into review items by code, accept or reject with a reason (`decision_item_reviewed`), send back only when every item has a verdict, unchanged items keep their verdict by `itemHash`, freeze only when every item is accepted
    - Confirm card in feature words with exactly one selectable approach or combination; freeze records version, hash, session and time (`decision_doc_frozen`); request changes back to `deciding`; Other_Repo end before freeze to `analysis_only`; guards block planning while unconfirmed
    - Design: Decision step, Flow_Graph
    - _Requirements: 5.7, 15.3, 15.4, 15.5, 15.11, 16.2, 16.3, 25.1, 37.4_
  - [x]* 7.5 Write property test for confirmable options
    - Done 2026-11-23: `decision.property.test.ts`, 100 runs
    - **Property 10: Only complete approach options can be confirmed**
    - **Validates: Requirements 15.11, 37.4, 37.5**
  - [x] 7.6 Build the Decision_Doc view
    - Done 2026-11-23: review in the timeline, confirmation record in the Decision tab, `DECISION_DOC.md`
    - Artifact_Area view with version number, Unverified marks, assessment labels, UI impact section and the version history with hashes and confirmation records
    - Design: Decision step, Web app
    - _Requirements: 4.5, 15.8, 15.9, 16.4, 37.3_
  - [x]* 7.7 Write unit tests for the decision step
    - Done 2026-11-23: `desk.test.ts`, `draft.test.ts`
    - Planning blocked while unconfirmed; in-place edit of a frozen version rejected; version chain after a change request
    - _Requirements: 15.4, 15.6, 16.1, 16.2_
  - [x] 7.8 Demo and verify: decision step
    - Done 2026-11-23 on linkding (`scripts/live-walk-m7-decision.mjs`): meeting 315 s, draft 1 after 316 s with 3 options (medium, medium, large flagged as engineering risk), the Judge chose one, rejected the screen item with a reason and sent it back; draft 2 after 152 s kept 4 of 7 items unchanged (their verdicts carried over) and reworded the screen item as asked; freeze created version 1; the recomputed hash equals the recorded one; DECISION_DOC.md written. Found and fixed: the redactor stored shared objects as "[Circular]" (now only real cycles); a reject form stayed open on the next draft (row key now includes the item hash). Open: drafting takes 2.5 to 5 minutes
    - Show the user a real decision step on linkding ending in a frozen Decision_Doc, and a change request that creates version 2; check that the recomputed hash equals the recorded one and that an option without an Acceptance_Check cannot be selected
    - _Requirements: 15.3, 16.5, 37.5_

- [x] 8. Checkpoint M1: any repository from URL to frozen Decision_Doc (target 2026-11-25)
  - Done 2026-11-23 with screen recordings (`scripts/live-walk-m8.mjs`, `data/ui-snaps/m8-*.mp4`), thinking levels sent as reasoning_effort: p-limit (Other_Repo, first read) 298 s to Analysis only (reading 45 s, meeting 166 s, draft 84 s, 0 failures); linkding (brief cached) 220 s to a frozen version 1 (meeting 145 s, draft 53 s). All 164 tests pass. Found: a raw tool validation message was shown in the timeline (now plain words)
  - Ensure all tests pass, ask the user if questions arise.
  - Demo to the user: linkding and one Other_Repo from URL to a frozen Decision_Doc (Other_Repo ending as Analysis only when the Judge ends before freeze).

- [ ] 9. Replay_File export, Replay player and M1 polish (target 2026-11-26)
  - [x] 9.1 Implement the Replay exporter
    - Done 2026-11-23: `apps/server/src/replay/export.ts`, export at the terminal, copy and index for the static host, `GET /replays/:file`
    - `apps/server/src/replay/`: Replay_File with header (schemaVersion, label "Replay"), second secret scan that refuses export and records a failure, `data/replays/<taskId>.json`, static `GET /replays/:taskId.json`
    - Design: Replay_File, Secret redactor
    - _Requirements: 26.6, 27.11, 27.12, 27.13_
  - [x] 9.2 Extend the redaction property test to the Replay_File
    - Done 2026-11-23: `replay/export.property.test.ts`, 100 runs
    - **Property 12: Secret redaction** (same test as 3.7, now also over the exported Replay_File)
    - **Validates: Requirements 30.15, 27.12, 28.4, 30.5, 13.5**
  - [x] 9.3 Build the Replay player
    - Done 2026-11-23: `apps/web/src/replay/ReplayApp.tsx` at `/replay/<taskId>`, Replay list on the home page
    - Same Workspace with a Replay bar (play, pause, speed, seek), permanent "Replay" label, `now` at the playhead, typing animated from the stored Complete_Message with the note that typing speed is simulated
    - Design: Web app
    - _Requirements: 1.5, 7.4, 7.5, 26.2, 26.3, 26.4, 26.9, 27.2, 27.3, 27.8_
  - [x] 9.4 Write property test for live versus Replay equality
    - Done 2026-11-23: `replay.property.test.ts`, 200 runs
    - **Property 4: Live and Replay produce the same UI state**
    - **Validates: Requirements 26.7, 27.14, 7.5**
  - [x] 9.5 Build the final view
    - Done 2026-11-23: `components/FinalView.tsx`, live and Replay; the stepper marks only visited steps; open cards close at the terminal
    - Terminal summary from `terminal_reached`: Verifier results, counts per Failure_Class, Unconfirmed marks, Analysis only or Docs only label
    - Design: Error Handling, Web app
    - _Requirements: 23.3, 25.1, 25.2, 26.1, 26.5_
  - [ ]* 9.6 Write an end-to-end smoke test against a recorded Replay_File
    - Playwright Test: open a Replay, play, seek, check the label and the final view
    - _Requirements: 26.2, 26.4_
  - [ ] 9.7 Polish the M1 path
    - Acknowledgement timing, notifications without focus steal, indeterminate progress reasons, failure display that keeps the original failure visible across retries
    - Design: Web app, Error Handling
    - _Requirements: 4.3, 6.1, 7.2, 23.1, 23.5_
  - [x] 9.8 Demo and verify: Replay
    - Done 2026-11-23: 2026-11-23 with the backend stopped: linkding and p-limit Replays played from the static host, label, seek and final view checked (`scripts/replay-walk.mjs`), recordings `data/ui-snaps/m9-replay-*.mp4`; second scan found no secret
    - Show the user the M1 Task replayed from its Replay_File with the backend stopped; check that the live and Replay final views match and that the Replay_File holds no key or token
    - _Requirements: 26.7, 27.12, 27.13_

- [ ] 10. Containers: dev-sandbox image, LLM_Proxy, Sandbox with test data and reset, Worktree manager, Adapter contract (target 2026-11-27)
  - [x] 10.1 Write the dev-sandbox Dockerfile
    - Done 2026-11-23: `docker/dev-sandbox/Dockerfile`, context script `scripts/dev-sandbox-context.ts` (source by `git archive` from the Adapter's mirror, created from a git bundle on hosts with unreliable clones via `GL_MIRROR_SOURCE_<ID>`), `adapters/linkding/dev-sandbox/setup.sh`, image lock in `docker/dev-sandbox/image/`; Adapter fields `devSandbox.dependencySetup`, `path`, `prebuilt` (gitignored copies into `/work` at sandbox start, checked with `git check-ignore`); built on the PC: 1.11 GB, toolchain and prebuilt paths checked inside the image
    - `docker/dev-sandbox/Dockerfile`: the generic layer (git, Node 24 LTS tarball with its checksum verified at build time, the pi packages at pinned versions, the Code_Agent runner copied from `docker/dev-sandbox/runner/`, task 10.13) on top of the Adapter's base image, built as `graftlab/dev-sandbox-<adapterId>`; package sources as build arguments; for linkding the base is the digest-pinned official image plus uv, the hash-checked dev dependency group, `npm ci` and `npm run build` (prototype: `spike/dev-sandbox/Dockerfile`); settle how the preinstalled Node modules and build output relate to the Worktree at `/work`
    - Design: Images; reference-target-linkding.md (Development_Sandbox for linkding); reference-deployment.md (Network facts, Integrity rules)
    - _Requirements: 39.2, 25.6_
  - [x] 10.2 Implement the Verifier `api_readback` check
    - Done 2026-11-23: `apps/server/src/verifier/readback.ts` (all pages, comparator, pre-state, per-item results, a failing read is a failed check); tested against the in-memory model
    - `apps/server/src/verifier/readback.ts`: reads all pages of the Adapter's read endpoints, applies the Adapter comparator from 10.15 (key matching, field rules, a create whose key existed in the pre-state snapshot compared as an update), per-item results (also used for the reset equality check)
    - Design: Verifier, Adapter contract
    - _Requirements: 22.4, 22.5, 22.7, 22.9, 29.4_
  - [x] 10.3 Implement the container manager
    - Done 2026-11-23: `apps/server/src/containers/{docker,manager}.ts`: Engine API client over the socket or named pipe (no dependency), internal network per Task, LLM_Proxy on the default bridge plus the internal network with the relay port on the loopback interface (`proxy/relay.ts`), Development_Sandbox (read-only root, tmpfs, Worktree the only writable host path, prebuilt copies), baseline Sandbox (image by config digest, own bridge, fresh volume, loopback port), memory limits `GL_MEM_*_MB`, cleanup by label at Task end and at server start, `GL_EXECUTION_ENABLED`. The relay inside a container is tested with the Run_Environment (milestone 14)
    - `apps/server/src/containers/`: Docker Engine API wrapper, internal-only network, the port relay hosted by the LLM_Proxy container, memory limits (`GL_MEM_*_MB`, values per deployment), read-only root and tmpfs, mounts, engine ping at server start, `GL_EXECUTION_ENABLED`
    - Design: Containers, Network policy, Deployment model; reference-deployment.md (Docker Desktop facts, Docker Desktop and memory)
    - _Requirements: 38.2, 38.3, 38.4, 39.1, 39.6, 25.8_
  - [x] 10.4 Write property test for the Adapter comparator
    - Done 2026-11-23: `adapters/linkding/comparator.property.test.ts`, 200 runs
    - **Property 11: The Adapter comparator agrees with a model of the target's write semantics**
    - Lives in `adapters/linkding/`; in-memory linkding model with upsert by normalized URL that replaces title and tags, and generated auto-tag rules (reference-target-linkding.md, Write semantics for the comparator)
    - **Validates: Requirements 22.4, 22.5**
  - [x] 10.5 Implement the LLM_Proxy
    - Done 2026-11-23: the proxy runs in its container with a non-root user and a read-only root; the runner reached the real model through it on the PC; its log held only `POST /chat/completions 200`
    - Progress 2026-11-23 (Mac): `apps/server/src/proxy/{proxy,main,credential}.ts`, bundled with `npm run build:proxy -w apps/server` to `dist/llm-proxy.mjs`; accepts `/chat/completions` (POST) and `/models` (GET), with or without a `/v1` prefix; per-Task credential `glp_…` registered with the redactor as `proxy_credential`; tests cover 10.7 against a fake upstream; the Code_Agent runner ran through it against the real model. Open: running it in its container (10.3) and the port relay
    - `apps/server/src/proxy/` bundled to one file, run on the dev-sandbox image: per-Task bearer credential, allow-listed paths, real key swapped in, streaming passthrough, logs method, path and status only; credential registered with the redactor
    - Design: LLM_Proxy
    - _Requirements: 30.5, 30.16_
  - [x] 10.6 Implement the Worktree manager
    - Done 2026-11-23: `apps/server/src/worktree/worktree.ts` (mirror, clone, branch, config, diff and snapshot with a temporary index, snapshot commits under `refs/graftlab/snapshots/`, Patch_Artifact); 7 tests on a local upstream
    - `apps/server/src/worktree/`: one bare mirror per Adapter (`data/mirror/<adapterId>.git`), `git clone --no-hardlinks`, branch `graftlab/<taskId>`, `core.fileMode=false` and `core.autocrlf=false` on every clone, snapshots, diff with a temporary index, Patch_Artifact; created only for Adapted_Repo when first needed; no linked git worktrees
    - Design: Worktree manager; reference-deployment.md (Docker Desktop facts)
    - _Requirements: 25.6, 38.1, 38.5, 38.6, 38.9_
  - [x]* 10.7 Write integration tests for the LLM_Proxy
    - Done 2026-11-23: `apps/server/src/proxy/proxy.test.ts` (fake upstream, streaming passthrough, log lines)
    - Wrong credential rejected; allowed path forwarded to a fake upstream with the real key; other paths refused
    - _Requirements: 30.16_
  - [x] 10.8 Implement Sandbox start with test data and reset
    - Done 2026-11-23: `apps/server/src/containers/sandbox.ts` over the Adapter contract; on the PC: start 3 s, readiness 33 to 36 s, provision 0.7 s, seed 3 s, equality 11 of 11; a reset after a changed item takes about 36 s and passes again; a start failure is returned as a result naming the step
    - Generic procedure over the Adapter contract: fresh volume, per-Task generated `secretEnv` values (registered with the redactor), readiness wait on the health path, the Adapter's `provision` hook, `testData.seed`, equality by the Verifier with `testData.equals`; a failure is returned as a recorded result, so the caller decides the edge: in `sandbox_start` "experience unavailable" and continue to the meeting (11.1), in `target_check` `failed` "not executed" (14.6)
    - Design: Sandbox and test data, Adapter contract; reference-target-linkding.md (Baseline run, Provisioning, Fixed test data set, reset and restore)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 29.1, 29.3, 29.4, 29.5_
  - [x] 10.9 Implement the restore operation
    - Done 2026-11-23: `POST /api/sandbox/restore` (operator or admin, 409 while one runs) and `SandboxService.guard()`, which blocks Agent actions against the baseline after a failed start, reset or restore until one succeeds; wired to a Task with `sandbox_start` in 11.1
    - `POST /api/sandbox/restore` for the lease holder or the admin only; recreate container and volume, provision, seed, Verifier equality; a failed restore blocks Agent actions against the target baseline until a reset succeeds
    - Design: Sandbox and test data, HTTP API; reference-target-linkding.md (Fixed test data set, reset and restore)
    - _Requirements: 29.2, 29.4, 18.13_
  - [x]* 10.10 Write integration tests for the Development_Sandbox confinement
    - Done 2026-11-23: `containers.integration.test.ts` on the PC (`GL_DOCKER_TESTS=1`): write to `/work` reaches the host and the diff; `/etc` and `/context` refused; no internet; LLM_Proxy reachable; no key and no engine socket inside; a targeted linkding test file passes offline in `/work`
    - Write to `/work` reaches the host Worktree; write to `/etc` fails read-only; no host path outside the Worktree changes; internet request fails; LLM_Proxy reachable
    - _Requirements: 38.2, 38.4, 38.8_
  - [x]* 10.11 Write integration tests for the Sandbox
    - Done 2026-11-23: same file: pinned image, provisioning, test data, equality, reset after a change, recorded start failure; restore for a non-holder refused in `app.test.ts`
    - Start from the pinned digest, provisioning, test data, Verifier equality, restore; restore rejected for a non-holder; a forced start failure is returned as a recorded failure
    - Design: Testing Strategy (Integration tests)
    - _Requirements: 13.2, 13.4, 29.2, 29.4_
  - [ ] 10.12 Demo and verify: containers
    - Show the user a Sandbox reset with the Verifier equality table, a restore, and a write attempt outside `/work` failing; check `docker stats` against the memory limits and that no container has the Docker socket
    - _Requirements: 29.4, 38.2, 38.8_

  - [x] 10.13 Write the Code_Agent runner (`docker/dev-sandbox/runner`) with the protocol, normalized events and unit tests with recorded event fixtures
    - Done 2026-11-23: the runner ran inside the image on the PC (10.14)
    - Progress 2026-11-23 (Mac): protocol and mapper in `packages/shared/src/runner.ts` (the mapper is not yet used by `PiRuntime`), runner workspace `docker/dev-sandbox/runner/` (`controller.ts`, `main.ts`, bundle `npm run build -w docker/dev-sandbox/runner`), rules in `runtime-rules/roles/code_agent.md` read from `/context/rules.md`; fixtures recorded on the Mac with the real model through the LLM_Proxy (fix completed in 43 s; ask: two `ask_question` calls answered in the same process; abort after the first tool call); 10 tests. Open: the runner inside the image (10.1, 10.14)
    - `docker/dev-sandbox/runner/`: embeds `createAgentSession()` with an allow-listed tool set, `SessionManager.inMemory()`, thinking level low, custom provider pointing at the LLM_Proxy; custom `ask_question` tool (zod-validated arguments `kind`, `text`, optional `options`; ends the turn); stdin commands `prompt`, `answer`, `steer`, `abort` validated by zod; stdout normalized JSON-line events using the shared pi event mapping module from 6.4; one long-lived process per story attempt; `dispose()` on exit; shape follows the 1.7 and 1.8 results (embedded runner by default, pi RPC mode if the spike says so)
    - Unit tests with vitest using the sanitized recorded event fixtures from 1.7 and 1.8: every fixture line maps to the expected `RuntimeEvent`, invalid commands are rejected, an `ask_question` call produces a `question` event and the turn ends, `answer` resumes
    - Design: PiCodeRuntime, Repository layout
    - _Requirements: 38.7, 40.2, 40.11, 40.13_
  - [x] 10.14 Demo and verify: Code_Agent runner
    - Done 2026-11-23: `runner.integration.test.ts` on the PC (`GL_LIVE_LLM=1`): `ask_question` answered in the same process, story completed in 38 s with only `greeter.py` changed; abort ends as aborted; no real key in the container; only `/work` and `/tmp` writable. In the first run the scripted answer contradicted the existing test, and the agent asked a second question about the contradiction before changing the test
    - Show the user the runner inside the built dev-sandbox image completing a small story on the toy repository through the LLM_Proxy, a question raised by `ask_question` and answered in the same process, and an abort; check that only `/work` and `/tmp` were written and that no real key is in the container environment
    - _Requirements: 30.16, 40.11, 40.13_
  - [x] 10.15 Implement the Adapter contract and the linkding Adapter
    - Done 2026-11-23: hooks verified against the real image on the PC (provisioning, seed, reset, equality); Adapter fields added: `api.auth`, `devSandbox.dependencySetup`, `path`, `prebuilt`
    - Progress 2026-11-23 (Mac, no containers yet): contract types and strict schema (`packages/shared/src/adapter.ts`), registry validated at server start (`apps/server/src/adapters/registry.ts`), linkding hooks, comparator, test data, in-memory model, checklist; 17 tests. Open until 10.16: the hooks against the real image (provisioning, seed, reset) on the PC
    - `packages/shared/src/adapter.ts`: the Adapter contract types and a zod schema for `adapter.json` (no start-procedure field for the modified target); `apps/server/src/adapters/`: loader and registry validated at server start, case-insensitive match used by 5.1
    - `adapters/linkding/`: `adapter.json` with the real pins, the `api` allow-list (read and write endpoints, op ids, item cap, `itemFields` schema), the comparator (normalized-URL key, tag inclusion, same-URL create compared as an update that replaces title and tags, auto-tagging) with its tests, the provisioning hook (`bookmarks.ApiToken` in the management shell after `/health`, key registered with the redactor), `test-data.json` with seed, reset (fresh volume) and the equality check; `runtime-rules/adapters/linkding-checklist.md`
    - Design: Adapter contract, Sandbox and test data, Verifier; reference-target-linkding.md (all sections)
    - _Requirements: 9.5, 13.3, 13.5, 18.10, 18.11, 22.4, 22.5, 29.1, 29.3, 29.4, 39.10_
  - [ ] 10.16 Demo and verify: Adapter contract and linkding Adapter
    - Show the user `adapter.json` passing the contract schema, the comparator tests (including Property 11 from 10.4) passing, and a Sandbox started through the contract with provisioning, seed and a passing equality table, then a changed item failing the equality check and a reset passing it again; check that no credential appears in `events.jsonl` and that the repository check finds no start-procedure field
    - _Requirements: 29.4, 39.10, 30.15_
- [ ] 11. F4-F5: evidence gathering before the meeting: Sandbox start and Browser_Use experience with live screenshots (target 2026-11-28)
  - [ ] 11.1 Wire `sandbox_start` into the flow
    - Node handler after `adapter_branch` for Adapted_Repo, after reading and before the meeting; a start, provisioning, reset or equality failure (including an unavailable container engine) is recorded, shown, labels the experience "experience unavailable" with the reason, and takes the edge to `meeting`; no Agent action runs against the target baseline in that state; the "not executed" end happens only at `target_check` (14.6)
    - Design: Flow_Graph (rules), Sandbox and test data
    - _Requirements: 13.1, 13.4, 25.8, 29.1, 29.5_
  - [ ] 11.2 Implement Browser_Use tools
    - `apps/server/src/browser/`: Playwright Chromium, route filter that aborts other origins, Studio login, operator tools, ARIA snapshot truncated to 8 KB, screenshots only when image-capable, JPEG after each action, `browser_action` and `browser_observation`, failure recorded before the next action, 40 actions and 5 consecutive failures limit
    - Design: Browser_Use
    - _Requirements: 14.2, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_
  - [ ] 11.3 Implement the `browser_experience` node and the "start the meeting now" control
    - Operator pi agent with `record_note` and no `ask_judge`; analysis notes and live screenshots shown; ends with the observed experience leading to `meeting`; a failure or timeout keeps the observations so far and leads to `meeting` with "experience unavailable"
    - `POST /api/tasks/:id/gathering/end` and a Workspace control "start the meeting now", accepted only in `sandbox_start` and `browser_experience`: stops the running gathering work and leads to `meeting` with the partial label; the `evidence_summary` from 6.9 then includes the experience notes, screenshots and labels
    - Design: Browser_Use, Flow_Graph (rules), Meeting, HTTP API
    - _Requirements: 11.1, 11.9, 12.6, 14.1, 14.3, 14.12, 14.13, 14.14_
  - [ ] 11.4 Build the live browser view
    - Artifact_Area stream of screenshots with action and observation entries
    - Design: Web app, Browser_Use
    - _Requirements: 4.2, 14.2_
  - [ ]* 11.5 Write unit tests for Browser_Use and evidence gathering
    - Route filter blocks another origin; a failed action is recorded before the next one; password never appears in events; an experience timeout and a Sandbox failure each continue to `meeting` with "experience unavailable"; "start the meeting now" gives a partial summary; a Judge message during the experience is queued and delivered at the meeting start; no card is opened during gathering
    - _Requirements: 14.5, 14.6, 13.4, 13.5, 14.13, 14.14, 12.5, 12.6_
  - [ ] 11.6 Demo and verify: evidence gathering and experience
    - Show the user a linkding Task going from reading through Sandbox start to the operator using linkding with live screenshots, then the meeting starting with the gathered-evidence summary; a Judge message sent during the experience and delivered at the meeting start; "start the meeting now" giving a partial summary; a forced Sandbox failure continuing to the meeting with "experience unavailable"; check that every action has an event and a screenshot and that no card was opened during gathering
    - _Requirements: 11.9, 12.5, 13.4, 14.1, 14.2, 14.4, 14.14_

- [ ] 12. Checkpoint: linkding from URL through evidence gathering and meeting to frozen Decision_Doc (target 2026-11-28)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. F7-F8: planning and document-first (target 2026-11-29)
  - [x] 13.1 Implement the planning schemas
    - Done 2026-11-23: `packages/shared/src/planning.ts` (strict Feature_Contract, backlog, Sprint_Plan, Task_Board, Definition_of_Done, Demo_Review_Note, Retrospective, documents, `buildPlan`)
    - Product_Backlog, Story, strict Feature_Contract (no path lists, `executionKind`), Sprint_Plan, Task_Board, Definition_of_Done, Demo_Review_Notes, Retrospective
    - Design: Product_Backlog and Feature_Contract
    - _Requirements: 20.5, 20.6, 20.7, 20.8, 20.9, 40.1, 40.3_
  - [x]* 13.2 Write property test for backlog validity
    - Done 2026-11-23: `planning.property.test.ts`, 200 runs
    - **Property 15: Backlog validity**
    - **Validates: Requirements 20.5, 20.6, 20.9, 40.1, 40.3**
  - [x] 13.3 Implement the planning node
    - Done 2026-11-23: `apps/server/src/planning/plan.ts`; live on the linkding Decision_Doc: Planner 280 s (thinking low), assessments 10 s, Facilitator 165 s with two visible validation retries; 2 stories on the chosen approach
    - Multi-role (R19.1): Planner `submit_plan`, Feasibility and Risk `submit_plan_assessment` in parallel, Facilitator `submit_final_plan`; rejection names the incomplete story; Feature_Contracts derived from the Frozen version and referenced in the Sprint_Plan; `runtime-rules/roles/planner.md`
    - Design: Planning and document-first
    - _Requirements: 19.1, 19.3, 19.9, 19.10, 20.1, 20.4, 20.11, 40.1_
  - [x] 13.9 Implement the plan review
    - Done 2026-11-23: node `plan_review`, card with the stories (`PlanStories`), `textRequiredFor` on cards so sending back needs a reason, agenda for the meeting after a send back; flow tests in `runner.test.ts`
    - Node `plan_review` (wait_user) with edges to `documenting` (confirmed) and `meeting` (sent back with a reason); the card in feature terms; `plan_confirmed` and `plan_sent_back` events; the meeting agenda after a send back
    - Design: Planning and document-first, Flow_Graph
    - _Requirements: 19.11, 19.12, 20.10_
  - [x] 13.4 Implement the documenting node
    - Done 2026-11-23: `apps/server/src/planning/docs.ts`, Task_Board by code, JSON plus Markdown in `docs/`; live: 86 s with thinking off, run environment `uv run manage.py runserver 0.0.0.0:8000` from the Makefile with checked quotes
    - Requirements, design and tasks documents and the Task_Board for the analyzed repository; `runEnvironment` section proposed by the Planner; version recorded; JSON plus Markdown in `data/tasks/<id>/docs/`; Other_Repo ends as Docs only
    - Design: Planning and document-first
    - _Requirements: 19.2, 19.4, 19.6, 20.4, 25.2, 39.9, 39.10_
  - [x] 13.5 Mark documents based on an older version
    - Done 2026-11-23: older documents get the note at the next freeze; the Output_Docs view marks them
    - When a new version is frozen, documents that reference an older version are marked
    - Design: Planning and document-first
    - _Requirements: 20.10_
  - [x] 13.6 Build the Output_Docs view
    - Done 2026-11-23: tab "Plan and documents" (`components/Plan.tsx`, `Plan.test.tsx`)
    - Backlog with Feature_Contracts in feature words, Sprint_Plan, Task_Board statuses, documents rendered from Markdown
    - Design: Web app
    - _Requirements: 4.1, 20.8_
  - [x]* 13.7 Write unit tests for document-first
    - Done 2026-11-23: `runner.test.ts`: Other_Repo ends in `docs_only` after confirmation; a send back goes to the meeting; development blocked while documents are incomplete
    - Development blocked while documents are incomplete; Other_Repo ends in `docs_only` with the label
    - _Requirements: 19.4, 19.6, 25.2_
  - [x] 13.8 Demo and verify: planning and documents
    - Done 2026-11-23: shown to the user and accepted: live walk on DeepSeek (`scripts/live-walk-m13.mjs`, recording `data/ui-snaps/m13-linkding.mp4`): plan 1 with 4 stories sent back with a reason, new meeting and Decision_Doc v2, plan 2 with 2 stories confirmed, 7 documents at v2, rendered Markdown, in 346 s
    - Show the user the backlog with Feature_Contracts and the `runEnvironment` section generated from the M1 Decision_Doc, and an Other_Repo ending as Docs only; check every document records the Frozen version and that a story without a Feature_Contract is rejected
    - _Requirements: 20.4, 20.9, 25.2_

- [ ] 14. F10: pre-execution target check, PiCodeRuntime, development, Reviewer review, stop and ask, Run_Environment, checkpoints, Verifier and API-operation path (target 2026-11-30)
  - [x] 14.21 Download the Adapter's pinned commit for Adapted_Repo
    - Done 2026-11-23: `TaskService.create` uses `adapter.source.commit`; test in `reader.test.ts`
    - `TaskService.create`: an Adapted_Repo reads the commit in `adapter.json` instead of the default-branch head; the Repo_Brief cache follows the commit
    - _Requirements: 10.1_
  - [x] 14.22 Write the splitting skills and validate them
    - Done 2026-11-23: `runtime-rules/skills/{story-splitting,feature-breakdown}.md`; `scripts/eval-skills.ts`; reports `runtime-rules/skills/eval/0.9.0-2026-11-23-first.md` and `0.9.1-2026-11-23.md` (with and without the skill on two real plans; the first report led to the code check of size against files)
    - `runtime-rules/skills/story-splitting.md` and `feature-breakdown.md`, our own text, sources named in the README (Humanizing Work story splitting guide; the two agent skills reviewed 2026-11-23); evaluation script on recorded real plans, report under `runtime-rules/skills/eval/`
    - _Requirements: 19.15_
  - [x] 14.23 Implement the technical design step
    - Done 2026-11-23: `packages/shared/src/techdesign.ts` (schemas, `checkBreakdown`, `unplannedChanges`), `apps/server/src/planning/techdesign.ts`, node `tech_design`, documents TECHNICAL_ARCHITECTURE.md and FEATURE_BREAKDOWN.md, Task_Board per Feature; `techdesign.test.ts`
    - Node `tech_design` after `documenting`; schemas for the Technical Architecture and the Features with the code checks of R19.14; Planner draft, Feasibility review, Reviewer final with the rubric; Task_Board per Feature; documents in the Output_Docs view
    - _Requirements: 19.13, 19.14, 19.15_
  - [x] 14.24 Feature branches and merge into main
    - Worktree `main` at the pinned commit, `feature/<id>` per Feature, `--no-ff` merge after review and Verifier, unmerged branch on failure, diff against the Feature's base, unplanned-change list for the Reviewer
    - _Requirements: 38.5, 38.6, 38.10_
  - [x] 14.25 AI runtime in the meeting and the Decision_Doc
    - `runtime-rules/skills/ai-runtime.md`; `aiRuntime` in the draft schema and the review items; environment facts from the Adapter for Feasibility; the question card; `GL_AI_*` for the Run_Environment and the test container; egress for those two containers with consent (R38.4)
    - _Requirements: 15.12, 38.4_
  - [x] 14.26 Focus pack and Code_Agent rules
    - Focus pack built by code at Feature start (planned files with memo summaries and outlines, one-hop neighbors, an example test, design quotes, outdated marks), delivered as pi's project context file; `grep`, `find`, `ls` enabled; coding rules (assumptions, simplicity, surgical changes, test-driven completion) in `code_agent.md`; reads and changes measured against the pack
    - _Requirements: 40.19_
  - [x] 14.27 Feature status events and the development whiteboard
    - `feature_status` written by code at every phase change; `featureBoard()` in the shared reducer (pure); Board tab in the Details panel with one lane per story, phase track, working agent and live Role_Status, attempt, change size, Verifier badges; Test_Agent avatar in the Team panel
    - _Requirements: 1.10_
  - [x] 14.28 Test_Agent and the red check
    - Node `story_test`; `runtime-rules/roles/test_agent.md`; Test_Agent run with the same runner; test-file-only rule by code; tests committed on the Feature branch; red check in a fresh test container; one visible retry; protected test files checked before the review
    - _Requirements: 40.20, 40.21, 40.22, 22.12_
  - [x] 14.29 Code changes in the Engineering details
    - `code_change` with per-file line counts, planned marks and the diff text; `change_summary` of `main` against the pinned commit at the end; the Changes fold in Engineering_Details
    - _Requirements: 4.9, 38.5_
  - [x] 14.30 Regression_Check
    - Adapter `regression` (linkding: `bookmarks.tests`, Django parser); baseline started in the background at `target_check` and cached; node `regression_check` after the last merge; `regression_result` with counts, new tests, regressions
    - _Requirements: 22.10_
  - [x] 14.31 AI usage and the app's model calls
    - Two proxy credentials; usage log lines in the LLM_Proxy; the app's calls per browser check as a Verifier item (`needsAi`); `ai_usage`; tokens per agent from `message_completed`; prices from `<data>/config/llm-prices.json` recorded in `task_created`; optional demo per story (R21.10); the flow follows the Code_Agent on a changed Test_Agent test (R40.21); usage in the Result view
    - _Requirements: 22.11, 30.19_
  - [x] 14.32 Prewritten AI client library
    - `runtime-libs/python/graftlab_ai/` with its own tests; Adapter `aiClient`; added to `main` at `target_check` as a Studio-provided commit; rules and story bundle name the API; code flag on own model clients in the review
    - _Requirements: 40.23_
  - [x] 14.1 Implement the context builder and the development rules
    - Done 2026-11-23: `apps/server/src/dev/context.ts` (one Feature, its story and contract, the architecture, summaries of the Features it builds on); `runtime-rules/roles/code_agent.md` updated
    - `apps/server/src/dev/context.ts` writes only the story, its Feature_Contract and the referenced documents; Runtime_Rules rules "small scope per Agent" and "no decision power, stop and ask, reviewed by the Reviewer"
    - Design: Development stage
    - _Requirements: 19.5, 19.7, 19.8, 35.8, 35.9, 40.2_
  - [x] 14.2 Implement the PiCodeRuntime
    - `apps/server/src/runtime/pi-code.ts`: Docker exec of the runner (task 10.13) in the Development_Sandbox with the per-Task proxy credential, stdin commands (prompt, answer, steer, abort), stdout protocol parsing with zod, unknown lines counted, `question` events turned into `question_opened`, answer resumes the same process, budget timer that kills the exec, read-only errors as rejected by a safety rule, `final` events mapped to attempt end
    - Design: PiCodeRuntime
    - _Requirements: 30.16, 38.3, 38.7, 38.8, 40.11, 40.13_
  - [ ] 14.3 Implement the Demo_Case schema, validator and check derivation
    - `packages/shared` Demo_Case and suggestion schemas (generic keys and fields); `apps/server/src/apiops/validate.ts` (Item_Count_Cap as the lower of `GL_DEMO_CASE_MAX_ITEMS` and the Adapter's `itemCap`, Adapter allow-list and `itemFields`, Sandbox target); `deriveChecks`
    - Design: Demo_Case and suggestion, Adapter contract; reference-target-linkding.md (Write semantics for the comparator)
    - _Requirements: 18.8, 18.10, 18.11, 18.12_
  - [x]* 14.4 Write property test for small scope per Agent
    - Done 2026-11-23: `apps/server/src/dev/context.property.test.ts`, 200 runs
    - **Property 16: Small scope per Agent**
    - **Validates: Requirements 19.5, 19.7, 35.8, 40.2**
  - [x]* 14.5 Write unit tests for the PiCodeRuntime protocol parser
    - Done 2026-11-23: `apps/server/src/runtime/pi-code.test.ts` with the recorded runner fixtures
    - Sanitized runner event fixtures from 1.7 and 1.8 map to the expected Studio events; invalid lines counted
    - _Requirements: 38.7, 40.11_
  - [x] 14.6 Implement `target_check`, `story_develop` and change recording
    - `target_check` after `adapter_branch_2`, before the first execution story: engine ping, baseline image present by digest, and if an API-operation story remains the Sandbox started or reused after a fresh reset, provisioned and verified with the procedure from 10.8; failure ends the Task in `failed` with the label "not executed"
    - `story_develop`: start or resume the Development_Sandbox, run the Code_Agent, compute changed files and diff with a temporary index, append `code_change`, diff in Engineering details only, budget accounting
    - Design: Flow_Graph (rules), Sandbox and test data, Development stage
    - _Requirements: 13.4, 25.8, 29.5, 38.1, 38.3, 38.5, 39.4, 40.5_
  - [ ]* 14.7 Write property test for change recording
    - **Property 18: Every Code_Agent change is recorded and reviewed**
    - **Validates: Requirements 40.5, 38.5**
  - [x] 14.8 Implement the Reviewer review
    - `story_review`: `read_changed_file`, `read_diff`, `submit_review_verdict`; label "reviewed by Reviewer (LLM judgment)"; request changes back with reasons; escalate to the Facilitator; approach change returns to `deciding`
    - Design: Development stage, Review_Verdict
    - _Requirements: 37.8, 37.9, 40.6, 40.7, 40.8, 40.9, 40.10, 40.15_
  - [x] 14.9 Implement stop and ask
    - `story_ask`: attempts counted, retry limit 3 opens a question; technical questions to Reviewer `answer_question`; feature questions through the Facilitator as a question card; "waiting for answer" status; 300 s unanswered marks the story Unconfirmed-blocked and continues or ends `failed`
    - Design: Development stage, Flow_Graph
    - _Requirements: 2.10, 5.5, 40.11, 40.12, 40.13, 40.14, 40.17_
  - [ ]* 14.10 Write unit tests for development routing with a fake runtime
    - Retry limit leads to a question; technical versus feature routing; a simulated unresolved problem ends in a question and not a widened scope; approach change returns to `deciding`; unanswered question blocks the story
    - _Requirements: 35.9, 40.4, 40.12, 40.13, 40.15, 40.17_
  - [x] 14.11 Implement the Run_Environment
    - Stop the Development_Sandbox, snapshot the Worktree, record `worktree_handoff`, start a fresh Run_Environment per attempt with the `runEnvironment` commands only inside it, reached through the relay, 240 s health wait, failure to `failed`
    - Design: Development stage, Containers
    - _Requirements: 39.3, 39.4, 39.5, 39.6, 39.7, 39.9, 39.11_
  - [x] 14.12 Implement checkpoints and reminders
    - `story_checkpoint` confirm card in feature words with the demo, 120 s wait (`GL_CONFIRM_WAIT_S`), Unconfirmed mark, reminder card at the next Judge input, Demo_Review_Notes entry
    - Design: Development stage
    - _Requirements: 5.8, 20.2, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.8, 21.9_
  - [ ]* 14.13 Write integration test for the Run_Environment
    - Start modified linkding from a snapshot with given commands; health wait; failure path ends `failed`
    - _Requirements: 39.3, 39.5, 39.11_
  - [ ]* 14.14 Write unit tests for checkpoints
    - No response gives Unconfirmed; next input triggers a reminder in feature terms recorded in the Event_Stream
    - _Requirements: 21.4, 21.8, 21.9_
  - [x] 14.15 Complete the Verifier
    - `test_suite` running the test selection named in the check (targeted files by default, guided by the Adapter's test-selection hint) in a fresh test container with a read-only snapshot, scripted `browser_check` without an LLM, per-item results, disagreement display, success only from Verifier results, Retrospective at Task end
    - Design: Verifier
    - _Requirements: 14.11, 20.3, 22.1, 22.2, 22.3, 22.6, 22.7, 22.8, 22.9_
  - [ ] 14.16 Implement the API-operation path with the Demo_Case
    - `api_read` Reviewer loop with `target_api_read` (read-only calls within the Adapter allow-list), `read_file`, `search_repo`, `submit_demo_case`; `api_plan` validation; `api_suggest` and `api_confirm` for purpose B; `apiops/writer.ts` as the only code path that writes to the target (Sandbox origin, allow-list, per item, `api_write` events); `api_try_one`, `api_write_batch`, `api_read_back`; label "designed by Reviewer (LLM judgment)"; checkpoint shows the read-back table
    - Design: Flow_Graph (API-operation sub-path), Development stage (per API-operation story)
    - _Requirements: 15.7, 18.2, 18.3, 18.4, 18.7, 18.9, 18.10, 18.13, 22.1, 40.18_
  - [ ]* 14.17 Write property test for success only from the Verifier
    - **Property 3: Success comes only from the Verifier**
    - **Validates: Requirements 22.3, 40.10, 41.3**
  - [ ] 14.18 Write property test for Demo_Case write constraints
    - **Property 19: Demo_Case write constraints**
    - Recording fake HTTP client; mutated Demo_Cases (missing harmlessness reason, reversal or expected outcome, too many items, disallowed endpoint, other origin)
    - **Validates: Requirements 18.8, 18.9, 18.10, 18.11, 18.12**
  - [ ]* 14.19 Repeat the runtime comparison with real documents
    - Run the first real story context with pi-coding-agent; optionally also with the DeepSeek Harness runtime fallback for comparison; compare out of the box behavior, cost, speed and instruction following; if pi-coding-agent fails, activate the fallback behind the `AgentRuntime` interface; record in `spike/results/S-runtime-real.md`
    - _Requirements: 40.16_
  - [ ] 14.20 Demo and verify: development stage
    - Show the user one source-change story (develop, review, run, checkpoint, Verifier) and one API-operation story (Demo_Case, writes, read-back, Verifier), then a restore; check that success appears only after Verifier results, that every `api_write` names an item of the validated Demo_Case, and that diffs stay in Engineering details
    - _Requirements: 18.9, 22.3, 4.8, 29.2_

- [ ] 15. Checkpoint: full linkding Task (target 2026-11-30)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Scope decision day (target 2026-12-01)
  - [ ] 16.1 Assess status
    - Run the full test suite and one linkding Task end to end; list each milestone sub-task as done, partial or not started in `docs/status-2026-12-01.md`
    - _Requirements: 23.1_
  - [ ] 16.2 Decide what to cut with the user
    - Apply the user's fallback statement: protect the UI (R1-R8) and F1-F6 first; propose a cut list for F7-F10, deployment extras and Stretch items; the user decides
    - _Requirements: 1.1, 15.3_
  - [ ] 16.3 Record the decision
    - Record it in requirements.md Open item 18 and in this file (cut tasks marked as cut); switch off cut stages by configuration (for example `GL_EXECUTION_ENABLED=false`) so the Judge sees honest labels
    - _Requirements: 25.8, 35.5_

- [ ] 17. Deployment: front end on k3s with Cloudflare, tunnel, queue, Judge trial path, static Replay_Files (target 2026-12-02)
  - [ ] 17.1 Spike: SSE through the Cloudflare tunnel (TO VERIFY 14)
    - Stream a test Task through the tunnel for 10 minutes with 15 s heartbeats
    - Pass: events arrive without buffering and the stream survives idle periods. Fail fallback: long polling of `/api/tasks/:id/events?after=<seq>` (implement it in this task if the spike fails)
    - Design: Deployment model, TO VERIFY list; reference-deployment.md (Later deployment)
    - _Requirements: 32.5, 32.7_
  - [ ] 17.2 Write the front-end Pod manifests
    - k3s Deployment and Service that serve the static web build and the Replay_Files; routing of `/api` on the same hostname to the tunnel; no secrets in manifests
    - Note: the user creates the Cloudflare tunnel credentials and the DNS entry
    - Design: Deployment model; reference-deployment.md (Later deployment)
    - _Requirements: 32.2, 32.6, 32.7, 27.13_
  - [ ] 17.3 Add the tunnel configuration and the unreachable-backend handling
    - Tunnel configuration template without credentials; "backend unreachable" banner; SSE reconnect with `Last-Event-ID`; commands fail visibly next to the input
    - Design: Deployment model, Error Handling; reference-deployment.md (Later deployment)
    - _Requirements: 6.4, 32.7_
  - [ ] 17.4 Implement the Judge trial path chosen by the user (Open items 6 and 20)
    - Note: the user settles Open items 6 and 20 first (hosted capped key, a labeled Replay of a real recorded run, or both)
    - Implement the chosen path: hosted key with a cap, and/or a Replay list on the home page; if Judge-supplied keys are enabled, implement the SSRF validator and the per-Task key handling
    - Design: LLM configuration and SSRF validation, Replay_File
    - _Requirements: 26.8, 30.2, 30.8, 30.17_
  - [ ]* 17.5 Write property test for base-address validation
    - **Property 13: Judge base-address validation**
    - **Validates: Requirements 30.17**
  - [ ] 17.6 Write the static Replay_File upload script
    - Upload exported Replay_Files to the front-end Pod after the secret scan; list them on the home page with the "Replay" label
    - Design: Deployment model, Replay_File; reference-deployment.md (Later deployment)
    - _Requirements: 26.8, 27.13_
  - [ ] 17.7 Demo and verify: deployment
    - Show the user the public link with a live Task through the tunnel, a second browser queued, and a Replay that plays with the PC backend stopped; check the Judge-facing link is unchanged after restarting the backend
    - _Requirements: 28.2, 27.13, 32.7_

- [ ] 18. Halloween avatar effects, UI polish and submission materials (target 2026-12-03)
  - [ ] 18.1 Implement Halloween avatar effects bound to Role_Status
    - Effects driven only by the derived Role_Status; no effect without a backing event; disabled under reduced motion; Frankenstein stays the category
    - Design: Web app
    - _Requirements: 1.7, 2.9, 8.1_
  - [ ]* 18.2 Write a unit test for avatar effects
    - No activity effect is rendered for a role whose status is idle or waiting
    - _Requirements: 2.9_
  - [ ] 18.3 Polish the UI
    - Layout and copy across Home, Workspace and Replay; feature-first wording on every card
    - Design: Web app
    - _Requirements: 4.1, 5.4, 21.2_
  - [ ] 18.4 Write the README
    - Run instructions, how Judges try the product, new-work statement, third-party notices: pi packages MIT, Playwright Apache-2.0, linkding MIT as an unmodified external dependency, the DeepSeek Harness runtime only if it was activated as the fallback (MIT with its THIRD_PARTY_NOTICES, to be verified), Remotion only if used; Kiroween rule facts kept as TO BE CONFIRMED
    - docs/kiro-usage.md; Design: Deployment model; reference-deployment.md (First deployment); reference-target-linkding.md (Identity and why linkding)
    - _Requirements: 33.1, 33.5, 33.6, 33.8, 27.5_
  - [ ] 18.5 Write the Kiro usage write-up
    - `docs/kiro-usage.md`: spec-driven build, steering, hooks, spike results feeding the design
    - docs/kiro-usage.md
    - _Requirements: 33.7_
  - [ ] 18.6 Write the Devpost English text
    - `docs/devpost.md`: what it does, how it was built, Frankenstein statement, honest limits
    - _Requirements: 33.7, 1.7_
  - [ ] 18.7 Write the demo video script
    - `docs/video-script.md`: at most 3 minutes, shot list based on a live run and a labeled Replay
    - Note: the user records the video
    - _Requirements: 33.10, 26.2_
  - [ ] 18.8 Demo and verify: polish and materials
    - Show the user the effects, the README and the texts; check the README license list against the installed packages and that no file contains a key, private address or account name
    - _Requirements: 33.4, 33.6_

- [ ] 19. Submission day: code freeze at noon, fresh-clone verification, external access test (target 2026-12-04)
  - Note: the user uploads the video to YouTube and submits on Devpost in the afternoon
  - [ ] 19.1 Run the code-freeze checks
    - Full test suite, repository checks, secret scan, tasks.md status updated; the user makes the final commit
    - _Requirements: 33.3, 33.4_
  - [ ] 19.2 Verify from a fresh clone
    - Clone into a temporary directory, follow the README exactly, build, run the tests, start, play a Replay; fix any README gap found
    - _Requirements: 33.1, 32.1_
  - [ ] 19.3 Run the external access test
    - Scripted smoke test against the public URL: home page loads, a Replay plays, the SSE stream connects, a second session is queued
    - _Requirements: 28.2, 27.13, 33.9_

- [ ] 20. Stretch items (optional, only if time remains after the scope decision)
  - [ ]* 20.1 Implement Case_Cards
    - Team-written cards in `runtime-rules/cases/` with source link and evidence boundary, shown by workflow tag
    - Design: Stretch features (Case_Cards)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_
  - [ ]* 20.2 Implement Prototype during the requirement meeting
    - `prototype` node behind a flag, separate clone, "Prototype" label everywhere, never success, never bypasses the freeze
    - Design: Stretch features (Prototype)
    - _Requirements: 41.1, 41.2, 41.3, 41.4, 41.5, 41.6, 41.7, 41.8_
  - [ ]* 20.3 Implement narration
    - Segments of at most 240 characters, serial rate-limited calls to the TTS_Service, compressed cached audio, silent Replay with a note when unavailable
    - Design: Stretch features (Narration)
    - _Requirements: 31.1, 31.2, 31.3, 31.4, 31.5, 31.6, 31.7_
  - [ ]* 20.4 Implement the Remotion presentation
    - Remotion composition over a Replay_File with the shared reducer; README license note
    - Design: Stretch features (Remotion presentation)
    - _Requirements: 27.2, 27.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; the required property tests (Properties 1, 2, 4, 11, 12, 19) are not marked.
- The schedule follows the user's dates; the scope decision on 2026-12-01 may cut tasks from milestones 13-14 and 17-20, while the UI (R1-R8) and F1-F6 are protected first.
- Spike results that change the design are written back to design.md in 1.12 before dependent tasks start; target-specific and host-specific results go to `reference-target-linkding.md` and `reference-deployment.md`.
- Each task references specific requirement criteria for traceability; Correctness Property numbers refer to design.md.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "1.5"] },
    { "id": 2, "tasks": ["1.6", "1.10"] },
    { "id": 3, "tasks": ["1.7", "1.11"] },
    { "id": 4, "tasks": ["1.8"] },
    { "id": 5, "tasks": ["1.9"] },
    { "id": 6, "tasks": ["1.12"] },
    { "id": 7, "tasks": ["1.13"] },
    { "id": 8, "tasks": ["2.1", "2.3"] },
    { "id": 9, "tasks": ["2.2", "2.5"] },
    { "id": 10, "tasks": ["2.4", "2.6", "2.7"] },
    { "id": 11, "tasks": ["2.8"] },
    { "id": 12, "tasks": ["2.9", "2.10"] },
    { "id": 13, "tasks": ["2.11"] },
    { "id": 14, "tasks": ["3.1", "3.2"] },
    { "id": 15, "tasks": ["3.3", "3.4"] },
    { "id": 16, "tasks": ["3.5", "3.6"] },
    { "id": 17, "tasks": ["3.7", "3.8"] },
    { "id": 18, "tasks": ["3.9", "3.10"] },
    { "id": 19, "tasks": ["3.11"] },
    { "id": 20, "tasks": ["3.12", "3.13"] },
    { "id": 21, "tasks": ["3.14"] },
    { "id": 22, "tasks": ["3.15"] },
    { "id": 23, "tasks": ["4"] },
    { "id": 24, "tasks": ["5.1", "5.2"] },
    { "id": 25, "tasks": ["5.3", "5.4"] },
    { "id": 26, "tasks": ["5.5"] },
    { "id": 27, "tasks": ["5.6", "5.7"] },
    { "id": 28, "tasks": ["5.8"] },
    { "id": 29, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 30, "tasks": ["6.4", "6.5"] },
    { "id": 31, "tasks": ["6.6"] },
    { "id": 32, "tasks": ["6.7", "6.8"] },
    { "id": 33, "tasks": ["6.9"] },
    { "id": 34, "tasks": ["6.10", "6.11"] },
    { "id": 35, "tasks": ["6.12"] },
    { "id": 36, "tasks": ["6.13"] },
    { "id": 37, "tasks": ["6.14"] },
    { "id": 38, "tasks": ["7.1"] },
    { "id": 39, "tasks": ["7.2", "7.3"] },
    { "id": 40, "tasks": ["7.4"] },
    { "id": 41, "tasks": ["7.5", "7.6"] },
    { "id": 42, "tasks": ["7.7"] },
    { "id": 43, "tasks": ["7.8"] },
    { "id": 44, "tasks": ["8"] },
    { "id": 45, "tasks": ["9.1"] },
    { "id": 46, "tasks": ["9.2", "9.3"] },
    { "id": 47, "tasks": ["9.4", "9.5"] },
    { "id": 48, "tasks": ["9.6", "9.7"] },
    { "id": 49, "tasks": ["9.8"] },
    { "id": 50, "tasks": ["10.1", "10.13", "10.15"] },
    { "id": 51, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 52, "tasks": ["10.5", "10.6"] },
    { "id": 53, "tasks": ["10.7", "10.8"] },
    { "id": 54, "tasks": ["10.9", "10.10"] },
    { "id": 55, "tasks": ["10.11"] },
    { "id": 56, "tasks": ["10.12", "10.14", "10.16"] },
    { "id": 57, "tasks": ["11.1", "11.2"] },
    { "id": 58, "tasks": ["11.3", "11.4"] },
    { "id": 59, "tasks": ["11.5"] },
    { "id": 60, "tasks": ["11.6"] },
    { "id": 61, "tasks": ["12"] },
    { "id": 62, "tasks": ["13.1"] },
    { "id": 63, "tasks": ["13.2", "13.3"] },
    { "id": 64, "tasks": ["13.4"] },
    { "id": 65, "tasks": ["13.5", "13.6"] },
    { "id": 66, "tasks": ["13.7"] },
    { "id": 67, "tasks": ["13.8"] },
    { "id": 68, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 69, "tasks": ["14.4", "14.5", "14.6"] },
    { "id": 70, "tasks": ["14.7", "14.8"] },
    { "id": 71, "tasks": ["14.9"] },
    { "id": 72, "tasks": ["14.10", "14.11"] },
    { "id": 73, "tasks": ["14.12", "14.13"] },
    { "id": 74, "tasks": ["14.14", "14.15"] },
    { "id": 75, "tasks": ["14.16", "14.17"] },
    { "id": 76, "tasks": ["14.18", "14.19"] },
    { "id": 77, "tasks": ["14.20"] },
    { "id": 78, "tasks": ["15"] },
    { "id": 79, "tasks": ["16.1"] },
    { "id": 80, "tasks": ["16.2"] },
    { "id": 81, "tasks": ["16.3"] },
    { "id": 82, "tasks": ["17.1", "17.2"] },
    { "id": 83, "tasks": ["17.3", "17.4"] },
    { "id": 84, "tasks": ["17.5", "17.6"] },
    { "id": 85, "tasks": ["17.7"] },
    { "id": 86, "tasks": ["18.1", "18.4", "18.5"] },
    { "id": 87, "tasks": ["18.2", "18.3", "18.6"] },
    { "id": 88, "tasks": ["18.7"] },
    { "id": 89, "tasks": ["18.8"] },
    { "id": 90, "tasks": ["20.1", "20.2"] },
    { "id": 91, "tasks": ["20.3", "20.4"] },
    { "id": 92, "tasks": ["19.1"] },
    { "id": 93, "tasks": ["19.2"] },
    { "id": 94, "tasks": ["19.3"] }
  ]
}
```
