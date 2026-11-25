# Agent issue log

Every place where an LLM role or agent misunderstood its task, broke a rule, or produced something the Studio had to refuse, recorded for later review (decided by the user 2026-11-25). Studio defects that a run exposed are recorded too when they shaped what the agent did.

Rules for this log:

- One entry per distinct issue. A repeat adds a line to "Seen", not a new entry.
- Evidence comes from the run's events (`data/tasks/<taskId>/events.jsonl`, copies in `data/transfer/runs/`). Quote the model's own words where they explain the choice (reasoning or text).
- "Prompt at the time" names the Runtime_Rules version and the file, and quotes the lines that applied. Studio-written prompt text that lives in code names the file and the commit.
- "Fix" names the change and its commit. "Verified" says whether a later live run showed the fix working, and which run; a fix without a run is "not yet verified".
- Kinds: `misread` (the model understood the task wrongly), `rule-break` (a written rule was not followed), `format` (a submission did not match its schema), `design-gap` (the documents did not say what the agent needed), `studio` (our code or prompt was wrong and the model followed it).

## Index

| # | Kind | Agent | Short | Status |
|---|---|---|---|---|
| 1 | rule-break, design-gap | Test_Agent | Searched the whole container from `/` for a design that did not exist, instead of asking | fixed (cap, ask rule, detail design), not yet verified |
| 2 | design-gap | Planner, Reviewer | Model answer formats were not designed; agents chose their own | fixed (detail design refused by code without answer shapes), not yet verified |
| 3 | misread | Code_Agent | Put the model call into a background task that never runs in the Run_Environment | fixed, verified |
| 4 | studio | Planner, Facilitator | Read-back field `tag_names` copied from a wrong Studio hint | fixed, verified |
| 5 | misread | Code_Agent | Answered a Turbo form POST with a 200 page; the browser showed nothing | rule added, not yet verified |
| 6 | misread | Planner | Browser check expected the bookmark URL on the list, which shows titles | rule added, not yet verified |
| 7 | rule-break | Planner, Reviewer | Install commands (`uv sync`, `npm install`) in the run environment despite the note | refused by code, still recurs |
| 8 | format | Meeting roles | Unknown fields and broken JSON in submit tools | refused by code, still recurs |
| 9 | format | Planner | Check ids written as `S1.c2`, test paths as `test_x/py`, Feature ids as `S1-F1` | refused by code, still recurs |
| 10 | studio | Reviewer | Reading files that do not exist ended the review turn | fixed, verified |
| 11 | studio | Reviewer, Code_Agent | Own-client flag fired on a comment; the Reviewer correctly called it a false positive | fixed, verified |
| 12 | misread, design-gap | Reviewer | Rejected an inline model call three times because the contract said "after saving" | fixed (environment facts), verified |
| 13 | studio | Code_Agent | A Feature was built on a blocked Feature and ran out of time | fixed, not yet verified |
| 14 | — | Code_Agent | Changed tests the Test_Agent wrote | behavior accepted (the flow follows the Code_Agent) |
| 15 | misread | Planner | Browser check passed on a fixed heading, not on the model's answer | fixed (needsAi, proxy count), verified |
| 16 | rule-break | Test_Agent | Thought about asking, then did not ask | rule tightened, not yet verified |
| 17 | rule-break | Code_Agent | Special-cased code to pass contradictory tests (spike) | backstop: review and Verifier |
| 18 | rule-break | all runtimes | Did not ask on an ambiguous request in unattended mode (spike) | backstop: question at the retry limit |
| 19 | format | Planner, roles | Texts over the length limits were refused and the turn failed | fixed (soft caps), verified |
| 20 | format | Planner | A test command given as one string | fixed (split by code), verified |
| 21 | studio | Reviewer | Read-back field `url` passed the design check but not the comparator | fixed, verified |
| 22 | — | Planner, Reviewer | First runs with detail designs: answer shapes written for every model Feature | observed twice |
| 23 | misread | Explorer | Clicked "Bulk edit", which is not a plain button; timed out | accepted (recorded, within limits) |
| 24 | format | Planner (GLM 5.4) | Wrote the whole technical design as plain text instead of calling submit_tech_design | fixed (text passes the same checks), not yet verified live |
| 26 | misread | Planner, Reviewer | A needsAi browser check never switched the feature on, so its button was not there | fixed (refused by code), not yet verified |
| 25 | studio | Planner | The visible retry starts a fresh turn, so the model reads the repository again and runs out of the step's time | fixed in the technical design (retry gets the first answer), not yet verified live |

## Entries

### 1. Test_Agent searched the whole container from `/`

- Kind: rule-break, design-gap. Agent: Test_Agent. Runtime_Rules 0.12.0.
- Seen: `linkding-mwuzn62i`, Feature F3 "Ask your own bookmarks a question", 2026-11-24 18:05 to 18:15 UTC.
- What happened: after 14 short reads (0 to 3 s each) the Test_Agent ran `cd / && grep -rln "bookmark_questions\|candidate ids\|candidates capped\|answered bookmarks" --exclude-dir=node_modules --exclude-dir=.git .` It ran for 579 s until the 10-minute budget stopped the attempt (`budget_exceeded`); the retry passed.
- The model's reasoning just before: "The critical ambiguity: answer_question return and model output format … This may warrant ask_question … Maybe there's an upstream design doc somewhere hidden. Search whole /work and /context for "bookmark_questions" and "candidate"." It meant two folders and wrote a search of the whole file system.
- Prompt at the time (`runtime-rules/roles/test_agent.md`, 0.12.0): "If the interfaces in the design are too vague to write a test, or the contract contradicts itself, stop and ask with the ask_question tool." The prompt said where the story is (`/context/<Feature>/story.md`) but not that nothing else exists.
- Causes: the design did not give the model answer format (entry 2); the Test_Agent did not follow the ask rule (entry 16); shell commands had no time limit.
- Fix: every shell command ends after 120 s (`docker/dev-sandbox/runner/src/main.ts`, `cappedBash`); rule "search only inside /work and /context" (commit e5cf842). Verified: the runner works with the capped bash in `linkding-mwvjehfj`; the cap itself has not been hit in a run yet.
- Open: the rule that missing details must be asked, not searched for, and the Feature detail design (entries 2 and 16).

### 2. Model answer formats were not designed

- Kind: design-gap. Agents: Planner (draft), Reviewer (final) in the technical design.
- Seen: every run with model-powered Features. In `linkding-mwuzn62i` F3 the interface was only `answer_question(user, question) -> (answer, bookmarks)` with "links filtered against the candidate ids"; how the model names a bookmark was nowhere.
- Effect: the Test_Agent could not write the filtering test (entry 1); in earlier Features the Code_Agent chose prompt and answer format itself and the Test_Agent guessed.
- Prompt at the time: `runtime-rules/skills/feature-breakdown.md` asks for scope, interfaces, tests and size; it does not ask for model calls.
- Fix (agreed 2026-11-25, Runtime_Rules 0.14.0): a detail design per Feature with the model calls (input, answer shape, behavior on failure), data changes, visible texts used by checks, and error behavior; code refuses a model-using Feature without an answer shape; `graftlab_ai.ask_json(..., expect=...)` checks the shape.

### 3. Model call in a background task

- Kind: misread. Agent: Code_Agent. Runtime_Rules 0.11.1.
- Seen: `linkding-mwuugbla`, F2 (suggestions after save): `@huey.task(retries=5, retry_delay=10) def _ai_after_save_task(...)` with `.schedule(...)`.
- Effect: the page showed "Suggested tags: None yet"; the LLM_Proxy counted 0 calls from the app. The text check "see Suggested tags" passed on the heading (entry 15).
- Cause: the Run_Environment runs the web server only (`LD_DISABLE_BACKGROUND_TASKS=True`); no role was told.
- Fix: linkding checklist rule (d5eb3c7); Adapter `environmentFacts` reach the meeting, plan and design (3a1158c). Verified in `linkding-mwuzn62i` (inline call, 1 app call with status 200).

### 4. Read-back field `tag_names`

- Kind: studio. Agents: Facilitator (decision draft), Planner (technical design).
- Seen: `linkding-mwuqvo3a` (c3 failed "Unrecognized key: tag_names"), `linkding-mwus16og`, `linkding-mwuvrvj2` (Planner refused 12 times in a row, technical design failed).
- Cause: our own hint in `apps/server/src/tasks/service.ts` (`#checkHints`, before 28f5228): "api_readback keys are bookmark URLs; fields are bookmark fields such as tag_names." The models followed it. When code then refused `tag_names`, the refusal did not name the allowed fields, so the Planner tried `title` next.
- Fix: the field check moved to the technical design (658b7a0); the allowed fields come from the Adapter (`readbackFields`) into the decision, the design and the refusal text (28f5228). Verified in `linkding-mwuzn62i` (c3 read-back passed).

### 5. Turbo form answered with 200

- Kind: misread. Agent: Code_Agent. Seen: `linkding-mwumhuw1`, F2 question box: the POST view rendered the answer page with status 200; Django's test client saw it, the browser did not change the page (Turbo ignores a 200 answer to a form POST).
- Fix: linkding checklist "a form sent with POST must answer with a redirect (303) or 422" (2afcf33). Not yet verified in a run.

### 6. Browser check expected the URL on the list

- Kind: misread. Agent: Planner. Seen: `linkding-mwuqvo3a`, c2 step `see "https://example.org"` after saving; the list shows the fetched title ("Example Domain").
- Fix: checklist line "the bookmark list shows each bookmark's title, not its URL" (c5909d4). Not yet verified.

### 7. Install commands in the run environment

- Kind: rule-break. Agents: Reviewer (final design) mostly, Planner. Seen: every run since the check exists (`uv sync` or `npm install` in `buildCommands`).
- Prompt at the time: the environment note in `#environmentNote` says "leave out every install step (uv sync, pip install, npm install or ci)".
- Fix: code refuses the submission and names the command (5688318); the role resubmits. Recurs; the cost is one refused submission per run.

### 8. Unknown fields and broken JSON in submit tools

- Kind: format. Agents: User_Value, Feasibility, Risk, Facilitator.
- Seen: `submit_turn` with an `evidence` field or with `kind`, `proposal`, `stance` at the top level; `submit_assessment` with `acceptanceChecks` per assessment; "Unexpected non-whitespace character after JSON" (two JSON objects in one argument) in `submit_assessment`, `submit_tech_design`, `submit_turn`.
- Fix: refused by schema with a visible retry; texts are cut instead of refused (7429b00). Recurs; possible next step: accept and drop known extra fields, take the first JSON object.

### 9. Ids and paths in the wrong form

- Kind: format. Agent: Planner. Seen: `servesChecks` as `S1.c2` or `S1:c2` instead of `c2`; Feature ids `S1-F1`; a test path `bookmarks/tests/test_auto_tagging/py`; `fits: "no"` instead of `yes|doubt`.
- Fix: refused with the reason; the next submission is usually right. Possible next step: normalize `S1.c2` to `c2` by code.

### 10. Reviewer turn ended by missing files

- Kind: studio. Agent: Reviewer. Seen: `linkding-mwuntywt`, F2: reads of `siteroot/settings/base.py`, `requirements.txt`, `bookmarks/api/version.py` (files that do not exist) counted as rejected tool calls; three ended the turn ("gave up after 3 rejected tool calls"), twice, so the review failed.
- Fix: the Reviewer may read any file of the working copy (2afcf33); only refused submissions and malformed arguments count toward giving up (3a5b9b5). Verified in later runs.

### 11. Own-client flag on a comment

- Kind: studio. Seen: `linkding-mwuweumc`, F1: the docstring "configured exclusively by the GL_AI_BASE_URL … environment" was flagged as an own model client. The Reviewer answered: "False alarm on the model client: bookmarks/services/ai_suggestions.py does not build its own HTTP client. It imports the Studio client …" and first requested changes for other reasons, then approved.
- Fix: the flag matches only string literals (85da352). Verified in `linkding-mwuzn62i` (no flag).

### 12. Inline call rejected for "after saving"

- Kind: misread, design-gap. Agent: Reviewer. Seen: `linkding-mwuxchea`, F1, three request_changes in a row: "The suggestion step runs inline inside the person's save request instead of the follow-up work after saving that the contract names …". The Code_Agent had followed the checklist (no background tasks); the contract from the meeting said "after saving". The Feature went to the Judge and was blocked.
- Fix: the environment fact "no background worker; work the person must see happens inside the request" reaches the meeting, the plan and the design (3a1158c), so the contract is written that way. Verified in `linkding-mwuzn62i`.

### 13. Feature built on a blocked Feature

- Kind: studio. Seen: `linkding-mwuxchea`, F2 after F1 was blocked: the Reviewer found "it reads a summary store and an owner switch that do not exist", the next attempt ran out of its 10 minutes.
- Fix: a Feature whose `dependsOn` is not verified is blocked by code with the reason (3a1158c). Not yet verified in a run.

### 14. Code_Agent changed a Test_Agent test

- Seen: `linkding-mwuqvo3a` F1 (`test_ai_settings.py`), `linkding-mwuzn62i` F4 (`test_page_questions.py`).
- Decision (user, 2026-11-24): the flow follows the Code_Agent, records it and the Reviewer must justify each changed test. Both times the Reviewer approved with a reason. A small meeting to settle such cases is recorded for later.

### 15. Browser check passed on a fixed heading

- Kind: misread. Agent: Planner (check design). Seen: `linkding-mwuefj0y`, F2 c2 `see "Suggested tags"` matched the template heading; whether the model answered was not checked.
- Fix: `needsAi` on browser checks and the app's calls counted by the LLM_Proxy as a Verifier item (f91b0fc); guidance to expect text only the model's answer produces. Verified: `linkding-mwuugbla` failed honestly with 0 calls; `linkding-mwuzn62i` passed with 1 call.

### 16. Thought about asking, did not ask

- Kind: rule-break. Agent: Test_Agent. Seen with entry 1 ("This may warrant ask_question"). The same Test_Agent did ask the Reviewer in F2 of the same run ("The story says bookmarks/services/ai_tag_suggestions._call_model(messages) -> st…"), so asking works when it chooses to.
- Fix (Runtime_Rules 0.14.0): rule "the documents are only in /context/<Feature>/ and /work; a detail you cannot find there is asked, never searched for elsewhere"; answers are kept with the Feature for the later agents; a question from the Test_Agent shows on the board as "found a design gap".

### 17. Special-cased code to pass contradictory tests (spike, 2026-11-20)

- Kind: rule-break. Agent: pi-coding-agent (Code_Agent runtime). On the toy fixture with contradictory tests and "do not modify tests" it special-cased the code so every test passed, and did not report the contradiction (design.md, "Runtime selection" table).
- Backstop: the Reviewer review and the Verifier; the rule "never special-case code to satisfy tests" in `code_agent.md`.

### 18. Did not ask on an ambiguous request (spike, 2026-11-20)

- Kind: rule-break. None of the tested runtimes stopped to ask on an ambiguous request in unattended mode (design.md, "Runtime selection").
- Backstop: the Studio opens a question by code at the retry limit (R40.12).

### 19. Over-long texts refused

- Kind: format. Agents: meeting roles, Planner (DeepSeek writes longer texts). A sprint goal over 300 characters and every speaking signal were refused.
- Fix: over-long texts and lists are cut instead of refused (7429b00). Verified in later runs.

### 20. Test command as one string

- Kind: format. Agent: Planner. `["python manage.py test x"]` was run as one program name.
- Fix: a one-element command with spaces is split into words (`shellCommand`, 0eab119). Verified.

### 21. Read-back field `url` passed the design check

- Kind: studio. Agent: Reviewer (final technical design). Seen: `linkding-mwvm0f3k`, S1 c3 refined to `fields: {"url": "https://example.org"}`; the Verifier's comparator refused it ("Unrecognized key: url") and the Task ended in `failed` after F2 had passed every other check.
- Cause: the technical design checked read-back fields against the Adapter's `itemFields`, which also allows Demo_Case item fields (`url`, `title`, `tags`); the comparator accepts only `titleContains`, `tagsInclude`, `archived`.
- Fix: the Adapter exposes `expectFields` (the comparator's schema) and the design check uses it (c201e1c). Verified in `linkding-mwvnwdgv` (c3 read-back passed).

### 22. First run with Feature detail designs (observation)

- Seen: `linkding-mwvm0f3k`, Runtime_Rules 0.14.0. The final design gave answer shapes for both model-using Features, for example F4 `{"answer": "one sentence naming what matched", "bookmark_ids": [3, 7]}`, the shape that was missing in entry 1. Switch Features had `usesModel: false` and no model call. No Test_Agent searched outside /work in this run.
- Seen again: `linkding-mwvnwdgv` (success, 37 min): answer shapes in every model-using Feature, every Feature approved on the first review, no search outside /work, no question needed. One Test_Agent test was changed by the Code_Agent (entry 14).

### 23. Explorer clicked a button that is not clickable

- Kind: misread. Agent: Explorer. Seen: `linkding-mwuxchea` and `linkding-mwvnwdgv`: `browser_click` on button "Bulk edit" timed out (the control is a toggle shown only in some states). The failure was recorded and the Explorer went on; the experience completed.
- No fix; one failed action per run, inside the limit of 5 in a row.

### 24. Technical design written as text instead of the submit tool (GLM 5.4)

- Kind: format. Agent: Planner. Model: glm-5.4 (first run on it). Runtime_Rules 0.14.1.
- Seen: `linkding-mwvwvy2i`, trace `0027-…-plan1-t1.json`: 114 tool calls (78 read_file, 36 search_repo) over 11 min 45 s, then a final message with stop reason `stop` whose text is the complete design JSON (`{"architecture":{"overview":"Three AI helpers, …`), no tool call. Its reasoning ends: "Let me write the submit payload carefully." Code recorded "Planner ended the turn without a valid submit_tech_design (no valid submission); one retry".
- Not seen with DeepSeek in 12 runs (they sometimes sent broken JSON as arguments, entry 8, but always called the tool).
- Possible fix (not done): when the final text is a JSON object that passes the same submission check, accept it and record that it came as text; or end the read phase with an explicit "now call submit_tech_design" message.

### 25. The visible retry starts from scratch

- Kind: studio. Seen: same run, trace `0028-…-plan1-t1r.json`: the retry got the original prompt plus "You ended your turn without a valid submit_tech_design. Call it now." in a new turn, without the first turn's reading or answer, so it read the repository again (80 tool calls) and the step hit its 20-minute limit. The Judge's retry (failure review) then succeeded in 14 min (`0029-…`), after two refused submissions (six Features, a browser step `op` outside the schema, check ids `t2`, `t3`, more than six `notTouch` entries).
- Possible fix (not done): the retry continues the same conversation, or gets the first turn's final text; `notTouch` becomes a soft list like the others.

### 26. A model check that never switches the feature on

- Kind: misread. Agents: Planner (draft) and Reviewer (final technical design). Seen: `linkding-mww360n6`, S1 c2 `{"goto":"/bookmarks/new"} → fill URL → click "Suggest"` with `needsAi: true`. The template shows the button only `{% if request.user_profile.enable_ai_suggestions %}`, which is off by default (F1's switch). The click timed out, the LLM_Proxy counted 0 app calls, the Task ended in `failed` after every Feature test had passed.
- Prompt at the time: the environment note says "checks that need the AI feature must switch it on first"; earlier runs did include the switch steps.
- Fix: the technical design refuses a `needsAi` browser check without a click on a checkbox or switch, with the reason. Not yet verified.
- Also seen in this run: the background worker started (`uv run manage.py run_huey -f &` in the start commands, app healthy), and the Judge message and "Start the meeting now" during the app trial worked (tasks.md 11.3).
