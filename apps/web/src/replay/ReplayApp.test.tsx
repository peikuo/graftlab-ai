// @vitest-environment jsdom
// Replay smoke test against a real recorded run (tasks.md 9.6; R26.2, R26.4): open, play, seek to the end, check the
// permanent label, the final view from the Verifier and that nothing can be sent. Runs in the normal test run so UI
// polish cannot silently break Replay playback.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioEvent } from "@graftlab/shared";
import { ReplayApp } from "./ReplayApp.tsx";

const root = join(import.meta.dirname, "../../../..");
const events = readFileSync(join(root, "packages/shared/test/fixtures/real-linkding-success.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as StudioEvent);
const taskId = events[0]!.taskId;
const replay = { header: { schemaVersion: 1, taskId, repo: "sissbruecker/linkding", runtimeRulesVersion: "x", createdAt: events.at(-1)!.ts, label: "Replay" }, events };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (url === `/replays/${taskId}.json` ? new Response(JSON.stringify(replay)) : new Response("{}", { status: 404 }))));
  // The artifact area may measure or scroll; jsdom has no layout.
  Element.prototype.scrollIntoView ??= () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Replay smoke test with a real recorded run (9.6)", () => {
  it("plays, seeks to the end and shows the Verifier's result under a permanent Replay label", async () => {
    render(<ReplayApp taskId={taskId} />);
    const bar = await screen.findByRole("group", { name: "Replay controls" });
    expect(within(bar).getByText("REPLAY")).toBeTruthy();
    expect(screen.getByText(/▶ Replay · recorded/)).toBeTruthy();
    // Playing starts at the first event; nothing has a result yet.
    expect(screen.queryByRole("region", { name: "Result" })).toBeNull();
    const seek = screen.getByLabelText("Position") as HTMLInputElement;
    await act(async () => {
      fireEvent.change(seek, { target: { value: seek.max } });
    });
    const result = await screen.findByRole("region", { name: "Result" });
    expect(result.textContent).toMatch(/success/i);
    // The label stays after seeking, and the player offers to play again.
    expect(within(bar).getByText("REPLAY")).toBeTruthy();
    expect(within(bar).getByRole("button", { name: /Again/ })).toBeTruthy();
    // Nothing in a Replay can send a command.
    expect(screen.queryByRole("button", { name: "Stop the Task" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
  });

  it("names a missing Replay instead of showing an empty Workspace", async () => {
    render(<ReplayApp taskId="no-such-task" />);
    expect(await screen.findByText("This Replay does not exist.")).toBeTruthy();
  });
});
