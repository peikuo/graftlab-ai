# Product: GraftLab AI

GraftLab AI is a Kiroween 2026 entry (Frankenstein category). A Judge pastes a public GitHub repository URL. AI roles read the repository, gather evidence (for an adapted target also by running it in a sandbox and using it in a browser), hold a meeting with the Judge, and freeze a Decision_Doc on how to make the software AI-powered. The Studio then plans in a document-first agile way. For the adapted target (linkding) a Code_Agent develops the change in a confined container, and a non-LLM Verifier decides success.

The spec in `.kiro/specs/graftlab-ai/` is the single source of truth. Change the spec first, then the code.

## Priorities

1. UI interactivity and visible, honest agent activity come before breadth of features. The Judge must always see who is working, on what, and why the work is waiting.
2. The flow F1-F6 (URL to frozen Decision_Doc) is protected first when scope is cut.

## Honesty rules

- Every working indicator in the UI is backed by a recent event. No fake activity, no fake progress numbers.
- Failures are shown when they happen, with their Failure_Class. No hidden retries; a retry is a visible event.
- Replay is always labeled "Replay".
- Success is decided only by the Verifier (code, no LLM). A role statement or a Reviewer approval is never success.
- LLM judgments carry their label: "LLM assessment, not a guarantee", "reviewed by Reviewer (LLM judgment)", "designed by Reviewer (LLM judgment)".

## What the Studio guarantees versus best effort

Guaranteed, because code enforces it: the Flow_Graph transitions and guards, schema validation of every stage output, the Demo_Case write constraints, the container confinement, secret redaction, the evidence check marks, and the Verifier result.

Best effort, and measured instead of promised: the quality of role statements, decisions, plans, code changes, reviews and Demo_Cases.

## Agent rules

- Development agents have no decision power. Decisions are made in the meeting and frozen in the Decision_Doc.
- Each story has a feature-level Feature_Contract (no file lists). The Reviewer reviews the changed files against it.
- An agent that cannot resolve a problem stops and asks. It does not improvise or retry forever.

## Scope

- Analysis: any public GitHub repository, read-only. Repository code is never run.
- Execution: adapted targets only (linkding in the first version), always in containers.
- No computer use in the first version.
