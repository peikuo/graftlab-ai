// Review items of a decision draft (design.md, "Decision step"; R5.7): one item per section, split by code, in
// feature words for the Judge. `hash` covers the section's content, so an unchanged item keeps its verdict.
import { describeCheck, type DecisionDocContent, type EvidenceRef, type ReviewItemData } from "@graftlab/shared";
import { contentHash } from "./hash.ts";

const PURPOSE = { A: "AI takes over a step people do now", B: "AI makes a feature stronger or new" } as const;
const KIND: Record<string, string> = { independent_agent: "a separate AI helper next to the app", source_change: "a change in the app's code", ui_change: "a change in the app's screens", mix: "a combination" };
const AI_SOURCE: Record<string, string> = { studio_service: "The Studio's model service on the internet; the data below leaves the software", judge_endpoint: "Your own model endpoint", local: "A local model on the same server" };
const EFFORT: Record<string, string> = { small: "small change", medium: "medium change", large: "large change (engineering risk)", not_assessed: "effort not assessed" };
const unverifiedOf = (n: number) => (n === 0 ? undefined : n === 1 ? "1 statement has no quote that Studio code found in the files" : `${n} statements have no quote that Studio code found in the files`);

export function splitItems(c: DecisionDocContent): ReviewItemData[] {
  const item = (id: string, section: unknown, body: Omit<ReviewItemData, "id" | "hash">): ReviewItemData => ({ id, ...body, hash: contentHash(section) });
  const wfEvidence: EvidenceRef[] = c.workflows.flatMap((w) => w.evidence);
  const claims = c.approachOptions.flatMap((o) => o.assessment.claims);
  return [
    item("purpose", { purpose: c.purpose, workflows: c.workflows }, {
      title: "What AI should do",
      summary: `Purpose ${c.purpose}: ${PURPOSE[c.purpose]}.`,
      details: c.workflows.map((w) => `${w.name} (${w.purpose === "A" ? "takes over a step" : "stronger or new"}): ${w.description}`),
      ...(unverifiedOf(c.workflows.filter((w) => w.evidenceStatus === "unverified").length) ? { unverified: unverifiedOf(c.workflows.filter((w) => w.evidenceStatus === "unverified").length)! } : {}),
      evidence: wfEvidence,
    }),
    item("scope", { inScope: c.inScope, outOfScope: c.outOfScope, acceptanceCriteria: c.acceptanceCriteria }, {
      title: "Scope and what counts as done",
      summary: `${c.inScope.length} in scope, ${c.outOfScope.length} left out.`,
      details: [...c.inScope.map((s) => `In: ${s}`), ...c.outOfScope.map((s) => `Out: ${s}`), ...c.acceptanceCriteria.map((s) => `Done when: ${s}`)],
      evidence: [],
    }),
    item("approach", { approachOptions: c.approachOptions.map((o) => ({ id: o.id, kind: o.kind, title: o.title, summary: o.summary, assessment: o.assessment })) }, {
      title: "How to build it",
      summary: `${c.approachOptions.length} ways to build it. Choose exactly one; an option without an acceptance check cannot be chosen.`,
      details: [],
      ...(unverifiedOf(claims.filter((x) => x.evidenceStatus === "unverified").length) ? { unverified: unverifiedOf(claims.filter((x) => x.evidenceStatus === "unverified").length)! } : {}),
      evidence: claims.flatMap((x) => x.evidence),
      options: c.approachOptions.map((o) => ({
        id: o.id,
        label: o.title,
        detail: [`${KIND[o.kind]}: ${o.summary}`, `Effort: ${EFFORT[o.assessment.effort]}${o.assessment.firstVersion ? `; first version: ${o.assessment.firstVersion}` : ""}`, `Feasibility: ${o.assessment.feasibility || "not assessed"}`, `Risk: ${o.assessment.risk || "not assessed"}`].join("\n"),
        complete: o.assessment.complete,
        effort: o.assessment.effort,
        largeRisk: o.assessment.effort === "large",
      })),
    }),
    item("ui", { uiImpact: c.uiImpact }, { title: "What changes on screen", summary: c.uiImpact, details: [], evidence: [] }),
    item("checks", { checks: c.approachOptions.map((o) => ({ id: o.id, checks: o.assessment.acceptanceChecks })) }, {
      title: "How the result is checked",
      summary: "The Verifier (code, no AI) runs these checks; only they decide success.",
      details: c.approachOptions.flatMap((o) => (o.assessment.acceptanceChecks.length ? o.assessment.acceptanceChecks.map((ch) => `${o.title}: ${describeCheck(ch)}`) : [`${o.title}: no executable check yet, so it cannot be chosen`])),
      evidence: [],
    }),
    ...(c.aiRuntime
      ? [
          item("ai_runtime", { aiRuntime: c.aiRuntime }, {
            title: "Where the AI gets its model",
            summary: `${AI_SOURCE[c.aiRuntime.source]}${c.aiRuntime.endpoint ? ` (${c.aiRuntime.endpoint})` : ""}. Accepting this item is your consent.`,
            details: [...c.aiRuntime.dataSent.map((d) => `Sent to the model: ${d}`), c.aiRuntime.reason],
            evidence: [],
          }),
        ]
      : []),
    item("risks", { risks: c.risks }, { title: "Risks", summary: c.risks.length === 1 ? "1 risk named." : `${c.risks.length} risks named.`, details: c.risks, evidence: [] }),
    item("questions", { openQuestions: c.openQuestions }, { title: "Open questions", summary: c.openQuestions.length === 0 ? "No open questions." : c.openQuestions.length === 1 ? "1 question stays open." : `${c.openQuestions.length} questions stay open.`, details: c.openQuestions, evidence: [] }),
  ];
}
