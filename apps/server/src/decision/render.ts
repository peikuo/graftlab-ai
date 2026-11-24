// DECISION_DOC.md (an Output_Doc, layer C): the frozen version in plain Markdown, written to the Task's docs.
import { describeCheck, type DecisionDocContent } from "@graftlab/shared";

export function renderDecisionDoc(c: DecisionDocContent, v: { version: number; hash: string; confirmedBy: string; confirmedAt: string }): string {
  const op = c.approachOptions.find((o) => c.chosenApproachIds.includes(o.id));
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- none");
  const mark = (s: string) => (s === "unverified" ? " (Unverified)" : "");
  return [
    `# Decision_Doc version ${v.version}`,
    `Frozen ${v.confirmedAt} by session ${v.confirmedBy}. Content hash (sha256 of the canonical JSON): \`${v.hash}\`.`,
    `## Purpose\n${c.purpose === "A" ? "A: AI takes over a step people do now" : "B: AI makes a feature stronger or new"}`,
    `## Workflows\n${c.workflows.map((w) => `- ${w.name} (${w.purpose})${mark(w.evidenceStatus)}: ${w.description}`).join("\n")}`,
    `## In scope\n${list(c.inScope)}`,
    `## Out of scope\n${list(c.outOfScope)}`,
    `## Acceptance criteria\n${list(c.acceptanceCriteria)}`,
    `## Chosen approach\n${op ? `${op.title} (${op.kind}): ${op.summary}` : "none"}`,
    `## Approach options (LLM assessment, not a guarantee)\n${c.approachOptions
      .map((o) => `### ${o.title}${c.chosenApproachIds.includes(o.id) ? " (chosen)" : ""}\n${o.summary}\n- Effort: ${o.assessment.effort}${o.assessment.firstVersion ? `; first version: ${o.assessment.firstVersion}` : ""}\n- Feasibility: ${o.assessment.feasibility || "not assessed"}\n- Risk: ${o.assessment.risk || "not assessed"}\n- Environments: ${o.assessment.neededEnvironments.join(", ") || "none named"}\n- Complete (has an acceptance check): ${o.assessment.complete ? "yes" : "no"}${o.assessment.claims.length ? `\n- Claims:\n${o.assessment.claims.map((x) => `  - ${x.text}${mark(x.evidenceStatus)}`).join("\n")}` : ""}`)
      .join("\n\n")}`,
    `## UI impact\n${c.uiImpact}`,
    c.aiRuntime ? `## AI runtime (accepted by the Judge)\n- Source: ${c.aiRuntime.source}${c.aiRuntime.endpoint ? ` (${c.aiRuntime.endpoint})` : ""}\n${c.aiRuntime.dataSent.map((d) => `- Sent: ${d}`).join("\n")}\n- Why: ${c.aiRuntime.reason}` : "",
    `## Executable acceptance checks (run by the Verifier, code, no AI)\n${list(c.executableAcceptanceChecks.map((x) => `${x.id}: ${describeCheck(x)}`))}`,
    `## Risks\n${list(c.risks)}`,
    `## Evidence sources (checked by Studio code)\n${list(c.evidenceSources.map((e) => `${e.path}${e.line ? `:${e.line}` : ""} — ${e.status === "passed" ? "found" : `Unverified (${e.reason})`}`))}`,
    `## Open questions\n${list(c.openQuestions)}`,
  ].filter(Boolean).join("\n\n") + "\n";
}
