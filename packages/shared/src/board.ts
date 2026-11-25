// The development whiteboard and AI usage (design.md, "UI design": development whiteboard, AI usage; R1.10, R30.19).
// Pure functions of the folded UI state, so Live and Replay show the same board and the same numbers.
import type { FeaturePhase } from "./events.ts";
import type { ActorKey, UiState } from "./reducer.ts";

/** The phase track of a card, in order (failed and blocked are shown on the phase where they happened). */
export const PHASE_TRACK = ["testing", "building", "reviewing", "running", "demo", "verifying", "merged"] as const satisfies readonly FeaturePhase[];
/** Who works on a Feature in each phase; the card shows that agent's live Role_Status. */
export const PHASE_ACTOR: Partial<Record<FeaturePhase, ActorKey>> = {
  testing: "test_agent",
  building: "code_agent",
  reviewing: "reviewer",
  running: "system",
  demo: "judge",
  verifying: "verifier",
};

export interface BoardCard {
  featureId: string;
  storyId: string;
  title: string;
  size?: string;
  status: FeaturePhase;
  /** The last track phase reached, for a failed or blocked card. */
  reached?: FeaturePhase;
  attempt: number;
  reason?: string;
  actor?: ActorKey;
  change?: { files: number; added: number; removed: number; unplanned: number };
  tests?: { files: number; added: number };
  checks: { checkId: string; pass: boolean }[];
  /** The phases this card goes through (no run and demo for a Feature without a demo). */
  phases: FeaturePhase[];
  /** The story has no demo, so only the tests prove it (R21.10). */
  noDemo: boolean;
  /** R40.24: questions about this Feature; one from the Test_Agent means it found a design gap. */
  questions: { from: ActorKey; askedParty: "reviewer" | "judge"; open: boolean }[];
}
export interface BoardLane {
  storyId: string;
  title: string;
  cards: BoardCard[];
}
export interface Board {
  lanes: BoardLane[];
  total: number;
  merged: number;
  failed: number;
  blocked: number;
}

interface TaskBoardItem {
  id: string;
  storyId: string;
  title: string;
}
const asItems = (content: unknown): TaskBoardItem[] => {
  const items = (content as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? (items as TaskBoardItem[]).filter((i) => typeof i?.id === "string" && typeof i?.storyId === "string") : [];
};

/** The whiteboard: the Task_Board's Features (or, without one, the Features seen in status events), by story. */
export function featureBoard(state: UiState): Board | null {
  const statuses = state.featureStatus;
  if (Object.keys(statuses).length === 0) return null;
  const items = asItems(state.outputDocs.task_board?.content);
  const known = new Set(items.map((i) => i.id));
  for (const s of Object.values(statuses).sort((a, b) => a.seq - b.seq)) if (!known.has(s.featureId)) items.push({ id: s.featureId, storyId: s.storyId, title: s.featureId });
  const breakdown = (state.outputDocs.features?.content as { breakdown?: { features?: { id: string; size?: string }[] } } | undefined)?.breakdown?.features ?? [];
  const stories = ((state.outputDocs.product_backlog?.content as { stories?: { id: string; title: string }[] } | undefined)?.stories ?? []);
  const lanes = new Map<string, BoardLane>();
  for (const it of items) {
    const st = statuses[it.id];
    const changes = state.codeChanges.filter((c) => c.storyId === it.id);
    const code = changes.filter((c) => c.by !== "test_agent").at(-1);
    const tests = changes.filter((c) => c.by === "test_agent").at(-1);
    const sum = (c: (typeof changes)[number] | undefined) => (c?.files ?? []).reduce((a, f) => ({ added: a.added + f.added, removed: a.removed + f.removed }), { added: 0, removed: 0 });
    const status = st?.status ?? "todo";
    const card: BoardCard = {
      featureId: it.id,
      storyId: it.storyId,
      title: it.title,
      status,
      attempt: st?.attempt ?? 0,
      checks: state.verifierResults.filter((r) => r.storyId === it.id).map((r) => ({ checkId: r.checkId, pass: r.pass })),
      phases: state.featurePhases[it.id] ?? [...PHASE_TRACK],
      questions: Object.values(state.questions).filter((q) => q.featureId === it.id).map((q) => ({ from: q.from, askedParty: q.askedParty, open: !q.answered })),
      noDemo: !!state.featurePhases[it.id] && !state.featurePhases[it.id]!.includes("demo") && !items.some((x) => x.storyId === it.storyId && x.id !== it.id && state.featurePhases[x.id]?.includes("demo")),
    };
    const size = breakdown.find((f) => f.id === it.id)?.size;
    if (size) card.size = size;
    if (st?.reason) card.reason = st.reason;
    const actor = PHASE_ACTOR[status];
    if (actor) card.actor = actor;
    if (status === "failed" || status === "blocked") {
      const reached = state.featureTrack[it.id];
      if (reached) card.reached = reached;
    }
    if (code) card.change = { files: code.changedFiles.length, ...sum(code), unplanned: (code.files ?? []).filter((f) => !f.planned).length };
    if (tests) card.tests = { files: tests.changedFiles.length, added: sum(tests).added };
    const lane = lanes.get(it.storyId) ?? { storyId: it.storyId, title: stories.find((s) => s.id === it.storyId)?.title ?? it.storyId, cards: [] };
    lane.cards.push(card);
    lanes.set(it.storyId, lane);
  }
  const cards = [...lanes.values()].flatMap((l) => l.cards);
  return { lanes: [...lanes.values()], total: cards.length, merged: cards.filter((c) => c.status === "merged").length, failed: cards.filter((c) => c.status === "failed").length, blocked: cards.filter((c) => c.status === "blocked").length };
}

export interface UsageRow {
  actor: ActorKey | "app" | "total";
  calls: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  /** In the recorded currency; absent without recorded prices. */
  cost?: number;
}
export interface UsageSummary {
  rows: UsageRow[];
  total: UsageRow;
  currency?: string;
  label: "estimate from configured prices" | "tokens only, no prices configured";
}

/** Tokens per agent and for the app's calls, with a cost estimate from the prices recorded in the Task (R30.19). */
export function usageSummary(state: UiState): UsageSummary {
  const p = state.llmPrice;
  const price = (input: number, cached: number, output: number) => (p ? ((input - cached) * p.inputPerMTok + cached * p.cachedInputPerMTok + output * p.outputPerMTok) / 1_000_000 : undefined);
  const row = (actor: UsageRow["actor"], calls: number, input: number, cached: number, output: number): UsageRow => {
    const r: UsageRow = { actor, calls, inputTokens: input, cachedTokens: cached, outputTokens: output };
    const c = price(input, cached, output);
    if (c !== undefined) r.cost = c;
    return r;
  };
  const rows: UsageRow[] = Object.entries(state.usageByActor).map(([a, u]) => row(a as ActorKey, u!.messages, u!.inputTokens, u!.cachedTokens, u!.outputTokens));
  if (state.appUsage.length) {
    const a = state.appUsage.reduce((s, x) => ({ calls: s.calls + x.calls, i: s.i + x.inputTokens, c: s.c + x.cachedTokens, o: s.o + x.outputTokens }), { calls: 0, i: 0, c: 0, o: 0 });
    rows.push(row("app", a.calls, a.i, a.c, a.o));
  }
  const t = rows.reduce((s, r) => ({ calls: s.calls + r.calls, i: s.i + r.inputTokens, c: s.c + r.cachedTokens, o: s.o + r.outputTokens }), { calls: 0, i: 0, c: 0, o: 0 });
  return { rows, total: row("total", t.calls, t.i, t.c, t.o), ...(p ? { currency: p.currency } : {}), label: p ? "estimate from configured prices" : "tokens only, no prices configured" };
}
