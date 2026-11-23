// Decision review desk and items (tasks.md 7.4, 7.7; R5.7, R15.3, R15.6, R16).
import { describe, expect, it } from "vitest";
import { DecisionDesk, type Verdict } from "./desk.ts";
import { content } from "./fixtures.ts";
import { contentHash } from "./hash.ts";
import { splitItems } from "./items.ts";

function desk(verdicts = new Map<string, Verdict>(), nextVersion = 1) {
  const c = content();
  const items = splitItems(c);
  const events: { type: string; payload: any }[] = [];
  const d = new DecisionDesk({ draftId: "d1", content: c, items, verdicts, nextVersion, emit: async (e) => void events.push(e), now: () => new Date("2026-11-24T10:00:00Z") });
  return { d, items, events, c };
}

describe("splitItems", () => {
  it("splits a draft into seven items in feature words; an unchanged section keeps its hash", () => {
    const a = splitItems(content());
    expect(a.map((i) => i.id)).toEqual(["purpose", "scope", "approach", "ui", "checks", "risks", "questions"]);
    const b = splitItems(content({ uiImpact: "a different screen change" }));
    expect(b.find((i) => i.id === "ui")!.hash).not.toBe(a.find((i) => i.id === "ui")!.hash);
    expect(b.filter((i) => i.id !== "ui").map((i) => i.hash)).toEqual(a.filter((i) => i.id !== "ui").map((i) => i.hash));
    const approach = a.find((i) => i.id === "approach")!;
    expect(approach.options).toMatchObject([{ id: "src", complete: true, largeRisk: false }, { id: "agent", complete: false, largeRisk: true }]);
    expect(a.find((i) => i.id === "checks")!.details[0]).toBe("Change the save step: Runs the tests: python manage.py test bookmarks.tests.test_ai_tags (at most 600 s)");
  });
});

describe("DecisionDesk", () => {
  it("a rejection needs a reason; a stale hash or draft is refused", async () => {
    const { d, items } = desk();
    expect(await d.reviewItem("d1", "purpose", items[0]!.hash, "reject", "  ")).toMatchObject({ ok: false, status: 400 });
    expect(await d.reviewItem("d1", "purpose", "old-hash", "accept")).toMatchObject({ ok: false, status: 409 });
    expect(await d.reviewItem("d0", "purpose", items[0]!.hash, "accept")).toMatchObject({ ok: false, status: 409 });
  });
  it("the approach item can be accepted only after a complete option is chosen; a new choice resets it", async () => {
    const { d, items } = desk();
    const approach = items.find((i) => i.id === "approach")!;
    expect(await d.reviewItem("d1", "approach", approach.hash, "accept")).toMatchObject({ ok: false, status: 409 });
    expect(await d.select("d1", "agent")).toMatchObject({ ok: false, error: "this option has no acceptance check, so it cannot be chosen" });
    expect(await d.select("d1", "src")).toEqual({ ok: true });
    expect(await d.reviewItem("d1", "approach", approach.hash, "accept")).toEqual({ ok: true });
    await d.select("d1", "src");
    expect(d.review().accepted).toBe(1); // the same choice keeps the verdict
  });
  it("send back only when every item has a verdict and one is rejected; it returns the rejections", async () => {
    const { d, items } = desk();
    await d.select("d1", "src");
    expect(await d.sendBack("d1")).toMatchObject({ ok: false });
    for (const i of items) await d.reviewItem("d1", i.id, i.hash, i.id === "ui" ? "reject" : "accept", i.id === "ui" ? "Show suggestions as chips" : undefined);
    expect(await d.freeze("d1", "s1")).toMatchObject({ ok: false });
    expect(await d.sendBack("d1")).toEqual({ ok: true });
    expect(await d.outcome).toEqual({ kind: "send_back", rejections: [{ itemId: "ui", title: "What changes on screen", reason: "Show suggestions as chips" }] });
    expect(await d.reviewItem("d1", "ui", items[3]!.hash, "accept")).toMatchObject({ ok: false, error: "this draft is closed" });
  });
  it("verdicts on unchanged items carry over to the next draft; changed items are pending", async () => {
    const first = desk();
    await first.d.select("d1", "src");
    for (const i of first.items) await first.d.reviewItem("d1", i.id, i.hash, "accept");
    const next = splitItems(content({ uiImpact: "chips under the tag box" }));
    const d2 = new DecisionDesk({ draftId: "d2", content: content({ uiImpact: "chips under the tag box" }), items: next, verdicts: first.d.verdicts, selected: first.d.selected, nextVersion: 1, emit: async () => {} });
    expect(d2.review()).toMatchObject({ total: 7, accepted: 6, rejected: 0, approachComplete: true }); // only the changed ui item is pending
    await d2.select("d2", "src");
    expect(d2.review().accepted).toBe(6); // choosing the same option again changes nothing
  });
  it("freeze records version, hash over the content with the chosen option and its checks, who and when", async () => {
    const { d, items, events, c } = desk(new Map(), 2);
    await d.select("d1", "src");
    for (const i of items) await d.reviewItem("d1", i.id, i.hash, "accept");
    expect(await d.freeze("d1", "session-7")).toEqual({ ok: true });
    const v = events.find((e) => e.type === "decision_doc_version")!.payload;
    const f = events.find((e) => e.type === "decision_doc_frozen")!.payload;
    expect(v.version).toBe(2);
    expect(v.content.chosenApproachIds).toEqual(["src"]);
    expect(v.content.executableAcceptanceChecks).toEqual(c.approachOptions[0]!.assessment.acceptanceChecks);
    expect(v.hash).toBe(contentHash(v.content));
    expect(f).toEqual({ version: 2, hash: v.hash, confirmedBy: "session-7", confirmedAt: "2026-11-24T10:00:00.000Z" });
    // a frozen draft cannot be changed in place (R15.6)
    expect(await d.select("d1", "src")).toMatchObject({ ok: false, error: "this draft is closed" });
  });
});
