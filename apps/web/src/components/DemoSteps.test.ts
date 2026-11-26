import { describe, expect, it } from "vitest";
import type { StudioEvent } from "@graftlab/shared";
import { demoSteps } from "./DemoSteps.tsx";

const ev = (seq: number, node: string, type: string, payload: unknown) => ({ v: 1, seq, ts: new Date(seq * 1000).toISOString(), taskId: "t", node, actor: { kind: "verifier" }, type, payload }) as unknown as StudioEvent;
const shot = (seq: number, n: number, pass: boolean, node = "story_checkpoint") => ev(seq, node, "artifact_updated", { artifactKind: "screenshot", ref: `artifacts/shots/F1-c2-s${n}.jpg`, title: `Step ${n} of check c2: open /bookmarks/new (${pass ? "passed" : "failed"})` });

describe("demoSteps (R21.11)", () => {
  it("lists the step screenshots of this confirmation point only, in order, with their results", () => {
    const events = [
      ev(1, "story_checkpoint", "node_entered", { from: "story_run", to: "story_checkpoint", edgeId: "run_healthy" }),
      shot(2, 1, true, "verifying"),
      ev(3, "story_checkpoint", "node_entered", { from: "story_run", to: "story_checkpoint", edgeId: "run_healthy" }),
      shot(4, 1, true),
      ev(5, "story_checkpoint", "artifact_updated", { artifactKind: "screenshot", ref: "artifacts/shots/F1-c2.jpg", title: "Browser check c2" }),
      shot(6, 2, false),
      ev(7, "story_checkpoint", "card_opened", { cardId: "card-9", kind: "checkpoint", title: "x", body: "", options: [], allowFreeText: false }),
      shot(8, 3, true),
    ];
    expect(demoSteps(events, "card-9")).toEqual([
      { ref: "artifacts/shots/F1-c2-s1.jpg", label: "1. open /bookmarks/new", pass: true },
      { ref: "artifacts/shots/F1-c2-s2.jpg", label: "2. open /bookmarks/new", pass: false },
    ]);
  });
  it("is empty for other cards", () => {
    expect(demoSteps([ev(1, "plan_review", "card_opened", { cardId: "c", kind: "question", title: "x", body: "", options: [], allowFreeText: true })], "c")).toEqual([]);
  });
});
