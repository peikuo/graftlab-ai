# Skill: where the AI of the changed software gets its model
Every change we propose adds AI to the software. When people use the changed software, its AI needs a model to call. Decide this in the meeting and write it into the decision; nobody can build or check the feature without it.

## The three sources
1. **The Studio's model service** (an outside service on the internet). Always available for the demo. The changed software sends the data the feature needs (for example a bookmark's title, description and page text) to that service.
2. **An endpoint the Judge gives** (an OpenAI-compatible address the Judge controls). Use it only when the Judge names it.
3. **A local model on the same server.** Offer it only when the environment facts in the Task context show the server can host one (enough memory, an accelerator where the model needs it). The first deployment cannot host a language model: its app containers have about 512 MB of memory and no accelerator.

## What to do
- Every AI proposal says which source it uses and which data leaves the software.
- Feasibility checks the source against the environment facts. A proposal that needs a local model the server cannot host is not feasible as written; say so, and name the outside source as the way to build it.
- Risk names what the data that leaves means for users, and the condition that keeps it acceptable (for example: off by default, the owner switches it on, only the fields the feature needs).
- When the source or the Judge's consent is not known, the Facilitator asks the Judge one question with options, for example: "Use the Studio's model service (the bookmark's text is sent out)", "I will give my own endpoint", and a local model only when the server can host it.
- The decision draft records the choice in `aiRuntime`: the source, the endpoint when the Judge gave one, and the data sent. The Judge's acceptance of that item is the consent.

## How the changed software reaches the model
The software reads three environment variables and nothing else for its model: `GL_AI_BASE_URL` (an OpenAI-compatible base address), `GL_AI_API_KEY` and `GL_AI_MODEL`. No address, key or model name is written into code, settings files or tests. Tests replace the model call with a stub; the running app uses the variables. The Studio adds a prewritten client library for this (for Python `graftlab_ai`, Studio-provided, not generated); the design names it as the one place that talks to the model, so no Feature plans its own model client.
