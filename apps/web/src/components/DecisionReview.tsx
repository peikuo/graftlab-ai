// Decision step review (R5.7; mock ui/ui-4-decide.svg): the draft as items; accept or reject each with a reason;
// exactly one complete approach; "Send back" only when every item has a verdict and one is rejected; "Freeze"
// only when every item is accepted. The same conditions are enforced again by the server (or the demo engine).
import { useState } from "react";

export interface ReviewOption {
  id: string;
  label: string;
  detail: string;
  complete: boolean; // has executable acceptance checks (R37.5)
}

export interface ReviewItem {
  id: string;
  title: string;
  summary: string;
  details?: string[];
  unverified?: string;
  options?: ReviewOption[]; // only for the approach item
  hash: string;
}

export interface Draft {
  draftId: string;
  number: number;
  items: ReviewItem[];
}

export type Verdict = { verdict: "accept" | "reject"; reason?: string; itemHash: string };

export function reviewState(draft: Draft, verdicts: Record<string, Verdict>, selected: string | null) {
  const current = draft.items.map((i) => {
    const v = verdicts[i.id];
    return v && v.itemHash === i.hash ? v : undefined;
  });
  const accepted = current.filter((v) => v?.verdict === "accept").length;
  const rejected = current.filter((v) => v?.verdict === "reject").length;
  const approach = draft.items.find((i) => i.options);
  const approachComplete = !approach || !!approach.options?.find((o) => o.id === selected && o.complete);
  return {
    accepted,
    rejected,
    pending: draft.items.length - accepted - rejected,
    canSendBack: accepted + rejected === draft.items.length && rejected > 0,
    canFreeze: accepted === draft.items.length && approachComplete,
    approachComplete,
  };
}

interface Props {
  draft: Draft;
  verdicts: Record<string, Verdict>;
  selected: string | null;
  history: string[];
  busy: boolean;
  onSelect: (optionId: string) => void;
  onReview: (item: ReviewItem, verdict: "accept" | "reject", reason?: string) => void;
  onSendBack: () => void;
  onFreeze: () => void;
}

function ItemRow({ item, verdict, selected, busy, onSelect, onReview }: { item: ReviewItem; verdict: Verdict | undefined; selected: string | null; busy: boolean; onSelect: (id: string) => void; onReview: Props["onReview"] }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const state = verdict?.verdict ?? "pending";
  const needsChoice = !!item.options && !item.options.find((o) => o.id === selected && o.complete);
  return (
    <li className={`ritem ${state}`}>
      <div className="ritem-head">
        <span className="ritem-mark" aria-hidden="true">{state === "accept" ? "✓" : state === "reject" ? "✗" : "●"}</span>
        <strong>{item.title}</strong>
        <span className="ritem-state">{state === "accept" ? "Accepted" : state === "reject" ? "Rejected" : "Waiting for you"}</span>
      </div>
      <p className="ritem-summary">{item.summary}</p>
      {item.details && (
        <ul className="ritem-details">
          {item.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {item.options && (
        <fieldset className="ritem-options" disabled={busy || state !== "pending"}>
          <legend>Choose exactly one approach</legend>
          {item.options.map((o) => (
            <label key={o.id} className={o.complete ? "" : "incomplete"}>
              <input type="radio" name={`opt-${item.id}`} checked={selected === o.id} disabled={!o.complete} onChange={() => onSelect(o.id)} />
              <span>
                {o.label} <span className="muted">· {o.detail}</span>
                {!o.complete && <span className="muted"> · cannot be chosen: it has no acceptance check</span>}
              </span>
            </label>
          ))}
          <p className="muted small">LLM assessment, not a guarantee</p>
        </fieldset>
      )}
      {item.unverified && <p className="failure-text small">⚠ Unverified: {item.unverified}</p>}
      {state === "reject" && verdict?.reason && <p className="ritem-reason">Your reason: “{verdict.reason}”. It goes back to the team when you send the draft back.</p>}
      {state === "pending" &&
        (rejecting ? (
          <form
            className="ritem-reject"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim()) onReview(item, "reject", reason.trim());
            }}
          >
            <label className="sr-only" htmlFor={`reason-${item.id}`}>Why do you reject this item?</label>
            <input id={`reason-${item.id}`} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? The team will revise this item with your reason." />
            <button type="submit" disabled={!reason.trim() || busy}>Reject</button>
            <button type="button" onClick={() => setRejecting(false)}>Cancel</button>
          </form>
        ) : (
          <div className="ritem-actions">
            <button type="button" className="accept" disabled={busy || needsChoice} onClick={() => onReview(item, "accept")} title={needsChoice ? "Choose an approach first" : undefined}>
              Accept
            </button>
            <button type="button" className="reject" disabled={busy} onClick={() => setRejecting(true)}>
              Reject…
            </button>
            {needsChoice && <span className="muted small">Choose an approach first</span>}
          </div>
        ))}
    </li>
  );
}

export function DecisionReview(p: Props) {
  const s = reviewState(p.draft, p.verdicts, p.selected);
  return (
    <section className="review" aria-label="Decision review" id="decision-review">
      <div className="review-head">
        <h2>Decision draft {p.draft.number}</h2>
        <span className="muted small">
          {s.accepted} accepted · {s.rejected} rejected · {s.pending} waiting
        </span>
      </div>
      <p className="review-help">
        Read each item. Accept it, or reject it with a reason. When you are happy with every item, freeze the decision: it is locked and the team plans and builds from it.
      </p>
      <ol className="ritems">
        {p.draft.items.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            verdict={p.verdicts[i.id]?.itemHash === i.hash ? p.verdicts[i.id] : undefined}
            selected={p.selected}
            busy={p.busy}
            onSelect={p.onSelect}
            onReview={p.onReview}
          />
        ))}
      </ol>
      <div className="review-bar">
        <span className="muted small">
          {s.canFreeze
            ? "Everything is accepted. Freezing records the version, a fingerprint of the content, you and the time."
            : s.canSendBack
              ? "You rejected something. Send the draft back so the team can revise it."
              : "Review every item to continue."}
        </span>
        <button type="button" disabled={!s.canSendBack || p.busy} onClick={p.onSendBack}>
          Send back ({s.rejected} rejected)
        </button>
        <button type="button" className="freeze" disabled={!s.canFreeze || p.busy} onClick={p.onFreeze}>
          🔒 Freeze the decision
        </button>
      </div>
      {p.history.length > 0 && (
        <details className="review-history">
          <summary>History ({p.history.length})</summary>
          <ul className="plain small">
            {p.history.map((h, i) => (
              <li key={i}>{h}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
