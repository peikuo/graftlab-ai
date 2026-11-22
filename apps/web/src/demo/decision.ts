// Decision review state for the demo engine (mock data). Verdicts are recorded as decision_item_reviewed events.
import type { Draft, ReviewItem, Verdict } from "../components/DecisionReview.tsx";
import { reviewState } from "../components/DecisionReview.tsx";
import type { DemoEngine } from "./engine.ts";

export class DecisionDesk {
  draft: Draft | null = null;
  verdicts: Record<string, Verdict> = {};
  selected: string | null = null;
  history: string[] = [];
  busy = false;
  #engine: DemoEngine;
  #notify: () => void;

  constructor(engine: DemoEngine, notify: () => void) {
    this.#engine = engine;
    this.#notify = notify;
  }

  setDraft(d: Draft): void {
    this.draft = d;
    this.busy = false;
    this.history.push(`Draft ${d.number} ready`);
    this.#notify();
  }

  select(optionId: string): void {
    this.selected = optionId;
    this.#notify();
  }

  review(item: ReviewItem, verdict: "accept" | "reject", reason?: string): void {
    if (!this.draft) return;
    this.verdicts = { ...this.verdicts, [item.id]: { verdict, itemHash: item.hash, ...(reason ? { reason } : {}) } };
    this.#engine.emit("decision_item_reviewed", { draftId: this.draft.draftId, itemId: item.id, itemHash: item.hash, verdict, ...(reason ? { reason } : {}) }, { kind: "judge" });
    this.history.push(`${verdict === "accept" ? "You accepted" : "You rejected"} "${item.title}"${reason ? `: ${reason}` : ""}`);
    this.#notify();
  }

  state() {
    return this.draft ? reviewState(this.draft, this.verdicts, this.selected) : null;
  }

  sendBack(): void {
    if (!this.state()?.canSendBack) return;
    this.busy = true;
    this.history.push("You sent the draft back");
    this.#notify();
    this.#engine.signal("decision");
  }

  freeze(): void {
    if (!this.state()?.canFreeze) return;
    this.busy = true;
    this.#notify();
    this.#engine.signal("decision");
  }

  rejected(): { item: ReviewItem; reason: string }[] {
    if (!this.draft) return [];
    return this.draft.items.flatMap((i) => {
      const v = this.verdicts[i.id];
      return v && v.itemHash === i.hash && v.verdict === "reject" ? [{ item: i, reason: v.reason ?? "" }] : [];
    });
  }
}
