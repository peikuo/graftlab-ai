// Markdown of the Agile_Docs and the analyzed-repository documents (layer C, data/tasks/<id>/docs/). Every
// document states the Frozen Decision_Doc version it is based on (R20.4).
import { describeCheck, RUBRIC, storyEffort, type DefinitionOfDone, type Plan, type ProductBacklog, type RequirementsDoc, type SprintPlan, type TaskBoard, type TechArchitecture, type TechDesign } from "@graftlab/shared";

const header = (title: string, v: number) => `# ${title}\n\nBased on Decision_Doc version ${v}.`;
const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- none");

export function renderBacklog(b: ProductBacklog, plan?: Pick<Plan, "assessments">): string {
  return [
    header("Product Backlog", b.decisionVersion),
    ...b.stories.map((s) => {
      const fc = s.featureContract;
      const effort = plan ? storyEffort(plan, s.id) : undefined;
      return [
        `## ${s.id} ${s.title} (priority ${s.priority}${effort ? `, effort ${effort}${effort === "large" ? ", Large change: engineering risk" : ""}` : ""})`,
        s.userStory,
        `**Acceptance criteria**\n${list(s.acceptanceCriteria)}`,
        `**Demo point:** ${s.demoPoint.description}`,
        `**Feature_Contract** (${fc.executionKind === "source_change" ? "changes the software's code" : "works through the software's API"}; at most ${fc.budgets.maxAttempts} attempts, ${fc.budgets.maxCodeAgentMinutes} min)\n\n${fc.feature}\n\nShould do:\n${list(fc.shouldDo)}\n\nShould not do:\n${list(fc.shouldNotDo)}\n\nChecks run by the Verifier (code, no AI):\n${list(fc.acceptanceChecks.map((c) => `${c.id}: ${describeCheck(c)}`))}`,
        s.references.length ? `References: ${s.references.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
  ].join("\n\n") + "\n";
}

export function renderSprintPlan(p: SprintPlan, b: ProductBacklog): string {
  const title = (id: string) => b.stories.find((s) => s.id === id)?.title ?? id;
  return [header("Sprint Plan", p.decisionVersion), `**Sprint goal:** ${p.goal}`, `## Stories\n${list(p.storyIds.map((id, i) => `${id} ${title(id)} (Feature_Contract: ${p.featureContractRefs[i]})`))}`].join("\n\n") + "\n";
}

export function renderDefinitionOfDone(d: DefinitionOfDone): string {
  return [header("Definition of Done", d.decisionVersion), list(d.checklist.map((c) => `[ ] ${c}`))].join("\n\n") + "\n";
}

export function renderTaskBoard(t: TaskBoard): string {
  const label = { to_do: "to do", in_progress: "in progress", done: "done", blocked: "blocked" } as const;
  return [header("Task Board", t.decisionVersion), "| Item | Story | Title | Status |\n|---|---|---|---|", ...t.items.map((i) => `| ${i.id} | ${i.storyId} | ${i.title} | ${label[i.status]} |`)].join("\n") + "\n";
}

export function renderRequirements(r: RequirementsDoc): string {
  return [header("Requirements", r.decisionVersion), r.introduction, ...r.items.map((i) => `## ${i.id} (story ${i.storyId})\n${i.text}\n\nAcceptance:\n${list(i.acceptance)}`)].join("\n\n") + "\n";
}

export function renderArchitecture(a: TechArchitecture): string {
  const re = a.runEnvironment;
  const q = (x: { path: string; line?: number | undefined; snippet: string; status?: string | undefined }) => `${x.path}${x.line ? `:${x.line}` : ""} — ${x.status === "passed" ? "found" : "Unverified"}: \`${x.snippet.trim().slice(0, 140)}\``;
  return [
    header("Technical Architecture", a.decisionVersion),
    a.overview,
    `## Affected parts of the existing software\n\n${a.affected.map((p) => `### ${p.part}\n${p.how}${p.quotes.length ? `\n\nSources (checked by Studio code):\n${list(p.quotes.map(q))}` : ""}`).join("\n\n")}`,
    a.newComponents.length ? `## New components\n${list(a.newComponents.map((c) => `**${c.name}**: ${c.purpose}${c.connectsTo.length ? ` (connects to ${c.connectsTo.join(", ")})` : ""}`))}` : "",
    a.dataChanges.length ? `## Data and configuration changes\n${list(a.dataChanges)}` : "",
    `## Technical decisions\n\n${a.decisions.map((d, n) => `### Decision ${n + 1}: ${d.decision}\n**Why:** ${d.why}${d.rejected.length ? `\n\n**Rejected alternatives:**\n${list(d.rejected)}` : ""}`).join("\n\n")}`,
    re
      ? `## Run environment (proposed by the Planner from the software's own files; not a Studio recipe)\n\nBuild:\n${list(re.buildCommands.map((c) => `\`${c}\``))}\n\nStart:\n${list(re.startCommands.map((c) => `\`${c}\``))}\n\nApp port ${re.port}, health path \`${re.healthPath}\`.\n\nSources (checked by Studio code):\n${list(re.evidence.map(q))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

export function renderFeatures(d: TechDesign): string {
  const grade = (id: string) => d.grades.find((g) => g.featureId === id);
  const rev = (id: string) => d.review.find((r) => r.featureId === id);
  return [
    header("Feature Breakdown", d.decisionVersion),
    "Each Feature is built on its own branch, reviewed, verified by its tests and merged into main before the next one starts.",
    ...d.breakdown.features.map((f) => {
      const g = grade(f.id);
      const r = rev(f.id);
      return [
        `## ${f.id} ${f.title} (story ${f.storyId}, size ${f.size})`,
        f.summary,
        `**Scope**\n- Modules: ${f.scope.modules.join(", ")}\n- Files expected to change: ${f.scope.files.map((x) => `\`${x}\``).join(", ")}${f.scope.notTouch.length ? `\n- Must not touch: ${f.scope.notTouch.join("; ")}` : ""}`,
        f.interfaces.length ? `**Interfaces**\n${list(f.interfaces)}` : "",
        `**Tests**\n- Files: ${f.tests.files.map((x) => `\`${x}\``).join(", ")}\n- Command: \`${f.tests.command.join(" ")}\``,
        f.dependsOn.length ? `**After:** ${f.dependsOn.join(", ")}` : "",
        f.servesChecks.length ? `**Serves acceptance checks:** ${f.servesChecks.join(", ")}` : "",
        g ? `**Quality (LLM assessment, not a guarantee):** ${RUBRIC.map((k) => `${RUBRIC_LABEL[k]} ${g[k] === "pass" ? "✓" : "⚠"}`).join(" · ")}${g.note ? ` — ${g.note}` : ""}` : "",
        r ? `**Feasibility:** fits ${r.fits}, size ${r.sizeRight ? "right" : "questioned"}${r.missing ? `; missing: ${r.missing}` : ""}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    }),
    d.checks.length ? `## Acceptance checks refined in the technical design\n\n${d.checks.map((c) => `### Story ${c.storyId}\n${c.reason}\n\n${list(c.checks.map((x) => `${x.id}: ${describeCheck(x)}`))}`).join("\n\n")}` : "",
    d.reviewerNote ? `## Reviewer's decision\n\n${d.reviewerNote}` : "",
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

const RUBRIC_LABEL: Record<(typeof RUBRIC)[number], string> = { verticalSlice: "vertical slice", independent: "independent", testable: "testable", small: "small", inScope: "in scope" };

/** The plan as the Planner and the Judge see it (backlog, sprint goal, Definition_of_Done, assessments). */
export function renderPlanMarkdown(p: Plan): string {
  const assess = (["feasibility", "risk"] as const)
    .map((r) => `${r === "feasibility" ? "Feasibility" : "Risk"} (LLM assessment, not a guarantee):\n${list(p.assessments[r].map((a) => `${a.storyId}: ${r === "feasibility" ? `effort ${a.effort ?? "not assessed"}${a.concerns ? `; ${a.concerns}` : ""}` : `${a.risk ?? ""}${a.conditions ? `; condition: ${a.conditions}` : ""}`}`))}`)
    .join("\n\n");
  return [renderSprintPlan(p.sprintPlan, p.backlog), renderBacklog(p.backlog, p), renderDefinitionOfDone(p.definitionOfDone), `## Assessments\n\n${assess}`, p.facilitatorNote ? `## Facilitator's decision\n\n${p.facilitatorNote}` : ""].filter(Boolean).join("\n\n");
}

/** The note put at the top of a document whose Decision_Doc version is no longer the current one (R20.10). */
export function olderVersionNote(docVersion: number, current: number): string {
  return `> Based on an older version: this document follows Decision_Doc version ${docVersion}; the current Frozen version is ${current}.\n\n`;
}
