// Planning and the Agile_Docs (design.md, "Product_Backlog and Feature_Contract", "Planning and document-first";
// R19, R20, R40.1, R40.3). Pure: shared by server and web. The plan the roles submit is validated here; the
// Sprint_Plan, the Task_Board and every version number are filled in by code.
import { z } from "zod";
import { AcceptanceCheckSchema } from "./decision.ts";
import { EFFORTS, OUTPUT_DOC_KINDS } from "./events.ts";

const text = z.string().trim().min(1);
const line = (max: number) => text.max(max);

/** Strict: no other fields, so no file or path list can enter a Feature_Contract (R40.3). */
export const FeatureContractSchema = z
  .object({
    feature: line(400),
    shouldDo: z.array(line(300)).min(1).max(8),
    shouldNotDo: z.array(line(300)).max(8),
    executionKind: z.enum(["source_change", "api_operation"]),
    acceptanceChecks: z.array(AcceptanceCheckSchema).max(6),
    budgets: z.object({ maxAttempts: z.number().int().min(1).max(5), maxCodeAgentMinutes: z.number().int().min(1).max(30) }).strict(),
    derivedFromDecisionVersion: z.number().int().positive(),
  })
  .strict();
export type FeatureContract = z.infer<typeof FeatureContractSchema>;

export const StorySchema = z
  .object({
    id: z.string().regex(/^S[1-9][0-9]?$/, "story ids are S1, S2, ..."),
    title: line(100),
    priority: z.number().int().min(1).max(9),
    userStory: line(400),
    acceptanceCriteria: z.array(line(300)).min(1, "at least one acceptance criterion").max(10),
    demoPoint: z.object({ description: line(300) }).strict(),
    /** Decision_Doc sections the story uses, for example "workflow:w1", "scope", "approach". */
    references: z.array(line(80)).max(8),
    featureContract: FeatureContractSchema,
  })
  .strict();
export type Story = z.infer<typeof StorySchema>;

export const MAX_STORIES = 4;
export const ProductBacklogSchema = z.object({ decisionVersion: z.number().int().positive(), stories: z.array(StorySchema).min(1).max(MAX_STORIES) }).strict();
export type ProductBacklog = z.infer<typeof ProductBacklogSchema>;
export const SprintPlanSchema = z.object({ decisionVersion: z.number().int().positive(), goal: line(300), storyIds: z.array(text).min(1), featureContractRefs: z.array(text).min(1) }).strict();
export type SprintPlan = z.infer<typeof SprintPlanSchema>;
export const TaskBoardSchema = z
  .object({ decisionVersion: z.number().int().positive(), items: z.array(z.object({ id: text, storyId: text, title: text, status: z.enum(["to_do", "in_progress", "done", "blocked"]) }).strict()) })
  .strict();
export type TaskBoard = z.infer<typeof TaskBoardSchema>;
export const DefinitionOfDoneSchema = z.object({ decisionVersion: z.number().int().positive(), checklist: z.array(line(300)).min(1).max(10) }).strict();
export type DefinitionOfDone = z.infer<typeof DefinitionOfDoneSchema>;
export const DemoReviewNoteSchema = z.object({ decisionVersion: z.number().int().positive(), storyId: text, demo: text, judgeFeedback: z.string().optional(), unconfirmed: z.boolean() }).strict();
export type DemoReviewNote = z.infer<typeof DemoReviewNoteSchema>;
export const RetrospectiveSchema = z.object({ decisionVersion: z.number().int().positive(), worked: z.array(text), failed: z.array(text), change: z.array(text) }).strict();
export type Retrospective = z.infer<typeof RetrospectiveSchema>;

/** One role's assessment of one story (LLM judgment, shown with its label). */
export const StoryAssessmentSchema = z
  .object({
    storyId: text,
    effort: z.enum(EFFORTS).optional(),
    concerns: z.string().max(400).optional(),
    risk: z.string().max(400).optional(),
    conditions: z.string().max(300).optional(),
  })
  .strict();
export type StoryAssessment = z.infer<typeof StoryAssessmentSchema>;

/** The confirmed-or-proposed plan as one unit: what the Judge reviews and what the documents derive from. */
export const PlanSchema = z
  .object({
    decisionVersion: z.number().int().positive(),
    backlog: ProductBacklogSchema,
    sprintPlan: SprintPlanSchema,
    definitionOfDone: DefinitionOfDoneSchema,
    assessments: z.object({ feasibility: z.array(StoryAssessmentSchema), risk: z.array(StoryAssessmentSchema) }).strict(),
    /** The Facilitator's note on what it changed in the Planner's draft and why. */
    facilitatorNote: z.string().max(800),
    label: z.literal("LLM assessment, not a guarantee"),
  })
  .strict();
export type Plan = z.infer<typeof PlanSchema>;

/** Story fields as a role submits them (code adds the version and the default budgets). */
export const SubmittedStorySchema = z.object({
  id: z.string().default(""),
  title: z.string().default(""),
  priority: z.number().optional(),
  userStory: z.string().default(""),
  acceptanceCriteria: z.array(z.string()).default([]),
  demoPoint: z.string().default(""),
  references: z.array(z.string()).default([]),
  featureContract: z
    .object({
      feature: z.string().default(""),
      shouldDo: z.array(z.string()).default([]),
      shouldNotDo: z.array(z.string()).default([]),
      executionKind: z.string().default(""),
      acceptanceChecks: z.array(z.unknown()).default([]),
    })
    // Loose here, strict in StorySchema: an extra field (for example a file list) is reported, not dropped.
    .loose()
    .optional(),
});
export const SubmittedPlanSchema = z.object({
  sprintGoal: z.string().default(""),
  stories: z.array(SubmittedStorySchema),
  definitionOfDone: z.array(z.string()).default([]),
});
export type SubmittedPlan = z.infer<typeof SubmittedPlanSchema>;

export const DEFAULT_BUDGETS = { maxAttempts: 3, maxCodeAgentMinutes: 10 } as const;

export type BuildPlanResult = { ok: true; backlog: ProductBacklog; sprintPlan: SprintPlan; definitionOfDone: DefinitionOfDone } | { ok: false; problems: string[] };

/**
 * Builds the backlog, Sprint_Plan and Definition_of_Done from a submitted plan. Every problem names the story it
 * belongs to (R20.9). The Sprint_Plan selects every story in priority order and references each Feature_Contract.
 */
export function buildPlan(input: unknown, decisionVersion: number): BuildPlanResult {
  const p = SubmittedPlanSchema.safeParse(input);
  if (!p.success) return { ok: false, problems: p.error.issues.map((i) => `${i.path.join(".") || "plan"}: ${i.message}`) };
  const problems: string[] = [];
  const stories: Story[] = [];
  const ids = new Set<string>();
  if (p.data.stories.length === 0) problems.push("the plan has no story");
  if (p.data.stories.length > MAX_STORIES) problems.push(`at most ${MAX_STORIES} stories`);
  for (const [i, s] of p.data.stories.entries()) {
    const name = `story ${s.id || i + 1}${s.title ? ` "${s.title}"` : ""}`;
    if (ids.has(s.id)) problems.push(`${name}: the id is used twice`);
    ids.add(s.id);
    if (!s.featureContract) {
      problems.push(`${name}: no Feature_Contract`);
      continue;
    }
    const candidate = {
      id: s.id,
      title: s.title,
      priority: s.priority,
      userStory: s.userStory,
      acceptanceCriteria: s.acceptanceCriteria.slice(0, 10),
      demoPoint: { description: s.demoPoint },
      references: s.references,
      featureContract: { ...s.featureContract, shouldDo: s.featureContract.shouldDo.slice(0, 8), shouldNotDo: s.featureContract.shouldNotDo.slice(0, 8), budgets: { ...DEFAULT_BUDGETS }, derivedFromDecisionVersion: decisionVersion },
    };
    const r = StorySchema.safeParse(candidate);
    if (!r.success) {
      for (const issue of r.error.issues) problems.push(`${name}: ${issue.path.join(".")} ${issue.message}`);
      continue;
    }
    stories.push(r.data);
  }
  const dod = p.data.definitionOfDone.map((d) => d.trim()).filter(Boolean);
  if (dod.length === 0) problems.push("the Definition_of_Done has no entry");
  if (!p.data.sprintGoal.trim()) problems.push("the sprint goal is empty");
  if (problems.length) return { ok: false, problems };
  const ordered = [...stories].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id, "en", { numeric: true }));
  const backlog = ProductBacklogSchema.parse({ decisionVersion, stories: ordered });
  const sprintPlan = SprintPlanSchema.parse({ decisionVersion, goal: p.data.sprintGoal.trim(), storyIds: ordered.map((s) => s.id), featureContractRefs: ordered.map((s) => `${s.id}.featureContract`) });
  const definitionOfDone = DefinitionOfDoneSchema.parse({ decisionVersion, checklist: dod.slice(0, 10) });
  return { ok: true, backlog, sprintPlan, definitionOfDone };
}

/** The Task_Board is built by code from the confirmed stories (R20.8). */
export function initialTaskBoard(backlog: ProductBacklog): TaskBoard {
  return { decisionVersion: backlog.decisionVersion, items: backlog.stories.map((s) => ({ id: `T-${s.id}`, storyId: s.id, title: s.title, status: "to_do" as const })) };
}

/** Effort of a story as Feasibility assessed it (or "not assessed"). */
export function storyEffort(plan: Pick<Plan, "assessments">, storyId: string): string {
  return plan.assessments.feasibility.find((a) => a.storyId === storyId)?.effort ?? "not assessed";
}

// ---- documents for the analyzed repository (documenting) ----

const Quote = z.object({ path: text, line: z.number().int().positive().optional(), snippet: z.string() }).strict();
export const RunEnvironmentSchema = z
  .object({
    buildCommands: z.array(text).max(10),
    startCommands: z.array(text).min(1).max(5),
    port: z.number().int().min(1).max(65535),
    healthPath: text.regex(/^\//),
    /** Quotes from the target's own files that the commands come from; checked by code. */
    evidence: z.array(Quote.extend({ status: z.enum(["passed", "unverified"]).optional() })).max(10),
  })
  .strict();
export type RunEnvironment = z.infer<typeof RunEnvironmentSchema>;
export const RequirementsDocSchema = z
  .object({ decisionVersion: z.number().int().positive(), introduction: text, items: z.array(z.object({ id: text, storyId: text, text, acceptance: z.array(text).min(1) }).strict()).min(1) })
  .strict();
export const DesignDocSchema = z
  .object({
    decisionVersion: z.number().int().positive(),
    overview: text,
    changes: z.array(z.object({ storyId: text, area: text, description: text }).strict()).min(1),
    runEnvironment: RunEnvironmentSchema.optional(),
  })
  .strict();
export const TasksDocSchema = z
  .object({ decisionVersion: z.number().int().positive(), items: z.array(z.object({ id: text, storyId: text, title: text, steps: z.array(text).min(1) }).strict()).min(1) })
  .strict();
export type RequirementsDoc = z.infer<typeof RequirementsDocSchema>;
export type DesignDoc = z.infer<typeof DesignDocSchema>;
export type TasksDoc = z.infer<typeof TasksDocSchema>;

export type OutputDocKind = (typeof OUTPUT_DOC_KINDS)[number];
export const OUTPUT_DOC_TITLES: Record<OutputDocKind, string> = {
  product_backlog: "Product Backlog",
  sprint_plan: "Sprint Plan",
  definition_of_done: "Definition of Done",
  task_board: "Task Board",
  requirements: "Requirements",
  design: "Design",
  tasks: "Tasks",
  demo_review_note: "Demo and Review Notes",
  retrospective: "Retrospective",
};
