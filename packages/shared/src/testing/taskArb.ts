// fast-check arbitrary for TaskState at any node, with random facts (Properties 1 and 2).
import fc from "fast-check";
import { NODE_IDS } from "../flow/ids.ts";
import { NODE_OUTCOMES, type StoryProgress, type TaskState } from "../task.ts";

const story = (i: number): fc.Arbitrary<StoryProgress> =>
  fc.record({
    storyId: fc.constant(`S${i + 1}`),
    kind: fc.constantFrom("source_change" as const, "api_operation" as const),
    purpose: fc.constantFrom("A" as const, "B" as const),
    attempts: fc.integer({ min: 0, max: 4 }),
    status: fc.constantFrom("pending" as const, "in_progress" as const, "verified" as const, "failed" as const, "blocked" as const),
    unconfirmed: fc.boolean(),
    demoCaseRejections: fc.integer({ min: 0, max: 3 }),
    suggestionConfirmed: fc.boolean(),
  });

export const storiesArb: fc.Arbitrary<StoryProgress[]> = fc
  .integer({ min: 0, max: 4 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => story(i))));

export const taskStateArb: fc.Arbitrary<TaskState> = fc
  .record({
    node: fc.constantFrom(...NODE_IDS),
    outcome: fc.option(fc.constantFrom(...NODE_OUTCOMES), { nil: undefined }),
    repoKind: fc.constantFrom("adapted" as const, "other" as const),
    frozenVersion: fc.option(fc.integer({ min: 1, max: 3 }), { nil: null }),
    review: fc.option(
      fc
        .record({ total: fc.integer({ min: 0, max: 7 }), a: fc.nat({ max: 7 }), r: fc.nat({ max: 7 }), approachComplete: fc.boolean() })
        .map(({ total, a, r, approachComplete }) => {
          const accepted = Math.min(a, total);
          return { total, accepted, rejected: Math.min(r, total - accepted), approachComplete };
        }),
      { nil: undefined },
    ),
    backlogValid: fc.boolean(),
    docsComplete: fc.boolean(),
    stories: storiesArb,
    currentIndex: fc.nat({ max: 4 }),
    targetCheckPassed: fc.boolean(),
    partial: fc.boolean(),
    prototypeEnabled: fc.boolean(),
    // Half of the states satisfy every execution prerequisite, so story and API edges are exercised.
    consistent: fc.boolean(),
  })
  .map((r) =>
    r.consistent
      ? { ...r, repoKind: "adapted" as const, frozenVersion: r.frozenVersion ?? 1, backlogValid: true, docsComplete: true, targetCheckPassed: true }
      : r,
  )
  .map((r) => {
    const t: TaskState = {
      taskId: "t1",
      url: "https://github.com/o/r",
      owner: "o",
      repo: "r",
      repoKind: r.repoKind,
      node: r.node,
      runtimeRulesVersion: "0.1.0",
      frozenVersion: r.frozenVersion,
      backlogValid: r.backlogValid,
      docsComplete: r.docsComplete,
      stories: r.stories,
      pendingUnconfirmed: [],
      failuresByClass: {},
      gathering: { partial: r.partial, queuedJudgeMessages: [] },
      targetCheckPassed: r.targetCheckPassed,
      flags: { prototypeEnabled: r.prototypeEnabled, judgeLlm: false },
      limits: { storyAttempts: 3, demoCaseRetries: 1 },
      startedAt: "2026-11-22T10:00:00.000Z",
      deadlineAt: "2026-11-22T11:30:00.000Z",
    };
    if (r.outcome !== undefined) t.outcome = r.outcome;
    if (r.review !== undefined) t.review = r.review;
    const cur = r.stories[r.currentIndex];
    if (cur) t.currentStoryId = cur.storyId;
    return t;
  });
