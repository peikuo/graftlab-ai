// Technical design (Sprint Planning part two; design.md, "Planning and document-first"; R19.13-R19.15). The
// Technical Architecture and the Feature breakdown, and the code checks every breakdown must pass. A Feature's
// scope guides the Code_Agent and the review; it is not a write restriction (R38.2).
import { z } from "zod";
import { AcceptanceCheckSchema, type AcceptanceCheckSpec } from "./decision.ts";
import type { Plan, ProductBacklog } from "./planning.ts";

const text = z.string().trim().min(1);
const soft = (max: number) => text.transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));
/** A list with a soft cap: extra entries are dropped instead of refusing the whole design. */
const upTo = <T extends z.ZodTypeAny>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
const Quote = z.object({ path: text, line: z.number().int().positive().optional(), snippet: z.string(), status: z.enum(["passed", "unverified"]).optional() }).strict();

export const RunEnvironmentSchema = z
  .object({
    buildCommands: z.array(text).max(10),
    startCommands: z.array(text).min(1).max(5),
    port: z.number().int().min(1).max(65535),
    healthPath: text.regex(/^\//),
    /** Quotes from the target's own files that the commands come from; checked by code. */
    evidence: upTo(Quote, 10),
  })
  .strict();
export type RunEnvironment = z.infer<typeof RunEnvironmentSchema>;

export const TechArchitectureSchema = z
  .object({
    decisionVersion: z.number().int().positive(),
    overview: soft(800),
    affected: upTo(z.object({ part: soft(120), how: soft(400), quotes: upTo(Quote, 4) }).strict(), 8).refine((a) => a.length > 0, "name at least one affected part"),
    newComponents: upTo(z.object({ name: soft(80), purpose: soft(300), connectsTo: upTo(soft(80), 6) }).strict(), 6),
    dataChanges: upTo(soft(300), 8),
    decisions: upTo(z.object({ decision: soft(300), why: soft(400), rejected: upTo(soft(200), 4) }).strict(), 6).refine((a) => a.length > 0, "record at least one decision"),
    runEnvironment: RunEnvironmentSchema.optional(),
  })
  .strict();
export type TechArchitecture = z.infer<typeof TechArchitectureSchema>;

export const FEATURE_SIZES = ["XS", "S", "M"] as const;
export const FeatureSchema = z
  .object({
    id: z.string().regex(/^F[1-9]$/, "Feature ids are F1 to F9"),
    storyId: text,
    title: soft(100),
    summary: soft(400),
    scope: z.object({ modules: z.array(soft(120)).min(1).max(6), files: z.array(text).min(1, "name the files expected to change").max(8), notTouch: z.array(soft(200)).max(6) }).strict(),
    interfaces: upTo(soft(300), 8),
    tests: z.object({ files: z.array(text).min(1, "name the test files").max(4), command: z.array(text).min(1, "give the command that runs these tests") }).strict(),
    size: z.enum(FEATURE_SIZES, "size is XS, S or M; a larger Feature is split"),
    dependsOn: z.array(z.string()).max(4),
    /** Ids of the story's acceptance checks this Feature serves. */
    servesChecks: z.array(z.string()).max(6),
  })
  .strict();
export type Feature = z.infer<typeof FeatureSchema>;
export const MAX_FEATURES = 4;
/** Planned non-test files per size. */
export const SIZE_FILES: Record<(typeof FEATURE_SIZES)[number], number> = { XS: 1, S: 2, M: 5 };
export const FeatureBreakdownSchema = z.object({ decisionVersion: z.number().int().positive(), features: z.array(FeatureSchema).min(1).max(MAX_FEATURES) }).strict();
export type FeatureBreakdown = z.infer<typeof FeatureBreakdownSchema>;

export const RUBRIC = ["verticalSlice", "independent", "testable", "small", "inScope"] as const;
export const FeatureGradeSchema = z
  .object({ featureId: text, ...Object.fromEntries(RUBRIC.map((k) => [k, z.enum(["pass", "concern"])])), note: z.string().transform((x) => x.slice(0, 300)).default("") } as Record<string, z.ZodTypeAny>)
  .strict();
export type FeatureGrade = { featureId: string; note: string } & Record<(typeof RUBRIC)[number], "pass" | "concern">;

export const TechDesignSchema = z
  .object({
    decisionVersion: z.number().int().positive(),
    architecture: TechArchitectureSchema,
    breakdown: FeatureBreakdownSchema,
    /** Acceptance checks refined in the technical design (R19.16), replacing the story's checks. */
    checks: z.array(z.object({ storyId: text, checks: z.array(AcceptanceCheckSchema).max(6), reason: soft(400) }).strict()).default([]),
    review: z.array(z.object({ featureId: text, fits: z.enum(["yes", "doubt"]), sizeRight: z.boolean(), missing: z.string().max(400).optional() }).strict()),
    grades: z.array(FeatureGradeSchema),
    reviewerNote: z.string().max(800),
    label: z.literal("LLM assessment, not a guarantee"),
  })
  .strict();
export type TechDesign = Omit<z.infer<typeof TechDesignSchema>, "grades"> & { grades: FeatureGrade[] };

/**
 * The guaranteed checks of a Feature breakdown against the confirmed plan (R19.14). Every problem names its
 * Feature or story. Order rule: a Feature depends only on Features listed before it.
 */
export function checkBreakdown(input: unknown, backlog: ProductBacklog): { ok: true; breakdown: FeatureBreakdown } | { ok: false; problems: string[] } {
  const raw = (input ?? {}) as { features?: unknown[] };
  const problems: string[] = [];
  const features: Feature[] = [];
  const list = Array.isArray(raw.features) ? raw.features : [];
  if (list.length === 0) problems.push("the breakdown has no Feature");
  if (list.length > MAX_FEATURES) problems.push(`at most ${MAX_FEATURES} Features in the sprint (got ${list.length}); merge or move work to a later sprint`);
  const stories = new Map(backlog.stories.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const [i, f] of list.entries()) {
    const id = (f as { id?: string })?.id ?? `#${i + 1}`;
    const r = FeatureSchema.safeParse(f);
    if (!r.success) {
      for (const issue of r.error.issues) problems.push(`Feature ${id}: ${issue.path.join(".")} ${issue.message}`);
      seen.add(id);
      continue;
    }
    const x = r.data;
    if (seen.has(x.id)) problems.push(`Feature ${x.id}: the id is used twice`);
    if (!stories.has(x.storyId)) problems.push(`Feature ${x.id}: story ${x.storyId} is not in the confirmed plan`);
    for (const d of x.dependsOn) if (!seen.has(d)) problems.push(`Feature ${x.id}: depends on ${d}, which is not listed before it`);
    // Size by planned non-test files (skill feature-breakdown): XS 1, S up to 2, M up to 5; found by the skill
    // validation of 2026-11-23, where Features marked S or M listed 5 to 8 files.
    const code = x.scope.files.filter((f) => !x.tests.files.includes(f));
    const cap = SIZE_FILES[x.size];
    if (code.length > cap) problems.push(`Feature ${x.id}: size ${x.size} allows ${cap} non-test file${cap === 1 ? "" : "s"} but ${code.length} are planned; ${x.size === "M" ? "split it" : "raise the size or split it"}`);
    const checks = new Set((stories.get(x.storyId)?.featureContract.acceptanceChecks ?? []).map((c) => c.id));
    for (const c of x.servesChecks) if (!checks.has(c)) problems.push(`Feature ${x.id}: check ${c} is not an acceptance check of story ${x.storyId}`);
    seen.add(x.id);
    features.push(x);
  }
  for (const s of backlog.stories) {
    const n = features.filter((f) => f.storyId === s.id).length;
    const failed = list.some((f) => (f as { storyId?: string })?.storyId === s.id) && n === 0;
    if (n === 0 && !failed) problems.push(`story ${s.id}: no Feature`);
    if (n > 3) problems.push(`story ${s.id}: ${n} Features; at most 3 per story`);
    for (const c of s.featureContract.acceptanceChecks) if (!features.some((f) => f.storyId === s.id && f.servesChecks.includes(c.id)) && n > 0) problems.push(`story ${s.id}: acceptance check ${c.id} is served by no Feature`);
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, breakdown: { decisionVersion: backlog.decisionVersion, features } };
}

/** The Task_Board: one item per Feature in dependency order (R20.8). */
export function featureTaskBoard(b: FeatureBreakdown) {
  return { decisionVersion: b.decisionVersion, items: b.features.map((f) => ({ id: f.id, storyId: f.storyId, title: f.title, status: "to_do" as const })) };
}

/** Files changed outside a Feature's planned files and tests: the list the Reviewer must justify (design: Feature). */
export function unplannedChanges(feature: Pick<Feature, "scope" | "tests">, changed: string[]): string[] {
  const planned = new Set([...feature.scope.files, ...feature.tests.files]);
  return changed.filter((p) => !planned.has(p));
}

/**
 * A file the Test_Agent may write (R40.20): a test file named in the Feature, or a path whose name or directory marks
 * it as a test (`test_*`, `*_test.*`, `*.test.*`, `*.spec.*`, `conftest.py`, a `tests/` or `test/` directory).
 */
export function isTestPath(feature: Pick<Feature, "tests">, path: string): boolean {
  if (feature.tests.files.includes(path)) return true;
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";
  if (parts.slice(0, -1).some((d) => d === "tests" || d === "test" || d === "__tests__")) return true;
  return /^test_.+\.\w+$/.test(name) || /_test\.\w+$/.test(name) || /\.(test|spec)\.\w+$/.test(name) || name === "conftest.py";
}

// ---- acceptance checks against the code (R19.16) ----

export const RefinedChecksSchema = z.array(z.object({ storyId: text, checks: z.array(AcceptanceCheckSchema).max(6), reason: soft(400) }).strict());
export type RefinedChecks = z.infer<typeof RefinedChecksSchema>;

/** The backlog with the refined checks in place of the stories' checks. */
export function withRefinedChecks<T extends Pick<Plan, "backlog">>(plan: T, refined: RefinedChecks): T {
  if (!refined.length) return plan;
  return {
    ...plan,
    backlog: { ...plan.backlog, stories: plan.backlog.stories.map((s) => { const r = refined.find((x) => x.storyId === s.id); return r ? { ...s, featureContract: { ...s.featureContract, acceptanceChecks: r.checks } } : s; }) },
  };
}

const words = (argv: string[]) => (argv.length === 1 && /\s/.test(argv[0]!.trim()) ? argv[0]!.trim().split(/\s+/) : argv);

/**
 * The repository paths a test command names, or null when the command is not a recognized test runner. Django
 * `manage.py test a.b.c` labels become `a/b/c.py` (or the directory `a/b/c/`); pytest arguments are paths.
 */
export function testTargets(command: string[]): string[] | null {
  const w = words(command);
  const t = w.indexOf("test");
  if (w.some((x) => x.endsWith("manage.py")) && t >= 0)
    return w.slice(t + 1).filter((x) => !x.startsWith("-")).map((l) => l.split(".").join("/"));
  const p = w.findIndex((x) => x === "pytest" || x.endsWith("/pytest"));
  if (p >= 0) return w.slice(p + 1).filter((x) => !x.startsWith("-")).map((x) => x.split("::")[0]!.replace(/\/+$/, ""));
  return null;
}

/** Test checks whose targets exist neither in the repository nor among the Features' planned test files. */
export function missingTestTargets(checks: AcceptanceCheckSpec[], repoFiles: Iterable<string>, plannedTests: Iterable<string>): { checkId: string; target: string }[] {
  const files = new Set([...repoFiles, ...plannedTests]);
  const exists = (t: string) => files.has(t) || files.has(`${t}.py`) || [...files].some((f) => f.startsWith(`${t}/`));
  const out: { checkId: string; target: string }[] = [];
  for (const c of checks) {
    if (c.kind !== "test_suite") continue;
    for (const t of testTargets(c.command) ?? []) if (!exists(t)) out.push({ checkId: c.id, target: t });
  }
  return out;
}
