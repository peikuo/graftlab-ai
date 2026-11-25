# Skill: breaking stories into Features for development
Use this in the technical design step, after the Judge confirmed the stories. A Feature is one unit the Code_Agent builds in one go on its own branch; it is reviewed, tested and merged before the next one starts. A clear Feature is the difference between a focused change and a tangle.

## First read, then design
- Read the code the stories touch before you design anything: find where the behavior lives today, the patterns the code already uses (how views, forms, settings, tasks and tests are written), and the tests that cover that place. Quote what you rely on.
- Write down what depends on what: data and settings first, then the logic that uses them, then the screens and APIs that show them. Features follow this order.
- Note what you do not know. An unknown that changes the design becomes its own small Feature early, so it fails fast.

## What a good Feature is
- Part of exactly one story, and the story's Features together deliver its demo point.
- A thin vertical slice where possible: it leaves the software working and adds something that can be tested. A Feature that only prepares data is acceptable when the next Feature of the same story uses it and its own tests prove it.
- Small: XS (one function or setting, one file), S (one component or endpoint, one or two files) or M (one slice across a few parts, three to five files); test files do not count. Studio code refuses a Feature whose planned files exceed its size. Anything bigger is split. If you cannot state its result in at most three checks, or its title needs "and", split it.
- Bounded: name the modules and files you expect to change, and what must not be touched (for example "the existing auto-tagging rules", "the search syntax", other stories' parts). This is the frame the review uses.
- Testable on its own: name the test files to add or change, following the project's test layout, and the exact command that runs only those tests. The Verifier runs exactly that command.
- Honest about interfaces: list each function, endpoint, setting, form field or template block it adds or changes, with its shape in one line.
- Ordered: it depends only on Features that come before it. Risky Features come early.
## The detail design of each Feature
Tests are written before the code from this, so write down what the tests and the code must agree on:
- `usesModel`: whether the Feature calls the model.
- `modelCalls`: for each call, its purpose, the input sent (which fields, how many items), the answer shape as a JSON example (for example `{"answer": "text", "bookmark_ids": [3, 7]}`), and what the app does when the call fails or the answer does not match. Studio code refuses a model-using Feature without an answer shape.
- `dataChanges`: new fields, defaults, migrations.
- `visibleTexts`: the button, field and heading texts a person sees and the browser checks use, exactly as they will appear.
- `errors`: what the person sees when something goes wrong.

## The Technical Architecture
- Say which existing parts are affected and how, with quotes from the code.
- Name every new component or module and how it connects to the existing ones.
- List data and configuration changes (new fields, migrations, settings, defaults).
- Record each real technical decision as: decision, why, alternatives rejected.
- Give the run environment from the software's own files.

## Check before you submit
- Every story has one to three Features; the sprint has at most four.
- Every acceptance check of every story is served by at least one Feature.
- No Feature is larger than M, lacks a test command, or depends on a later Feature.
- Every Feature has a detail design, and every model call has an answer shape.
- Nothing in a Feature goes beyond its story's Feature_Contract.
