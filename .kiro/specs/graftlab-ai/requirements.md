# Requirements Document

> Language: English (hackathon submission). Project name: GraftLab AI. Feature directory: `graftlab-ai`. In this document the product is called "the Studio".
> Anything marked "TO BE CONFIRMED" is an unverified external fact or a decision not yet made and MUST NOT be treated as verified. Anything marked "UNDECIDED" is a value or choice deferred to the design stage or later.
> Priority labels: "Must-have" (first version) or "Stretch" (only if time remains). The UI group (Requirements 1-8) is "Must-have, highest priority".
> Fallback statement (user): If the project cannot be finished, the user wants the UI (Requirements 1-8) and the requirement-analysis stage (flow steps F1-F6, ending with the frozen Decision_Doc) protected first. The final scope decision is made in the last week before the deadline; until then work proceeds at the normal pace. No priority tiers are defined now.

## Introduction

### Product in one sentence

A Judge types a GitHub repository URL on a search-like home page. Several AI roles analyze the repository like a meeting and interact with the Judge, and together they decide "how to make this software powered by AI". The Studio then plans in a document-first agile way and generates agile documents. For linkding (the only adapted software) the Studio runs it in a sandbox, uses it through a browser, develops against it (a code Agent changes a copy of the linkding source inside an isolated per-Task worktree), demonstrates each feature, and an independent Verifier decides success from executable acceptance checks.

### Top priority: the UI

The most important quality of this product is the UI. It MUST be interactive, the viewer MUST see that people (Agent_Roles) are working all the time, and every user action MUST get feedback. When trading off, UI interactivity and visible, honest agent activity take priority over breadth of features. Everything shown as "working" MUST be backed by real events.

### Process Principles

The user uses an agile process for three reasons:

1. The requirements are clear.
2. The work is split clearly.
3. Each Agent_Role can be given a very small task context (one story plus its referenced documents).

These reasons are made testable by the "small scope per Agent" rule in Requirement 19 (a Runtime_Rules rule, see Requirement 35 and the traceability table). What an Agent does inside that context is best effort (principle 5).

A fourth principle fixes who decides what:

4. **Decisions are made in the requirement meeting; development executes a feature-level contract and has no decision power.** How to make the target software AI-powered is decided in the requirement discussion (flow steps F3-F6) by the Agent_Roles together with the Judge, and a Prototype may be produced there to help the decision (Requirement 41). The requirement split (Product_Backlog) then gives every story a Feature_Contract (Requirement 40): what the feature should do, what it should not do, and how it is checked. The Studio cannot predict which files an Agent must change in an unfamiliar codebase, so it does not fix file paths in advance. It records every change, has the Tech_Manager Agent_Role assess afterwards whether the changed files fit the Feature_Contract (an LLM judgment, not a guarantee), and lets only the non-LLM Verifier decide success. When the development Code_Agent cannot resolve a problem, it stops and asks instead of retrying forever or improvising. Any need that goes beyond the Feature_Contract goes back to the requirement meeting and a new Decision_Doc version (Requirement 16).

A fifth principle fixes what the Studio can promise:

5. **Studio guarantees versus Agent best effort.** The Studio guarantees only what code can enforce or check:
   - the Flow_Graph and the Terminal_States (Requirement 36);
   - persistence and replay of events (Requirement 27);
   - validation of structured output against a schema (Requirements 23 and 35);
   - existence of cited evidence: a cited file exists and a quoted snippet is present, otherwise the claim is marked Unverified (Requirement 24);
   - write confinement of the Code_Agent to its Worktree by the container boundary of the Development_Sandbox (Requirement 38);
   - budgets and timeouts (Requirements 36 and 38);
   - the checks of the non-LLM Verifier (Requirement 22);
   - honest display of failures (Requirement 23);
   - secret redaction: every known secret value is removed from every event before it is persisted, broadcast or written to a Replay_File (Requirement 30).

   What the Agent_Roles do well is a goal, not a guarantee: quality of analysis, adherence to an A/B path, quality of Assessments and reviews, and quality of generated code. These goals are measured by benchmarks and mitigated by checks. Requirements worded "THE Agent_Roles SHOULD ... (best effort, measured, not guaranteed)" are goals of this kind. Every Agent output shown to the Judge as an assessment or review is labeled as an LLM judgment.

A sixth principle fixes how the project itself is built:

6. **Build stage by stage with real data.** The project is built one stage at a time. The real output of one stage is used directly as the input to debug the next stage, and real documents are used for testing.

### Two product purposes

- **Purpose A (replace a human decision or work step with AI)**: a decision or a work step that a human makes or does today is made or done by AI, fully or partly.
- **Purpose B (AI-powered)**: with AI, a function of the software becomes stronger or becomes new.

How the user interface changes after a feature becomes AI-powered is a design question, not a direction question. It is proposed by the Agent_Roles and decided with the Judge, and it is recorded in the "UI impact" section of the Decision_Doc (Requirement 15). No UI change is pre-decided by these requirements.

Every analyzed workflow is labeled A or B. The default path suggested to the Agents depends on the label (the Studio enforces what the stage machine and the per-stage tools can enforce; the rest is best effort, see Requirement 18):

- A: read, plan, try one item first, write in batch, read back after writing.
- B: the A path plus one extra step, "retrieve or infer, then give a suggestion with evidence", with Judge confirmation required before any write.

### Who chooses the approach

How to make linkding AI-powered (an independent agent next to it, a source change to the application, a UI change, or a mix) is NOT pre-selected by the Studio team. It is decided at run time by the DeepSeek-driven Agent_Roles together with the Judge in flow step F6 and is recorded in the Decision_Doc. The Studio only ASSESSES each proposed approach (feasibility, effort, risk, needed environments, executable acceptance checks); the assessment is an LLM judgment, not a guarantee (see Requirement 37). The development stage never chooses, changes or extends the approach (Requirements 37 and 40).

### Kiroween category and Frankenstein statement

Target: Devpost Kiroween 2026, preferred category Frankenstein (stitching together seemingly incompatible technologies into a useful application). **The rules below are relayed by the user. The official page could not be read (HTTP 403), so every rule detail is TO BE CONFIRMED.** Whether the category name has changed is TO BE CONFIRMED.

Evaluation notes (TO BE CONFIRMED for 2026): the 2025 edition's page stated that entries are judged on potential value, implementation of Kiro, and creativity. The 2026 judging criteria could not be read and are TO BE CONFIRMED. Whether 2026 has extra prize categories is TO BE CONFIRMED.

| Part | Responsibility |
|---|---|
| Existing software (linkding) | Provides real business functions and a REST API; it is what gets transformed and verified |
| Agents (multiple roles) | Try to read the repository, hold the meeting, decide with the user, write documents, plan, operate linkding, and develop changes to a copy of linkding in a per-Task worktree; the Tech_Manager reviews the changed files (best effort, an LLM judgment) |
| Independent Verifier | Runs the executable acceptance checks (API read-back, the target's own test suite, browser check), compares with the plan item by item, and is the only judge of success |
| Event stream and replay layer | Stores all process events for live viewing and replay |
| Team workspace UI | Shows the roles working, takes user input, and gives feedback on every action |

What the combination adds: an Agent that looks like "just chat" is checked against the real API of existing software, corrected by an independent Verifier, and fully watchable and replayable. The chat box is only an entry point, not the product.

### Submission rules summary (relayed by the user, TO BE CONFIRMED)

- A runnable new work, substantially developed with Kiro during the submission period (2026-10-30 to 2026-12-04). A compliant open-source base is allowed, but old code MUST be disclosed with an explanation of what is new.
- Judges can actually try it (review account provided if login is needed), free to use until 2027-01-30 05:00 Beijing time.
- Public GitHub repository: full source, assets, run instructions, an identifiable open-source license; the root `.kiro/` directory MUST be committed and not ignored.
- Public YouTube demo video of at most 3 minutes; the video does not replace a usable product.
- Devpost text materials MUST be in English, including a write-up on how Kiro was used.
- Submission deadline: 2026-12-05 06:00 Beijing time.

### Verified linkding facts

Verified from the official linkding documentation and GitHub repository metadata:

- linkding is licensed under MIT.
- The REST API supports listing, querying, creating, PATCH, archiving and deleting bookmarks, plus tags and bundles, with Token authentication.
- Creating a bookmark whose URL already exists silently updates the existing bookmark instead of creating a new one.
- Auto-tagging rules merge tags into the tag list on each update.

## Glossary

- **Studio**: The whole product (frontend, backend, Agent runtime, Verifier, Event_Stream).
- **Judge**: The evaluator or trial user, the human who operates the Studio.
- **Viewer**: A person who only watches the current Task and cannot operate.
- **Task**: One complete analysis and (if adapted) execution flow started by submitting a GitHub URL.
- **Agent_Role**: An AI role inside the Studio. Draft set: Moderator, Product, Architecture, Risk_and_Security, Verification, Tech_Manager (active in the development stage). May change during development.
- **Tech_Manager**: The Agent_Role that, in the development stage, reviews the files changed by the Code_Agent against the Feature_Contract and the Decision_Doc and answers technical questions of the Code_Agent. Its verdict is an LLM judgment (an assessment, not a guarantee) and is never success.
- **Review_Verdict**: The Tech_Manager's result for one story attempt: approve, request changes, or escalate. Labeled "reviewed by Tech_Manager (LLM judgment)".
- **Engineering_Details**: The collapsed, on-demand view of diffs, review verdicts, rejected changes and tool calls. Never the main Judge view.
- **Best_Effort_Goal**: A requirement worded "THE Agent_Roles SHOULD ... (best effort, measured, not guaranteed)"; its quality is measured by benchmarks and mitigated by checks.
- **Adapter**: An adaptation package for one specific software. The first version has only the linkding Adapter. It carries only what the Studio itself needs: the target identity and reference (the upstream repository and pinned commit for the source copy, and the unmodified baseline, identified as the official linkding container image pinned by digest plus its documented configuration), the fixed test data set, and the assessment checks. The Sandbox runs that unmodified baseline. The Adapter does not define how to build or start the modified target (Requirement 39). Its exact contents are set in design.md.
- **Adapted_Repo**: A repository that has an Adapter; in the first version only linkding.
- **Other_Repo**: Any other public GitHub repository; analysis and documents only.
- **Repo_Reader**: The Studio component that downloads and reads a repository read-only.
- **Sandbox**: The isolated environment that runs unmodified linkding for the baseline experience (flow steps F4 and F5): the official linkding container image pinned by digest, with its documented configuration, as identified by the Adapter.
- **Browser_Use**: An Agent operating the sandboxed linkding web page through a browser like a human. Does not include controlling the whole desktop (computer use).
- **Decision_Doc**: The decision document produced in flow step F6; once confirmed by the user it is frozen and is the stable baseline for everything after.
- **Approach_Option**: One proposed way to make linkding AI-powered (independent agent, source change, UI change or a mix), proposed by the Agent_Roles and carried in the Decision_Doc together with its assessment.
- **Assessment**: The Agent_Roles' evaluation of one Approach_Option: feasibility, effort, risk, needed environments, and executable Acceptance_Checks. It is an LLM judgment, labeled as such, not a guarantee.
- **Acceptance_Check**: An executable check that proves a feature works: an API read-back compared item by item, a run of the target's own test suite in a fresh container from the Development_Sandbox image, or a scripted Playwright browser check (no LLM) in the Run_Environment (Requirement 22.2).
- **Flow_Graph**: The explicit graph of Task stages (nodes and guarded edges stored as data) that governs every state transition of a Task.
- **Terminal_State**: One of success, failed, aborted, Analysis only, Docs only.
- **Code_Agent**: The in-product Agent that edits a copy of the target source and runs tests inside the Development_Sandbox. It has no decision power and stops and asks when it cannot resolve a problem.
- **Worktree**: An isolated per-Task working copy of the target source under git (implemented as a local clone from a mirror, not a linked worktree; see design), one per Task, holding the only modified copy of the target source.
- **Feature_Contract**: The per-story, feature-level contract derived from the Frozen Decision_Doc and carried by every Product_Backlog story. It states the feature in plain language, what it should do, what it should NOT do (in feature terms), executable Acceptance_Checks where possible, and budgets. It contains no file or path lists (Requirement 40).
- **Prototype**: A throwaway artifact the Agent_Roles may build in flow steps F3-F6 to help the approach decision. It is labeled "Prototype", is never an execution result and never counts as success (Requirement 41).
- **Patch_Artifact**: The stored diff of the changes produced in a Worktree, kept as an Output_Docs artifact per Task.
- **Dev_Environment**: Environment 1: the team's own development environment, used to build the Studio itself.
- **Studio_Runtime**: Environment 2: the Studio product runtime (Node backend and web UI).
- **Development_Sandbox**: Environment 3: the one container per Task in which the whole code-Agent runtime, its tools and the needed toolchains (Node and Python) run. Confinement of the Code_Agent's file writes to its Worktree comes from the container boundary. Only one Task runs at a time (Requirement 28), so one container is enough. The exact image and the network policy are UNDECIDED (design).
- **Run_Environment**: Environment 4: the environment that runs the modified target software starting from the Task's Worktree result. How to build and start the target is analyzed by the Agent_Roles from the target's own files and documentation; the Studio only assesses the result (Requirement 39).
- **Frozen**: The immutable state of a Decision_Doc version after user confirmation.
- **Verifier**: The independent, non-LLM verifier. Runs the Acceptance_Checks, compares results with the plan, and does not call an LLM to judge results.
- **Event_Stream**: The ordered list of process events saved by the Studio; live view and Replay read the same list. It holds complete messages and message lifecycle events; streamed text chunks are not stored.
- **Complete_Message**: A model message persisted in full in the Event_Stream. An interrupted stream is persisted as the partial text marked "incomplete" with the reason.
- **Replay**: Event-stream playback from a saved JSON file; always labeled "Replay". Typing of messages in a Replay is animated in the UI from the stored Complete_Message and is simulated.
- **Replay_File**: The JSON file holding a saved Event_Stream with a schema version.
- **Checkpoint_Demo**: The demo and confirmation point of one feature during development.
- **Unconfirmed**: The mark on a result when the user did not respond at a confirmation point; it MUST NOT be treated as confirmed.
- **Unverified**: The mark on a conclusion that has no supporting evidence, or whose cited evidence fails the Studio's existence check (cited file missing or quoted snippet absent); displayed as "Unverified".
- **Failure_Class**: Failure classification, at least four classes: interface call failure, read-back mismatch, LLM output format invalid, rejected by a safety rule (for example a blocked worktree-escape attempt); additionally budget exceeded and blocked by an unanswered question (Requirement 23.2).
- **Analysis_Only**: The on-screen label "Analysis only - not executed".
- **Docs_Only**: The on-screen label "Docs only - not developed".
- **Case_Card**: A "similar approaches" card collected by the team itself, with a source link and an evidence boundary.
- **Workspace**: The live team workspace screen shown after a URL is submitted (Requirement 1).
- **Presence_Card**: The card in the Workspace showing one Agent_Role's avatar, name, role and status.
- **Role_Status**: The status shown on a Presence_Card. Allowed values include reading, speaking, thinking, waiting for user, waiting for LLM, waiting for answer, blocked, idle.
- **Activity_Feed**: The live narrated list of what is happening in the Workspace.
- **Artifact_Area**: The Workspace area showing the current work product, in feature terms (Engineering_Details only on demand).
- **Interjection_Input**: The always-available input through which the Judge talks to the roles.
- **Interaction_Card**: An inline card in the Workspace: a question card (options plus free text) or a confirm/reject card.
- **Recency_Window**: The maximum age of the last Event_Stream event that may back a "working" indicator. Value UNDECIDED (design).
- **Dev_Docs (layer A)**: Our own development documents: AGENTS.md, .kiro/steering, .kiro/specs, hooks.
- **Runtime_Rules (layer B)**: Rules given to the in-product Agent_Roles (the Studio enforces what code can enforce; adherence otherwise is best effort): role duties, behavior rules, stage output schemas, linkding Adapter checklist, case library rules. Versioned and loaded at run time.
- **Output_Docs (layer C)**: Documents generated by the Studio for each analyzed repository (see Agile_Docs).
- **Agile_Docs**: The Output_Docs set: Decision_Doc, Product_Backlog, Sprint_Plan, Task_Board, Definition_of_Done, Demo_Review_Notes, Retrospective, plus requirements, design and tasks documents for the analyzed repository.
- **Product_Backlog**: The list of user stories, each with acceptance criteria and a priority.
- **Sprint_Plan**: The sprint goal and the selected stories.
- **Task_Board**: The work items and their status (for example to do, in progress, done, blocked).
- **Definition_of_Done**: The shared checklist a story must satisfy to count as done.
- **Demo_Review_Notes**: One note per feature confirmation point, recording the demo and the Judge feedback.
- **Retrospective**: The end-of-Task review of what worked, what failed and what to change.
- **TTS_Service**: The in-cluster text-to-speech service (details in Requirement 31).
- **LLM_Config**: The LLM base address, model name and key supplied by the Judge or the server.
- **LLM_Proxy**: The Studio's own LLM proxy that holds the real LLM key and forwards requests from the Development_Sandbox, authenticating callers by a per-Task proxy credential (Requirement 30).

## UI Principles

1. Alive but honest: show activity only when real events back it; otherwise show idle or the honest waiting reason.
2. Always interactive: the Judge can speak to the roles at any moment, and every action gets visible feedback.
3. Narrated waiting: long waits are filled with meaningful narration of real work, not spinners.
4. Show the work: the current work product is always visible next to the people producing it.
5. One view for live and replay: Replay reuses the Workspace and is always labeled "Replay".
6. Accessible by default: reduced-motion respected, keyboard operation for decisions.
7. Feature-first: the Judge-facing view speaks in features and demos (feature name, plain-language status, a demo, confirm cards in feature words). Engineering details (diffs, review verdicts, rejected changes, tool calls) are recorded in the Event_Stream and live in a collapsed, on-demand "Engineering details" view; they are never pushed to the Judge as the main view.

### Illustrative wireframe (ILLUSTRATIVE ONLY, not a final design)

The exact layout and the decision-step UI are UNDECIDED and will be explored by experimenting during implementation.

```text
+----------------------------------------------------------------------------------+
| Studio | repo: github.com/sissbruecker/linkding | Task: running | [Replay: off]  |
+------------------------+---------------------------------------+-----------------+
| TEAM (Presence_Cards)  | ARTIFACT AREA                         | ACTIVITY FEED   |
| +--------------------+ | +-----------------------------------+ | 12:01 Reading   |
| | Moderator          | | | [Files] [Diagram] [Decision Doc]  | |  bookmarks/api  |
| | status: speaking   | | | [Browser view]                    | | 12:02 Product:  |
| +--------------------+ | |                                   | |  found tag rules|
| | Product            | | |  (current work product shown      | | 12:02 Arch:     |
| | status: thinking   | | |   here, e.g. file being read,     | |  endpoint /api/ |
| +--------------------+ | |   diagram being built, or live    | |  bookmarks/     |
| | Architecture       | | |   sandboxed linkding page)        | | 12:03 Waiting   |
| | status: waiting    | | |                                   | |  for LLM, 12 s  |
| |   for LLM (12 s)   | | +-----------------------------------+ |                 |
| +--------------------+ |                                       |                 |
| | Risk_and_Security  | | INTERACTION CARDS                     |                 |
| | status: idle       | | +-----------------------------------+ |                 |
| +--------------------+ | | Moderator asks: Which workflow?   | |                 |
| | Verification       | | | (o) Import  (o) Dedupe  [free text]| |                 |
| | status: idle       | | | [Send]                            | |                 |
| +--------------------+ | +-----------------------------------+ |                 |
+------------------------+---------------------------------------+-----------------+
| Talk to the team: [ to: All v ] [ type a message...                    ] [Send]  |
| Progress: indeterminate - reading repository (file count unknown yet)            |
+----------------------------------------------------------------------------------+
```

## Flow Chart and Document Layers

### Flow chart (for user review)

Every step is labeled with a name and the requirement ids that cover it. Step ids F1-F11 are flow step ids, not requirement numbers; the mapping table below links them.

```mermaid
flowchart TD
    F1["F1 Home input of GitHub URL (R9)"] --> WS["Team workspace opens (R1-R8)<br/>presence, feed, artifacts, interjection"]
    WS --> F2["F2 Download and read repository read-only (R10, R34)<br/>show what is read and found"]
    F2 --> F3["F3 Multi-role meeting analysis (R11, R18, R24)<br/>interaction with the user"]
    F3 --> AD{"Adapter branch (R25)<br/>is it linkding?"}
    AD -- "No (Other_Repo)" --> O1["Skip sandbox and browser use<br/>label: Analysis only - not executed"]
    AD -- "Yes (linkding)" --> F4["F4 Run Sandbox (R13, R29)<br/>reset to fixed test data"]
    F4 --> F5["F5 Browser_Use experience (R14)<br/>experiencing is the demo"]
    O1 --> F6
    F5 --> F6["F6 Decide with user (R15, R17, R37)<br/>Agent_Roles and Judge decide the approach<br/>Decision_Doc draft with approach options,<br/>assessments, UI impact, acceptance checks"]
    F5 -.-> PR["Optional Prototype (R41, Stretch)<br/>labeled Prototype, isolated worktree,<br/>never counted as success"]
    PR -.-> F6
    F6 --> CF{"User confirms? (R15, R16, R37)<br/>exactly one approach confirmed"}
    CF -- "No: request changes" --> F6
    CF -- "Other_Repo: Judge ends Task before freeze" --> TAO(["Terminal: Analysis only - not executed (R25, R36)"])
    CF -- "Yes" --> FZ["Freeze Decision_Doc (R15, R16)<br/>record version, hash, who, when"]
    FZ --> F7["F7 Agile planning, multi-role (R19, R20, R40)<br/>Product_Backlog with a Feature_Contract per story,<br/>Sprint_Plan, Definition_of_Done"]
    F7 --> F8["F8 Document-first (R19, R20, R40)<br/>requirements, design, tasks, Task_Board,<br/>Feature_Contracts part of the backlog documents"]
    F8 --> AD2{"Adapter branch (R25)"}
    AD2 -- "No (Other_Repo)" --> O2(["Terminal: Docs only - not developed (R25, R36)"])
    AD2 -- "Yes (linkding)" --> F10["F10 Develop and execute (R21, R22, R38, R39)<br/>Code_Agent edits a Task worktree in the Development_Sandbox<br/>(one container per Task, file writes confined to the worktree) and runs tests;<br/>modified app runs in the Run_Environment<br/>(start procedure analyzed by the Agent_Roles, only assessed by the Studio);<br/>one feature at a time;<br/>no decision power, only the story's Feature_Contract (R40)"]
    F10 -- "Code_Agent stops and asks:<br/>unclear requirement, conflict, more than the<br/>Feature_Contract, or retry limit reached (R40)" --> ASK{"Who answers? (R40)"}
    ASK -- "Technical question" --> TM
    ASK -- "Feature or requirement question" --> MOD["Moderator asks the Judge in feature words;<br/>Task shows waiting for answer (R2, R40)"]
    MOD -- "Answer received" --> F10
    ASK -. "Unanswered beyond the wait time:<br/>story marked Unconfirmed-blocked,<br/>next story if one is left (R40)" .-> F10
    ASK -. "Unanswered, no story left (R40)" .-> FL
    TM -- "Technical answer" --> F10
    F10 -- "Change recorded in Event_Stream (R38)" --> TM{"Tech_Manager review of the changed files<br/>(LLM judgment, not success) (R40)"}
    TM -- "Approve" --> CP{"Confirmation point (R21):<br/>user feedback?"}
    TM -- "Request changes, with reasons" --> F10
    TM -- "Escalate: to the Moderator, and for feature<br/>questions to the Judge in feature words" --> MOD
    TM -- "Approach itself must change:<br/>new Decision_Doc version (R16, R37, R40)" --> F6
    CP -- "Feedback" --> F10
    CP -- "No response" --> UC["Continue, result marked Unconfirmed<br/>(wait time UNDECIDED);<br/>reminder at the Judge's next input (R21)"]
    UC --> VF
    CP -- "Confirmed" --> VF["Verifier runs executable acceptance checks (R22)<br/>API read-back, target test suite, browser check<br/>in Run_Environment; compare with the plan"]
    VF -- "All checks pass" --> OK(["Terminal: success, decided by Verifier (R36)"])
    VF -- "Mismatch or other failure" --> FL(["Terminal: failed, recorded honestly with class (R23, R36)<br/>no hiding retry"])
    F10 -. "budget exceeded, Code_Agent failure<br/>or Run_Environment fails to start (R39)" .-> FL
    ANY["Any node: timeout, unrecoverable error<br/>or Judge abort (R36)"] -.-> FL
    ANY -.-> AB(["Terminal: aborted (R36)"])

    OK --> F11
    FL --> F11
    AB --> F11
    TAO --> F11
    O2 --> F11["F11 Final demo and Replay view (R26, R27)<br/>Demo_Review_Notes, Retrospective (R20)<br/>label: Replay"]

    USER["F9 User interjects any time (R5, R12)"] -.-> F2
    USER -.-> F3
    USER -.-> F5
    USER -.-> F7
    USER -.-> F10

    F2 -. "events" .-> ES[("Event_Stream saved (R27)")]
    F3 -. "events" .-> ES
    F5 -. "events" .-> ES
    F10 -. "events" .-> ES
    VF -. "events" .-> ES
    ES --> WS
    ES --> F11
    ES --> LIVE["Live watching, including queued Viewers (R28)"]
```

Flow chart notes:

- F9 "user interjects any time" runs through the whole flow and is drawn with dotted lines.
- Demonstration runs through the whole flow: F5 is itself a demo, and F10 builds and demos one feature at a time.
- Any step may fail; the chart shows the failure path at the verification stage as the representative case, and the same honest recording applies to all other steps (R23).
- Freeze point: F7 and later steps MUST NOT start before the Decision_Doc is confirmed.
- The chart is the draft of the Flow_Graph (R36): nodes and edges are data with guards; a deterministic stage machine moves the Task between nodes, and Agent loops run inside a node, never across nodes. The rounded nodes are Terminal_States.
- The approach to make linkding AI-powered is decided at F6 by the Agent_Roles with the Judge; the Studio only assesses it (R37).
- F7 and F8 produce the Feature_Contract of every story. In F10 every change is recorded, the Tech_Manager reviews the changed files against the Feature_Contract (an LLM judgment, not a guarantee), the Code_Agent stops and asks when it cannot resolve a problem, and a need to change the approach returns to F6 with a new Decision_Doc version. Development has no decision power (R40). Success is decided only by the Verifier's checks, which run after review and confirmation.
- Diffs, review verdicts and rejected changes go to the Event_Stream and the collapsed Engineering details view; the Judge sees feature-level status, demos and confirm cards (UI principle "Feature-first").
- The dashed Prototype activity between F5 and F6 is optional (Stretch, R41); it may also happen during F3 and F4 and never replaces the Decision_Doc confirmation.
- F11 is a view of the saved Event_Stream after a Terminal_State; it is not a stage that changes the Task outcome.
- The Event_Stream feeds the Workspace, so every presence and activity display comes from real events (R2).
- The Event_Stream stores complete messages only; live streamed text is shown in the Workspace while it arrives and is not stored, and Replay animates typing from the stored complete message (R3, R26, R27).

### Flow step to requirement mapping

| Flow step | Name | Requirement ids |
|---|---|---|
| Workspace | Team workspace screen | R1-R8 |
| F1 | Home input | R9 |
| F2 | Download and read | R10, R34 |
| F3 | Meeting analysis | R11, R18, R24 |
| Adapter branch | Adapted_Repo or Other_Repo | R25, R9 (labeling) |
| F4 | Sandbox | R13, R29, R39 |
| F5 | Browser_Use | R14 |
| F3-F6 (optional) | Prototype during the requirement meeting | R41 (Stretch) |
| F6 | Decide, approach options and assessment, freeze, versions; decision made here, not in development | R15, R16, R17 (Case_Cards, Stretch), R37 |
| F7 | Agile planning, Feature_Contract per story | R19, R20, R40 |
| F8 | Document-first, Feature_Contract in backlog documents | R19, R20, R40 |
| F9 | Interjection | R5, R12 |
| F10 | Develop in a worktree inside the per-Task container against the Feature_Contract, Tech_Manager review, stop and ask, run (start procedure analyzed by the Agent_Roles), confirmation points and reminders | R21, R22, R38, R39, R40 |
| Verification and failure | Verifier, honesty, Engineering details | R22, R23, R24, R38, R40 |
| Terminal states and Flow_Graph | Stage machine, all stages | R36 (all flow steps), R25 (Analysis only, Docs only labels) |
| F11 | Final demo and Replay | R26, R27 |
| Cross-cutting | Queue, LLM config, TTS, portability, compliance, layers | R28, R30, R31, R32, R33, R35 |

### Three document layers

| Layer | Name | Content | Reader | Delivery | Location |
|---|---|---|---|---|---|
| A | Dev docs | AGENTS.md, .kiro/steering, .kiro/specs, hooks | Developers and Kiro | Committed with the repository | Repository root and `.kiro/` |
| B | Runtime rules | Role duties, behavior rules, stage output schemas, linkding Adapter checklist, case library rules | In-product Agent_Roles | Shipped with the product, versioned, loaded at run time | `runtime-rules/` (decided in design.md) |
| C | Output docs | Decision_Doc, Product_Backlog, Sprint_Plan, Task_Board, Definition_of_Done, Demo_Review_Notes, Retrospective, plus requirements, design, tasks for the analyzed repository | Judge | Generated at run time, one set per Task | `data/tasks/<taskId>/docs/` (decided in design.md; generated, gitignored) |

Traceability: key requirements in A map to rules in B and to test checks. Example: A says "failures MUST be shown honestly", B has a matching Agent rule, and a test has a matching check. See the traceability table at the end.

Process note for our own work (layer A stays in Kiro format): each feature in our own tasks will include a "demo and verify" item. The design and tasks phases will honor this.

## Roles and Queue Rules

| Role | Type | Description |
|---|---|---|
| Judge | Human | Submits the URL, joins the meeting, confirms the Decision_Doc, gives feedback at confirmation points. Only one Judge can operate at a time |
| Viewer | Human | Queued or watching; can watch the current Task but cannot operate; never sees any key |
| Moderator | Agent_Role | Runs the meeting, summarizes disagreements, asks the user questions |
| Product | Agent_Role | Analyzes user value and workflows, labels A or B |
| Architecture | Agent_Role | Analyzes interfaces, data and integration |
| Risk_and_Security | Agent_Role | Identifies risks; safety rules are enforced by Studio code, not by this role |
| Verification | Agent_Role | Defines acceptance criteria and the read-back comparison plan; does not decide success |
| Tech_Manager | Agent_Role | Active in the development stage: reviews the files changed by the Code_Agent against the Feature_Contract and the Decision_Doc (approve, request changes, escalate) and answers technical questions; its verdict is an LLM judgment, not a guarantee, and not success |
| Verifier | Non-LLM component | The only judge of success |

The number of roles is TO BE CONFIRMED and may change during development.

Queue and watching rules: only one Judge operates at a time; others queue and may watch the current Task; no view may display a key.

## Requirements

### Group 1: Team Workspace UI (Must-have, highest priority)

### Requirement 1: Live team workspace screen

**User Story:** As a Judge, I want a live team workspace right after I submit a URL, so that I can see the roles working as a team.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHEN a Task is created, THE Studio SHALL open the Workspace for that Task.
2. THE Workspace SHALL display one Presence_Card per Agent_Role, each showing the role avatar, the role name, the role description and the current Role_Status.
3. THE Workspace SHALL provide an Activity_Feed area, an Artifact_Area, an Interjection_Input and an Interaction_Card area on one screen.
4. WHEN a Role_Status changes, THE Workspace SHALL update the corresponding Presence_Card.
5. WHERE the Task is a Replay, THE Workspace SHALL use the same layout as a live Task.
6. THE Studio SHALL give each Agent_Role an avatar.
7. WHERE a dark Halloween theme is used, THE Studio SHALL treat it as a styling choice only; the main Kiroween category remains Frankenstein.
8. THE project documents SHALL treat the question whether one entry may be in more than one Kiroween category as TO BE CONFIRMED and SHALL NOT assume the answer.

### Requirement 2: Event-backed presence, no fake animation

**User Story:** As a Judge, I want every "working" indicator to reflect something real, so that I can trust what I see.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. THE Studio SHALL derive every Role_Status from events in the Event_Stream.
2. WHILE an Agent_Role has no event inside the Recency_Window, THE Workspace SHALL show that role as "idle" or with an honest waiting reason.
3. WHILE the Studio waits for an LLM response, THE Workspace SHALL show the role as "waiting for LLM" with the elapsed seconds, for example "waiting for LLM response, 12 s elapsed".
4. THE Studio SHALL show a "working" indicator (reading, speaking, thinking) on a Presence_Card only when an Event_Stream event for that role exists inside the Recency_Window.
5. THE Recency_Window value SHALL be UNDECIDED and decided in the design stage.
6. WHEN an Agent_Role is blocked by a failure or a safety rule, THE Workspace SHALL show the status "blocked" with the reason.
7. WHILE nothing is happening in a Task, THE Workspace SHALL NOT display any animation that implies activity.
8. THE Studio SHALL show a role as "speaking" or "thinking" because of streaming only when a message-started event or a message-progress event for that role's message exists inside the Recency_Window and no event that ends that message (complete or incomplete) follows it. A message-progress event is a text-free lifecycle event that the Studio emits at a fixed interval while the message streams; it stores no text (Requirement 27.10).
9. WHERE Halloween-style avatar effects are used, THE Studio SHALL bind each effect to the Role_Status derived from events, and SHALL show no activity effect on an avatar while no event backs it.
10. WHILE the Code_Agent waits for an answer to a question (Requirement 40), THE Workspace SHALL show an honest "waiting for answer" status with the asked party (Tech_Manager or Judge) and the elapsed seconds.

### Requirement 3: Live activity feed with narration and streaming LLM output

**User Story:** As a Judge, I want a live feed that narrates what is happening, so that long waits feel immersive and informative.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHEN an event is appended to the Event_Stream, THE Activity_Feed SHALL display a narration entry for it, including the acting role and a timestamp.
2. THE Activity_Feed SHALL narrate each of these event kinds when it occurs in the Event_Stream: file being read, finding recorded, endpoint recorded, statement made, Judge message received, and action taken in the browser. Whether the Agent_Roles produce findings or endpoints is best effort (Process Principle 5); the Studio narrates only what was recorded.
3. WHERE a narration entry refers to a repository file, THE Activity_Feed SHALL attach the source file path to that entry.
4. WHEN the Judge selects a narration entry that has an artifact, THE Workspace SHALL show that artifact in the Artifact_Area.
5. THE Activity_Feed SHALL narrate only events that exist in the Event_Stream.
6. WHEN an Agent_Role is generating a response, THE Activity_Feed and the Presence_Card of that role SHALL display the model output incrementally as it arrives.
7. THE Studio SHALL display as live streamed text only the actual model output, and SHALL NOT display simulated text or text replayed from a cache while it is labeled as live.
8. WHEN a stream ends, THE Activity_Feed SHALL mark the entry as complete and THE Studio SHALL persist the Complete_Message in the Event_Stream.
9. IF a stream breaks, THEN THE Activity_Feed SHALL mark the entry "incomplete" with the reason, SHALL keep the partial text, THE Studio SHALL persist the partial text as a message marked "incomplete" with the reason, and THE Studio SHALL record the break as a failure with its Failure_Class.
10. WHILE a stream has not started, THE Presence_Card SHALL show "waiting for LLM" with the elapsed seconds (Requirement 2).
11. THE Studio SHALL persist only Complete_Messages and incomplete messages (criteria 8 and 9) and SHALL NOT store streamed text chunks; the live incremental display of criterion 6 is shown while the text arrives and is not itself stored.
12. WHERE the provider returns reasoning text with a response, THE Activity_Feed SHALL display the real reasoning text in a collapsible section labeled as model-provided.
13. WHERE the provider returns no reasoning text, THE Activity_Feed SHALL show only a "thinking" state with the elapsed seconds and SHALL NOT display invented reasoning text.

### Requirement 4: Artifact area

**User Story:** As a Judge, I want to see the work product being built, so that I know what the roles are producing.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. THE Artifact_Area SHALL display the current work product in feature terms, selectable from: files being read, the diagram or whiteboard-style view the roles are building, the Decision_Doc draft, and, in the development stage, the feature name, its plain-language status and its demo.
2. WHERE the Task is Adapted_Repo and a Browser_Use session is running, THE Artifact_Area SHALL display a live view of the sandboxed browser session.
3. WHEN a new work product appears, THE Artifact_Area SHALL show a notification that identifies it without taking focus away from the Judge's current selection.
4. WHILE a file is being read, THE Artifact_Area SHALL display the file path and the content portion read so far.
5. THE Artifact_Area SHALL display the Decision_Doc draft with its version number and its Unverified marks.
6. IF a work product is unavailable, THEN THE Artifact_Area SHALL display the reason.
7. THE Artifact_Area SHALL provide a collapsed "Engineering details" view, closed by default, that shows on demand the diffs, Review_Verdicts, rejected changes and tool calls of the development stage.
8. THE Studio SHALL NOT push diffs, Review_Verdicts or rejected changes into the Judge's main view and SHALL NOT open the Engineering details view without a Judge action.

### Requirement 5: Interjection, questions and confirmation cards

**User Story:** As a Judge, I want to talk to the team at any moment and answer their questions inline, so that I can steer the work.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHILE a Task is running, THE Interjection_Input SHALL be available at all times.
2. WHERE the Judge selects a specific Agent_Role as addressee, THE Studio SHALL deliver the message to that role as the primary recipient.
3. WHEN an Agent_Role asks the Judge a question, THE Workspace SHALL display an inline question card with predefined options and a free-text field.
4. WHEN a decision, a confirmation or a Checkpoint_Demo needs the Judge, THE Workspace SHALL display an inline confirm/reject card worded in feature terms (feature name, what it does, the demo), without file names, paths or diffs.
5. WHEN a Code_Agent question or a Tech_Manager escalation about a feature or requirement needs the Judge, THE Workspace SHALL display it as a question card phrased in feature terms.
6. WHEN the Judge answers a card, THE Studio SHALL record the answer in the Event_Stream and deliver it to the asking role.
7. THE exact decision-step UI SHALL be UNDECIDED and SHALL be explored by experimenting during implementation.
8. WHEN the Studio reminds the Judge of pending Unconfirmed items (Requirement 21.8), THE Workspace SHALL display the reminder as an inline card that lists each pending item in feature terms, without file names, paths or diffs.

### Requirement 6: Feedback for every user action

**User Story:** As a Judge, I want immediate feedback on everything I do, so that I know the system heard me.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHEN the Judge submits an input, THE Workspace SHALL display an acknowledgement that the input was received and delivered.
2. THE acknowledgement time bound SHALL be UNDECIDED and decided in the design stage.
3. WHEN the Studio delivers a Judge input to an Agent_Role, THE Workspace SHALL show a Role_Status change or an Activity_Feed entry for that delivery; the content and quality of the role's reply are best effort (Process Principle 5).
4. IF delivery of a Judge input fails, THEN THE Workspace SHALL display the failure next to that input.
5. WHEN the Judge confirms or rejects a card, THE Workspace SHALL display the resulting state change.

### Requirement 7: Honest progress and Replay in the same view

**User Story:** As a Judge, I want honest progress and a replay in the same screen, so that nothing is faked and review is easy.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHERE a progress value is known, THE Workspace SHALL display the real value.
2. WHERE a progress value is unknown, THE Workspace SHALL display an indeterminate state together with an explanation of what is being waited for.
3. THE Workspace SHALL NOT display a progress value that is not computed from real data.
4. WHILE the Workspace plays a Replay, THE Workspace SHALL display the label "Replay" visibly at all times.
5. WHEN a Replay plays, THE Workspace SHALL render presence, feed and artifacts from the saved Event_Stream.

### Requirement 8: Basic accessibility

**User Story:** As a Judge with accessibility needs, I want motion and keyboard handling to respect my settings, so that I can use the Workspace comfortably.

**Priority:** Must-have, highest priority

#### Acceptance Criteria

1. WHILE the operating system reduced-motion setting is on, THE Workspace SHALL disable non-essential animation.
2. THE Workspace SHALL allow every confirm/reject card and question card to be operated using the keyboard alone.
3. THE Workspace SHALL show a visible focus indicator on every interactive element.
4. THE Workspace SHALL NOT convey a Role_Status by color alone and SHALL include the status text.

### Group 2: Core Flow

### Requirement 9: Home page input

**User Story:** As a Judge, I want a search-like home page with one input, so that I can start an analysis by pasting a GitHub repository URL.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL display on the home page a single input for a GitHub repository URL and no other required input.
2. WHEN the Judge submits a URL that matches the form of a public GitHub repository address, THE Studio SHALL create a Task and start the reading step.
3. IF the submitted text is not a GitHub repository URL, THEN THE Studio SHALL display an error that names the expected form and SHALL NOT create a Task.
4. IF the repository does not exist or is not public, THEN THE Studio SHALL display the reason returned by GitHub and SHALL NOT create a Task.
5. WHEN a Task is created, THE Studio SHALL label the Task as Adapted_Repo or Other_Repo according to whether an Adapter exists for it.

### Requirement 10: Download and read-only reading, immersion

**User Story:** As a Judge, I want to watch the repository being read in real time, so that I understand what the Agent reads and discovers during a long wait.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN a Task starts, THE Repo_Reader SHALL download the repository content using a read-only credential.
2. WHILE the Repo_Reader is reading, THE Studio SHALL display in real time the file currently being read and each finding the Agent_Roles record, with the source file path; which findings the Agent_Roles discover is best effort.
3. THE Repo_Reader SHALL treat the downloaded repository as read-only text and SHALL NOT execute any file from it.
4. THE Studio SHALL record each reading event into the Event_Stream with a timestamp.
5. IF the download fails, THEN THE Studio SHALL display the failure reason, record it in the Event_Stream, and stop the Task without retrying silently.
6. WHERE the repository exceeds the read-volume limit defined in Requirement 34, THE Repo_Reader SHALL display which parts were skipped.

### Requirement 11: Multi-role meeting analysis

**User Story:** As a Judge, I want multiple AI roles to discuss the repository like a meeting and ask me questions, so that I do not just receive a one-shot conclusion.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN reading finishes, THE Studio SHALL start a meeting and give a turn to each of the Moderator, Product, Architecture, Risk_and_Security and Verification Agent_Roles.
2. IF an Agent_Role does not produce a schema-valid statement in its turn, THEN THE Studio SHALL record that role's turn as failed (Requirement 23) and SHALL NOT present the role as having contributed.
3. THE Studio SHALL display each statement with the speaking Agent_Role name.
4. THE Agent_Roles SHOULD discuss the repository from their own role perspective, and the Moderator SHOULD ask the Judge at least one question before presenting a conclusion (best effort, measured, not guaranteed; Process Principle 5).
5. THE Studio SHALL require each conclusion to carry an evidence reference (source file path, and the line number where available) in the stage output schema and SHALL validate the reference as in Requirement 24.
6. IF a conclusion lacks an evidence reference or its evidence fails validation, THEN THE Studio SHALL mark it Unverified.
7. THE Studio SHALL require each analyzed workflow to carry a purpose A or purpose B tag in the stage output schema; which tag the Agent_Roles choose is best effort and is confirmed by the Judge in the Decision_Doc.
8. THE Studio SHALL record each statement and each Judge answer into the Event_Stream.

### Requirement 12: User interjects at any time

**User Story:** As a Judge, I want to interject at any time, so that I can steer the analysis without waiting for a step to end.

**Priority:** Must-have

#### Acceptance Criteria

1. WHILE a Task is running, THE Studio SHALL accept a Judge message at any step.
2. WHEN a Judge message arrives, THE Studio SHALL display it in the Workspace and deliver it to the Agent_Roles before their next statement or action.
3. THE Studio SHALL record each Judge message into the Event_Stream.
4. WHEN a Judge message conflicts with a Frozen Decision_Doc, THE Studio SHALL tell the Judge that the change requires a new Decision_Doc version (Requirement 16). Detecting the conflict is an LLM judgment and is best effort (measured, not guaranteed); the Studio enforces only that a changed baseline needs a new Decision_Doc version (Requirement 16).

### Requirement 13: Sandbox run (linkding only)

**User Story:** As a Judge, I want unmodified linkding to run in an isolated sandbox, so that the Agent can really operate it for the baseline experience without risk to any other system.

**Priority:** Must-have

#### Acceptance Criteria

1. WHERE the Task is Adapted_Repo, THE Studio SHALL start linkding in the Sandbox before the Browser_Use step.
2. WHEN a Task starts a Sandbox, THE Studio SHALL reset linkding to the fixed test data set.
3. THE Studio SHALL run only the linkding version identified by the Adapter's target reference and SHALL NOT run any other code taken from a submitted repository.
4. IF the Sandbox fails to start, THEN THE Studio SHALL display the failure, record it in the Event_Stream, and end the Task in the Terminal_State `failed` with the label "not executed".
5. THE Studio SHALL keep Sandbox access limited to the Studio backend and SHALL NOT expose the linkding token to any Viewer or Judge view.
6. THE Studio SHALL run the unmodified linkding version identified by the Adapter in the Sandbox for flow steps F4 and F5; the modified target software runs only in the Run_Environment (Requirement 39).

### Requirement 14: Browser use experience (linkding only)

**User Story:** As a Judge, I want to watch the Agent use linkding in a browser and analyze while using it, so that the experience itself is the demonstration.

**Priority:** Must-have (confirmed by the user for the first version). Image input by the default model was verified by a live test on 2026-11-20 (Requirement 30).

#### Acceptance Criteria

1. WHERE the Task is Adapted_Repo, THE Studio SHALL run a Browser_Use session against the Sandbox linkding after it starts.
2. WHILE the Browser_Use session runs, THE Studio SHALL display each Agent action and observation in real time.
3. WHILE the Browser_Use session runs, THE Studio SHALL display analysis notes produced by the Agent_Roles.
4. THE Studio SHALL record each Browser_Use event into the Event_Stream.
5. THE Studio SHALL limit the Browser_Use scope to the browser page of the Sandbox linkding and SHALL NOT control the whole desktop.
6. IF a Browser_Use action fails, THEN THE Studio SHALL record the failure with its Failure_Class in the Event_Stream before the next Browser_Use action is executed.
7. THE Studio SHALL use page-structure snapshots as the primary Browser_Use observation method and MAY use screenshots as a supplement.
8. WHERE Browser_Use uses screenshots, THE Studio SHALL use a model that accepts image input; screenshots are allowed because image input by the default model deepseek-flash was verified by a live test on 2026-11-20 (a solid red image was identified as red). How well the model reads real page screenshots is not yet verified.
9. WHERE the configured model does not accept image input, THE Studio SHALL use page-structure operation only.
10. THE Studio SHALL keep desktop control (computer use) out of scope.
11. WHERE an Acceptance_Check is a browser check, THE Verifier SHALL run it as a scripted Playwright check without an LLM (Requirement 22.9) against the Run_Environment and SHALL record its events in the Event_Stream; the LLM-driven Browser_Use operator is used only for the experience in flow step F5.

### Requirement 15: Decision_Doc production, confirmation and freeze

**User Story:** As a Judge, I want to decide with the Agent how to make the software powered by AI and confirm a decision document, so that all later steps rest on a stable baseline.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN the analysis and experience steps finish, THE Studio SHALL start an interactive decision step with the Judge.
2. THE Studio SHALL validate the Decision_Doc against its stage output schema and SHALL reject a draft that lacks a required section; the Agent_Roles draft the content (best effort), and the Judge confirms it. The Decision_Doc contains: purpose (A or B), selected workflows, in-scope items, out-of-scope items, acceptance criteria, approach options with their assessments (Requirement 37), the chosen approach, UI impact, executable acceptance checks, risks, evidence sources with file references, open questions, version number, content hash, and confirmation record (who, when).
3. WHEN the Judge confirms a Decision_Doc version, THE Studio SHALL freeze it and SHALL record the version number, content hash, confirming person and confirmation time.
4. WHILE no Decision_Doc version is confirmed, THE Studio SHALL block the planning, document-first and execution steps from starting.
5. WHILE no Decision_Doc version is confirmed, THE Studio SHALL prevent every Agent_Role from planning or executing based on that version.
6. WHEN a Decision_Doc is Frozen, THE Studio SHALL reject any in-place modification of its content.
7. WHERE the purpose of a workflow is B and the confirmed approach executes the workflow by operating linkding through its API, THE Studio SHALL require explicit Judge confirmation before any write operation derived from an AI suggestion. Where the confirmed approach is a source or UI change, this confirmation step applies to how the built feature behaves and is checked by the Acceptance_Checks (Requirement 22).
8. THE Studio SHALL display statements in the Decision_Doc whose evidence is missing or fails validation (Requirement 24) as Unverified.
9. THE "UI impact" section of the Decision_Doc SHALL describe how the user interface would change after the feature becomes AI-powered, SHALL be proposed by the Agent_Roles (best effort) and decided with the Judge, and SHALL NOT be pre-decided by these requirements.
10. THE "executable acceptance checks" section of the Decision_Doc SHALL list each check in a form the Verifier can execute (Requirement 22).
11. THE Decision_Doc SHALL record exactly one confirmed approach (or one confirmed combination of approaches) before it can be frozen (Requirement 37).

### Requirement 16: Decision_Doc version changes

**User Story:** As a Judge, I want later feedback to create a new version rather than silently altering the confirmed one, so that the baseline stays trustworthy.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN the Judge requests a change after a Decision_Doc is Frozen, THE Studio SHALL create a new version with an incremented version number and a new content hash.
2. WHEN a new version is created, THE Studio SHALL require a new Judge confirmation before it replaces the previous baseline.
3. WHILE a new version awaits confirmation, THE Studio SHALL keep the previous Frozen version as the only baseline and mark any work started afterwards as based on that version.
4. THE Studio SHALL keep all versions with their hashes and confirmation records viewable.
5. FOR ALL Decision_Doc versions, recomputing the content hash over the stored content SHALL equal the recorded hash.

### Requirement 17: Case inspiration (similar approaches cards)

**User Story:** As a Judge, I want to see similar approaches during the decision step and the meeting, so that I get inspiration for making software powered by AI.

**Priority:** Stretch

#### Acceptance Criteria

1. WHEN the meeting or the decision step discusses a workflow, THE Studio SHALL display Case_Cards related to that workflow from the project's own case library.
2. THE Studio SHALL display on each Case_Card a source link and an evidence boundary statement.
3. WHERE a Case_Card originates from a company or vendor disclosure, THE Studio SHALL state that it is not independent verification.
4. THE Studio SHALL limit the case library topic to making software powered by AI and SHALL exclude enterprise AI adoption cases.
5. THE Studio SHALL contain only case documents written by the team and SHALL exclude case documents copied from another project.

### Requirement 18: Purpose A/B and default thinking path

**User Story:** As a Judge, I want each workflow labeled A or B with a matching working method, so that replacement work and capability enhancement are handled with the right level of care.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL label every analyzed workflow as A (replace a human decision or work step with AI) or B (AI-powered: a function becomes stronger or new) in the Decision_Doc.
2. WHERE a workflow is labeled A and the confirmed approach executes the workflow by operating linkding through its API, THE Studio SHALL run its execution as the stages read, plan, try one item, write in batch, read back, with the write tools available only in the "try one item" and "write in batch" stages and the read tools available in the read and read-back stages, and with each stage entered only through the Flow_Graph. Where the confirmed approach is a source or UI change, these stages apply to how the built feature behaves and are checked by the Acceptance_Checks (Requirement 22).
3. WHERE a workflow is labeled B and the confirmed approach executes the workflow by operating linkding through its API, THE Studio SHALL add to the A stages a stage "retrieve or infer, then suggest with evidence" before any write stage, and SHALL require a schema-valid suggestion with an evidence reference to enter the write stage.
4. WHERE a workflow is labeled B and the confirmed approach executes the workflow by operating linkding through its API, THE Studio SHALL require Judge confirmation before writing any result (consistent with Requirement 15.7).
5. THE Agent_Roles SHOULD make good use of each stage, for example plan from what was read and choose a representative item to try first (best effort, measured, not guaranteed); the Verifier and the read-back stage check the outcome (Requirement 22).
6. IF a workflow cannot be labeled A or B, THEN THE Studio SHALL list it as an open question in the Decision_Doc.

### Requirement 19: Agile planning and document-first

**User Story:** As a Judge, I want a multi-role agile plan and documents prepared before development, so that Agents work from documents rather than improvisation.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN a Decision_Doc is Frozen, THE Studio SHALL start the multi-role agile planning step.
2. THE Studio SHALL have the Agent_Roles draft requirements, design and tasks documents from the Frozen Decision_Doc version, SHALL validate each against its schema, and SHALL record that version number in each; the quality of the drafted content is best effort (Process Principle 5).
3. WHEN splitting user stories and features, THE Studio SHALL attach to each feature a demonstration and confirmation point.
4. WHILE the Output_Docs are incomplete, THE Studio SHALL block development from starting.
5. THE Studio SHALL place the Output_Docs referenced by the assigned story into the context of the Agent_Role for development, and THE Agent_Roles SHOULD base their actions on them (best effort, measured, not guaranteed).
6. WHERE the Task is Other_Repo, THE Studio SHALL stop after producing documents and label the result Docs_Only.
7. WHEN the Studio assigns a task to an Agent_Role, THE Studio SHALL give that Agent_Role exactly one Product_Backlog story plus the documents that story references as its working context, and SHALL NOT give it the whole repository or all documents.
8. IF an Agent_Role needs context outside its assigned story and referenced documents, THEN THE Agent_Role SHALL ask through the Moderator or the Judge (Requirement 40); the Studio SHALL provide no tool that reads context outside the assigned story and its referenced documents.
9. WHEN the Studio performs planning and document-first, THE Studio SHALL generate the Feature_Contract of each story from the Frozen Decision_Doc version and SHALL include it in the backlog documents (Requirement 40).
10. THE Studio SHALL reference the Feature_Contract of each story in the Sprint_Plan entry of that story.

### Requirement 20: Agile documents (layer C set)

**User Story:** As a Judge, I want the documents an agile process needs generated for the analyzed repository, so that planning, delivery and review are all documented and traceable to the baseline.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN a Decision_Doc is Frozen, THE Studio SHALL generate the Product_Backlog, Sprint_Plan, Task_Board and Definition_of_Done for the Task and SHALL validate each against its schema.
2. WHEN a Checkpoint_Demo ends, THE Studio SHALL generate one Demo_Review_Notes entry for that feature confirmation point.
3. WHEN a Task ends, THE Studio SHALL generate the Retrospective.
4. THE Studio SHALL record in every Agile_Docs document the version number of the Frozen Decision_Doc it references.
5. THE Studio SHALL give every Product_Backlog story at least one acceptance criterion and exactly one demo and confirmation point.
6. THE Studio SHALL give every Product_Backlog story a priority.
7. THE Sprint_Plan SHALL state a sprint goal and list the selected stories by identifier.
8. THE Task_Board SHALL show for every work item a status from the set to do, in progress, done and blocked.
9. IF a Product_Backlog story lacks an acceptance criterion, a demo and confirmation point, or a Feature_Contract, THEN THE Studio SHALL reject the Product_Backlog as invalid and SHALL display which story is incomplete.
10. WHEN a new Decision_Doc version is Frozen, THE Studio SHALL mark Agile_Docs that reference an older version as based on an older version.
11. THE Studio SHALL include the Feature_Contract of every story in the Product_Backlog documents and SHALL record in it the Decision_Doc version it was derived from (Requirement 40).

### Requirement 21: Demo and confirmation points during development

**User Story:** As a Judge, I want each feature demonstrated and confirmed as it is built, so that I can give feedback before the next piece starts.

**Priority:** Must-have

#### Acceptance Criteria

1. WHILE development runs, THE Studio SHALL develop one feature at a time, demonstrate it, and request Judge feedback at its confirmation point before starting the next feature.
2. WHEN a confirmation point is reached, THE Studio SHALL display a confirm card in feature words (feature name, plain-language status, the demonstration of the feature) and an input for Judge feedback, and SHALL NOT include file names, paths or diffs in the card.
3. WHEN the Judge gives feedback at a confirmation point, THE Studio SHALL record it and apply it before continuing.
4. IF the Judge does not respond at a confirmation point within the confirmation wait time, THEN THE Studio SHALL allow the Agent to continue and SHALL mark the result Unconfirmed.
5. THE Studio SHALL display an Unconfirmed result as Unconfirmed in every summary and in the final result.
6. THE Studio SHALL record each confirmation point and its outcome into the Event_Stream.
7. THE confirmation wait time SHALL be UNDECIDED and decided in the design stage.
8. WHEN the Judge next gives any input while results marked Unconfirmed are pending, THE Studio SHALL remind the Judge of the pending Unconfirmed items, listed in feature terms (feature name and plain-language status), without file names, paths or diffs.
9. THE Studio SHALL record each reminder of criterion 8 in the Event_Stream.

### Requirement 22: Execution and independent verification

**User Story:** As a Judge, I want success decided by an independent verifier running executable checks against the real result, so that I can trust the result.

**Priority:** Must-have

#### Acceptance Criteria

1. WHERE the Task is Adapted_Repo, THE Studio SHALL execute the approved plan against linkding: through the linkding API in the Sandbox for approaches that do not change the source, and in the Run_Environment for approaches that change the source or the UI (Requirements 38 and 39).
2. WHEN execution finishes, THE Verifier SHALL run the executable Acceptance_Checks of the Frozen Decision_Doc and compare the results item by item with the plan; an Acceptance_Check is one of: an API read-back through the linkding REST API, a run of the target's own test suite in a fresh container from the Development_Sandbox image (not necessarily the same container instance), or a scripted Playwright browser check, executed by the Verifier without an LLM (criterion 9), that a new or changed UI element works; the LLM-driven Browser_Use operator is used only for the experience in flow step F5.
3. THE Studio SHALL determine success from the Verifier result of the Acceptance_Checks only.
4. WHEN the Verifier compares tags, THE Verifier SHALL use an inclusion comparison (planned tags are a subset of read-back tags), because linkding auto-tagging rules merge tags.
5. WHEN the plan creates a bookmark whose URL already exists, THE Verifier SHALL treat the result as an update of the existing bookmark and SHALL compare accordingly.
6. IF the Verifier result differs from the LLM statement, THEN THE Studio SHALL display the Verifier result as the outcome and SHALL display the disagreement.
7. THE Studio SHALL display per-item pass or fail results from the Verifier.
8. WHERE a source change or a UI change is verified, THE Verifier SHALL verify it in the Run_Environment.
9. THE Verifier SHALL decide each Acceptance_Check without calling an LLM.

### Requirement 23: Failure and honesty principle

**User Story:** As a Judge, I want failures shown as they are, so that nothing simulated is presented as success.

**Priority:** Must-have

#### Acceptance Criteria

1. IF any step fails, THEN THE Studio SHALL display the failure, record it in the Event_Stream, and keep the original failure visible in any later retry.
2. THE Studio SHALL classify each failure into at least four Failure_Classes: interface call failure, read-back mismatch, LLM output format invalid, and rejected by a safety rule; the Studio additionally uses the Failure_Classes budget exceeded and blocked by an unanswered question.
3. THE Studio SHALL display a separate count for each Failure_Class.
4. THE Studio SHALL label every simulated result as simulated.
5. WHERE a retry occurs, THE Studio SHALL display each attempt and its outcome as separate events.
6. IF the LLM output does not pass local schema validation, THEN THE Studio SHALL count it as LLM output format invalid and discard the output.
7. IF a safety rule rejects an action, THEN THE Studio SHALL skip the action and SHALL display the rejecting rule.

### Requirement 24: Evidence and Unverified

**User Story:** As a Judge, I want conclusions tied to source files and unsupported ones marked, so that I can tell facts from guesses.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL require each conclusion to carry at least one evidence reference consisting of a source file path, the line number where available, and a quoted snippet.
2. WHEN a conclusion cites evidence, THE Studio SHALL check that the cited file exists in the downloaded repository and that the quoted snippet is present in it, and SHALL mark the conclusion Unverified if either check fails.
3. IF an interface or capability has no evidence reference that passes the check in criterion 2, THEN THE Studio SHALL mark it Unverified and SHALL present it as not confirmed to exist.
4. THE Studio SHALL require an evidence reference for every endpoint named in a Decision_Doc and SHALL mark the endpoint Unverified when the reference is missing or fails the check.
5. FOR ALL conclusions in a Decision_Doc, either an evidence reference that passed the check exists or the Unverified mark exists.
6. THE Studio SHALL NOT claim that a passed evidence check proves the conclusion is correct; the check proves only that the cited file and snippet exist. The Agent_Roles SHOULD avoid naming endpoints or capabilities the repository does not contain (best effort, measured, not guaranteed).

### Requirement 25: Scope tiers and labels

**User Story:** As a Judge, I want to know exactly what was executed and what was only analyzed, so that I am not misled.

**Priority:** Must-have

#### Acceptance Criteria

1. WHERE the Task is Other_Repo and only analysis was done, THE Studio SHALL label the result "Analysis only - not executed" on every result view.
2. WHERE the Task is Other_Repo and documents were produced without development, THE Studio SHALL label the result "Docs only - not developed" on every result view.
3. THE Studio SHALL execute (run, operate with browser, develop, including source changes inside a per-Task Worktree, and verify) only on Adapted_Repo, which in the first version is linkding.
4. THE Studio SHALL keep code taken from any submitted Other_Repo from running on the server or on the user's machine.
5. IF the Judge asks for execution on an Other_Repo, THEN THE Studio SHALL decline and explain that execution is not supported in the first version.
6. THE Studio repository SHALL contain linkding only as an unmodified external dependency and SHALL NOT contain modified target code; modified copies SHALL exist only in per-Task Worktrees (Requirement 38).
7. THE Studio SHALL confine the file writes of the Code_Agent to the Task Worktree (Requirement 38); the guarantee comes from the container boundary of the Development_Sandbox, and network access is limited only as far as the container's network policy sets it (Requirement 38).
8. IF the backend that serves a Task has no Docker engine, THEN THE Studio SHALL end a linkding Task in the Terminal_State `failed` with the label "not executed" after analysis, and THE home page SHALL state that live execution is unavailable.

### Requirement 26: Final demo and Replay

**User Story:** As a Judge, I want a final demonstration and a replay of the whole process, so that I can review what happened.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN a Task ends, THE Studio SHALL provide a final demonstration view built from the Event_Stream.
2. THE Studio SHALL display the label "Replay" visibly on every Replay view.
3. THE Studio SHALL present a Replay as a recording and not as real-time.
4. WHEN the Judge opens a Replay, THE Studio SHALL support playback, speed change and seeking to a point in time.
5. THE Studio SHALL show in the final view the Verifier results, Failure_Class counts, Unconfirmed marks, and the "Analysis only - not executed" or "Docs only - not developed" label where applicable.
6. THE Replay SHALL be event-stream playback from a Replay_File.
7. THE Workspace UI state SHALL be a pure function of the ordered events, and live view and Replay SHALL share the same rendering logic.
8. THE Studio MAY keep a Replay of a real recorded successful run, labeled "Replay", as a complement to live runs, and SHALL NOT use it to replace the honesty rules.
9. WHEN a Replay shows a message, THE Studio SHALL animate the typing in the UI from the stored Complete_Message, and SHALL state in the Replay view that typing speed in Replay is simulated and does not reflect real latency. The typing animation is presentation only and is not part of the UI state of criterion 7.

### Requirement 27: Event stream and experience layer

**User Story:** As a Judge, I want one saved event list that drives both live viewing and replay, so that what I saw live matches what I replay.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL save process events as an Event_Stream, one ordered list per Task.
2. THE Studio SHALL play the Event_Stream in the browser, supporting live view, replay, speed change and seeking; basic event replay is Must-have, and the video-like Remotion presentation of a Replay is a Stretch enhancement.
3. THE Studio web page SHALL read the same Event_Stream for live view and replay.
4. FOR ALL Event_Streams, serializing then deserializing SHALL produce an equivalent Event_Stream (round trip).
5. WHERE Remotion is used for the Stretch presentation, THE README SHALL state that Remotion is used under its free license conditions for an individual developer (license terms TO BE CONFIRMED).
6. IF an event cannot be saved, THEN THE Studio SHALL display the failure and mark the Task record incomplete.
7. THE Studio SHALL persist model text in the Event_Stream only as Complete_Messages, and an interrupted stream only as the partial text marked "incomplete" with the reason (Requirement 3.8, 3.9, 3.11).
8. WHEN a Replay shows message text, THE Studio SHALL label it "Replay".
9. THE Studio SHALL give every event a sequence number and a timestamp.
10. THE Studio SHALL record for each model message a message-started event, `message_progress` lifecycle events without text at a fixed interval while the message streams, and an event that ends it (complete or incomplete), without text chunks, so that presence can be derived from events (Requirement 2.8).
11. THE Replay_File SHALL carry a schema version.
12. THE Replay_File SHALL contain no key and no token.
13. THE Replay_File SHALL be servable as a static file by the front-end host, so that a Replay can be viewed while the backend is offline, and THE Studio SHALL label it "Replay".
14. FOR ALL ordered event sequences, rendering the UI state live and rendering it from the Replay_File SHALL produce the same UI state.

### Requirement 28: Queue and watching

**User Story:** As a Viewer, I want to wait in a queue and watch the current task, so that I can follow along without interfering.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL allow only one Judge to operate at the same time.
2. WHEN a second person requests to operate while a Task is active, THE Studio SHALL place the person in a queue and display the queue position.
3. WHILE a person is queued or only watching, THE Studio SHALL display the current Task process in real time and disable all operations.
4. THE Studio SHALL keep every key and token out of every view, including the Viewer view and the Event_Stream.
5. WHEN the active Task ends, THE Studio SHALL promote the next queued person.
6. THE Studio backend SHALL enforce the queue and the single-operator rule server-side, and SHALL reject operation requests from a queued or watching person even when the UI hides the controls.

### Requirement 29: Data isolation and recovery

**User Story:** As a Judge, I want linkding reset to fixed test data before each Task and a way to restore it, so that each run starts from the same state.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN a Task starts on Adapted_Repo, THE Studio SHALL reset linkding to the fixed test data set before any Agent action.
2. THE Studio SHALL provide an operation that restores linkding to the fixed test data set, and SHALL accept the restore operation only from the current operator (the queue lease holder, Requirement 28) or the admin.
3. THE Studio SHALL keep only test data in linkding and SHALL keep real personal data out of it.
4. WHEN a reset or restore finishes, THE Verifier SHALL confirm that the linkding data equals the fixed test data set.
5. IF a reset or restore fails, THEN THE Studio SHALL display the failure, SHALL NOT start any Agent action on linkding, and SHALL end the Task in the Terminal_State `failed` with the label "not executed".

### Requirement 30: LLM configuration and data egress

**User Story:** As a Judge, I want to use my own LLM address, model name and key, so that I can try the product with the model I trust.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL use an OpenAI-compatible request format to call the LLM.
2. WHERE Judge-supplied LLM configuration is enabled (a feature flag, off until Open items 6 and 20 are settled), THE Studio SHALL let the Judge fill in the base address, model name and key.
3. THE Studio SHALL use the default model name deepseek-flash and the default base address https://api.deepseek.com; both were verified by a live test on 2026-11-20, in which the models endpoint listed deepseek-flash and deepseek-v4-pro.
4. THE Studio SHALL obtain structured output by requiring the LLM to output JSON or by using function calling, and SHALL validate all structured output locally regardless of the method.
5. THE Studio SHALL keep the LLM key and the GitHub read-only token in server-side environment variables or server-side memory only, and SHALL keep them out of the repository, logs and the Event_Stream.
6. THE Studio SHALL send to the LLM only test data from linkding and, for repository analysis, only text fragments of public repositories.
7. IF the LLM call fails, THEN THE Studio SHALL display the failure and record the Failure_Class.
8. WHERE a Judge-supplied key is used, THE Studio SHALL use it only for that Task and SHALL NOT display it back.
9. THE Studio SHALL request streamed responses using the OpenAI-compatible streaming format; streaming by the default model and endpoint was verified by a live test on 2026-11-20.
10. IF streaming is unavailable, THEN THE Studio SHALL fall back to non-streaming and SHALL display a visible note that the response arrived at once, and SHALL NOT simulate streaming.
11. THE Studio SHALL treat the following default-model capabilities as verified by a live test on 2026-11-20: streaming, function calling, and image input (a solid red image was identified as red). The Studio SHALL keep function calling plus local validation of structured output (criterion 4).
12. THE model streams its thinking text separately: reasoning content arrives before the answer text. Thinking is on by default and consumes the token budget. THE Studio SHALL therefore set max_tokens so that it leaves room for thinking, and SHALL check the finish reason of every response for truncation.
13. IF the finish reason shows that a response was truncated, THEN THE Studio SHALL treat the response as a failure with the Failure_Class "LLM output format invalid" and SHALL NOT use the truncated output as a valid structured result.
14. Whether thinking can be turned off is TO BE CONFIRMED (not verified); THE Studio SHALL NOT rely on turning thinking off.
15. THE Studio SHALL redact every known secret value (LLM key, GitHub token, linkding token, per-Task proxy credential) from every event before the event is persisted, broadcast or written to a Replay_File.
16. THE Studio SHALL NOT pass the real LLM key into the Development_Sandbox; THE Studio SHALL give the Code_Agent a per-Task credential for the LLM_Proxy, which holds the real key. Whether the chosen Code_Agent runtime accepts a custom base address is TO BE CONFIRMED by the first spike task (in the 2026-11-20 test, setting a custom base address on the harness runtime returned HTTP 404; the cause is not known).
17. WHERE a Judge-supplied base address is enabled, THE Studio SHALL accept only https addresses that resolve to public IP addresses and SHALL reject loopback, private, link-local and cluster addresses (server-side request forgery protection).

### Requirement 31: Narration (text to speech)

**User Story:** As a Judge, I want narration in the replay, so that the demo is easier to follow.

**Priority:** Stretch

#### Acceptance Criteria

1. WHEN a meeting ends, THE Studio SHALL pre-generate narration audio for the replay and cache it.
2. WHEN a Replay plays, THE Studio SHALL play the cached audio and SHALL NOT synthesize speech on the fly.
3. THE Studio SHALL call the TTS_Service only from the project's own backend.
4. THE Studio SHALL limit each TTS request to at most 240 characters and SHALL limit request frequency.
5. THE Studio SHALL send each TTS request as POST /v1/speech with text and language (zh or en) and treat the response as a 24 kHz mono WAV.
6. THE Studio SHALL convert the cached audio to a smaller format before serving it.
7. IF the TTS_Service is unavailable, THEN THE Studio SHALL play the Replay without audio and SHALL display that narration is unavailable.
8. THE Studio SHALL treat the following TTS_Service facts, supplied by the user, as TO BE CONFIRMED: no subtitles, a serial queue of at most 4 segments per Pod, no authentication, no public entry, temporary forwarding through the project's front-end Pod.
9. THE network path from the PC to the TTS_Service SHALL be UNDECIDED.

### Requirement 32: Portability and runtime environment

**User Story:** As a developer, I want the Studio configured by environment variables and easy to move, so that hosting can change last without breaking the Judge link.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL read all configuration from environment variables.
2. THE Studio SHALL be runnable as containers.
3. THE Studio SHALL keep its state in one directory or one SQLite database.
4. THE Studio SHALL run without Windows-specific features.
5. THE Studio web page SHALL read the same Event_Stream regardless of where the backend runs.
6. THE Studio SHALL first run on the user's Windows PC; hosting (k3s, Cloudflare domain) is done last and is UNDECIDED.
7. WHEN the backend is migrated, THE Studio SHALL keep the Judge-facing link unchanged by changing only the backend.

Note (hosting consequence, Open item 46): live execution (flow steps F4-F10) needs the Docker engine on the developer's Windows PC. After the front end moves to the cluster, live execution is available only while the PC and its tunnel are up; otherwise Judges can use analysis (if the backend is hosted) and labeled Replays.

### Requirement 33: Open source and submission compliance

**User Story:** As a developer, I want the repository to meet submission rules, so that the entry is valid.

**Priority:** Must-have

#### Acceptance Criteria

1. THE repository SHALL contain the complete source code, assets and run instructions.
2. THE repository SHALL contain a LICENSE file with the Apache-2.0 license (DECIDED; the LICENSE file is committed).
3. THE repository SHALL commit the `.kiro/` directory and SHALL keep it out of `.gitignore`.
4. THE repository SHALL contain `.env.example` and SHALL keep every key, token and `.env` file out of the repository.
5. THE README SHALL state that the project is a new work with new history, written entirely by the team, and that no code or assets are copied from other projects.
6. THE README SHALL list third-party dependencies with their licenses, including the DeepSeek Harness runtime executable as MIT with its third-party notices (Open item 29).
7. THE README SHALL explain how Kiro was used, and all Devpost submission materials SHALL be in English.
8. THE README SHALL describe how a Judge tries the product; where login is needed, review account details SHALL be provided outside the repository.
9. THE Studio SHALL remain free for Judges to use until 2027-01-30 05:00 Beijing time (TO BE CONFIRMED).
10. THE demonstration video SHALL be at most 3 minutes and SHALL be a supplement to the usable product.

### Requirement 34: GitHub read limits

**User Story:** As a developer, I want GitHub reads cached and capped, so that rate limits do not break the Studio.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Repo_Reader SHALL use a read-only GitHub token held server-side.
2. THE Repo_Reader SHALL cache downloaded repository content so that a repeated request for the same repository version does not download it again.
3. THE Repo_Reader SHALL enforce a per-Task read-volume limit whose value is UNDECIDED and defined in the design stage.
4. IF the GitHub rate limit is reached, THEN THE Studio SHALL display the limit state and SHALL NOT fabricate repository content.
5. THE Studio SHALL treat the anonymous rate limit value as TO BE CONFIRMED and SHALL NOT assume it.

### Requirement 35: Three document layers and traceability

**User Story:** As a developer, I want the three document layers kept distinct and traceable, so that key rules are enforced by tests.

**Priority:** Must-have

#### Acceptance Criteria

1. THE repository SHALL keep Dev_Docs, Runtime_Rules and Output_Docs in separate, named locations; the Runtime_Rules directory name is UNDECIDED.
2. THE Runtime_Rules SHALL be versioned.
3. WHEN a Task runs, THE Studio SHALL record in the Event_Stream the Runtime_Rules version used.
4. THE Studio SHALL load Runtime_Rules at run time and supply them to the Agent_Roles.
5. THE repository SHALL map each key Dev_Docs requirement to a Runtime_Rules rule and to a test check; the mapping is summarized in the traceability table.
6. THE Runtime_Rules SHALL define the output schema of each stage, and THE Studio SHALL validate stage outputs against it.
7. THE Studio SHALL contain only documents and code written by the team and SHALL exclude case documents or code copied from other projects.
8. THE Runtime_Rules SHALL contain the "small scope per Agent" rule of Requirement 19 (one Product_Backlog story plus its referenced documents per Agent_Role task), and THE repository SHALL include a test check that the Studio builds each Agent context this way.
9. THE Runtime_Rules SHALL contain the rule "development agents have no decision power, MUST stop and ask when a problem cannot be resolved within the Feature_Contract, and are reviewed by the Tech_Manager" (Requirement 40), and THE repository SHALL include a test check that the Studio routes a simulated unresolved problem to a question and not to a widened scope.
10. THE Studio SHALL treat Runtime_Rules as instructions to the Agent_Roles whose adherence is best effort (Process Principle 5) and SHALL enforce by code only the parts listed there as Studio guarantees.

### Requirement 36: Explicit flow graph with guaranteed terminal states

**User Story:** As a Judge, I want every Task to follow an explicit flow and always finish in a clear final state, so that no Task hangs or ends in an unknown state.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL represent the Task flow as a Flow_Graph whose nodes and edges are data, with a guard on each edge.
2. THE Studio SHALL run the Flow_Graph as a deterministic stage machine, and Agent loops SHALL run inside nodes, not across nodes.
3. WHEN a state transition is requested, THE Studio SHALL perform it only if it is an edge of the Flow_Graph and its guard holds.
4. IF a requested transition is not an edge of the Flow_Graph, THEN THE Studio SHALL reject it and record the rejection in the Event_Stream.
5. THE Studio SHALL end every Task in exactly one Terminal_State: success, failed, aborted, Analysis only, or Docs only.
6. IF a timeout or an unrecoverable error occurs in any node, THEN THE Studio SHALL move the Task to a Terminal_State.
7. FOR ALL nodes of the Flow_Graph, at least one Terminal_State SHALL be reachable from that node.
8. THE Workspace SHALL display the current node of the Flow_Graph for the Task.
9. THE Studio SHALL record every node transition in the Event_Stream.

### Requirement 37: Approach selection by Agents and Judge, assessment by the Studio

**User Story:** As a Judge, I want the Agent_Roles to propose how to make linkding AI-powered and the Studio to assess each proposal, so that I confirm an approach with known cost and risk.

**Priority:** Must-have

#### Acceptance Criteria

1. WHEN the flow reaches step F6, THE Studio SHALL ask the Agent_Roles to propose Approach_Options (an independent agent next to linkding, a source change, a UI change, or a mix) and SHALL NOT pre-select the approach; the number and quality of the proposals are best effort (Process Principle 5).
2. THE Risk_and_Security Agent_Role and the Verification Agent_Role SHOULD produce an Assessment for each Approach_Option covering feasibility, effort, risk, needed environments (Requirement 39) and executable Acceptance_Checks (best effort, measured, not guaranteed).
3. THE Studio SHALL label every Assessment shown to the Judge as an LLM assessment, not a guarantee, and SHALL display it together with its Approach_Option in the Decision_Doc.
4. WHEN the Judge decides, THE Judge SHALL confirm exactly one Approach_Option or one combination of Approach_Options before the Decision_Doc is frozen.
5. IF an Approach_Option has no executable Acceptance_Check, THEN THE Studio SHALL mark its Assessment as incomplete and SHALL NOT allow it to be confirmed; this is a Studio check on the presence of an executable Acceptance_Check, not a judgment of the Assessment's quality.
6. IF a claim in an Assessment lacks evidence or its evidence fails the check of Requirement 24, THEN THE Studio SHALL mark it Unverified.
7. THE Agent_Roles and the Judge SHALL decide the approach at flow step F6, and THE Studio SHALL record the decision in the Decision_Doc.
8. THE Studio SHALL give the Code_Agent and the development stage no tool and no transition that changes the confirmed approach.
9. IF a need to change or extend the confirmed approach arises after the Decision_Doc is Frozen, THEN THE Studio SHALL return the Task to flow step F6 and SHALL require a new Decision_Doc version (Requirement 16) before any development continues.
10. THE Studio SHALL measure the accuracy of Assessments against later Verifier results in the benchmark (design-stage item) and SHALL NOT present an Assessment as a prediction that is guaranteed.

### Requirement 38: Development in an isolated worktree (linkding only)

**User Story:** As a Judge, I want source changes made in an isolated copy with every change recorded, so that nothing outside the Task is touched and the diff is available on demand.

**Priority:** Must-have

#### Acceptance Criteria

1. WHERE the Task is Adapted_Repo and the confirmed approach changes source, THE Code_Agent SHALL modify a copy of the target source inside a dedicated git Worktree, inside the Development_Sandbox.
2. THE Studio SHALL run the whole code-Agent runtime together with its tools and the needed toolchains (Node and Python) inside one container per Task (the Development_Sandbox), and SHALL confine the Code_Agent's file writes to the Worktree through the container boundary, with the Worktree as the only host path shared with the container for writing. The guarantee is confinement by the container boundary, not per-file permission. Which files inside the Worktree the Code_Agent changes is not restricted in advance, because it cannot be predicted in an unfamiliar codebase.
3. THE Studio SHALL apply resource and time budgets per Task to the Code_Agent; the budget values are UNDECIDED (design).
4. THE Studio SHALL limit network access from the Development_Sandbox, the Run_Environment and the Verifier test container with the same network policy, as far as the container's network policy can enforce it; the initial policy is set in design.md (Open item 26). Without such a policy, the container boundary alone does not limit network access.
5. WHEN the Code_Agent changes a file, THE Studio SHALL record the change and its diff in the Event_Stream and SHALL make the diff available in the Engineering details view on demand; the Studio SHALL NOT push the diff to the Judge as the main view.
6. THE Studio SHALL store the produced changes as a Patch_Artifact among the Output_Docs of the Task and SHALL NOT commit them into the Studio's own repository.
7. IF the Code_Agent fails or exceeds a budget, THEN THE Studio SHALL display the failure honestly with its Failure_Class and record it in the Event_Stream.
8. IF the Code_Agent attempts to write outside the Worktree, THEN THE container boundary SHALL keep the write from reaching any host path outside the Worktree, and where the Studio detects the attempt, THE Studio SHALL record it with the Failure_Class "rejected by a safety rule" in the Event_Stream and show it only in the Engineering details view.
9. WHERE the Task is Adapted_Repo, THE Studio SHALL create the Worktree when the flow first needs it (consistent with Requirement 39.4) and keep one Worktree per Task.
10. WHERE the DeepSeek Harness is chosen and a process sandbox is used on Windows, THE Studio SHALL treat that process sandbox's write confinement as possibly only partial and SHALL record in the Event_Stream the enforcement level it reports. This criterion is not part of the first-version path.
11. WHERE a process sandbox is used, THE Studio SHALL NOT claim that confinement is complete when that sandbox reports partial or no enforcement. This criterion is not part of the first-version path.

### Requirement 39: Four separate environments

**User Story:** As a developer, I want four environments kept separate with clean starts, so that code-writing, running and building the Studio never contaminate each other.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio project SHALL keep four environments separate: the Dev_Environment, the Studio_Runtime, the Development_Sandbox and the Run_Environment.
2. THE Development_Sandbox SHALL be one container per Task that holds the whole code-Agent runtime, its tools, and both the Node and Python toolchains, because the target linkding is a Python/Django application; because only one Task runs at a time (Requirement 28), one container is enough. The exact image is UNDECIDED (design).
3. THE Run_Environment SHALL start from the Task's Worktree result and SHALL be separate from the Development_Sandbox.
4. WHERE the Task is Adapted_Repo, THE Studio SHALL start each of the Development_Sandbox and the Run_Environment from a clean state when the flow first needs it: the Development_Sandbox before the first development story or Prototype, and the Run_Environment after a story attempt, to run the modified target.
5. THE Studio SHALL reset the Run_Environment by discarding and recreating it.
6. THE Development_Sandbox and the Run_Environment SHALL share no writable state except the explicit Worktree handoff.
7. WHEN the Worktree handoff happens, THE Studio SHALL record it in the Event_Stream.
8. WHERE the DeepSeek Harness is chosen and a process sandbox is used, THE Studio SHALL NOT assume that the process sandbox supplies the Python or Node environments or runs the target app; that process sandbox confines file writes of a spawned process only (modes read-only, workspace-write, danger-full-access), so the toolchains and the Run_Environment must be provided separately. This criterion is not part of the first-version path.
9. THE Studio SHALL have the Agent_Roles (DeepSeek) analyze, from the target's own files and documentation, how to build and start the modified target software in the Run_Environment; the Agent_Roles propose the start commands during document-first (flow step F8), THE Studio SHALL record them in a `runEnvironment` section of the Output_Docs and SHALL execute them only inside the Run_Environment container, and the Studio SHALL only assess the result of that start. The quality of the analysis is best effort (Process Principle 5).
10. THE Studio SHALL provide no fallback start recipe and no start optimization for the modified target software in the Run_Environment in the first version, and the Adapter SHALL NOT define the start procedure of the modified target; the Adapter only identifies the unmodified baseline (the official linkding container image pinned by digest plus its documented configuration), which the Sandbox runs (Requirement 13).
11. IF the modified target software fails to start in the Run_Environment, THEN THE Studio SHALL display the failure honestly (Requirement 23), record it in the Event_Stream, and end the Task in the Terminal_State failed (Requirement 36).

### Requirement 40: Feature_Contract per story, Tech_Manager review, stop and ask

**User Story:** As a Judge, I want every development story fixed at the feature level by the confirmed documents, reviewed by a Tech_Manager, and handled by a Code_Agent that asks when stuck, so that development executes decisions made in the requirement meeting, makes none of its own, and I only have to think about features.

**Priority:** Must-have

#### Acceptance Criteria

1. THE Studio SHALL attach to every Product_Backlog story a Feature_Contract derived from the Frozen Decision_Doc and containing: the feature in plain language, what it should do, what it should NOT do (in feature terms), executable Acceptance_Checks where possible, and budgets (values UNDECIDED, design). The Feature_Contract SHALL contain no file or path lists.
2. WHEN the Studio assigns a story to the Code_Agent, THE Studio SHALL give the Code_Agent only the Feature_Contract of that story plus the documents that story references (Requirements 19.7 and 19.8).
3. IF a Product_Backlog story has no Feature_Contract, THEN THE Studio SHALL treat the story as invalid (Requirement 20.9).
4. WHEN the Judge wants to widen what a feature does, THE Studio SHALL require a new Decision_Doc version (Requirement 16) and a regenerated Product_Backlog, and SHALL NOT accept a scope decision made by an Agent_Role during development.
5. FOR ALL changes made by the Code_Agent, THE Studio SHALL record the change and the list of changed files in the Event_Stream and SHALL send the changed files to the Tech_Manager review.
6. WHEN the Code_Agent finishes a story attempt, THE Studio SHALL ask the Tech_Manager to review the changed files against the Feature_Contract and the Decision_Doc and SHALL accept only a schema-valid Review_Verdict: approve, request changes, or escalate; the quality of the review is best effort (criterion 16).
7. WHEN the Review_Verdict is request changes, THE Studio SHALL send the reasons back to the Code_Agent.
8. WHEN the Review_Verdict is escalate, THE Studio SHALL send it to the Moderator and, for feature or requirement questions, through the Moderator to the Judge in feature words.
9. THE Studio SHALL record each Review_Verdict and its reasons in the Event_Stream, SHALL label it "reviewed by Tech_Manager (LLM judgment)", and SHALL show it only in the Engineering details view unless an escalation needs the Judge.
10. THE Studio SHALL treat a Review_Verdict as an assessment and not as success; only the Verifier's executable checks decide success (Requirement 22), and THE Studio SHALL NOT present approval by the Tech_Manager as proof that the feature works or that the changed files are right.
11. IF the Code_Agent cannot resolve a problem (an unclear requirement, a conflict, work that would need more than the Feature_Contract, or repeated failure beyond a retry limit whose value is UNDECIDED), THEN THE Code_Agent SHALL stop and ask a question and SHALL NOT retry indefinitely or improvise.
12. THE Studio SHALL enforce the retry limit by counting attempts in the stage machine and SHALL stop the Code_Agent and open a question when the limit is reached.
13. WHEN the Code_Agent's question is technical, THE Studio SHALL route it to the Tech_Manager; WHEN it is a feature or requirement question, THE Studio SHALL route it through the Moderator to the Judge, phrased in feature terms.
14. WHILE a question awaits an answer, THE Workspace SHALL show an honest "waiting for answer" status (Requirement 2).
15. IF a need to change the approach itself arises, THEN THE Studio SHALL return the Task to flow step F6 and require a new Decision_Doc version (Requirement 37.9).
16. THE Code_Agent and the Tech_Manager SHOULD follow the Feature_Contract and ask when unsure (best effort, measured, not guaranteed); the Studio measures in the benchmark how often changes needed review corrections or escalation, and records the result of each Verifier check for the story.
17. IF a Code_Agent question stays unanswered beyond its wait time (initial value 300 s, set in design.md, Open item 39), THEN THE Studio SHALL mark the story Unconfirmed-blocked and continue the flow with the next story, or end the Task in the Terminal_State `failed` if no story is left.

### Requirement 41: Prototype during the requirement meeting

**User Story:** As a Judge, I want the Agent_Roles to be able to build a quick prototype while we decide the approach, so that the decision rests on something I can see.

**Priority:** Stretch (priority to be confirmed by the user: TO BE CONFIRMED)

#### Acceptance Criteria

1. WHERE the Agent_Roles build a Prototype in flow steps F3-F6 to help the approach decision, THE Studio SHALL label it "Prototype" everywhere it is shown.
2. WHERE a Prototype is built, THE Studio SHALL build it in an isolated worktree inside the Development_Sandbox with the same confinement as Requirement 38.
3. THE Studio SHALL NOT count a Prototype as an execution result or as success.
4. THE Studio SHALL store the artifacts of a Prototype per Task.
5. THE Studio SHALL NOT let a Prototype bypass the Decision_Doc confirmation and freeze (Requirements 15 and 16).
6. THE Judge SHALL remain the decision maker on the approach, with or without a Prototype.
7. IF a Prototype fails, THEN THE Studio SHALL show the failure honestly with its Failure_Class (Requirement 23).
8. THE Studio documents SHALL note that a Prototype for an Adapted_Repo may need the Development_Sandbox before the Decision_Doc is frozen; this dependency is a design-stage discussion item.

## Out of Scope (first version)

- A general multi-Agent framework.
- Automatic deployment.
- A platform that automatically transforms any GitHub repository.
- A complex account system.
- Running arbitrary repository code (equivalent to remote code execution).
- Computer use (controlling the whole desktop); only Browser_Use is in scope.
- Sandbox run, experience, development and execution on Other_Repo.
- Modified target code stored in the Studio repository (the Studio repository holds linkding only as an unmodified external dependency).
- File writes by the Code_Agent outside the per-Task Worktree (kept from reaching the host by the container boundary).
- Running arbitrary submitted repositories (only linkding is executed, including its source changes inside a Task Worktree).

## Open Items

Nothing here may be assumed:

1. TO BE CONFIRMED: Official Kiroween rule details (category name changes, format for disclosing new code, whether hosting may change after submission). The official page returned HTTP 403.
2. DECIDED: The license is Apache-2.0; the LICENSE file is committed (Requirement 33.2).
3. CLOSED (verified by a live test on 2026-11-20): DeepSeek function calling works.
4. CLOSED (verified by a live test on 2026-11-20): deepseek-flash accepts image input (a solid red image was identified as red). Screenshot reading quality on real pages is tracked in item 45; page-structure operation stays the primary Browser_Use method (Requirement 14).
5. CLOSED (verified by a live test on 2026-11-20): the DeepSeek base address https://api.deepseek.com and the model name deepseek-flash are valid; the models endpoint lists deepseek-flash and deepseek-v4-pro.
6. UNDECIDED: Source of the Judge's LLM key: Judge-supplied, hosted key with a cap, or both.
7. UNDECIDED: Hosting domain and public entry.
8. UNDECIDED: Network path from the PC to the TTS_Service; TO BE CONFIRMED: the TTS_Service facts in Requirement 31.
9. UNDECIDED: Decision-step UI form (decided by experimenting during implementation).
10. Initial value set in design.md (adjustable): Confirmation wait time at confirmation points (Requirement 21).
11. TO BE CONFIRMED: Number of meeting roles.
12. TO BE CONFIRMED: GitHub anonymous rate limit value.
13. Initial value set in design.md (adjustable): Directory names and locations of Runtime_Rules (B) and Output_Docs (C).
14. Initial value set in design.md (adjustable): Recency_Window value for "working" indicators (Requirement 2).
15. Initial value set in design.md (adjustable): Acknowledgement time bound for user actions (Requirement 6).
16. Initial value set in design.md (adjustable): Per-Task read-volume limit value (Requirement 34).
17. TO BE CONFIRMED: Remotion free-license conditions for an individual developer.
18. UNDECIDED: Final-week scope decision. If the project cannot be finished, the user wants the UI (Requirements 1-8) and the requirement-analysis stage (flow steps F1-F6, ending with the frozen Decision_Doc) protected first. The decision is made in the last week before the deadline; until then work proceeds at the normal pace. No priority tiers are defined now.
19. TO BE CONFIRMED: Whether the Kiroween 2026 judging criteria match the 2025 edition (potential value, implementation of Kiro, creativity), and whether 2026 has extra prize categories.
20. UNDECIDED: Judge trial path without the Judge needing their own LLM key (hosted capped key, a labeled Replay of a real recorded run, or both), to be settled before the last week.
21. TO BE CONFIRMED: Hosting the first version on the developer's PC during judging is not allowed by the "free until 2027-01-30" requirement; hosting migration is required before submission. Confirm against the official rules.
22. CLOSED (verified by a live test on 2026-11-20): the default model and endpoint support streamed responses (Requirement 30). The model streams thinking text separately before the answer text.
23. CLOSED (verified by a live test on 2026-11-20): function calling and image input of the default model (Requirements 14 and 30). Items 3 and 4 above record the same result.
24. TO BE CONFIRMED: Whether one entry may be in more than one Kiroween category (Requirement 1).
25. Initial value set in design.md (adjustable): Resource and time budgets per Task for the Code_Agent (Requirement 38).
26. Initial value set in design.md (adjustable): Network access policy of the Development_Sandbox (Requirement 38).
27. Initial value set in design.md (adjustable): Exact image and contents of the Development_Sandbox (Node plus Python) (Requirement 39).
28. Initial value set in design.md (adjustable): Wait and timeout values that move a Task to a Terminal_State (Requirement 36).
29. RECORDED: Licensing of the DeepSeek Harness. The artifact the Studio uses is the official bundled runtime executable from the PyPI wheel `deepseek-harness-runtime-bin` 0.2.2rc2; its wheel metadata states Author DeepSeek, License-Expression MIT, source github.com/deepseek-ai/deepseek-harness, and the wheel ships THIRD_PARTY_NOTICES. The npm TypeScript SDK client `@deepseek-ai/dsh-sdk-client` shows BSD-3-Clause and is not used in the first version. The README MUST list the runtime as MIT together with its third-party notices (Requirement 33.6).
30. VERIFIED on 2026-11-20 from npm: @earendil-works/pi-ai and @earendil-works/pi-agent-core version 1.5.2, MIT, engines node >=22.19.0. A smoke test against deepseek-flash ran streaming (text, thinking and tool-call deltas), tool use, abort, and a tool blocked through beforeToolCall successfully. The statement that the harness SDK has no mid-turn cancel comes from the harness README and was not tested.
31. UNDECIDED: Success rate of model-driven source changes to an unfamiliar Django app; it is unknown and must be measured, and failures are shown honestly.
32. TO BE CONFIRMED: Priority of Requirement 41 (Prototype during the requirement meeting). It is marked Stretch for now; the user confirms.
33. Initial value set in design.md (adjustable): Feature_Contract budget values per story and the concrete Feature_Contract schema (Requirement 40).
34. UNDECIDED: Whether and how the Development_Sandbox is available before the Decision_Doc freeze for a Prototype on an Adapted_Repo (Requirement 41, design).
35. Initial value set in design.md (adjustable): Retry limit of the Code_Agent and the "stop and ask" threshold (Requirement 40).
36. DECIDED: The Development_Sandbox is one container per Task that holds the whole code-Agent runtime, its tools and the Node and Python toolchains (Requirements 38 and 39). The question "host process versus Docker" is closed in favor of a container. Remaining design details: image contents (item 27) and network policy (item 26).
37. TO BE CONFIRMED, relevant only if the DeepSeek Harness is chosen and a process sandbox is used (not part of the first-version path): facts about the DeepSeek Harness process sandbox, read from the local harness documentation and not tested here: it confines file-write effects of a spawned process (modes read-only, workspace-write, danger-full-access); network and process visibility are not covered; backends are Linux bwrap/Landlock, macOS Seatbelt and a Windows ACL restricted-token runner that reports enforcement as "partial" (documented gaps: objects granting Everyone write access, NTFS hard links); containers and microVMs are separate sibling implementations; it provides no Python or Node environment and does not run the target app; the harness's own minimal composition uses danger-full-access, so confinement must be switched on explicitly. Must be confirmed by experiment on the target platform.
38. UNDECIDED: How the Tech_Manager review is evaluated in the benchmark (for example agreement with the Verifier results and with human labels of correct and incorrect changes) (Requirement 40, design).
39. Initial value set in design.md (adjustable): Wait time and escalation path when a Code_Agent question stays unanswered by the Judge (Requirement 40).
40. UNDECIDED: How Assessment accuracy and the other Best_Effort_Goals are measured and reported (Process Principle 5, Requirement 37.10, design).
41. UNDECIDED: Exact contents of the Adapter beyond the target identity and reference (including the pinned baseline image and its documented configuration), the fixed test data set, and the assessment checks (design).
42. Initial value set in design.md (adjustable): Whether the complete reasoning text is persisted together with a Complete_Message so that Replay can show it (Requirement 3.12).
43. TO BE CONFIRMED: Whether thinking can be turned off on the default model; not verified, and the Studio does not rely on it (Requirement 30.14).
44. DECIDED in design.md: the agent runtimes, behind a thin runtime interface. Meeting roles: pi-agent-core in the backend process. Code_Agent: the official DeepSeek Harness runtime executable in headless mode. Alternates: OpenCode and the OpenHands SDK. The comparison is repeated at the first development story with real documents.
45. TO BE CONFIRMED: How well deepseek-flash reads real page screenshots; only a solid-color image was tested (Requirement 14.8).
46. RECORDED (hosting consequence), linked to items 20 and 21: live execution (flow steps F4-F10) needs the Docker engine on the developer's Windows PC. After the front end moves to the cluster, live execution is available only while the PC and its tunnel are up; otherwise Judges can use analysis (if the backend is hosted) and labeled Replays (Requirement 32).
47. TO BE DONE (not a requirement change): the developer's Windows PC currently has Node 22.14, and the pi packages require Node >=22.19.0, so Node must be upgraded on the PC.
48. TO BE DONE (not a requirement change): Docker Hub is not reachable from the PC; images are pulled on another machine, pinned by digest and transferred with docker save and docker load (see design).
49. TO BE CONFIRMED: whether the chosen Code_Agent runtime accepts a custom base address pointing at the LLM_Proxy; in the 2026-11-20 test a custom base address on the harness runtime returned HTTP 404 with an unknown cause (Requirement 30.16).
50. TO BE CONFIRMED by the user: API-operation stories write through Studio code from a validated plan (no LLM-facing write tool) (design Gap 5).

## Design-Stage Discussion Items

- Agent framework choice: decided in design.md.
- The in-progress message buffer: the server keeps the text of a message that is still streaming in memory only, so that a page reload mid-stream can show it (best effort); no chunk is stored, and the buffer is dropped when the message is persisted as complete or incomplete (Requirements 3 and 27).
- The Adapter contents: target identity and reference (including the pinned baseline image and its documented configuration, which the Sandbox runs), the fixed test data set, and the assessment checks; no start procedure for the modified target (Requirement 39).
- Browser automation library choice: decided in design.md.
- Single Agent for small projects versus multiple roles with multiple worktrees and merging for large projects.
- Event schema and Remotion playback structure, including how presence status is derived from events.
- TTS network path and audio compression format.
- Honoring the "demo and verify" item for every feature in our own tasks.
- Separating the human-readable narration text (streamed) from the machine-readable structured result (validated locally after the stream completes).
- Handling of reasoning text: it is shown in a collapsible section labeled model-provided when the provider returns it (Requirement 3.12); design decides whether it is persisted (open item 42) and how max_tokens leaves room for thinking (Requirement 30.12).
- Agent runtime selection: DECIDED in design.md (open item 44). Meeting roles: pi-agent-core in the backend process; Code_Agent: the official DeepSeek Harness runtime executable in headless mode; alternates: OpenCode and the OpenHands SDK; all behind a thin runtime interface so that the runtime can be swapped cheaply. The comparison is repeated at the first development story using the project's own real documents. Criteria: works out of the box; cheaper and faster; follows instructions better (including tool whitelists and stopping to ask). The harness licensing is recorded in open item 29 and listed in the README.
- Building or running the modified target without docker-in-docker.
- Image contents, size and network policy of the per-Task Development_Sandbox container (Python plus Node).
- The unknown success rate of model-driven source changes to an unfamiliar Django app: it must be measured, and failures are shown honestly.
- Keeping the demo stable: a labeled Replay of a real recorded successful run may complement live runs, and never replaces the honesty rules.
- The Flow_Graph data format, guard language and the reachability check (Requirement 36).
- The UI changes that AI-powered features need, proposed by the Agent_Roles and decided with the Judge (Requirement 15, UI impact).
- How the Feature_Contract is represented and how the Tech_Manager review is prompted and routed (Requirement 40); file paths are deliberately not part of the contract.
- Relevant only if the DeepSeek Harness is chosen and a process sandbox is used (not part of the first-version path): the harness process sandbox confines file writes only, gives no network control, enforcement on Windows is partial, and it provides no Python or Node environment; confinement must be switched on explicitly because the harness's minimal composition uses danger-full-access (Requirement 38).
- The retry limit and the "stop and ask" threshold of the Code_Agent (Requirement 40).
- How the Tech_Manager review is evaluated in the benchmark (Requirement 40).
- How each Best_Effort_Goal is measured in the benchmark (Process Principle 5).
- Prototype timing and the early need for the Development_Sandbox before the freeze (Requirement 41).

## Traceability Table

| Requirement | Layer | Verification summary |
|---|---|---|
| 1 Live team workspace | A, B | UI example tests: all areas present per Task; layout equal for live and Replay; every role has an avatar |
| 2 Event-backed presence | A, B | Property test: every working status and every avatar activity effect has an event inside the Recency_Window; example test for idle and waiting-for-LLM display |
| 3 Activity feed and streaming | A, B | Property test: every feed entry maps to an Event_Stream event; example tests for stream complete (Complete_Message persisted), stream broken (partial text kept and persisted as incomplete, failure recorded) and non-streaming fallback note; check that no streamed text chunk is stored; example tests for reasoning display (collapsible, labeled model-provided) and for the "thinking" state with elapsed time when no reasoning text is returned |
| 4 Artifact area | A, B | Example tests for each artifact kind and the unavailable reason; example test that the Engineering details view is collapsed by default and that diffs, Review_Verdicts and rejected changes are not in the main view |
| 5 Interjection and cards | A, B | Example tests for addressing a role, question cards, confirm/reject cards; check that cards in the development stage contain no file names, paths or diffs; example test that the reminder card lists pending Unconfirmed items in feature terms |
| 6 Action feedback | A | Example tests: acknowledgement shown, delivery failure shown |
| 7 Honest progress and Replay | A, B | Check that no progress value lacks a data source; "Replay" label check |
| 8 Accessibility | A | Reduced-motion check; keyboard-only operation test; status text present |
| 9 Home page input | A, B | Example test for form input; property test for URL validation |
| 10 Download and read | A, B | Read-only and no-execution check; example test for events |
| 11 Meeting analysis | A, B, C | Schema validation of role statements and evidence marks; example test that a role turn without a valid statement is recorded as failed; participation and question quality are Best_Effort_Goals measured in the benchmark, not tested as guarantees |
| 12 Interjection | A, B | Example test that interjections enter the Event_Stream |
| 13 Sandbox | A, B | Integration test for start and reset; example test that a start failure ends the Task in `failed` with the label "not executed" |
| 14 Browser use | A, B | End-to-end example; failure classification check; scripted Playwright browser check (no LLM) by the Verifier against the Run_Environment |
| 15 Decision_Doc freeze | A, B, C | State machine check: blocks later steps while unconfirmed; rejects edits when Frozen; schema validation that approach options, assessments, chosen approach, UI impact and executable acceptance checks are present |
| 16 Version changes | A, B, C | Property test for hash recomputation; example test for version chain |
| 17 Case inspiration | A, B | Schema validation: card has source link and evidence boundary |
| 18 Purpose A/B | A, B, C | Schema validation: every workflow has an A or B mark; stage machine check, for workflows executed by operating linkding through its API, that write tools exist only in the write stages and that a B write stage needs a valid suggestion and Judge confirmation (for source or UI changes the stages are checked by the Acceptance_Checks); quality of path adherence is a Best_Effort_Goal measured in the benchmark |
| 19 Agile planning, document-first | A, B, C | Check that development is blocked while documents are incomplete; check that each Agent_Role task context holds exactly one story plus its referenced documents (small scope per Agent, a Runtime_Rules rule); schema validation that the Feature_Contract is generated from the Frozen Decision_Doc, is part of the backlog documents and is referenced in the Sprint_Plan stories |
| 20 Agile documents | A, B, C | Schema validation: each story has an acceptance criterion, a demo point and a Feature_Contract (a backlog without a Feature_Contract is rejected as invalid); each document references the Decision_Doc version |
| 21 Demo and confirmation points | A, B, C | Example tests: no response gives Unconfirmed; the next Judge input triggers a reminder of the pending Unconfirmed items in feature terms and the reminder is recorded in the Event_Stream |
| 22 Execution and verification | A, B | Property tests for Verifier comparison (tag inclusion, same-URL update); example tests for the three Acceptance_Check kinds (API read-back, target test suite, browser check); check that success depends on Verifier results only |
| 23 Failure and honesty | A, B | Count check for the four named classes plus budget exceeded and blocked by an unanswered question; display of LLM and Verifier disagreement |
| 24 Evidence and Unverified | A, B, C | Property test: for all conclusions, the cited file exists and the quoted snippet is present, otherwise the Unverified mark is set; example tests with a missing file and an absent snippet; frequency of invented claims is a Best_Effort_Goal measured in the benchmark |
| 25 Scope tiers | A, B | Label and execution refusal checks for non-linkding repositories; check that the Studio repository holds no modified target code and no change outside the Worktree; example test that a linkding Task on a backend without a Docker engine ends in `failed` "not executed" after analysis and the home page states that live execution is unavailable |
| 26 Final demo and Replay | A, B | UI check of the "Replay" label; property test that live and Replay rendering give the same UI state; example test that Replay types messages from the stored Complete_Message and states that typing speed is simulated and does not reflect real latency |
| 27 Event stream | A | Property test: Event_Stream serialization round trip; Replay_File checks (schema version, sequence numbers, timestamps, no key or token, static serving); check that the Event_Stream holds only Complete_Messages, incomplete messages and message lifecycle events, and no chunk events |
| 28 Queue and watching | A | Integration test for queue and read-only watching; server-side rejection of operations from queued persons; key-absence check |
| 29 Data isolation and recovery | A, B | Verifier comparison test after reset; example test that restore is rejected unless requested by the lease holder or the admin; example test that a reset failure ends the Task in `failed` "not executed" |
| 30 LLM configuration | A, B | Example test that Judge-supplied LLM configuration is unavailable while its feature flag is off; property test for local validation of JSON and function-call output; secret scan; property test: for all events containing a secret value, the persisted and broadcast forms contain none; example test that the Development_Sandbox receives only the per-Task proxy credential and not the real LLM key; property test that the Judge base-address validation rejects loopback, private, link-local and cluster addresses; example test that a truncated finish reason is recorded as a failure and the output is not used; example test that max_tokens leaves room for thinking; capability facts verified by a live test on 2026-11-20 |
| 31 Narration | A | Example tests for length and rate limits; degradation when unavailable |
| 32 Portability | A | Smoke tests for environment configuration and container start |
| 33 Open source and compliance | A | Repository checks: LICENSE, .kiro not ignored, no secrets, .env.example present |
| 34 GitHub read limits | A, B | Example tests for cache and limits |
| 35 Three layers and traceability | A, B | Mapping completeness check; run record includes Runtime_Rules version; the "small scope per Agent" rule exists in Runtime_Rules (layer B) and has a test check; the Runtime_Rules rule "development agents have no decision power, stop and ask when a problem cannot be resolved within the Feature_Contract, and are reviewed by the Tech_Manager" exists in layer B and has a test check (for example a simulated unresolved problem ends in a question and not in a widened scope); the Studio guarantees only what code enforces and treats the rest as best effort |
| 36 Flow graph and terminal states | A, B | Property test: every transition performed is an edge of the Flow_Graph; property test: a Terminal_State is reachable from every node; example tests for rejected transitions and timeouts |
| 37 Approach selection and assessment | A, B, C | Schema validation: each Approach_Option has an Assessment labeled as LLM assessment and an executable Acceptance_Check (an option without one cannot be confirmed); check that exactly one approach is confirmed before freeze; Assessment accuracy is a Best_Effort_Goal measured against Verifier results in the benchmark; state machine check that the approach is decided only at F6 and that a development-stage need to change it returns the Task to F6 and requires a new Decision_Doc version |
| 38 Worktree development | A, B | Example tests: the code-Agent runtime, tools and toolchains run inside one container per Task, a write outside the Worktree does not reach the host and a detected attempt is recorded as rejected by a safety rule, diff recorded and shown only in the Engineering details view, Patch_Artifact stored, nothing committed to the Studio repository, budget-exceeded failure shown, Worktree created only for Adapted_Repo; check that the Development_Sandbox, the Run_Environment and the Verifier test container share the same network policy |
| 39 Environment separation | A, B | Integration test: clean start of the Development_Sandbox container and Run_Environment, no shared writable state except the Worktree handoff; example test that a failure to start the modified target is shown honestly and the Task ends in the Terminal_State failed; check that the Adapter holds no start procedure for the modified target (only the pinned baseline image and its documented configuration) and the Studio holds no fallback start recipe; check that each environment starts clean when the flow first needs it; check that the start commands come from the `runEnvironment` section of the Output_Docs and run only inside the Run_Environment container |
| 40 Feature_Contract, Tech_Manager review, stop and ask | A, B, C | Property test: for all Code_Agent changes, the change and its changed-file list are recorded in the Event_Stream and routed to the Tech_Manager review; schema validation that a Feature_Contract has the required parts and no path list, and that a backlog without one is invalid; example tests for the three Review_Verdict routes (request changes back to the Code_Agent, escalate to the Moderator and Judge in feature words, approve is not success), the "reviewed by Tech_Manager (LLM judgment)" label, stop-and-ask after the retry limit with a "waiting for answer" status, an unanswered question past its wait time marks the story Unconfirmed-blocked and continues with the next story or ends in `failed`, routing of technical versus feature questions, widening only through a new Decision_Doc version; Runtime_Rules rule with a test check (layer B); review quality is a Best_Effort_Goal measured in the benchmark |
| 41 Prototype in the requirement meeting | A, B, C | Example tests: "Prototype" label on every view, Prototype never counted as execution result or success, artifacts stored per Task, Decision_Doc freeze not bypassed, failure shown honestly; confinement check shared with Requirement 38 |

Process note: each feature in our own tasks will include a "demo and verify" item (to be honored by the design and tasks phases).

Requirement renumbering reference (old draft number to new number): old 1-11 became 9-19; the new Agile documents requirement is 20; old 12-26 became 21-35; the new UI group is 1-8.
