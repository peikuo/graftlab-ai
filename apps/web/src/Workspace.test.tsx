// @vitest-environment jsdom
// UI example tests for the Workspace skeleton (tasks.md 3.14; R1.3, R4.7, R4.8, R5.4, R8.1, R8.2, R8.4).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { foldEvents, type StudioEvent } from "@graftlab/shared";
import { ArtifactArea } from "./components/Artifacts.tsx";
import { ActivityFeed } from "./components/Feed.tsx";
import { PresenceColumn, visibleCards } from "./components/Presence.tsx";
import { ROLE_CARDS } from "./roles.ts";

afterEach(cleanup);

const root = join(import.meta.dirname, "../../..");
// The synthetic fixture as persisted events (seq and ts assigned like the event store does).
const lines = readFileSync(join(root, "packages/shared/test/fixtures/synthetic-gathering-meeting.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const t0 = Date.UTC(2026, 10, 22, 10, 0, 0);
const events: StudioEvent[] = lines
  .filter((l) => l.event)
  .map((l, i) => ({ v: 1, seq: i + 1, ts: new Date(t0 + l.at).toISOString(), taskId: "t1", ...l.event }) as StudioEvent);
const state = foldEvents(events);
const end = Date.parse(events.at(-1)!.ts) + 1000;

function Workspace() {
  return (
    <main>
      <PresenceColumn state={state} now={end} />
      <ActivityFeed state={state} events={events} buffers={{}} onAnswer={async () => ({ ok: true })} />
      <ArtifactArea state={state} events={events} />
    </main>
  );
}

describe("Workspace skeleton", () => {
  it("shows all areas", () => {
    render(<Workspace />);
    expect(screen.getByRole("region", { name: "Team" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Activity" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Details" })).toBeTruthy();
  });

  it("every Presence_Card has an avatar, a name and a status in text, not color alone", () => {
    render(<Workspace />);
    const team = screen.getByRole("region", { name: "Team" });
    const cards = within(team).getAllByRole("listitem").filter((li) => li.classList.contains("agent"));
    expect(cards).toHaveLength(visibleCards(state).length);
    for (const c of cards) {
      expect(c.getAttribute("aria-label")).toMatch(/^.+: .+$/);
      expect(c.querySelector(".agent-status")?.textContent?.trim().length).toBeGreaterThan(0);
    }
  });

  it("shows an agent only after its first event, and the meeting group when the meeting starts (R1.2, R1.9)", () => {
    render(<Workspace />);
    const team = screen.getByRole("region", { name: "Team" });
    const shown = new Set(within(team).getAllByRole("listitem").filter((li) => li.classList.contains("agent")).map((li) => li.getAttribute("aria-label")!.split(":")[0]));
    for (const c of ROLE_CARDS) {
      const started = state.lastEventByActor[c.key] !== undefined;
      if (c.group === "meeting") expect(shown.has(c.name)).toBe(state.visitedNodes.includes("meeting") || started);
      else expect(shown.has(c.name)).toBe(started);
    }
    expect(shown.has("Verifier")).toBe(false); // no Verifier event in the fixture
    expect(shown.has("Code_Agent")).toBe(false);
  });

  it("shows nothing but the timeline before the first event", () => {
    const empty = foldEvents([]);
    render(
      <main>
        <PresenceColumn state={empty} now={end} />
        <ActivityFeed state={empty} events={[]} buffers={{}} onAnswer={async () => ({ ok: true })} />
        <ArtifactArea state={empty} events={[]} />
      </main>,
    );
    expect(screen.queryByRole("region", { name: "Team" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Details" })).toBeNull();
    expect(screen.queryByText("Engineering_Details")).toBeNull();
    expect(screen.getByRole("region", { name: "Activity" })).toBeTruthy();
  });

  it("keeps Engineering_Details closed until the Judge opens it", () => {
    render(<Workspace />);
    const details = screen.getByText("Engineering_Details").closest("details")!;
    expect(details.open).toBe(false);
    expect(within(details).queryByText(/sandbox_start/)).toBeNull();
    fireEvent.click(screen.getByText("Engineering_Details"));
    expect(details.open).toBe(true);
  });

  it("question cards contain no file names, paths or diffs", () => {
    render(<Workspace />);
    const cards = document.querySelectorAll(".icard");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.textContent).not.toMatch(/[\w-]+\/[\w./-]+|\.py\b|\.ts\b|^[+-]{3} /m);
  });

  it("cards are operable by keyboard: options are buttons and the free text has a label", () => {
    render(<Workspace />);
    const card = screen.getByRole("group", { name: /asks: Should suggested tags/ });
    const options = within(card).getAllByRole("button");
    expect(options.map((b) => b.textContent)).toEqual(expect.arrayContaining(["After I confirm", "Automatically"]));
    for (const b of options) expect(b.tagName).toBe("BUTTON");
    expect(within(card).getByLabelText("Your own answer")).toBeTruthy();
  });

  it("reasoning is collapsed and labeled model-provided", () => {
    render(<Workspace />);
    const toggle = screen.getByRole("button", { name: /model-provided reasoning/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("failures are shown in the feed with a text marker", () => {
    render(<Workspace />);
    expect(screen.getAllByText(/Failure:/).length).toBeGreaterThan(0);
  });

  it("reduced motion disables non-essential animation", () => {
    const css = readFileSync(join(import.meta.dirname, "styles.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*{[^}]*animation: none !important/);
  });
});
