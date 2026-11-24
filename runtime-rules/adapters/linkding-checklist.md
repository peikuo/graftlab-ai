# linkding checklist
Rules for every agent that plans, builds, reviews or checks a change to linkding. The Studio enforces the allow-list, the item cap and the Sandbox; this list helps you stay inside them.
## The app
- linkding is a Django bookmark manager. Bookmarks have a URL, a title, notes, tags and an archived flag. The REST API needs the header `Authorization: Token <key>`; the Studio provides the key and you never see it.
- Bookmarks are matched by normalized URL: lower-case scheme and host, no default port; path, query and fragment as written.
- Saving a URL that already exists updates that bookmark and replaces its title and tags; it does not create a second one.
- Auto-tagging rules in the user profile add their tag when a bookmark is created and keep it on a tag change that does not send tags.
- Archived bookmarks are listed only at `/api/bookmarks/archived/`.
## What you may call through the API
- Read: `GET /api/bookmarks/`, `GET /api/bookmarks/archived/`, `GET /api/bookmarks/{id}/`, `GET /api/tags/`.
- Write (only in a Demo_Case, executed by Studio code): `create`, `update_tags`, `archive`. There is no delete.
- At most 10 items per Demo_Case. Every create runs with scraping disabled, so the Sandbox fetches no page.
## Test data
- The Sandbox starts with a fixed set of 10 bookmarks on example.com, example.org and example.net. Use only these domains. Never use real personal data.
- After a reset the data is exactly the fixed set again; the Studio checks it item by item.
## Checks the Verifier can run
- `api_readback`: the key is the bookmark URL; fields are `titleContains`, `tagsInclude` (planned tags must be among the read-back tags) and `archived`.
- `test_suite`: name targeted test modules under `bookmarks/tests/` (for example `bookmarks.tests.test_bookmarks_api`); the full suite takes about 300 s.
- `browser_check`: the changed app runs in the Run_Environment; name buttons and fields by their visible labels. For a model-powered feature set `needsAi: true` and expect text that only the model's answer can produce, not a fixed heading.
- After the last Feature the Verifier runs the whole `bookmarks.tests` suite and compares it with the pinned commit; a test that passed before and fails after is a regression.
## Building
- linkding pages use Turbo: a form that is sent with POST must answer with a redirect (303), or with status 422 to show the form again with errors. A plain 200 page in answer to a POST is not shown in the browser, even though the Django test client sees it (found 2026-11-24: a question box worked in its tests and showed nothing in the browser). To show a result on the same page, send the form with GET, or mark the form `data-turbo="false"`.
- linkding needs Python 3.13. The development sandbox already has the dependencies, Node and the built front end; do not install new system packages.
- Change only the copy in your worktree. The Studio never starts the changed app from your instructions; it starts it the same way for every change.
