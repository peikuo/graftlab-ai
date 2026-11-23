# Skill: splitting work into stories
Use this when you turn a Frozen Decision_Doc into stories. A story is a change a user can see and use. The Judge confirms it at its demo point, so every story must work on its own when it is done.

## What a good story is
- Vertical: it goes through every layer it needs (data, logic, screen or API) and ends in something a user can try. "The save form shows suggested tags" is a story. "Add a database field" is not; it is part of a story.
- Valuable on its own: if the sprint stopped after this story, the user would still have something that works.
- Independent: it does not need a later story to be useful. If two stories cannot be shown apart, they are one story.
- Small: one demo point, at most six acceptance criteria. If you need "and" in the title, it is probably two stories.
- Testable: every acceptance criterion can be checked by the Verifier (tests, browser steps or API read-back) or seen at the demo point.
- In scope: it serves the chosen approach of the Frozen Decision_Doc. Work the Decision_Doc puts out of scope, parks, or leaves to a later phase is not a story in this sprint.

## How to split a story that is too big
Try these in order and stop at the first one that gives stories that each still work on their own:
1. Steps of the user's workflow: one story per step the user takes, starting with the step that gives value first.
2. Rule variations: the simple rule first, the special cases later (for example "off by default, one switch" before "per-user switches").
3. Data variations: one kind of input first (links pasted in the web form), others later (the browser extension, the API).
4. Acceptance criteria with several "when ... then ...": each pair can become its own story.
5. Effort: the first story does the hard part once in the simplest form; later stories extend it.
6. Outside dependencies: what works without the outside service first, the part that needs it next.
7. An unknown that blocks a sound split: write a small first story that answers it (for example "show one suggestion from a fixed model address") instead of guessing.

## What not to do
- Do not split by layer ("backend story", "frontend story"): neither is usable alone.
- Do not turn stories into technical tasks; those come in the technical design step.
- Do not split what is already small; a sprint of two good stories beats five thin ones.
- Do not add features the Decision_Doc does not contain, and do not drop its acceptance criteria: move each criterion into the story it belongs to.

## Check before you submit
- Every acceptance criterion of the Decision_Doc belongs to exactly one story.
- Every story has one demo point that the Judge can see without reading code.
- The order puts the story that gives the most value with the least risk first.
