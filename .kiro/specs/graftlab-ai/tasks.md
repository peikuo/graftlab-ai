# Implementation Plan: GraftLab AI

## Overview

The plan follows the schedule from today (2026-11-20 evening) to the real last working day 2026-12-04 (deadline 2026-12-05 06:00 Beijing time), for one developer. Each top-level task is a milestone with its target date in the title. The spike milestone comes first: it verifies the design's TO VERIFY items that block later work, each with a clear pass or fail and the fallback from design.md ("TO VERIFY list"). After that, each stage is built with the real output of the previous stage (Process Principle 6), all in TypeScript.

Conventions:

- Each sub-task is sized for one focused session and names the design section it implements ("Design: ...").
- Every feature milestone ends with a "Demo and verify" sub-task (layer A process note): what to show the user and how to check it.
- Property-based tests use fast-check with vitest, at least 100 runs, tagged `// Feature: graftlab-ai, Property <n>: <property text>`. These property tests are required: Property 1 and 2 (Flow_Graph reachability and transition validity), Property 4 (live versus Replay reducer equality), Property 11 (Verifier tag inclusion and same-URL update), Property 12 (secret redaction) and Property 19 (Demo_Case write constraints). All other test sub-tasks are optional and marked with `*`.
- Actions only the user can do (upgrading Node, pulling images on another machine, creating accounts, tunnel credentials, DNS, uploading the video, submitting on Devpost) are notes inside the relevant task, not tasks.
- No real key, token, private IP, private hostname, account name or e-mail address is written into any committed file; `.env` files are never read or committed.

## Tasks

- [ ] 1. Spike milestone: verify blocking TO VERIFY items (target 2026-11-21 to 2026-11-22)
  - [ ] 1.1 Check Node >=22.19 on the PC (TO VERIFY 12, Open item 47)
    - Run `node --version` on the PC and rerun `spike/pi/smoke.mjs` against `deepseek-flash` (streaming, tool call, abort)
    - Pass: version >=22.19.0 and the smoke test completes. Fail: stop; there is no fallback (required)
    - Note: the user upgrades Node on the PC; the task only checks it
    - Record the result in `spike/results/S-node.md`
    - Design: TO VERIFY list, Deployment and hosting
    - _Requirements: 32.6, 30.9_
  - [ ] 1.2 Check package mirror reachability from the PC at image build time (TO VERIFY 13)
    - Throwaway Dockerfile in `spike/mirrors/` on `ubuntu:latest` that runs `apt-get update`, a `pip download`, an `npm view`, a fetch from nodejs.org and a `git ls-remote` against GitHub; separately run the Playwright Chromium download on the host
    - Pass: every source is reachable during `docker build`. Fail fallback: download on another machine and transfer, as for images
    - Record per-source results in `spike/results/S-mirrors.md`
    - Design: Images, TO VERIFY list
    - _Requirements: 39.2_
  - [ ] 1.3 Verify linkding image transfer by docker save/load and digest check (Open item 48)
    - Load the transferred tar with `docker load`; compare `docker image inspect` RepoDigests with the digest recorded on the other machine; record digest, version tag and platform for `adapters/linkding/adapter.json`
    - Pass: digest matches and the image starts and answers on port 9090. Fail: re-transfer; no other fallback (the Sandbox depends on it)
    - Note: the user pulls with `--platform linux/amd64` and runs `docker save` on another machine
    - Record in `spike/results/S-linkding-image.md`
    - Design: Images, Sandbox and test data
    - _Requirements: 13.3, 25.6_
  - [ ] 1.4 Spike B part 1: Docker Desktop internal network, published port and bind mount (TO VERIFY 4, 5)
    - Create a network with `internal: true`, start a test container on it only with a port published to `127.0.0.1`, curl it from the host; check that the container cannot reach the internet
    - Bind mount a host directory holding a linkding clone with `core.autocrlf=false` at `/work`; write from the container; check host visibility, file mode, LF line endings, and the time of `git status`
    - Pass: curl answers, internet blocked, writes visible with LF and acceptable speed. Fail fallback: LLM_Proxy container relays the app port; Worktree in a named volume with a helper container for diffs
    - Record in `spike/results/S-docker-network.md`
    - Design: Containers, Worktree manager, TO VERIFY list
    - _Requirements: 38.4, 39.6_
  - [ ] 1.5 Spike C part 1: linkding API token creation and API allow-list paths (TO VERIFY 6)
    - Start the pinned image with a generated superuser password, create a token with a Django management shell command inside the container, then call `GET /api/bookmarks/`, `POST /api/bookmarks/`, `PATCH /api/bookmarks/{id}/`, `POST /api/bookmarks/{id}/archive/` and `GET /api/tags/`; confirm the same-URL update behavior and tag merging
    - Pass: token works and every allow-list endpoint answers as documented. Fail fallback: create the token through the settings page with Playwright; correct the allow-list to the observed paths
    - Record in `spike/results/S-linkding-api.md` (no token values)
    - Design: Sandbox and test data, Adapter, Demo_Case and suggestion
    - _Requirements: 13.2, 18.10, 29.1_
  - [ ] 1.6 Spike C part 2: run linkding from source in a dev-sandbox-like image (TO VERIFY 7, 8)
    - Throwaway Dockerfile in `spike/dev-sandbox/` on `ubuntu:latest` with Python 3, Node and git; clone linkding at the commit of the pinned image tag; preinstall Python and Node dependencies; run migrations, the frontend build, the dev server with a health path, and the linkding test command
    - Pass: the app answers on its health path and the test command runs; the image tag and the commit are the same release. Fail fallback: pin a Python version linkding supports; choose a tag that exists for both
    - Record the working commands (they inform the Agent_Roles' `runEnvironment` analysis, not an Adapter recipe) in `spike/results/S-linkding-source.md`
    - Design: Images, Run_Environment, TO VERIFY list
    - _Requirements: 39.2, 39.9, 39.10_
  - [ ] 1.7 Spike A part 1: harness runtime Linux build in a container with read-only root through the LLM_Proxy (TO VERIFY 1, 3)
    - Put the Linux x86_64 runtime executable from the PyPI wheel into the spike image; run it with read-only root filesystem, tmpfs `/tmp`, `HOME` and `DSH_HOME`, `/work` writable, on an internal network with a throwaway logging proxy that logs method, path and status only
    - Run the "fix failing tests" scenario from `spike/bench/` through the proxy; read the proxy log to find the cause of the earlier HTTP 404 (base address form or path)
    - Pass: the scenario completes through the proxy and the JSONL event types match the macOS spike. Fail fallback: item 1 OpenCode or OpenHands SDK as Code_Agent runtime; item 3 writable root with confinement by mounts only
    - Record in `spike/results/S-harness-linux.md`, with sanitized JSONL samples for later fixtures
    - Design: HarnessRuntime, LLM_Proxy, TO VERIFY list
    - _Requirements: 30.16, 38.2, 38.8_
  - [ ] 1.8 Spike A part 2: harness headless ask behavior (TO VERIFY 2)
    - Run the ambiguous scenario with a story prompt that states the stop-and-ask rule; inspect the JSONL for an ask-user event; test resume with `--session-id` and an answer
    - Pass: an ask event appears and resume works. Fail fallback: the `graftlab_question` JSON block in the final message plus resume with `--session-id` (verify that this fallback works either way)
    - Record in `spike/results/S-harness-ask.md`
    - Design: HarnessRuntime
    - _Requirements: 40.11, 40.13_
  - [ ] 1.9 Spike B part 2: memory fit under the 2 GB cap (TO VERIFY 11)
    - Run the Sandbox, a Run_Environment from the 1.6 image, and the logging proxy together with the design's memory limits, then run the harness scenario; sample `docker stats`
    - Pass: no container is OOM-killed and the peak stays under the WSL cap. Fail fallback: lower limits or stop the Sandbox earlier
    - Record peaks in `spike/results/S-memory.md`
    - Design: Containers, Initial values
    - _Requirements: 38.3_
  - [ ] 1.10 Spike D part 1: ARIA snapshot quality on linkding and screenshot reading (TO VERIFY 9, Open item 45)
    - With Playwright against the 1.5 Sandbox, take ARIA snapshots of login, bookmark list, add form, tag view and settings; run one operator turn with `deepseek-flash` that adds a bookmark using snapshot targets; send one real screenshot and ask what is on the page
    - Pass: snapshots give usable role and name targets and the turn adds the bookmark. Fail fallback: screenshots as the main input where snapshots are poor
    - Record in `spike/results/S-aria.md`
    - Design: Browser_Use
    - _Requirements: 14.7, 14.8, 14.9_
  - [ ] 1.11 Spike D part 2: pi-agent-core steer and followUp (TO VERIFY 10)
    - Extend `spike/pi/` with a run that calls `steer()` while a turn streams and `followUp()` after it ends
    - Pass: the steered message is taken into the running turn and the follow-up runs after it. Fail fallback: deliver interjections only before the next turn
    - Record in `spike/results/S-pi-steer.md`
    - Design: PiRuntime
    - _Requirements: 12.2, 5.2_
  - [ ] 1.12 Record spike outcomes in design.md
    - Update the TO VERIFY list (status per item, chosen fallback) and the dependent design sections (Containers, HarnessRuntime, Adapter allow-list, Browser_Use); sanitize spike outputs (no local paths, machine names, account names or secrets)
    - Design: TO VERIFY list
    - _Requirements: 35.5_
  - [ ] 1.13 Demo and verify: spike results
    - Show the user the pass or fail table per spike with the chosen fallbacks; check that every result file exists and that the secret scan finds nothing in `spike/results/`
    - _Requirements: 23.1, 33.4_

- [ ] 2. Foundations (target 2026-11-21)
  - [ ] 2.1 Create the steering files
    - `.kiro/steering/product.md` (purpose, honesty rules, UI priority, Studio guarantees versus best effort), `tech.md` (stack, versions, commands, testing rules, fast-check tag format), `structure.md` (repository layout, three document layers)
    - Design: Kiro usage plan, Repository layout
    - _Requirements: 35.1, 35.5, 35.10_
  - [ ] 2.2 Create the Kiro hooks
    - `.kiro/hooks/`: run related vitest tests on save of TypeScript files; run the secret scan on save and before commits; run the Flow_Graph reachability test when `packages/shared/src/flow/` changes
    - Design: Kiro usage plan
    - _Requirements: 30.5, 33.4, 36.7_
  - [ ] 2.3 Scaffold the monorepo
    - npm workspaces `apps/server` (Fastify), `apps/web` (React + Vite), `packages/shared`; directories `runtime-rules/` with `VERSION`, `adapters/linkding/` (`adapter.json` with the digest and commit from 1.3 and 1.6, the `api` allow-list from 1.5, `test-data.json`), `docker/dev-sandbox/`, `docker/llm-proxy/`; vitest and fast-check; `data/` in `.gitignore`; `.env.example` with variable names only
    - Design: Repository layout, Adapter, Data directory
    - _Requirements: 32.1, 32.2, 32.3, 33.3, 33.4, 35.1, 35.2_
  - [ ]* 2.4 Write repository checks
    - LICENSE is Apache-2.0, `.kiro/` not ignored, no `.env` tracked, `.env.example` present, Adapter has no start procedure field, Verifier imports no LLM module, traceability mapping complete
    - Design: Testing Strategy (Repository checks)
    - _Requirements: 33.2, 33.3, 33.4, 35.5, 39.10, 22.9_
  - [ ] 2.5 Define the shared event schema
    - `packages/shared/src/events.ts`: envelope and every payload type of the Data Models table (including `message_progress`, `demo_case_validated`, `api_write`) as a zod discriminated union; Failure_Class enum; `parseEvent`, `serializeEvent`
    - Design: Event envelope, Data Models
    - _Requirements: 27.1, 27.4, 27.9, 27.10, 23.2_
  - [ ]* 2.6 Write property test for event serialization round trip
    - **Property 7: Event serialization round trip**
    - **Validates: Requirements 27.4, 27.9**
  - [ ] 2.7 Implement the reducer skeleton
    - `packages/shared/src/reducer.ts`: `reduce`, `foldEvents`, UI state shape (presence, feed, artifacts, cards, current node, failure counts), ignoring events with `seq` at or below the last applied seq
    - Design: packages/shared, Web app
    - _Requirements: 26.7, 27.3, 27.14, 36.8_
  - [ ] 2.8 Implement Flow_Graph data and transition
    - `packages/shared/src/flow/graph.ts`, `guards.ts`, `transition.ts`: all nodes of the main graph and the API-operation sub-path with kind, tool whitelist and timeout; guarded edges; global edges `timeout`, `unrecoverable_error`, `judge_abort`; `transition()` appends `node_entered` or `transition_rejected`
    - Design: Flow_Graph (node table, rules)
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.6, 36.9, 15.4, 15.5, 19.4_
  - [ ] 2.9 Write property test for terminal reachability
    - **Property 1: A terminal is reachable from every node, and terminals are absorbing**
    - Exhaustive over the graph plus 100 random walks; also wired as the build-time check used by the hook
    - **Validates: Requirements 36.5, 36.7**
  - [ ] 2.10 Write property test for transition validity
    - **Property 2: Transitions happen only along edges whose guard holds**
    - **Validates: Requirements 36.2, 36.3, 36.4, 36.9, 15.4, 15.5, 15.7, 18.2, 18.3, 18.4, 19.4, 21.1, 25.3, 40.12**
  - [ ] 2.11 Demo and verify: foundations
    - Show the user the steering files, the hooks firing on save, and a printed node list with one accepted and one rejected transition; check that `npm test` passes and the secret scan is clean
    - _Requirements: 36.4, 35.1_

- [ ] 3. Event store, SSE, redactor, queue lease and Workspace UI skeleton (target 2026-11-22)
  - [ ] 3.1 Implement the secret redactor
    - `packages/shared/src/redact.ts`: registry of known secret values (refuses values shorter than 8 characters), `redact(event)` over every payload string, the same function for SSE `delta` frames
    - Design: Secret redactor
    - _Requirements: 30.15, 28.4, 30.5_
  - [ ] 3.2 Create sanitized fixture events
    - Turn the spike outputs (pi event traces, harness JSONL) into sanitized Studio event fixtures in `packages/shared/test/fixtures/`, one per stage kind; run the secret scan over them
    - Design: Recorded-event fixture suite
    - _Requirements: 27.1, 30.5_
  - [ ] 3.3 Implement the event store
    - `apps/server/src/events/store.ts`: single writer per Task, seq assignment, redaction before append and broadcast, JSONL append, fsync after decisions, card answers, terminals and failures, append failure marks the Task incomplete and takes the `unrecoverable_error` edge
    - Design: Persistence and live delivery
    - _Requirements: 27.1, 27.6, 27.9, 30.15_
  - [ ] 3.4 Implement Role_Status derivation
    - `roleStatus(state, roleId, now)` with the rule table, Recency_Window 15 s (`GL_RECENCY_WINDOW_S`), waiting for LLM with elapsed seconds, waiting for answer, blocked with reason
    - Design: Role_Status derivation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6, 2.8, 2.10_
  - [ ] 3.5 Implement the SSE hub
    - `apps/server/src/sse/`: event frames with `id: seq`, ephemeral `delta` frames, `buffer` on connect from in-progress buffers, `queue` and `error` frames, 15 s comment heartbeats, resume with `Last-Event-ID`
    - Design: Persistence and live delivery, HTTP API
    - _Requirements: 2.8, 3.6, 3.11, 27.3, 28.3_
  - [ ]* 3.6 Write property test for Role_Status
    - **Property 6: Role_Status never shows work without a recent event**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.8**
  - [ ] 3.7 Write property test for secret redaction (persisted and broadcast forms)
    - **Property 12: Secret redaction**
    - Covers the JSONL line and the SSE frame now; the Replay_File part is added in 9.2 to the same test
    - **Validates: Requirements 30.15, 27.12, 28.4, 30.5, 13.5**
  - [ ] 3.8 Implement session and queue lease
    - `apps/server/src/queue/` and `http/`: anonymous session cookie, join, heartbeat, leave, single operator lease held during an active Task, idle release 120 s, promotion at Task end, Origin and lease checks on every command endpoint (HTTP 403), admin switch
    - Design: Queue, HTTP API
    - _Requirements: 28.1, 28.2, 28.3, 28.5, 28.6_
  - [ ]* 3.9 Write integration tests for the queue
    - A queued session is rejected server-side on every command endpoint; a Viewer receives the stream read-only; promotion after Task end
    - _Requirements: 28.2, 28.5, 28.6_
  - [ ] 3.10 Build Presence_Cards and the Activity_Feed driven by fixture events
    - `apps/web`: Presence_Card per role with avatar, name, description and status text; Activity_Feed entries with role, timestamp and source path; the web app loads fixture events from a file in development
    - Design: Web app
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 2.7, 3.1, 3.2, 3.3, 3.5, 8.4_
  - [ ] 3.11 Build the Artifact_Area with the collapsed Engineering details view
    - Tabs for files, diagram, Decision_Doc and browser view; notifications that do not take focus; unavailable reason; Engineering details closed by default and opened only by a Judge action; current Flow_Graph node and progress line (real value or indeterminate with reason)
    - Design: Web app
    - _Requirements: 1.3, 4.1, 4.3, 4.6, 4.7, 4.8, 7.1, 7.2, 7.3, 36.8_
  - [ ] 3.12 Build Interaction_Cards and the Interjection_Input
    - Question card (options plus free text), confirm/reject card in feature words, reminder card; Interjection_Input with addressee selector; "received", "delivered" and failure states next to the input; keyboard operation and visible focus
    - Design: Web app, HTTP API (acknowledgement)
    - _Requirements: 5.1, 5.3, 5.4, 5.8, 6.1, 6.4, 6.5, 8.2, 8.3_
  - [ ]* 3.13 Write property test for feed entries
    - **Property 5: Every Activity_Feed entry maps to an event**
    - **Validates: Requirements 3.1, 3.3, 3.5**
  - [ ]* 3.14 Write UI example tests for the Workspace skeleton
    - All areas present; Engineering details collapsed by default; cards contain no file names, paths or diffs; reduced motion disables non-essential animation; keyboard-only card operation; status text present
    - _Requirements: 1.3, 4.7, 4.8, 5.4, 8.1, 8.2, 8.4_
  - [ ] 3.15 Demo and verify: Workspace skeleton
    - Show the user the Workspace playing the fixture events live over SSE, a second browser as a queued Viewer, and a reload that resumes from `Last-Event-ID`; check `events.jsonl` contains no registered secret and the queued browser gets HTTP 403 on a command
    - _Requirements: 1.1, 2.1, 28.3, 30.15_

- [ ] 4. Checkpoint: Workspace skeleton (target 2026-11-22)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. F1-F2: home input, URL validation, Repo_Reader and immersive reading view (target 2026-11-23)
  - [ ] 5.1 Implement GitHub URL parsing and Adapter matching
    - `packages/shared/src/url.ts`: accepted forms (with or without scheme, `www.`, trailing slash, `.git`), normalization, case-insensitive Adapter match
    - Design: packages/shared
    - _Requirements: 9.2, 9.3, 9.5_
  - [ ] 5.2 Implement the task runner skeleton
    - `apps/server/src/tasks/runner.ts`: holds TaskState, runs node handlers, applies `transition`, node and Task timeouts with an injectable clock, abort endpoint, backend restart handling (`failure` "backend restarted" and `terminal_reached` failed)
    - Design: apps/server modules, Error Handling
    - _Requirements: 36.2, 36.5, 36.6, 36.8_
  - [ ]* 5.3 Write property test for URL validation
    - **Property 14: Home URL validation round trip**
    - **Validates: Requirements 9.2, 9.3, 9.5**
  - [ ] 5.4 Build the home page and Task creation
    - Single URL input; error naming the expected form; `POST /api/tasks` checks existence and visibility on GitHub and shows GitHub's reason; `task_created` with repoKind and Runtime_Rules version; the home page states when live execution is unavailable (no Docker engine)
    - Design: HTTP API, Web app
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 25.8, 35.3_
  - [ ] 5.5 Implement the Repo_Reader
    - `apps/server/src/reader/`: read-only token, metadata, commit SHA, recursive tree, prioritized reading order, limits 300 files or 2 MB (`GL_READ_MAX_FILES`, `GL_READ_MAX_BYTES`), skip binary and files above 200 KB, cache by SHA, rate limit failure, download failure stops the Task, `file_read` events
    - Design: Repo_Reader
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 34.1, 34.2, 34.3, 34.4, 34.5_
  - [ ]* 5.6 Write unit tests for the Repo_Reader
    - Cache hit for the same SHA, skipped list at the limit, rate limit state shown without fabricated content, download failure recorded and Task stopped (fake GitHub server)
    - _Requirements: 10.5, 10.6, 34.2, 34.3, 34.4_
  - [ ] 5.7 Build the immersive reading view
    - Artifact_Area file view with the path and the portion read so far; feed narration of each file read; skipped parts list; progress as files read out of the planned count
    - Design: Web app, Repo_Reader
    - _Requirements: 4.4, 10.2, 10.6, 7.1_
  - [ ] 5.8 Demo and verify: URL to reading
    - Show the user the linkding URL and one Other_Repo URL being read live, an invalid URL error and a private repository error; check that a second submit of the same commit reads from the cache and that every file read is in `events.jsonl`
    - _Requirements: 9.3, 9.4, 10.2, 34.2_

- [ ] 6. F3: PiRuntime, meeting with streaming, thinking panel, interjection, question cards, evidence checker (target 2026-11-24)
  - [ ] 6.1 Implement LLM configuration
    - `apps/server/src/llm/`: server default base address and `deepseek-flash` from environment, max_tokens 16384 (`GL_MAX_TOKENS`), finish reason check, Judge-supplied configuration behind `GL_ALLOW_JUDGE_LLM` (off)
    - Design: LLM configuration and SSRF validation
    - _Requirements: 30.1, 30.2, 30.3, 30.5, 30.12, 30.14_
  - [ ] 6.2 Implement the Runtime_Rules loader and role prompts
    - `runtime-rules/roles/*.md` for Moderator, Product, Architecture, Risk_and_Security, Verification, Tech_Manager, operator; shared behavior rules; `VERSION`; schema export script into `runtime-rules/schemas/`; loader records the version at Task start
    - Design: Repository layout, apps/server modules (`roles/`)
    - _Requirements: 35.2, 35.3, 35.4, 35.6, 35.10_
  - [ ] 6.3 Implement the evidence checker
    - `apps/server/src/evidence/`: whitespace-normalized snippet match with at least 8 non-whitespace characters, reasons `file_missing`, `not_downloaded`, `snippet_absent`, `snippet_too_short`
    - Design: Evidence checker
    - _Requirements: 24.1, 24.2, 24.3, 24.5, 24.6_
  - [ ] 6.4 Implement the AgentRuntime interface and PiRuntime
    - `packages/shared/src/runtime.ts` types; `apps/server/src/runtime/pi.ts`: event mapping table, `message_progress` every 5 s and at the first delta, deltas as SSE frames only, `message_incomplete` plus `failure` on a break, non-streaming fallback note, `beforeToolCall` whitelist, abort
    - Design: AgentRuntime interface, PiRuntime
    - _Requirements: 3.6, 3.7, 3.8, 3.9, 3.11, 27.7, 27.10, 30.9, 30.10, 23.7_
  - [ ]* 6.5 Write property test for evidence marks
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
    - Architecture skim in `reading` (`read_file`, `search_repo`, `record_finding`); meeting rounds (fixed order, 2 rounds), `submit_statement` with findings, evidence and A/B/unclear workflows, Unverified marks, Moderator `ask_judge` with 120 s wait, `submit_meeting_summary` leading to `adapter_branch`
    - Design: Meeting, Repo_Reader
    - _Requirements: 10.2, 11.1, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 18.1, 18.6_
  - [ ] 6.10 Implement interjection delivery
    - `POST /api/tasks/:id/messages` acknowledges within 1 s (`GL_ACK_BOUND_MS`); `steer()` to the current speaker or prepend to the addressee's next turn; `judge_message` with `deliveredTo`; delivery failure next to the input; `propose_new_version` card
    - Design: Meeting, HTTP API, PiRuntime
    - _Requirements: 5.1, 5.2, 6.1, 6.2, 6.3, 6.4, 12.1, 12.2, 12.3, 12.4_
  - [ ] 6.11 Build the live streaming text and the thinking panel
    - Live text with a "live" marker replaced by the complete message; collapsible "model-provided reasoning"; "thinking, N s" when no reasoning arrives; "waiting for LLM, N s"; incomplete mark with reason
    - Design: Web app
    - _Requirements: 2.3, 3.6, 3.8, 3.9, 3.10, 3.12, 3.13_
  - [ ] 6.12 Wire question cards to the answer endpoint
    - `POST /api/tasks/:id/cards/:cardId/answer`, `card_answered` delivered to the asking role, resulting state shown
    - Design: HTTP API, Meeting
    - _Requirements: 5.3, 5.6, 6.5_
  - [ ]* 6.13 Write unit tests for interjection and question flows
    - Message addressed to a role reaches that role first; interjection enters the Event_Stream; unanswered question recorded and the meeting continues
    - _Requirements: 5.2, 11.4, 12.3_
  - [ ] 6.14 Demo and verify: meeting
    - Show the user a real meeting on linkding with `deepseek-flash`: streaming text, reasoning panel, an interjection mid-stream, an answered question card, an Unverified mark on a missing snippet, and a reload mid-stream that shows the buffer; check `events.jsonl` has complete messages only and no chunks
    - _Requirements: 3.11, 11.6, 12.2, 27.7_

- [ ] 7. F6: decision step, Decision_Doc schema, versions, hash and freeze (target 2026-11-25)
  - [ ] 7.1 Implement the Decision_Doc schema, canonical hash and versions
    - zod schema for every R15.2 section; canonical JSON (sorted keys, UTF-8) and sha256 over content only; immutable frozen versions; version n+1 on change
    - Design: Decision_Doc
    - _Requirements: 15.2, 15.6, 16.1, 16.4, 16.5_
  - [ ]* 7.2 Write property test for hash recomputation
    - **Property 8: Decision_Doc hash recomputation**
    - **Validates: Requirements 16.5**
  - [ ] 7.3 Implement the deciding node
    - Roles propose Approach_Options; Risk_and_Security and Verification add Assessments labeled "LLM assessment, not a guarantee"; `submit_decision_draft`; `assessment.complete` computed by code; evidence check of claims and endpoints
    - Design: Decision step
    - _Requirements: 15.1, 15.2, 15.8, 15.9, 15.10, 24.4, 37.1, 37.2, 37.3, 37.5, 37.6, 37.7_
  - [ ] 7.4 Implement confirmation and freeze
    - Confirm card in feature words with exactly one selectable approach or combination; freeze records version, hash, session and time (`decision_doc_frozen`); request changes back to `deciding`; Other_Repo end before freeze to `analysis_only`; guards block planning while unconfirmed
    - Design: Decision step, Flow_Graph
    - _Requirements: 15.3, 15.4, 15.5, 15.11, 16.2, 16.3, 25.1, 37.4_
  - [ ]* 7.5 Write property test for confirmable options
    - **Property 10: Only complete approach options can be confirmed**
    - **Validates: Requirements 15.11, 37.4, 37.5**
  - [ ] 7.6 Build the Decision_Doc view
    - Artifact_Area view with version number, Unverified marks, assessment labels, UI impact section and the version history with hashes and confirmation records
    - Design: Decision step, Web app
    - _Requirements: 4.5, 15.8, 15.9, 16.4, 37.3_
  - [ ]* 7.7 Write unit tests for the decision step
    - Planning blocked while unconfirmed; in-place edit of a frozen version rejected; version chain after a change request
    - _Requirements: 15.4, 15.6, 16.1, 16.2_
  - [ ] 7.8 Demo and verify: decision step
    - Show the user a real decision step on linkding ending in a frozen Decision_Doc, and a change request that creates version 2; check that the recomputed hash equals the recorded one and that an option without an Acceptance_Check cannot be selected
    - _Requirements: 15.3, 16.5, 37.5_

- [ ] 8. Checkpoint M1: any repository from URL to frozen Decision_Doc (target 2026-11-25)
  - Ensure all tests pass, ask the user if questions arise.
  - Demo to the user: linkding and one Other_Repo from URL to a frozen Decision_Doc (Other_Repo ending as Analysis only when the Judge ends before freeze).

- [ ] 9. Replay_File export, Replay player and M1 polish (target 2026-11-26)
  - [ ] 9.1 Implement the Replay exporter
    - `apps/server/src/replay/`: Replay_File with header (schemaVersion, label "Replay"), second secret scan that refuses export and records a failure, `data/replays/<taskId>.json`, static `GET /replays/:taskId.json`
    - Design: Replay_File, Secret redactor
    - _Requirements: 26.6, 27.11, 27.12, 27.13_
  - [ ] 9.2 Extend the redaction property test to the Replay_File
    - **Property 12: Secret redaction** (same test as 3.7, now also over the exported Replay_File)
    - **Validates: Requirements 30.15, 27.12, 28.4, 30.5, 13.5**
  - [ ] 9.3 Build the Replay player
    - Same Workspace with a Replay bar (play, pause, speed, seek), permanent "Replay" label, `now` at the playhead, typing animated from the stored Complete_Message with the note that typing speed is simulated
    - Design: Web app
    - _Requirements: 1.5, 7.4, 7.5, 26.2, 26.3, 26.4, 26.9, 27.2, 27.3, 27.8_
  - [ ] 9.4 Write property test for live versus Replay equality
    - **Property 4: Live and Replay produce the same UI state**
    - **Validates: Requirements 26.7, 27.14, 7.5**
  - [ ] 9.5 Build the final view
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
  - [ ] 9.8 Demo and verify: Replay
    - Show the user the M1 Task replayed from its Replay_File with the backend stopped; check that the live and Replay final views match and that the Replay_File holds no key or token
    - _Requirements: 26.7, 27.12, 27.13_

- [ ] 10. Containers: dev-sandbox image, LLM_Proxy, Sandbox with test data and reset, Worktree manager (target 2026-11-27)
  - [ ] 10.1 Write the dev-sandbox Dockerfile
    - `docker/dev-sandbox/Dockerfile` on `ubuntu:latest`: Python 3, Node, git, the harness runtime executable, linkding source at the pinned commit in `/opt/linkding-src`, Python dependencies in `/opt/venv`, Node dependencies cached; uses the results of 1.2 and 1.6
    - Design: Images
    - _Requirements: 39.2, 25.6_
  - [ ] 10.2 Implement the Verifier `api_readback` check
    - `apps/server/src/verifier/readback.ts`: all pages, URL normalization, tag inclusion, same-URL create compared as update against a pre-state snapshot, per-item results (also used for the reset equality check)
    - Design: Verifier
    - _Requirements: 22.4, 22.5, 22.7, 22.9, 29.4_
  - [ ] 10.3 Implement the container manager
    - `apps/server/src/containers/`: Docker Engine API wrapper, internal network, memory limits (`GL_MEM_*_MB`), read-only root and tmpfs, mounts, engine ping at server start, `GL_EXECUTION_ENABLED`
    - Design: Containers, Where things run
    - _Requirements: 38.2, 38.3, 38.4, 39.1, 39.6, 25.8_
  - [ ] 10.4 Write property test for Verifier tag inclusion and same-URL update
    - **Property 11: Verifier tag inclusion and same-URL update**
    - In-memory linkding model with upsert by URL and generated auto-tag rules
    - **Validates: Requirements 22.4, 22.5**
  - [ ] 10.5 Implement the LLM_Proxy
    - `apps/server/src/proxy/` bundled to one file, run on the dev-sandbox image: per-Task bearer credential, allow-listed paths, real key swapped in, streaming passthrough, logs method, path and status only; credential registered with the redactor
    - Design: LLM_Proxy
    - _Requirements: 30.5, 30.16_
  - [ ] 10.6 Implement the Worktree manager
    - `apps/server/src/worktree/`: bare mirror, `git clone --no-hardlinks`, branch `graftlab/<taskId>`, `core.autocrlf=false`, snapshots, diff with a temporary index, Patch_Artifact; created only for Adapted_Repo when first needed
    - Design: Worktree manager
    - _Requirements: 25.6, 38.1, 38.5, 38.6, 38.9_
  - [ ]* 10.7 Write integration tests for the LLM_Proxy
    - Wrong credential rejected; allowed path forwarded to a fake upstream with the real key; other paths refused
    - _Requirements: 30.16_
  - [ ] 10.8 Implement Sandbox start with test data and reset
    - Fresh volume, per-Task generated password (registered with the redactor), readiness wait, token creation by the method from 1.5, load `test-data.json` with `disable_scraping`, reset equality by the Verifier; failure leads to `failed` "not executed"
    - Design: Sandbox and test data
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 29.1, 29.3, 29.4, 29.5_
  - [ ] 10.9 Implement the restore operation
    - `POST /api/sandbox/restore` for the lease holder or the admin only; recreate container and volume, reload, Verifier equality
    - Design: Sandbox and test data, HTTP API
    - _Requirements: 29.2, 29.4, 18.13_
  - [ ]* 10.10 Write integration tests for the Development_Sandbox confinement
    - Write to `/work` reaches the host Worktree; write to `/etc` fails read-only; no host path outside the Worktree changes; internet request fails; LLM_Proxy reachable
    - _Requirements: 38.2, 38.4, 38.8_
  - [ ]* 10.11 Write integration tests for the Sandbox
    - Start from the pinned digest, token, test data, Verifier equality, restore; restore rejected for a non-holder
    - _Requirements: 13.2, 29.2, 29.4_
  - [ ] 10.12 Demo and verify: containers
    - Show the user a Sandbox reset with the Verifier equality table, a restore, and a write attempt outside `/work` failing; check `docker stats` against the memory limits and that no container has the Docker socket
    - _Requirements: 29.4, 38.2, 38.8_

- [ ] 11. F4-F5: Sandbox start and Browser_Use experience with live screenshots (target 2026-11-28)
  - [ ] 11.1 Wire `sandbox_start` into the flow
    - Node handler after `adapter_branch` for Adapted_Repo; Docker unavailable path to `failed` "not executed" after analysis
    - Design: Flow_Graph, Sandbox and test data
    - _Requirements: 13.1, 13.4, 25.8, 29.1_
  - [ ] 11.2 Implement Browser_Use tools
    - `apps/server/src/browser/`: Playwright Chromium, route filter that aborts other origins, Studio login, operator tools, ARIA snapshot truncated to 8 KB, screenshots only when image-capable, JPEG after each action, `browser_action` and `browser_observation`, failure recorded before the next action, 40 actions and 5 consecutive failures limit
    - Design: Browser_Use
    - _Requirements: 14.2, 14.4, 14.5, 14.6, 14.7, 14.8, 14.9, 14.10_
  - [ ] 11.3 Implement the `browser_experience` node
    - Operator pi agent with `record_note`; analysis notes shown live; ends with the observed experience leading to `deciding`
    - Design: Browser_Use, Flow_Graph
    - _Requirements: 14.1, 14.3_
  - [ ] 11.4 Build the live browser view
    - Artifact_Area stream of screenshots with action and observation entries
    - Design: Web app, Browser_Use
    - _Requirements: 4.2, 14.2_
  - [ ]* 11.5 Write unit tests for Browser_Use
    - Route filter blocks another origin; a failed action is recorded before the next one; password never appears in events
    - _Requirements: 14.5, 14.6, 13.5_
  - [ ] 11.6 Demo and verify: experience
    - Show the user a linkding Task going from meeting through Sandbox start to the operator using linkding with live screenshots; check that every action has an event and a screenshot and that the experience feeds the decision step
    - _Requirements: 14.1, 14.2, 14.4_

- [ ] 12. Checkpoint: linkding from URL through experience to frozen Decision_Doc (target 2026-11-28)
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. F7-F8: planning and document-first (target 2026-11-29)
  - [ ] 13.1 Implement the planning schemas
    - Product_Backlog, Story, strict Feature_Contract (no path lists, `executionKind`), Sprint_Plan, Task_Board, Definition_of_Done, Demo_Review_Notes, Retrospective
    - Design: Product_Backlog and Feature_Contract
    - _Requirements: 20.5, 20.6, 20.7, 20.8, 20.9, 40.1, 40.3_
  - [ ]* 13.2 Write property test for backlog validity
    - **Property 15: Backlog validity**
    - **Validates: Requirements 20.5, 20.6, 20.9, 40.1, 40.3**
  - [ ] 13.3 Implement the planning node
    - `submit_backlog`, `submit_sprint_plan`, `submit_definition_of_done`; rejection names the incomplete story; Feature_Contracts derived from the Frozen version and referenced in the Sprint_Plan
    - Design: Planning and document-first
    - _Requirements: 19.1, 19.3, 19.9, 19.10, 20.1, 20.4, 20.11, 40.1_
  - [ ] 13.4 Implement the documenting node
    - Requirements, design and tasks documents and the Task_Board for the analyzed repository; `runEnvironment` section proposed by the Architecture role; version recorded; JSON plus Markdown in `data/tasks/<id>/docs/`; Other_Repo ends as Docs only
    - Design: Planning and document-first
    - _Requirements: 19.2, 19.4, 19.6, 20.4, 25.2, 39.9, 39.10_
  - [ ] 13.5 Mark documents based on an older version
    - When a new version is frozen, documents that reference an older version are marked
    - Design: Planning and document-first
    - _Requirements: 20.10_
  - [ ] 13.6 Build the Output_Docs view
    - Backlog with Feature_Contracts in feature words, Sprint_Plan, Task_Board statuses, documents rendered from Markdown
    - Design: Web app
    - _Requirements: 4.1, 20.8_
  - [ ]* 13.7 Write unit tests for document-first
    - Development blocked while documents are incomplete; Other_Repo ends in `docs_only` with the label
    - _Requirements: 19.4, 19.6, 25.2_
  - [ ] 13.8 Demo and verify: planning and documents
    - Show the user the backlog with Feature_Contracts and the `runEnvironment` section generated from the M1 Decision_Doc, and an Other_Repo ending as Docs only; check every document records the Frozen version and that a story without a Feature_Contract is rejected
    - _Requirements: 20.4, 20.9, 25.2_

- [ ] 14. F10: HarnessRuntime, development, Tech_Manager review, stop and ask, Run_Environment, checkpoints, Verifier and API-operation path (target 2026-11-30)
  - [ ] 14.1 Implement the context builder and the development rules
    - `apps/server/src/dev/context.ts` writes only the story, its Feature_Contract and the referenced documents; Runtime_Rules rules "small scope per Agent" and "no decision power, stop and ask, reviewed by the Tech_Manager"
    - Design: Development stage
    - _Requirements: 19.5, 19.7, 19.8, 35.8, 35.9, 40.2_
  - [ ] 14.2 Implement the HarnessRuntime
    - `apps/server/src/runtime/harness.ts`: docker exec with the per-Task proxy credential, JSONL parsing with zod, event mapping table, unknown lines counted, session id resume, `graftlab_question` fallback (or the native ask event if 1.8 passed), budget timer that kills the exec, read-only errors as rejected by a safety rule
    - Design: HarnessRuntime
    - _Requirements: 30.16, 38.3, 38.7, 38.8, 40.11, 40.13_
  - [ ] 14.3 Implement the Demo_Case schema, validator and check derivation
    - `packages/shared` Demo_Case and suggestion schemas; `apps/server/src/apiops/validate.ts` (Item_Count_Cap from `GL_DEMO_CASE_MAX_ITEMS`, Adapter allow-list, Sandbox target); `deriveChecks`
    - Design: Demo_Case and suggestion, Adapter
    - _Requirements: 18.8, 18.10, 18.11, 18.12_
  - [ ]* 14.4 Write property test for small scope per Agent
    - **Property 16: Small scope per Agent**
    - **Validates: Requirements 19.5, 19.7, 35.8, 40.2**
  - [ ]* 14.5 Write unit tests for the HarnessRuntime parser
    - Sanitized JSONL fixtures from 1.7 and 1.8 map to the expected Studio events; unknown lines counted
    - _Requirements: 38.7, 40.11_
  - [ ] 14.6 Implement `story_develop` and change recording
    - Start or resume the Development_Sandbox, run the Code_Agent, compute changed files and diff with a temporary index, append `code_change`, diff in Engineering details only, budget accounting
    - Design: Development stage
    - _Requirements: 38.1, 38.3, 38.5, 39.4, 40.5_
  - [ ]* 14.7 Write property test for change recording
    - **Property 18: Every Code_Agent change is recorded and reviewed**
    - **Validates: Requirements 40.5, 38.5**
  - [ ] 14.8 Implement the Tech_Manager review
    - `story_review`: `read_changed_file`, `read_diff`, `submit_review_verdict`; label "reviewed by Tech_Manager (LLM judgment)"; request changes back with reasons; escalate to the Moderator; approach change returns to `deciding`
    - Design: Development stage, Review_Verdict
    - _Requirements: 37.8, 37.9, 40.6, 40.7, 40.8, 40.9, 40.10, 40.15_
  - [ ] 14.9 Implement stop and ask
    - `story_ask`: attempts counted, retry limit 3 opens a question; technical questions to Tech_Manager `answer_question`; feature questions through the Moderator as a question card; "waiting for answer" status; 300 s unanswered marks the story Unconfirmed-blocked and continues or ends `failed`
    - Design: Development stage, Flow_Graph
    - _Requirements: 2.10, 5.5, 40.11, 40.12, 40.13, 40.14, 40.17_
  - [ ]* 14.10 Write unit tests for development routing with a fake runtime
    - Retry limit leads to a question; technical versus feature routing; a simulated unresolved problem ends in a question and not a widened scope; approach change returns to `deciding`; unanswered question blocks the story
    - _Requirements: 35.9, 40.4, 40.12, 40.13, 40.15, 40.17_
  - [ ] 14.11 Implement the Run_Environment
    - Stop the Development_Sandbox, snapshot the Worktree, record `worktree_handoff`, start a fresh Run_Environment per attempt with the `runEnvironment` commands only inside it, 240 s health wait, failure to `failed`
    - Design: Development stage, Containers
    - _Requirements: 39.3, 39.4, 39.5, 39.6, 39.7, 39.9, 39.11_
  - [ ] 14.12 Implement checkpoints and reminders
    - `story_checkpoint` confirm card in feature words with the demo, 120 s wait (`GL_CONFIRM_WAIT_S`), Unconfirmed mark, reminder card at the next Judge input, Demo_Review_Notes entry
    - Design: Development stage
    - _Requirements: 5.8, 20.2, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.8, 21.9_
  - [ ]* 14.13 Write integration test for the Run_Environment
    - Start modified linkding from a snapshot with given commands; health wait; failure path ends `failed`
    - _Requirements: 39.3, 39.5, 39.11_
  - [ ]* 14.14 Write unit tests for checkpoints
    - No response gives Unconfirmed; next input triggers a reminder in feature terms recorded in the Event_Stream
    - _Requirements: 21.4, 21.8, 21.9_
  - [ ] 14.15 Complete the Verifier
    - `test_suite` in a fresh test container with a read-only snapshot, scripted `browser_check` without an LLM, per-item results, disagreement display, success only from Verifier results, Retrospective at Task end
    - Design: Verifier
    - _Requirements: 14.11, 20.3, 22.1, 22.2, 22.3, 22.6, 22.7, 22.8, 22.9_
  - [ ] 14.16 Implement the API-operation path with the Demo_Case
    - `api_read` Tech_Manager loop with `linkding_read`, `read_file`, `search_repo`, `submit_demo_case`; `api_plan` validation; `api_suggest` and `api_confirm` for purpose B; `apiops/writer.ts` as the only linkding write path (Sandbox origin, allow-list, per item, `api_write` events); `api_try_one`, `api_write_batch`, `api_read_back`; label "designed by Tech_Manager (LLM judgment)"; checkpoint shows the read-back table
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
    - Run the first real story context with the harness runtime and one alternate; compare out of the box behavior, cost, speed and instruction following; record in `spike/results/S-runtime-real.md`
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
    - Design: Deployment and hosting
    - _Requirements: 32.5, 32.7_
  - [ ] 17.2 Write the front-end Pod manifests
    - k3s Deployment and Service that serve the static web build and the Replay_Files; routing of `/api` on the same hostname to the tunnel; no secrets in manifests
    - Note: the user creates the Cloudflare tunnel credentials and the DNS entry
    - Design: Deployment and hosting
    - _Requirements: 32.2, 32.6, 32.7, 27.13_
  - [ ] 17.3 Add the tunnel configuration and the unreachable-backend handling
    - Tunnel configuration template without credentials; "backend unreachable" banner; SSE reconnect with `Last-Event-ID`; commands fail visibly next to the input
    - Design: Deployment and hosting, Error Handling
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
    - Design: Deployment and hosting
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
    - Run instructions, how Judges try the product, new-work statement, third-party notices: DeepSeek Harness runtime executable MIT with its THIRD_PARTY_NOTICES, pi packages MIT, Playwright Apache-2.0, linkding MIT as an unmodified external dependency, Remotion only if used; Kiroween rule facts kept as TO BE CONFIRMED
    - Design: Kiro usage plan, Deployment and hosting
    - _Requirements: 33.1, 33.5, 33.6, 33.8, 27.5_
  - [ ] 18.5 Write the Kiro usage write-up
    - `docs/kiro-usage.md`: spec-driven build, steering, hooks, spike results feeding the design
    - Design: Kiro usage plan
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
- Spike results that change the design are written back to design.md in 1.12 before dependent tasks start.
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
    { "id": 50, "tasks": ["10.1", "10.2"] },
    { "id": 51, "tasks": ["10.3", "10.4"] },
    { "id": 52, "tasks": ["10.5", "10.6"] },
    { "id": 53, "tasks": ["10.7", "10.8"] },
    { "id": 54, "tasks": ["10.9", "10.10"] },
    { "id": 55, "tasks": ["10.11"] },
    { "id": 56, "tasks": ["10.12"] },
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
