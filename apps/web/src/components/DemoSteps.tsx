// Demonstration at the confirmation point (R21.11; design.md, "Demonstration at the confirmation point"): the
// Verifier's browser-check steps in the running changed app, each with its result and screenshot, shown inside the
// confirm card. Derived from events only, so Live and Replay show the same.
import type { StudioEvent, UiState } from "@graftlab/shared";
import { shotUrl } from "./Artifacts.tsx";

export interface DemoStep {
  ref: string;
  label: string;
  pass: boolean;
}
const STEP = /^Step (\d+) of check ([^:]+): (.*) \((passed|failed)\)$/;

/** The step screenshots recorded between entering the confirmation point and opening this card. */
export function demoSteps(events: readonly StudioEvent[], cardId: string): DemoStep[] {
  const at = events.findIndex((e) => e.type === "card_opened" && e.payload.cardId === cardId);
  if (at < 0 || events[at]!.node !== "story_checkpoint") return [];
  let from = at;
  while (from > 0 && !(events[from]!.type === "node_entered" && events[from]!.node === "story_checkpoint")) from--;
  const steps: DemoStep[] = [];
  for (const e of events.slice(from, at)) {
    if (e.type !== "artifact_updated" || e.payload.artifactKind !== "screenshot") continue;
    const m = STEP.exec(e.payload.title ?? "");
    if (m) steps.push({ ref: e.payload.ref, label: `${m[1]}. ${m[3]}`, pass: m[4] === "passed" });
  }
  return steps;
}

/** The "now" line while the demonstration runs: the step the Verifier just did (newer than its last result). */
export function demoNow(state: UiState): string | null {
  const b = state.lastBrowserByActor.verifier;
  if (state.node !== "story_checkpoint" || !b || b.seq <= (state.verifierResults.at(-1)?.seq ?? 0)) return null;
  return `The Verifier is showing the feature in the changed app: ${b.what}`;
}

export function DemoSteps({ events, cardId, taskId, replay = false }: { events: readonly StudioEvent[]; cardId: string; taskId: string; replay?: boolean }) {
  const steps = demoSteps(events, cardId);
  if (steps.length === 0) return null;
  return (
    <div className="demo-steps">
      <p className="small muted">Run by the Verifier (code, no AI) in the changed app. This shows what it did; the result counts at verification.</p>
      <ol className="demo-grid">
        {steps.map((s) => (
          <li key={s.ref} className={s.pass ? "ok" : "bad"}>
            <a href={shotUrl(taskId, s.ref, replay)} target="_blank" rel="noreferrer">
              <img src={shotUrl(taskId, s.ref, replay)} alt={`Screenshot after step ${s.label}`} loading="lazy" />
            </a>
            <span className="small">
              <span aria-hidden="true">{s.pass ? "✓" : "✗"}</span> {s.label}
              {!s.pass && <span className="sr-only"> (failed)</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
