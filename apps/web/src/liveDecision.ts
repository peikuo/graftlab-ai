// The decision review state in the Workspace, derived from events only (R5.7; Live and Replay alike). It mirrors
// the server desk: a verdict counts while its item hash is current; a different approach choice makes the
// approach item pending again; the choice carries over to the next draft.
import type { ReviewItemData, StudioEvent } from "@graftlab/shared";
import type { Draft, Verdict } from "./components/DecisionReview.tsx";

export interface LiveDecision {
  draft: Draft | null;
  verdicts: Record<string, Verdict>;
  selected: string | null;
  history: string[];
  frozen: boolean;
}
export function deriveDecision(events: StudioEvent[]): LiveDecision {
  let draft: Draft | null = null;
  const verdicts: Record<string, Verdict> = {};
  let selected: string | null = null;
  let frozen = false;
  const history: string[] = [];
  const title = (id: string) => draft?.items.find((i) => i.id === id)?.title ?? id;
  for (const e of events) {
    if (e.type === "decision_draft") {
      const items = e.payload.items as ReviewItemData[];
      draft = { draftId: e.payload.draftId, number: e.payload.number, items };
      frozen = false;
      const kept = items.filter((i) => verdicts[i.id]?.itemHash === i.hash).length;
      history.push(`Draft ${e.payload.number} ready${e.payload.number > 1 ? ` (${kept} of ${items.length} items unchanged and keep your verdict)` : ""}`);
      if (selected && !items.find((i) => i.options)?.options?.some((o) => o.id === selected && o.complete)) selected = null;
    } else if (e.type === "decision_item_reviewed") {
      verdicts[e.payload.itemId] = { verdict: e.payload.verdict, itemHash: e.payload.itemHash, ...(e.payload.reason ? { reason: e.payload.reason } : {}) };
      history.push(`${e.payload.verdict === "accept" ? "You accepted" : "You rejected"} “${title(e.payload.itemId)}”${e.payload.reason ? `: ${e.payload.reason}` : ""}`);
    } else if (e.type === "decision_approach_selected") {
      const approach = draft?.items.find((i) => i.options);
      if (approach && e.payload.optionId !== selected && verdicts[approach.id]?.verdict === "accept") delete verdicts[approach.id];
      selected = e.payload.optionId;
      history.push(`You chose “${approach?.options?.find((o) => o.id === e.payload.optionId)?.label ?? e.payload.optionId}”`);
    } else if (e.type === "node_entered" && e.payload.to === "deciding" && e.payload.from === "awaiting_confirmation") {
      history.push("You sent the draft back to the team");
    } else if (e.type === "decision_doc_frozen") {
      frozen = true;
      history.push(`You froze the decision as version ${e.payload.version}`);
    }
  }
  return { draft, verdicts, selected, history, frozen };
}
