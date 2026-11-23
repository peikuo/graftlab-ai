// Proposal_Board, speaker choice and display text (tasks.md 6.9; R11.1, R11.11-R11.13, R24.5).
import { stripIds } from "@graftlab/shared";
import { describe, expect, it } from "vitest";
import { filesFrom } from "../evidence/check.ts";
import { Board, pickNext } from "./board.ts";

const files = filesFrom(new Map([["docs/auto-tagging.md", "Rule matching only works based on the URL, not on the content.\n"], ["app/models.py", "class Bookmark(models.Model):\n"]]));
const quote = { path: "docs/auto-tagging.md", snippet: "Rule matching only works based on the URL" };

describe("Board", () => {
  it("adds a proposal with the adder's stance, checks quotes into the pool and writes plain lines", () => {
    const b = new Board(files);
    const r = b.apply("user_value", [{ kind: "add", title: "Tag suggestions from page content", userChange: "New bookmarks get suggested tags.", purpose: "B", evidence: [quote], reason: "Users tag by hand today" }]);
    expect(r.errors).toEqual([]);
    expect(r.lines).toEqual(["Proposed “Tag suggestions from page content”"]);
    expect(r.added).toMatchObject([{ id: "E1", status: "passed", addedBy: "user_value" }]);
    const [p] = b.snapshot();
    expect(p).toMatchObject({ id: "P1", purpose: "B", evidenceStatus: "passed", stances: { user_value: { stance: "support", evidenceStatus: "passed" } } });
  });
  it("takes stances by id or title, reuses pool ids, and marks a stance without a passed quote Unverified", () => {
    const b = new Board(files);
    b.apply("user_value", [{ kind: "add", title: "Tag suggestions", userChange: "x", purpose: "B", evidence: [quote] }]);
    const r = b.apply("risk", [
      { kind: "stance", proposal: "tag suggestions", stance: "conditional", reason: "Page text leaves the server", conditions: "the user turns it on", evidence: [{ id: "e1" }] },
      { kind: "stance", proposal: "P9", stance: "support", reason: "x", evidence: [] },
    ]);
    expect(r.lines).toEqual(["Supports “Tag suggestions” only if the user turns it on: Page text leaves the server"]);
    expect(r.errors).toEqual(["no proposal “P9” on the board"]);
    b.apply("feasibility", [{ kind: "stance", proposal: "P1", stance: "against", reason: "No hook", evidence: [{ path: "app/models.py", snippet: "def save_hook(self):" }] }]);
    expect(b.snapshot()[0]!.stances.feasibility).toMatchObject({ stance: "against", evidenceStatus: "unverified", evidence: [{ reason: "snippet_absent" }] });
    expect(b.complete()).toBe(true);
  });
  it("only perspectives add or take stances, only the Facilitator merges; a merge keeps stances and evidence", () => {
    const b = new Board(files);
    expect(b.apply("facilitator", [{ kind: "add", title: "X", userChange: "x", purpose: "A", evidence: [] }]).errors).toEqual(["only a perspective can add a proposal"]);
    b.apply("user_value", [{ kind: "add", title: "Auto tags", userChange: "x", purpose: "B", evidence: [quote] }]);
    b.apply("risk", [{ kind: "add", title: "AI tagging", userChange: "y", purpose: "B", evidence: [], stance: "conditional", reason: "privacy", conditions: "opt-in" }]);
    expect(b.apply("risk", [{ kind: "merge", keep: "P1", drop: "P2" }]).errors).toEqual(["only the Facilitator can merge proposals"]);
    expect(b.apply("facilitator", [{ kind: "merge", keep: "P1", drop: "P2" }]).lines).toEqual(["Merged “AI tagging” into “Auto tags”"]);
    expect(b.snapshot()).toHaveLength(1);
    expect(b.snapshot()[0]!.stances).toMatchObject({ user_value: { stance: "support" }, risk: { stance: "conditional", conditions: "opt-in" } });
    expect(b.missing()).toEqual({ user_value: [], feasibility: ["P1"], risk: [] });
  });
  it("refuses a second proposal with the same title", () => {
    const b = new Board(files);
    b.apply("user_value", [{ kind: "add", title: "Auto tags", userChange: "x", purpose: "B", evidence: [] }]);
    expect(b.apply("risk", [{ kind: "add", title: "auto tags!", userChange: "y", purpose: "B", evidence: [] }]).errors[0]).toMatch(/exists \(P1\)/);
  });
});

describe("pickNext (R11.1)", () => {
  const none = { user_value: [], feasibility: [], risk: [] };
  it("the addressed role first, then disagree before answer before add before agree, never the previous speaker", () => {
    expect(pickNext({ signals: [{ roleId: "risk", speak: true, kind: "disagree" }], last: null, addressed: "feasibility", missing: none }).next).toBe("feasibility");
    expect(pickNext({ signals: [{ roleId: "user_value", speak: true, kind: "agree" }, { roleId: "risk", speak: true, kind: "disagree" }], last: "feasibility", addressed: null, missing: none })).toEqual({ next: "risk", reason: "a disagreement goes first" });
    expect(pickNext({ signals: [{ roleId: "risk", speak: true, kind: "disagree" }], last: "risk", addressed: null, missing: none }).next).toBe(null);
  });
  it("when nobody wants to speak, names the role that still lacks stances; else ends", () => {
    expect(pickNext({ signals: [], last: "risk", addressed: null, missing: { user_value: [], feasibility: ["P1", "P2"], risk: ["P1"] } })).toEqual({ next: "feasibility", reason: "the board still needs its view" });
    expect(pickNext({ signals: [{ roleId: "risk", speak: false }], last: "user_value", addressed: null, missing: none }).next).toBe(null);
  });
});

describe("Facilitator verdicts (R11.14)", () => {
  it("only the Facilitator decides; recommend needs a quote found in the code; text is cleaned of ids", () => {
    const b = new Board(files);
    b.apply("user_value", [{ kind: "add", title: "Tags", userChange: "x", purpose: "B", evidence: [quote] }]);
    b.apply("risk", [{ kind: "add", title: "Bulk retag", userChange: "y", purpose: "A", evidence: [{ path: "app/models.py", snippet: "def retag_all(self):" }] }]);
    expect(b.apply("risk", [{ kind: "decide", proposal: "P1", verdict: "recommend", reason: "x" }]).errors).toEqual(["only the Facilitator gives verdicts"]);
    expect(b.apply("facilitator", [{ kind: "decide", proposal: "P2", verdict: "recommend", reason: "x" }]).errors[0]).toMatch(/cannot be recommended: no quote from the code/);
    const r = b.apply("facilitator", [
      { kind: "decide", proposal: "P1", verdict: "recommend", rank: 1, reason: "All support it (E1)", conditions: ["off by default [E1]"] },
      { kind: "decide", proposal: "Bulk retag", verdict: "park", reason: "Depends on how much undo you want" },
    ]);
    expect(r.lines).toEqual(["Recommends “Tags” as number 1, only if off by default: All support it", "Leaves “Bulk retag” for you to decide: Depends on how much undo you want"]);
    expect(b.snapshot()[0]!.verdict).toEqual({ verdict: "recommend", rank: 1, reason: "All support it", conditions: ["off by default"] });
    expect(b.undecided()).toEqual([]);
    b.apply("feasibility", [{ kind: "stance", proposal: "P1", stance: "against", reason: "changed (P2)", evidence: [] }]);
    expect(b.undecided()).toEqual(["P1"]);
    expect(b.snapshot()[0]!.stances.feasibility!.reason).toBe("changed");
  });
});

describe("readability limits (R11.13)", () => {
  it("cuts long reasons at a word boundary and caps the board at 5 proposals", () => {
    const b = new Board(files);
    const long = "word ".repeat(80).trim();
    const r = b.apply("risk", [{ kind: "add", title: "One", userChange: "x", purpose: "A", evidence: [], reason: long }]);
    const reason = b.snapshot()[0]!.stances.risk!.reason;
    expect(reason.length).toBeLessThanOrEqual(181);
    expect(reason.endsWith("word…")).toBe(true);
    expect(r.lines[0]).toBe("Proposed “One”");
    for (const t of ["Two", "Three", "Four", "Five"]) b.apply("risk", [{ kind: "add", title: t, userChange: "x", purpose: "A", evidence: [] }]);
    expect(b.apply("risk", [{ kind: "add", title: "Six", userChange: "x", purpose: "A", evidence: [] }]).errors[0]).toMatch(/already has 5 proposals/);
  });
  it("once every view exists, only a disagreement or an answer continues", () => {
    const none = { user_value: [], feasibility: [], risk: [] };
    expect(pickNext({ signals: [{ roleId: "risk", speak: true, kind: "add" }, { roleId: "user_value", speak: true, kind: "agree" }], last: null, addressed: null, missing: none }).next).toBe(null);
    expect(pickNext({ signals: [{ roleId: "risk", speak: true, kind: "answer" }], last: null, addressed: null, missing: none }).next).toBe("risk");
  });
});

describe("stripIds (R11.13)", () => {
  it("removes internal ids from what the Judge reads", () => {
    expect(stripIds("The docs say matching is URL-only [E3], so content tags help (E1, E2). See E4.")).toEqual({ text: "The docs say matching is URL-only, so content tags help.", removed: 3 });
    expect(stripIds("I disagree with P2 here.").text).toBe("I disagree with here.");
    expect(stripIds("Plain words only.")).toEqual({ text: "Plain words only.", removed: 0 });
  });
});
