// The context of one Code_Agent attempt (design.md, "Development stage" step 1; R19.5, R19.7, R19.8, R35.8,
// R40.2). Exactly one Feature: the Feature (scope, interfaces, tests), its story with the Feature_Contract, the
// requirements of that story, the Technical Architecture, and short summaries of the Features it builds on.
// Nothing of other stories enters the context. The text is written to data/tasks/<id>/context/<featureId>/,
// mounted read-only at /context, together with the Code_Agent rules.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describeCheck, type Feature, type Plan, type RequirementsDoc, type TechDesign } from "@graftlab/shared";
import { renderArchitecture } from "../planning/render.ts";

export interface FeatureContextInput {
  featureId: string;
  plan: Plan;
  design: TechDesign;
  requirements?: RequirementsDoc;
  /** Review reasons or Judge feedback from the previous attempt of this Feature, if any. */
  previousFeedback?: string[];
  /** The Test_Agent's tests, written before the code (R40.21); absent for the Test_Agent itself. */
  protectedTests?: string[];
  /** The import name of the Studio's AI client library in the target (R40.23). */
  aiClient?: string;
}

const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- none");

export function featureContext(i: FeatureContextInput): string {
  const f = i.design.breakdown.features.find((x) => x.id === i.featureId);
  if (!f) throw new Error(`no Feature ${i.featureId} in the technical design`);
  const story = i.plan.backlog.stories.find((s) => s.id === f.storyId);
  if (!story) throw new Error(`Feature ${f.id} names story ${f.storyId}, which is not in the plan`);
  const fc = story.featureContract;
  const before = f.dependsOn.map((id) => i.design.breakdown.features.find((x) => x.id === id)).filter((x): x is Feature => !!x);
  const reqs = (i.requirements?.items ?? []).filter((r) => r.storyId === story.id);
  const checks = fc.acceptanceChecks.filter((c) => f.servesChecks.includes(c.id));
  return [
    `# Your assignment: Feature ${f.id} — ${f.title}`,
    "Build only this Feature. It is one part of the story below; other parts are built separately. If something you need is not here, or the scope does not fit the code, stop and ask with ask_question.",
    `## The Feature (size ${f.size})\n${f.summary}`,
    `### Scope\n- Modules: ${f.scope.modules.join(", ")}\n- Files expected to change:\n${list(f.scope.files.map((x) => `\`${x}\``))}\n- Must not touch:\n${list(f.scope.notTouch)}\n\nChanging a file outside this list needs a reason the Reviewer accepts.`,
    `### Interfaces\n${list(f.interfaces)}`,
    i.aiClient
      ? `### Calling the model: use \`${i.aiClient}\` (Studio-provided, already in the code)\nEvery model call goes through this library; do not write your own client and do not read GL_AI_* yourself.\n- \`${i.aiClient}.configured()\`: an address and a model are set\n- \`${i.aiClient}.ask(system, user, max_tokens=None, timeout=None)\` and \`${i.aiClient}.chat(messages, ...)\`: return \`Result(ok, text, error, usage)\`; never raise\n- \`${i.aiClient}.ask_json(system, user)\`: the parsed answer in \`Result.data\`\n- Tests: \`with ${i.aiClient}.stub(lambda messages: "answer") as calls:\` replaces the service (return a \`Result(ok=False, error=...)\` or raise to simulate a failure)\n- Call it inside the request when the person must see the answer; background tasks do not run here.`
      : "",
    i.protectedTests
      ? `### Tests (written first by the Test_Agent)\n${list(i.protectedTests.map((x) => `\`${x}\``))}\n- Run them with: \`${f.tests.command.join(" ")}\`\n\nMake these tests pass. Change one only when it is wrong against the Feature_Contract or the design, and name it and the reason in your final reply; the Reviewer checks every such change. You may add tests in new files. The Verifier runs exactly this command after your attempt.`
      : `### Tests\n- Add or change: ${f.tests.files.map((x) => `\`${x}\``).join(", ")}\n- Run them with: \`${f.tests.command.join(" ")}\`\n\nThe Verifier runs exactly this command after your attempt. Do not edit other tests.`,
    before.length ? `### Already built before this Feature\n${list(before.map((b) => `${b.id} ${b.title}: ${b.summary}`))}` : "",
    `## The story: ${story.title}\n${story.userStory}\n\n**Acceptance criteria**\n${list(story.acceptanceCriteria)}\n\n**Demo point:** ${story.demoPoint.description}`,
    `## Feature_Contract of the story\n${fc.feature}\n\nShould do:\n${list(fc.shouldDo)}\n\nShould not do:\n${list(fc.shouldNotDo)}`,
    checks.length ? `## Acceptance checks this Feature serves (run by the Verifier, code, no AI)\n${list(checks.map((c) => `${c.id}: ${describeCheck(c)}`))}` : "",
    reqs.length ? `## Requirements of the story\n${list(reqs.map((r) => `${r.id}: ${r.text}`))}` : "",
    i.previousFeedback?.length ? `## Feedback on your previous attempt\n${list(i.previousFeedback)}` : "",
    `## Technical Architecture (context; decided in the technical design)\n\n${renderArchitecture(i.design.architecture).replace(/^# Technical Architecture\n\n/, "")}`,
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

/** Writes the context directory of one attempt: story.md and rules.md. Returns its path. */
export async function writeFeatureContext(dataDir: string, taskId: string, input: FeatureContextInput, rules: string, rulesFile = "rules.md"): Promise<string> {
  const dir = join(dataDir, "tasks", taskId, "context", input.featureId);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "story.md"), featureContext(input));
  await writeFile(join(dir, rulesFile), `${rules.trim()}\n`);
  return dir;
}
