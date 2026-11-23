// Markdown of the Agile_Docs and the analyzed-repository documents (layer C, data/tasks/<id>/docs/). Every
// document states the Frozen Decision_Doc version it is based on (R20.4).
import { describeCheck, storyEffort, type DefinitionOfDone, type DesignDoc, type Plan, type ProductBacklog, type RequirementsDoc, type SprintPlan, type TaskBoard, type TasksDoc } from "@graftlab/shared";

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

export function renderDesign(d: DesignDoc): string {
  const re = d.runEnvironment;
  return [
    header("Design", d.decisionVersion),
    d.overview,
    ...d.changes.map((c) => `## ${c.area} (story ${c.storyId})\n${c.description}`),
    re
      ? `## Run environment (proposed by the Planner from the software's own files; not a Studio recipe)\n\nBuild:\n${list(re.buildCommands.map((c) => `\`${c}\``))}\n\nStart:\n${list(re.startCommands.map((c) => `\`${c}\``))}\n\nApp port ${re.port}, health path \`${re.healthPath}\`.\n\nSources (checked by Studio code):\n${list(re.evidence.map((e) => `${e.path}${e.line ? `:${e.line}` : ""} — ${e.status === "passed" ? "found" : "Unverified"}: \`${e.snippet.slice(0, 160)}\``))}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n") + "\n";
}

export function renderTasks(t: TasksDoc): string {
  return [header("Tasks", t.decisionVersion), ...t.items.map((i) => `## ${i.id} ${i.title} (story ${i.storyId})\n${i.steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}`)].join("\n\n") + "\n";
}

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
