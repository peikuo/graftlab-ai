// The decision review desk (design.md, "Decision step"; R5.7, R15.3, R15.4, R15.6, R15.11, R16, R37.4, R37.5).
// Code enforces every rule here: a verdict must name the current item hash, a rejection needs a reason, only a
// complete option can be chosen, send back needs a verdict on every item and one rejection, freeze needs every
// item accepted and one complete option. Freezing creates the next immutable version with its content hash.
import type { DecisionDocContent, DecisionReview, PayloadOf, ReviewItemData } from "@graftlab/shared";
import { contentHash } from "./hash.ts";

export interface Verdict {
  itemHash: string;
  verdict: "accept" | "reject";
  reason?: string;
}
type DeskEvent =
  | { type: "decision_item_reviewed"; payload: PayloadOf<"decision_item_reviewed"> }
  | { type: "decision_approach_selected"; payload: PayloadOf<"decision_approach_selected"> }
  | { type: "decision_doc_version"; payload: PayloadOf<"decision_doc_version"> }
  | { type: "decision_doc_frozen"; payload: PayloadOf<"decision_doc_frozen"> };
export type DeskOutcome = { kind: "send_back"; rejections: { itemId: string; title: string; reason: string }[] } | { kind: "confirmed"; version: number; hash: string; content: DecisionDocContent } | { kind: "judge_end" };
export type DeskResult = { ok: true } | { ok: false; status: number; error: string };

export interface DeskOptions {
  draftId: string;
  content: DecisionDocContent;
  items: ReviewItemData[];
  /** Verdicts from earlier drafts, by item id; only those whose hash matches the current item count. */
  verdicts: Map<string, Verdict>;
  /** The approach chosen on an earlier draft; kept when that option is still there and complete. */
  selected?: string | null;
  /** Number of the version a freeze creates (previous frozen versions + 1). */
  nextVersion: number;
  emit: (e: DeskEvent) => Promise<void>;
  now?: () => Date;
}

export class DecisionDesk {
  #o: DeskOptions;
  #selected: string | null = null;
  #done = false;
  #resolve!: (o: DeskOutcome) => void;
  readonly outcome: Promise<DeskOutcome>;
  constructor(o: DeskOptions) {
    this.#o = o;
    if (o.selected && this.#option(o.selected)?.assessment.complete) this.#selected = o.selected;
    this.outcome = new Promise((r) => (this.#resolve = r));
  }
  get draftId(): string {
    return this.#o.draftId;
  }
  get verdicts(): Map<string, Verdict> {
    return this.#o.verdicts;
  }
  get selected(): string | null {
    return this.#selected;
  }
  #current(itemId: string): Verdict | undefined {
    const item = this.#o.items.find((i) => i.id === itemId);
    const v = this.#o.verdicts.get(itemId);
    return item && v && v.itemHash === item.hash ? v : undefined;
  }
  #option(id: string | null) {
    return id ? this.#o.content.approachOptions.find((x) => x.id === id) : undefined;
  }
  /** The facts the Flow_Graph guards read (TaskState.review). */
  review(): DecisionReview {
    const vs = this.#o.items.map((i) => this.#current(i.id));
    return {
      total: this.#o.items.length,
      accepted: vs.filter((v) => v?.verdict === "accept").length,
      rejected: vs.filter((v) => v?.verdict === "reject").length,
      approachComplete: this.#option(this.#selected)?.assessment.complete === true,
    };
  }
  #stale(draftId: string): DeskResult | null {
    if (this.#done) return { ok: false, status: 409, error: "this draft is closed" };
    if (draftId !== this.#o.draftId) return { ok: false, status: 409, error: "this is not the current draft" };
    return null;
  }
  async reviewItem(draftId: string, itemId: string, itemHash: string, verdict: "accept" | "reject", reason?: string): Promise<DeskResult> {
    const stale = this.#stale(draftId);
    if (stale) return stale;
    const item = this.#o.items.find((i) => i.id === itemId);
    if (!item) return { ok: false, status: 404, error: "no such item" };
    if (item.hash !== itemHash) return { ok: false, status: 409, error: "the item changed; reload the draft" };
    const why = reason?.trim() ?? "";
    if (verdict === "reject" && !why) return { ok: false, status: 400, error: "a rejection needs a reason" };
    // Accepting the approach item needs a complete option chosen first (R15.11).
    if (verdict === "accept" && item.options && !this.review().approachComplete) return { ok: false, status: 409, error: "choose an approach that has an acceptance check first" };
    this.#o.verdicts.set(itemId, { itemHash, verdict, ...(verdict === "reject" ? { reason: why } : {}) });
    await this.#o.emit({ type: "decision_item_reviewed", payload: { draftId, itemId, itemHash, verdict, ...(verdict === "reject" ? { reason: why } : {}) } });
    return { ok: true };
  }
  async select(draftId: string, optionId: string): Promise<DeskResult> {
    const stale = this.#stale(draftId);
    if (stale) return stale;
    const op = this.#option(optionId);
    if (!op) return { ok: false, status: 404, error: "no such approach option" };
    // R37.5, Property 10: an option without an executable Acceptance_Check cannot be chosen.
    if (!op.assessment.complete) return { ok: false, status: 409, error: "this option has no acceptance check, so it cannot be chosen" };
    // A different choice needs a new look at the approach item; the same choice changes nothing.
    const approach = this.#o.items.find((i) => i.options);
    if (optionId !== this.#selected && approach && this.#o.verdicts.get(approach.id)?.verdict === "accept") this.#o.verdicts.delete(approach.id);
    this.#selected = optionId;
    await this.#o.emit({ type: "decision_approach_selected", payload: { draftId, optionId } });
    return { ok: true };
  }
  async sendBack(draftId: string): Promise<DeskResult> {
    const stale = this.#stale(draftId);
    if (stale) return stale;
    const r = this.review();
    if (r.accepted + r.rejected !== r.total || r.rejected === 0) return { ok: false, status: 409, error: "every item needs a verdict and at least one must be rejected" };
    this.#done = true;
    const rejections = this.#o.items.flatMap((i) => {
      const v = this.#current(i.id);
      return v?.verdict === "reject" ? [{ itemId: i.id, title: i.title, reason: v.reason ?? "" }] : [];
    });
    this.#resolve({ kind: "send_back", rejections });
    return { ok: true };
  }
  async freeze(draftId: string, confirmedBy: string): Promise<DeskResult> {
    const stale = this.#stale(draftId);
    if (stale) return stale;
    const r = this.review();
    if (r.accepted !== r.total || !r.approachComplete) return { ok: false, status: 409, error: "every item must be accepted and one approach with an acceptance check chosen" };
    const op = this.#option(this.#selected)!;
    // The frozen content: the chosen option and its checks; the hash covers the content only (R16.5).
    const content: DecisionDocContent = { ...this.#o.content, chosenApproachIds: [op.id], executableAcceptanceChecks: op.assessment.acceptanceChecks };
    const hash = contentHash(content);
    const version = this.#o.nextVersion;
    this.#done = true;
    await this.#o.emit({ type: "decision_doc_version", payload: { version, content, hash } });
    await this.#o.emit({ type: "decision_doc_frozen", payload: { version, hash, confirmedBy, confirmedAt: (this.#o.now?.() ?? new Date()).toISOString() } });
    this.#resolve({ kind: "confirmed", version, hash, content });
    return { ok: true };
  }
  end(): DeskResult {
    if (this.#done) return { ok: false, status: 409, error: "this draft is closed" };
    this.#done = true;
    this.#resolve({ kind: "judge_end" });
    return { ok: true };
  }
}
