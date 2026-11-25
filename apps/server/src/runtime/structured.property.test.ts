// Property 17 (design.md, "Correctness Properties"): structured output validation. Stage output schemas accept
// every value built from them and refuse a missing required field, a wrong type or an extra field in a strict
// schema; a truncated model answer is refused and counted exactly once as "LLM output format invalid".
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { AiRuntimeSchema, FeatureSchema, ModelCallSchema, RunEnvironmentSchema } from "@graftlab/shared";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import type { StudioModel } from "../llm/model.ts";
import { runAgentTurn, type Emit } from "./pi.ts";

const word = fc.stringMatching(/^[a-z][a-z0-9_]{0,11}$/);
const line = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.]{0,40}$/).filter((s) => s.trim().length > 0);
const path = fc.stringMatching(/^[a-z]{1,8}\/[a-z_]{1,10}\.py$/);
const modelCall = fc.record({ purpose: line, input: line, answerShape: fc.constant('{"answer": "text"}'), onFailure: line });
const feature = fc.record({
  id: fc.integer({ min: 1, max: 9 }).map((n) => `F${n}`),
  storyId: fc.constant("S1"),
  title: line,
  summary: line,
  scope: fc.record({ modules: fc.array(line, { minLength: 1, maxLength: 3 }), files: fc.array(path, { minLength: 1, maxLength: 3 }), notTouch: fc.array(line, { maxLength: 2 }) }),
  interfaces: fc.array(line, { maxLength: 3 }),
  tests: fc.record({ files: fc.array(path, { minLength: 1, maxLength: 2 }), command: fc.array(word, { minLength: 1, maxLength: 4 }) }),
  size: fc.constantFrom("XS", "S", "M"),
  dependsOn: fc.array(fc.constantFrom("F1", "F2"), { maxLength: 2 }),
  servesChecks: fc.array(fc.constantFrom("c1", "c2"), { maxLength: 2 }),
  detail: fc.record({ usesModel: fc.boolean(), modelCalls: fc.array(modelCall, { maxLength: 2 }), dataChanges: fc.array(line, { maxLength: 2 }), visibleTexts: fc.array(line, { maxLength: 3 }), errors: fc.array(line, { maxLength: 2 }) }),
});
const runEnv = fc.record({
  buildCommands: fc.array(line, { maxLength: 3 }),
  startCommands: fc.array(line, { minLength: 1, maxLength: 3 }),
  port: fc.integer({ min: 1, max: 65535 }),
  healthPath: fc.constantFrom("/health", "/", "/api/health"),
  evidence: fc.array(fc.record({ path, snippet: line }), { maxLength: 2 }),
});
const aiRuntime = fc.record({ source: fc.constantFrom("studio_service", "judge_endpoint", "local"), dataSent: fc.array(line, { maxLength: 4 }), reason: line });
const CASES: { name: string; schema: z.ZodTypeAny; arb: fc.Arbitrary<Record<string, unknown>>; required: string[] }[] = [
  { name: "Feature", schema: FeatureSchema, arb: feature as fc.Arbitrary<Record<string, unknown>>, required: ["id", "storyId", "title", "summary", "scope", "tests", "size"] },
  { name: "model call", schema: ModelCallSchema, arb: modelCall as fc.Arbitrary<Record<string, unknown>>, required: ["purpose", "input", "answerShape", "onFailure"] },
  { name: "run environment", schema: RunEnvironmentSchema, arb: runEnv as fc.Arbitrary<Record<string, unknown>>, required: ["startCommands", "port", "healthPath"] },
  { name: "AI runtime", schema: AiRuntimeSchema, arb: aiRuntime as fc.Arbitrary<Record<string, unknown>>, required: ["source", "reason"] },
];

describe("structured output validation", () => {
  // Feature: graftlab-ai, Property 17: Structured output validation
  it("accepts every value built from a stage schema and refuses a missing field, a wrong type or an extra field", () => {
    for (const c of CASES) {
      fc.assert(
        fc.property(c.arb, fc.constantFrom(...c.required), fc.constantFrom("missing", "wrong_type", "extra"), (value, key, mutation) => {
          expect(c.schema.safeParse(value).success, `${c.name} accepts a valid value`).toBe(true);
          const broken: Record<string, unknown> = { ...value };
          if (mutation === "missing") delete broken[key];
          else if (mutation === "wrong_type") broken[key] = typeof value[key] === "number" ? "not a number" : 12345;
          else broken.unexpectedField = "x";
          const strict = c.name !== "AI runtime"; // AiRuntimeSchema is not strict, so an extra field is allowed there
          if (mutation === "extra" && !strict) return;
          expect(c.schema.safeParse(broken).success, `${c.name} refuses ${mutation} ${key}`).toBe(false);
        }),
        { numRuns: 100 },
      );
    }
  });
  it("a truncated answer is refused and counted exactly once as LLM output format invalid", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 60 }), async (text) => {
        const core = createFauxCore({ api: "faux-p17", provider: "faux-p17", tokensPerSecond: 1_000_000 });
        core.setResponses([fauxAssistantMessage(text, { stopReason: "length" })]);
        const model: StudioModel = { model: core.getModel() as StudioModel["model"], streamFn: core.streamSimple as StudioModel["streamFn"], getApiKey: () => "unused-in-faux" };
        const failures: unknown[] = [];
        const emit: Emit = async (d) => {
          if (d.type === "failure") failures.push(d.payload);
        };
        const r = await runAgentTurn({ roleId: "planner", purpose: "statement", systemPrompt: "rules", prompt: "go", tools: [], model, emit, idPrefix: "p17" });
        expect(r.truncated).toBe(true);
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ failureClass: "llm_output_format_invalid" });
      }),
      { numRuns: 100 },
    );
  }, 60_000);
});
