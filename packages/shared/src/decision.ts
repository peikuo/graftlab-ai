// Decision_Doc (design.md, "Decision_Doc", "Acceptance_Check specs"; R15.2, R16, R37). Pure: shared by server and
// web. The content hash is sha256 over canonicalJson(content), computed on the server.
import { z } from "zod";
import { EFFORTS, EvidenceRefSchema } from "./events.ts";

const text = z.string().trim().min(1);
const ExpectationSchema = z.object({ key: text, mustExist: z.boolean(), fields: z.record(z.string(), z.unknown()) });
const BrowserStepSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("goto"), path: text }),
  z.object({ op: z.literal("expectRole"), role: text, name: text }),
  z.object({ op: z.literal("expectText"), text }),
  z.object({ op: z.literal("click"), role: text, name: text }),
  z.object({ op: z.literal("fill"), role: text, name: text, value: z.string() }),
]);
export const AcceptanceCheckSchema = z.discriminatedUnion("kind", [
  z.object({ id: text, kind: z.literal("api_readback"), target: z.enum(["sandbox", "run_environment"]), expect: z.array(ExpectationSchema).min(1) }),
  z.object({ id: text, kind: z.literal("test_suite"), command: z.array(text).min(1), workdir: z.string().optional(), timeoutS: z.number().int().positive().max(1800) }),
  z.object({ id: text, kind: z.literal("browser_check"), target: z.enum(["run_environment", "sandbox"]), steps: z.array(BrowserStepSchema).min(1).max(20) }),
]);
export type AcceptanceCheckSpec = z.infer<typeof AcceptanceCheckSchema>;
export const APPROACH_KINDS = ["independent_agent", "source_change", "ui_change", "mix"] as const;
const ClaimSchema = z.object({ text, evidence: z.array(EvidenceRefSchema), evidenceStatus: z.enum(["passed", "unverified"]) });
export const AssessmentSchema = z.object({
  feasibility: z.string(),
  effort: z.enum([...EFFORTS, "not_assessed"]),
  firstVersion: z.string().optional(),
  risk: z.string(),
  neededEnvironments: z.array(z.enum(["sandbox", "development_sandbox", "run_environment"])),
  acceptanceChecks: z.array(AcceptanceCheckSchema),
  label: z.literal("LLM assessment, not a guarantee"),
  claims: z.array(ClaimSchema),
  /** Computed by code: at least one executable Acceptance_Check (R37.5). */
  complete: z.boolean(),
});
export const DecisionDocContentSchema = z.object({
  purpose: z.enum(["A", "B"]),
  workflows: z.array(z.object({ id: text, name: text, purpose: z.enum(["A", "B"]), description: z.string(), evidence: z.array(EvidenceRefSchema), evidenceStatus: z.enum(["passed", "unverified"]) })).min(1),
  inScope: z.array(text).min(1),
  outOfScope: z.array(text),
  acceptanceCriteria: z.array(text).min(1),
  approachOptions: z.array(z.object({ id: text, kind: z.enum(APPROACH_KINDS), title: text, summary: text, assessment: AssessmentSchema })).min(1).max(4),
  /** Exactly one option at freeze; a combination is one option of kind "mix" (R15.11, R37.4). */
  chosenApproachIds: z.array(text),
  uiImpact: text,
  executableAcceptanceChecks: z.array(AcceptanceCheckSchema),
  risks: z.array(text),
  evidenceSources: z.array(EvidenceRefSchema),
  openQuestions: z.array(z.string()),
});
export type DecisionDocContent = z.infer<typeof DecisionDocContentSchema>;

/** One review item of a draft (R5.7), split by code; `hash` is sha256 of the canonical JSON of its section. */
export const ReviewItemSchema = z.object({
  id: text,
  title: text,
  summary: z.string(),
  details: z.array(z.string()),
  unverified: z.string().optional(),
  evidence: z.array(EvidenceRefSchema),
  options: z.array(z.object({ id: text, label: text, detail: z.string(), complete: z.boolean(), effort: z.string(), largeRisk: z.boolean() })).optional(),
  hash: text,
});
export type ReviewItemData = z.infer<typeof ReviewItemSchema>;

/** Canonical JSON (R16.5): object keys sorted, no insignificant whitespace; undefined members are dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical JSON has no NaN or Infinity");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** Plain words for an Acceptance_Check (R5.4: feature terms; the raw spec stays in Engineering_Details). */
export function describeCheck(c: AcceptanceCheckSpec): string {
  if (c.kind === "test_suite") return `Runs the tests: ${c.command.join(" ")} (at most ${c.timeoutS} s)`;
  if (c.kind === "api_readback") return `Reads the data back from the app and expects ${c.expect.map((e) => `${e.key} ${e.mustExist ? "present" : "absent"}${Object.keys(e.fields).length ? ` with ${Object.entries(e.fields).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(", ")}` : ""}`).join("; ")}`;
  const step = (s: (typeof c.steps)[number]) =>
    s.op === "goto" ? `open ${s.path}` : s.op === "expectText" ? `see “${s.text}”` : s.op === "expectRole" ? `see the ${s.role} “${s.name}”` : s.op === "click" ? `click the ${s.role} “${s.name}”` : `type “${s.value}” into “${s.name}”`;
  return `In the browser: ${c.steps.map(step).join(", then ")}`;
}
