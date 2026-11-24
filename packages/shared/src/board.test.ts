import { describe, expect, it } from "vitest";
import { featureBoard, usageSummary } from "./board.ts";
import type { Actor, StudioEvent } from "./events.ts";
import { foldEvents } from "./reducer.ts";
let seq = 0;
const ev = (type: string, payload: unknown, actor: Actor = { kind: "system" }): StudioEvent =>
  ({ v: 1, seq: ++seq, ts: new Date(Date.UTC(2026, 10, 24, 10, 0, seq)).toISOString(), taskId: "t1", node: "story_develop", actor, type, payload }) as StudioEvent;
const board = { decisionVersion: 1, items: [{ id: "F1", storyId: "S1", title: "Switches" }, { id: "F2", storyId: "S1", title: "Suggested tags" }, { id: "F3", storyId: "S2", title: "Summary" }] };
describe("development whiteboard (R1.10)", () => {
  it("is absent before the first feature_status, then shows every Task_Board Feature by story", () => {
    seq = 0;
    const docs = ev("output_doc", { kind: "task_board", decisionVersion: 1, content: board, ref: "docs/TASK_BOARD.md", markdown: "" });
    expect(featureBoard(foldEvents([docs]))).toBeNull();
    const s = foldEvents([docs, ev("feature_status", { featureId: "F1", storyId: "S1", status: "testing", attempt: 0 })]);
    const b = featureBoard(s)!;
    expect(b.lanes.map((l) => [l.storyId, l.cards.map((c) => `${c.featureId}:${c.status}`)])).toEqual([["S1", ["F1:testing", "F2:todo"]], ["S2", ["F3:todo"]]]);
    expect(b.lanes[0]!.cards[0]!.actor).toBe("test_agent");
  });
  it("counts merged Features, keeps the phase a failed card stopped at, and sizes the change from code_change", () => {
    seq = 0;
    const s = foldEvents([
      ev("output_doc", { kind: "task_board", decisionVersion: 1, content: board, ref: "x", markdown: "" }),
      ev("feature_status", { featureId: "F1", storyId: "S1", status: "merged", attempt: 1 }),
      ev("feature_status", { featureId: "F2", storyId: "S1", status: "verifying", attempt: 2 }),
      ev("code_change", { storyId: "F2", attempt: 2, changedFiles: ["a.py", "b.py"], diffRef: "d", by: "code_agent", files: [{ path: "a.py", status: "modified", added: 10, removed: 2, planned: true }, { path: "b.py", status: "added", added: 5, removed: 0, planned: false }] }, { kind: "code_agent" }),
      ev("verifier_result", { storyId: "F2", checkId: "F2-tests", pass: false, items: [] }, { kind: "verifier" }),
      ev("feature_status", { featureId: "F2", storyId: "S1", status: "failed", attempt: 2, reason: "a Verifier check failed" }),
    ]);
    const b = featureBoard(s)!;
    expect(b.merged).toBe(1);
    expect(b.failed).toBe(1);
    const f2 = b.lanes[0]!.cards[1]!;
    expect(f2).toMatchObject({ status: "failed", reached: "verifying", change: { files: 2, added: 15, removed: 2, unplanned: 1 }, checks: [{ checkId: "F2-tests", pass: false }] });
  });
});
describe("AI usage (R30.19)", () => {
  it("sums tokens per agent and the app's calls, with a cost only when prices were recorded", () => {
    seq = 0;
    const msgs = [
      ev("message_started", { messageId: "m1", purpose: "code_agent_step" }, { kind: "code_agent" }),
      ev("message_completed", { messageId: "m1", text: "", finishReason: "stop", usage: { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 800_000 } }, { kind: "code_agent" }),
      ev("ai_usage", { caller: "app", checkId: "c2", calls: 1, statuses: [200], inputTokens: 200, cachedTokens: 0, outputTokens: 20 }, { kind: "verifier" }),
    ];
    const plain = usageSummary(foldEvents(msgs));
    expect(plain.label).toBe("tokens only, no prices configured");
    expect(plain.rows.find((r) => r.actor === "code_agent")).toMatchObject({ calls: 1, inputTokens: 1_000_000, cachedTokens: 800_000, outputTokens: 100_000 });
    expect(plain.rows.find((r) => r.actor === "app")?.calls).toBe(1);
    expect(plain.total.cost).toBeUndefined();
    const created = ev("task_created", { url: "u", owner: "o", repo: "r", repoKind: "adapted", runtimeRulesVersion: "1", llmPrice: { currency: "CNY", inputPerMTok: 2, cachedInputPerMTok: 0.5, outputPerMTok: 8 } });
    const priced = usageSummary(foldEvents([created, ...msgs.map((m) => ({ ...m, seq: m.seq + 10 }))]));
    expect(priced.label).toBe("estimate from configured prices");
    // (1,000,000 - 800,000) × 2 + 800,000 × 0.5 + 100,000 × 8, per million = 0.4 + 0.4 + 0.8
    expect(priced.rows.find((r) => r.actor === "code_agent")?.cost).toBeCloseTo(1.6, 6);
  });
});
