# Reference: target linkding (first Adapter)

> Purpose: how the first target software, linkding, is installed, run, provisioned, tested and verified by the Studio.
> Status: Reference, not a decision record; [design.md](design.md) is authoritative.
> Implements these design.md sections: "Adapter contract", "Sandbox and test data", "Browser_Use", "Verifier", "Worktree manager", "Images", "Development stage" (per API-operation story) and Correctness Property 11. Deployment-specific facts (hosts, transfer, memory limits) are in [reference-deployment.md](reference-deployment.md).
> Sources: the spike notes in `spike/results/` (`S-linkding-image.md`, `S-linkding-api.md`, `S-linkding-source.md`, `S-docker-network.md`) recorded on 2026-11-21 by tasks 1.3-1.6 in [tasks.md](tasks.md), the official linkding documentation and the GitHub repository metadata.

## Identity and why linkding

- Upstream repository: `github.com/sissbruecker/linkding`. Adapter id: `linkding`. Match rule: owner `sissbruecker`, repository `linkding`, compared case-insensitively after URL normalization (design.md, Property 14).
- Why it was chosen as the first target: it is MIT-licensed, it has a documented REST API with token authentication (so API-operation stories and API read-back checks are possible), and it is a small Django application that starts in one container with SQLite (so the Sandbox, the Development_Sandbox and the Run_Environment stay small).
- The Studio repository holds linkding only as references (image digest, upstream URL, release tag and commit), never modified target code (R25.6, R38.6).

## Version pin

| Item | Value |
|---|---|
| Release | 1.47.0, the latest release at the time of the spike (GitHub release v1.47.0, 2026-09-13) |
| Image repository | `ghcr.io/sissbruecker/linkding`, the official image documented by linkding, basic variant (the plus variant with Chromium is not used) |
| Index digest (what the Adapter pins) | `sha256:e35cb50e0581178f245125ffaa909c565416c94c9f22ace305a7d234a4345522` |
| linux/amd64 manifest digest | `sha256:b44256a4ff37e4cb1a39c40d3a5b560337f1477a55428b3320e813d6004d8001` |
| linux/amd64 config digest (equals the image ID after `docker load`) | `sha256:0f9a8582286a2efc50d51724869b48d845fed52032b8d0b45f02ee6ee649a9f3` |
| Size | 12 layers, 392 MB on disk, 136 MB download |
| Source tag and commit | `v1.47.0` at commit `24b5ad6cc9bde497b5d1b1e86aed5a2fb7d25c2f` |
| Same release | Yes: image tag 1.47.0 and source tag v1.47.0 are the same release (TO VERIFY 8, done) |

How the image reaches the deployment host is described in [reference-deployment.md](reference-deployment.md), section "Image transfer".

## Baseline run

The Sandbox runs the unmodified image above (design.md, "Sandbox and test data"; R13).

- Environment: `LD_SUPERUSER_NAME` and `LD_SUPERUSER_PASSWORD` create the initial user; both values are generated per Task and the password is registered with the secret redactor. `LD_DISABLE_BACKGROUND_TASKS=True` saves resources.
- Port 9090 inside the container. Health path `/health`; `/login/` also answers 200.
- Data directory `/etc/linkding/data`, SQLite by default. A fresh named volume is mounted there at every start.
- Readiness: about 34 s from container start to `/health` 200, because the database migrations run first. The SQLite database is locked during these startup migrations, so the Studio waits for `/health` before it runs any management command.
- Idle memory: about 85 MiB under a 512 MiB limit.
- Scraping: linkding refuses internal hosts for scraping by default and the Studio keeps that default; in addition every bookmark creation sets `disable_scraping`.

## Provisioning

The provisioning hook runs after readiness (design.md, "Adapter contract", `provision`).

- Only the `bookmarks.ApiToken` model works for the REST API (fields id, key, user, name, created). `authtoken.Token` and the feed token return 401.
- Creation: a container exec of `python manage.py shell` with workdir `/etc/linkding` that runs `ApiToken.objects.create(user=<superuser>, name="graftlab")`. The result is a 40-character key.
- The key is registered with the secret redactor before it is used and stays in the backend; it is never shown to a Judge or Viewer (R13.5, R30.15). Requests use the documented header `Authorization: Token <key>`.
- Fallback if the shell command stops working on a later release: create the token through the settings page with Playwright (TO VERIFY 6 fallback, not needed for 1.47.0).

## API facts and the Adapter allow-list

Observed on the pinned image by spike 1.5 (all calls with the provisioned token):

| Method and path | Observed status | In the Adapter allow-list |
|---|---|---|
| `GET /api/bookmarks/` | 200 | read |
| `GET /api/bookmarks/{id}/` | documented, not exercised by the spike | read |
| `GET /api/tags/` | 200 | read |
| `POST /api/bookmarks/?disable_scraping` | 201 | write, op `create` |
| `PATCH /api/bookmarks/{id}/` | 200 | write, op `update_tags` |
| `POST /api/bookmarks/{id}/archive/` | 204 | write, op `archive` |
| `GET /api/bookmarks/check/?url=` | 200 | no |
| `GET /api/bookmarks/archived/` | 200 | read (added 2026-11-23: archived bookmarks are not in `GET /api/bookmarks/`, and the equality check and `archived` expectations must see them) |
| `POST /api/bookmarks/{id}/unarchive/` | 204 | no |
| `GET /api/bundles/` | 200 | no |

- The allow-list is the only set of calls a Demo_Case or the read-only tool `target_api_read` may use (R18.10). It has no delete endpoint (design.md, "Deliberately left out").
- Item cap: the Adapter keeps the Studio's Item_Count_Cap of 10 items per Demo_Case (R18.11).
- Every create sends `disable_scraping`, so no outbound fetch happens from the Sandbox for a bookmark.

## Write semantics for the comparator

These are the rules the linkding comparator implements (design.md, "Verifier" and Property 11; R22.4, R22.5):

- Same URL: a POST with a URL that already exists returns 201 with the SAME id, and REPLACES title and `tag_names` (in the spike, tags `['alpha', 'beta']` became `['gamma']`); the bookmark count for that URL stays 1.
- Auto-tagging: a profile rule in `auto_tagging_rules` (spike: `example.org autotag`) adds its tag on create, and keeps it on a PATCH that does not send `tag_names`.
- Matching: bookmarks are matched by normalized URL. Initial normalization rule: lower-case scheme and host, remove the default port, keep path, query and fragment as given. The rule is covered by the comparator tests.
- Tags: compared by inclusion (planned tags are a subset of the read-back tags) wherever auto-tagging can apply.
- A planned create whose URL existed in the pre-state snapshot is compared as an update of that bookmark: the count for that URL must stay 1, and the planned title and tags are the expected values (they replace the old ones; they are not merged with the pre-state).
- Title: `titleContains` is a substring check; `archived` is an equality check; `mustExist` checks presence by normalized URL.
- In-memory model used by the comparator tests (the linkding instance of Property 11): upsert by normalized URL that replaces title and tags, plus generated auto-tag rules that add their tag on create and keep it on a PATCH without `tag_names`.

Mapping of the generic Demo_Case and Acceptance_Check fields (design.md, "Data Models") for linkding: the item key is the normalized URL; Demo_Case item fields are `url`, `title` and `tags`; expectation fields are `titleContains`, `tagsInclude` and `archived`; Demo_Case ops are `create`, `update_tags` and `archive`; fields that a purpose B suggestion may fill are `tags` and `title`. These shapes are the Adapter's `api.itemFields` schema.

## Fixed test data set, reset and restore

Plan for `adapters/linkding/test-data.json` (final file in task 10.15, R29):

- 8 to 12 bookmarks on reserved example domains (`example.com`, `example.org`, `example.net`), each with an explicit title and explicit tags, at least two sharing a tag, and at least one archived. Only test data, never real personal data (R29.3).
- No auto-tagging rules in the baseline profile, so the reset equality check can compare tags exactly. A story that needs auto-tagging sets the rule itself, and its checks then compare by inclusion.
- Seed: Studio code creates every bookmark with `POST /api/bookmarks/?disable_scraping` and archives the archived ones with `POST /api/bookmarks/{id}/archive/`. Seeding is Studio code, not a Demo_Case.
- Equality check (R29.4): read all pages of `GET /api/bookmarks/` and `GET /api/bookmarks/archived/` through the Adapter client, then compare by normalized URL: same set of URLs, same titles, exactly equal tag sets, same archived flags, same count. The result is one per-item Verifier result.
- Reset: a new container on a fresh data volume, then readiness, provisioning, seed and the equality check. No delete endpoint is needed.
- Restore (R29.2): the same procedure as reset, requested by the operator or the admin through `POST /api/sandbox/restore`. It reverses every executed Demo_Case (R18.13).

## Development_Sandbox for linkding

- linkding 1.47.0 requires Python >=3.13; Ubuntu 24.04 ships Python 3.12. The Adapter's Development_Sandbox base image is therefore the digest-pinned official image itself (Debian 13), which already has Python 3.13.7 and all compiled runtime dependencies (including uwsgi) in `/etc/linkding/.venv`.
- Layer added by the linkding part of the image: git, Node 24 (nodejs.org tarball, SHA-256 checked), uv 0.8.13, the dev dependency group exported with `uv export --only-group dev` and installed with `--require-hashes`, then `npm ci` and `npm run build`. The generic layer from design.md ("Images") adds the pi packages and the Code_Agent runner on top.
- Size of the spike prototype: about 1.03 GB. Prototype Dockerfile: `spike/dev-sandbox/Dockerfile` (it copies the source to `/opt/linkding-src` for the build; how the preinstalled Node modules and the build output relate to the Worktree mounted at `/work` is settled in task 10.1).
- No start recipe for the modified target is part of the image or the Adapter (R39.10).

## Running from source

Evidence for the Agent_Roles' `runEnvironment` analysis (R39.9). This is not an Adapter recipe and the Studio does not supply it as a fallback (R39.10).

- `python manage.py migrate`: about 29 s.
- `python manage.py runserver 0.0.0.0:8000`: `/health` 200 after about 2 s; `/login/` 200.

## Tests

- Full suite: `python -m pytest -n 4 bookmarks/tests` gave 1380 passed and 58 subtests passed in about 300 s under a 768 MiB memory limit, without an OOM kill (peak memory not measured; task 1.9).
- Consequence: the full suite is too slow for every story attempt. The Adapter's test-selection hint tells the planning roles to name targeted test files in `test_suite` checks (for example one file under `bookmarks/tests/`), and the Verifier runs exactly the selection named in the check.

## Browser_Use notes

- Login is performed by Studio code with the generated superuser credentials; the operator role never sees the password.
- Pages to experience: login, bookmark list, add-bookmark form, tag view, archived list, settings (including the auto-tagging rules).
- ARIA snapshots (task 1.10, Playwright `locator("body").ariaSnapshot()`, 2026-11-22): login 318 characters with 8 named elements; bookmark list 1061 and 20; add form 868 and 15 (`textbox "URL"`, `textbox "Title"`, `textbox "Tags"`, `button "Save"`); tag view 868 and 18; settings exceeds the 8 KB cap (68 named elements before truncation), so the operator should snapshot a region of the settings page instead of the whole body.
- One operator turn with deepseek-flash, using only role and name targets from the snapshots, added a bookmark in 9.4 s with 7 actions and 0 tool errors (open, snapshot, fill URL, Tags and Title, click Save, snapshot); the bookmark then appeared in the list.
- A real screenshot of the bookmark list was described correctly (page name and the one visible title). Snapshots stay the primary observation; screenshots are a supplement.

## Adapter JSON example

The declarative part lives in `adapters/linkding/adapter.json`; the hooks (provisioning, seed, reset, equality, comparator) are code in the same directory. Field names follow the Adapter contract in design.md.

```json
{
  "id": "linkding",
  "match": { "owner": "sissbruecker", "repo": "linkding" },
  "source": {
    "upstreamUrl": "https://github.com/sissbruecker/linkding",
    "releaseTag": "v1.47.0",
    "commit": "24b5ad6cc9bde497b5d1b1e86aed5a2fb7d25c2f"
  },
  "baseline": {
    "image": "ghcr.io/sissbruecker/linkding@sha256:e35cb50e0581178f245125ffaa909c565416c94c9f22ace305a7d234a4345522",
    "platformManifestDigest": "sha256:b44256a4ff37e4cb1a39c40d3a5b560337f1477a55428b3320e813d6004d8001",
    "configDigest": "sha256:0f9a8582286a2efc50d51724869b48d845fed52032b8d0b45f02ee6ee649a9f3",
    "port": 9090,
    "healthPath": "/health",
    "env": { "LD_DISABLE_BACKGROUND_TASKS": "True" },
    "secretEnv": ["LD_SUPERUSER_NAME", "LD_SUPERUSER_PASSWORD"],
    "dataVolumePath": "/etc/linkding/data",
    "readinessTimeoutS": 120
  },
  "api": {
    "read": [
      { "method": "GET", "path": "/api/bookmarks/" },
      { "method": "GET", "path": "/api/bookmarks/{id}/" },
      { "method": "GET", "path": "/api/tags/" }
    ],
    "write": [
      { "method": "POST", "path": "/api/bookmarks/", "op": "create", "query": { "disable_scraping": "" } },
      { "method": "PATCH", "path": "/api/bookmarks/{id}/", "op": "update_tags" },
      { "method": "POST", "path": "/api/bookmarks/{id}/archive/", "op": "archive" }
    ],
    "itemCap": 10
  },
  "devSandbox": {
    "baseImage": "ghcr.io/sissbruecker/linkding@sha256:e35cb50e0581178f245125ffaa909c565416c94c9f22ace305a7d234a4345522",
    "preinstalled": ["git", "node 24", "uv 0.8.13", "dev dependency group (hash-checked)", "npm ci", "npm run build"]
  },
  "testSelectionHint": "Name targeted test files under bookmarks/tests/; the full suite takes about 300 s.",
  "testData": "test-data.json",
  "runtimeRulesChecklist": "runtime-rules/adapters/linkding-checklist.md"
}
```

`readinessTimeoutS` is an initial value (measured readiness is about 34 s). The `sandbox_start` node timeout in design.md bounds the whole start including provisioning and seed.

## Verified linkding facts

Moved from the requirements Introduction. Verified from the official linkding documentation and GitHub repository metadata, with the corrections from spike 1.5:

- linkding is licensed under MIT.
- The REST API supports listing, querying, creating, PATCH, archiving and deleting bookmarks, plus tags and bundles, with Token authentication.
- Creating a bookmark whose URL already exists silently updates the existing bookmark instead of creating a new one. Verified correction (spike 1.5, 2026-11-21): the POST returns 201 with the same id and REPLACES the title and the tags; it does not merge them.
- Auto-tagging rules merge tags into the tag list on each update. Verified detail (spike 1.5): a rule adds its tag on create and keeps it on a PATCH without `tag_names`.

## What is linkding-specific in the code

- `adapters/linkding/`: `adapter.json`, the provisioning hook, the seed, reset and equality code, the comparator, `test-data.json`, and the Adapter's own tests (comparator with the in-memory model above, provisioning, seed and reset).
- `runtime-rules/adapters/linkding-checklist.md`: the Runtime_Rules checklist for this target (layer B).
- The linkding part of the Development_Sandbox image (task 10.1).
- Nothing else: Studio modules use only the Adapter contract.
