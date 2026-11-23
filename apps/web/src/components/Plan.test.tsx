// @vitest-environment jsdom
// The plan review card content and the Output_Docs list (tasks.md 13.6; R19.11, R20.8, R20.10), with a plan the
// roles produced on the linkding Decision_Doc (2026-11-23).
import { cleanup, render, screen } from "@testing-library/react";
import { initialUiState, type UiState } from "@graftlab/shared";
import { afterEach, describe, expect, it } from "vitest";
import plan from "../fixtures/plan.json";
import { DocsList, parsePlan, PlanStories } from "./Plan.tsx";

afterEach(cleanup);
describe("plan view", () => {
  it("shows the sprint goal, each story in feature words with its demo point and effort", () => {
    const p = parsePlan(plan)!;
    expect(p).not.toBeNull();
    render(<PlanStories plan={p} />);
    expect(screen.getByText(/Sprint goal:/)).toBeTruthy();
    expect(screen.getAllByText(/You will see:/)).toHaveLength(p.backlog.stories.length);
    expect(screen.getByText("effort small")).toBeTruthy();
    expect(screen.getAllByText(/LLM assessment, not a guarantee/).length).toBeGreaterThan(0);
  });

  it("marks a document of an older Decision_Doc version", () => {
    const state: UiState = {
      ...initialUiState,
      decisionDocs: [
        { version: 1, hash: "a", frozen: true },
        { version: 2, hash: "b", frozen: true },
      ],
      outputDocs: {
        product_backlog: { kind: "product_backlog", decisionVersion: 1, ref: "docs/PRODUCT_BACKLOG.md", content: (plan as { backlog: unknown }).backlog, seq: 1 },
        definition_of_done: { kind: "definition_of_done", decisionVersion: 2, ref: "docs/DEFINITION_OF_DONE.md", content: { checklist: ["checks pass"] }, seq: 2 },
      },
    };
    render(<DocsList state={state} />);
    expect(screen.getAllByText("based on an older version")).toHaveLength(1);
    expect(screen.getByText("Product Backlog")).toBeTruthy();
  });
});
