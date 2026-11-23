# linkding Adapter
The first and only Adapter of the first version (design.md, "Adapter contract"). linkding is MIT-licensed and used only as an unmodified external dependency.

- `adapter.json`: declarative values (digest pins from spikes 1.3 and 1.6, the `api` allow-list from spike 1.5 plus the archived list), validated by the contract schema at server start.
- `index.ts`: the hooks: provisioning (API token in the management shell), seed, reset, equality check, `readAll`.
- `comparator.ts`: normalized-URL key and the comparison rules for `api_readback`.
- `test-data.json`: the fixed test data set (10 bookmarks on reserved example domains, two archived).
- `model.ts`: an in-memory model of linkding's write semantics, for the tests only.
- Tests: `hooks.test.ts`, `comparator.property.test.ts` (Property 11).

Facts: `.kiro/specs/graftlab-ai/reference-target-linkding.md`. No start or build procedure for the modified target lives here (R39.10).
