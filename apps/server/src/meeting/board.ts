// Proposal_Board and Evidence_Pool (design.md, "Meeting"; R11.11-R11.13, R24). Pure Studio code: every change a
// role submits is validated here, quotes are checked by the evidence checker, and the plain-language lines the
// Judge sees ("Against “Tag suggestions”: …") are written here, never by the model.
import { stripIds, type EvidenceRef, type Proposal, type RoleId } from "@graftlab/shared";
import { checkRef, normalize, type EvidenceFiles } from "../evidence/check.ts";

export const PERSPECTIVES = ["user_value", "feasibility", "risk"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];
export type StanceKind = "support" | "against" | "conditional";
export type Purpose = "A" | "B" | "unclear";
export interface Quote {
  path: string;
  line?: number;
  snippet: string;
}
/** An evidence entry from a role: a pool id ("E3") or a new quote. */
export interface EvidenceEntry {
  id?: string;
  path?: string;
  line?: number;
  snippet?: string;
}
export type PoolItem = EvidenceRef & { id: string; addedBy: RoleId };
interface StanceRec {
  stance: StanceKind;
  reason: string;
  conditions?: string;
  evidenceIds: string[];
}
export type VerdictKind = "recommend" | "drop" | "park";
interface VerdictRec {
  verdict: VerdictKind;
  reason: string;
  rank?: number;
  conditions: string[];
}
interface ProposalRec {
  id: string;
  kind: IdeaKind;
  title: string;
  userChange: string;
  purpose: Purpose;
  evidenceIds: string[];
  stances: Partial<Record<Perspective, StanceRec>>;
  verdict?: VerdictRec;
  addedBy: RoleId;
}
export type Change =
  | { kind: "add"; idea?: IdeaKind; title: string; userChange: string; purpose: Purpose; evidence: EvidenceEntry[]; stance?: StanceKind; reason?: string; conditions?: string }
  | { kind: "stance"; proposal: string; stance: StanceKind; reason: string; conditions?: string; evidence: EvidenceEntry[] }
  | { kind: "merge"; keep: string; drop: string }
  | { kind: "decide"; proposal: string; verdict: VerdictKind; reason: string; rank?: number; conditions?: string[] };
export interface ApplyResult {
  /** Plain-language lines for the Judge, one per accepted change. */
  lines: string[];
  /** Why a change was not accepted, for the tool result (the model can correct it). */
  errors: string[];
  /** Quotes this submission relied on (resolved, for the "why we think so" fold). */
  evidence: EvidenceRef[];
  /** New pool items added by this submission (for evidence_added). */
  added: PoolItem[];
}

export const MAX_PROPOSALS = 6;
export type IdeaKind = "improve" | "new";
/** Reasons and conditions are cut by code so the board stays readable (R11.13); the cut is marked with "…". */
export const short = (t: string, max: number) => {
  const s = stripIds(t).text.trim().replace(/\s+/g, " ");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20)).replace(/[,;:.\s]+$/, "")}…`;
};
const REASON = 180;
const COND = 120;
const PLAIN_ROLE: Record<string, string> = { facilitator: "Facilitator", user_value: "User_Value", feasibility: "Feasibility", risk: "Risk" };
const q = (t: string) => `“${t}”`;
const titleKey = (t: string) => normalize(t).toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "");

export class Board {
  #files: EvidenceFiles;
  #pool = new Map<string, PoolItem>();
  #proposals: ProposalRec[] = [];
  #nextE = 1;
  #nextP = 1;
  constructor(files: EvidenceFiles) {
    this.#files = files;
  }
  get size(): number {
    return this.#proposals.length;
  }
  /** Checks a quote and adds it to the pool (the same quote twice gets the same id). */
  addQuote(quote: Quote, by: RoleId, added: PoolItem[] = []): PoolItem {
    const key = `${quote.path}\u0000${normalize(quote.snippet)}`;
    for (const it of this.#pool.values()) if (`${it.path}\u0000${normalize(it.snippet)}` === key) return it;
    const checked = checkRef(quote, this.#files);
    const item: PoolItem = { ...checked, id: `E${this.#nextE++}`, addedBy: by };
    this.#pool.set(item.id, item);
    added.push(item);
    return item;
  }
  #resolve(entries: EvidenceEntry[], by: RoleId, added: PoolItem[], errors: string[]): string[] {
    const ids: string[] = [];
    for (const e of entries) {
      if (e.id) {
        const id = e.id.trim().toUpperCase();
        if (this.#pool.has(id)) ids.push(id);
        else errors.push(`evidence ${e.id} is not in the pool`);
      } else if (e.path && e.snippet) {
        ids.push(this.addQuote({ path: e.path, snippet: e.snippet, ...(e.line ? { line: e.line } : {}) }, by, added).id);
      } else errors.push("an evidence entry needs a pool id or a path with a snippet");
    }
    return [...new Set(ids)];
  }
  /** Finds a proposal by id ("P2") or by its title. */
  find(ref: string): ProposalRec | undefined {
    const r = ref.trim();
    return this.#proposals.find((p) => p.id.toLowerCase() === r.toLowerCase()) ?? this.#proposals.find((p) => titleKey(p.title) === titleKey(r));
  }
  /** Applies a role's changes; invalid changes are skipped with an error the model can read. */
  apply(by: RoleId, changes: Change[]): ApplyResult {
    const res: ApplyResult = { lines: [], errors: [], evidence: [], added: [] };
    const used = new Set<string>();
    const perspective = (PERSPECTIVES as readonly string[]).includes(by) ? (by as Perspective) : null;
    for (const c of changes) {
      if (c.kind === "add") {
        if (!perspective) {
          res.errors.push("only a perspective can add a proposal");
          continue;
        }
        if (this.#proposals.length >= MAX_PROPOSALS) {
          res.errors.push(`the board already has ${MAX_PROPOSALS} proposals; give a stance on one of them instead`);
          continue;
        }
        const existing = this.find(c.title);
        if (existing) {
          res.errors.push(`a proposal named ${q(existing.title)} exists (${existing.id}); give your stance on it instead`);
          continue;
        }
        const ids = this.#resolve(c.evidence, by, res.added, res.errors);
        ids.forEach((i) => used.add(i));
        const p: ProposalRec = { id: `P${this.#nextP++}`, kind: c.idea ?? "improve", title: short(c.title, 100), userChange: short(c.userChange, 300), purpose: c.purpose, evidenceIds: ids, stances: {}, addedBy: by };
        const stance = c.stance ?? "support";
        p.stances[perspective] = { stance, reason: short(c.reason ?? c.userChange, REASON), ...(c.conditions ? { conditions: short(c.conditions, COND) } : {}), evidenceIds: ids };
        this.#proposals.push(p);
        res.lines.push(`Proposed ${p.kind === "new" ? "a new capability, " : ""}${q(p.title)}${stance === "conditional" && c.conditions ? `, only if ${short(c.conditions, COND)}` : ""}`);
      } else if (c.kind === "stance") {
        if (!perspective) {
          res.errors.push("only a perspective can take a stance");
          continue;
        }
        const p = this.find(c.proposal);
        if (!p) {
          res.errors.push(`no proposal ${q(c.proposal)} on the board`);
          continue;
        }
        const ids = this.#resolve(c.evidence, by, res.added, res.errors);
        ids.forEach((i) => used.add(i));
        const before = p.stances[perspective]?.stance;
        const reason = short(c.reason, REASON);
        delete p.verdict; // a changed stance reopens the Facilitator's verdict
        const conditions = c.conditions ? short(c.conditions, COND) : undefined;
        p.stances[perspective] = { stance: c.stance, reason, ...(conditions ? { conditions } : {}), evidenceIds: ids };
        const verb = c.stance === "support" ? "Supports" : c.stance === "against" ? "Against" : "Supports";
        const cond = c.stance === "conditional" && conditions ? ` only if ${conditions}` : "";
        const changed = before && before !== c.stance ? " (changed its view)" : "";
        res.lines.push(`${verb} ${q(p.title)}${cond}${changed}: ${reason}`);
      } else if (c.kind === "decide") {
        if (by !== "facilitator") {
          res.errors.push("only the Facilitator gives verdicts");
          continue;
        }
        const p = this.find(c.proposal);
        if (!p) {
          res.errors.push(`no proposal ${q(c.proposal)} on the board`);
          continue;
        }
        // R11.14, R24.5: a recommendation needs at least one quote that Studio code found in the files.
        if (c.verdict === "recommend" && !this.#hasPassed(p)) {
          res.errors.push(`${q(p.title)} cannot be recommended: no quote from the code was found for it; park it for the Judge or drop it`);
          continue;
        }
        const conditions = (c.conditions ?? []).map((x) => short(x, COND)).filter(Boolean).slice(0, 4);
        p.verdict = { verdict: c.verdict, reason: short(c.reason, REASON), ...(c.verdict === "recommend" && c.rank ? { rank: c.rank } : {}), conditions };
        const what = c.verdict === "recommend" ? `Recommends ${q(p.title)}${c.rank ? ` as number ${c.rank}` : ""}` : c.verdict === "drop" ? `Drops ${q(p.title)}` : `Leaves ${q(p.title)} for you to decide`;
        res.lines.push(`${what}${conditions.length ? `, only if ${conditions.join("; ")}` : ""}: ${p.verdict.reason}`);
      } else {
        if (by !== "facilitator") {
          res.errors.push("only the Facilitator can merge proposals");
          continue;
        }
        const keep = this.find(c.keep);
        const drop = this.find(c.drop);
        if (!keep || !drop || keep === drop) {
          res.errors.push(`merge needs two different proposals on the board (${c.keep}, ${c.drop})`);
          continue;
        }
        for (const r of PERSPECTIVES) if (!keep.stances[r] && drop.stances[r]) keep.stances[r] = drop.stances[r];
        keep.evidenceIds = [...new Set([...keep.evidenceIds, ...drop.evidenceIds])];
        this.#proposals = this.#proposals.filter((p) => p !== drop);
        res.lines.push(`Merged ${q(drop.title)} into ${q(keep.title)}`);
      }
    }
    res.evidence = [...used].map((i) => this.#ref(i));
    return res;
  }
  #hasPassed(p: ProposalRec): boolean {
    const ids = [...p.evidenceIds, ...Object.values(p.stances).flatMap((s) => s.evidenceIds)];
    return ids.some((i) => this.#pool.get(i)?.status === "passed");
  }
  /** Proposals without a verdict (the close is refused until there are none). */
  undecided(): string[] {
    return this.#proposals.filter((p) => !p.verdict).map((p) => p.id);
  }
  #ref(id: string): EvidenceRef {
    const { addedBy: _by, ...ref } = this.#pool.get(id)!;
    return ref;
  }
  #refs(ids: string[]) {
    const evidence = ids.map((i) => this.#ref(i));
    return { evidence, evidenceStatus: evidence.some((e) => e.status === "passed") ? ("passed" as const) : ("unverified" as const) };
  }
  /** The board as events carry it: evidence resolved, Unverified computed by code (R24.5). */
  snapshot(): Proposal[] {
    return this.#proposals.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      userChange: p.userChange,
      purpose: p.purpose,
      ...this.#refs(p.evidenceIds),
      stances: Object.fromEntries(
        Object.entries(p.stances).map(([r, s]) => [r, { stance: s.stance, reason: s.reason, ...(s.conditions ? { conditions: s.conditions } : {}), ...this.#refs(s.evidenceIds) }]),
      ),
      ...(p.verdict ? { verdict: p.verdict } : {}),
      addedBy: p.addedBy,
    }));
  }
  /** Proposals each perspective has no stance on yet. */
  missing(): Record<Perspective, string[]> {
    const out = { user_value: [] as string[], feasibility: [] as string[], risk: [] as string[] };
    for (const p of this.#proposals) for (const r of PERSPECTIVES) if (!p.stances[r]) out[r].push(p.id);
    return out;
  }
  complete(): boolean {
    return this.#proposals.length > 0 && PERSPECTIVES.every((r) => this.missing()[r].length === 0);
  }
  /** For agents (with internal ids; never shown to the Judge). */
  render(): string {
    if (this.#proposals.length === 0) return "## Proposal_Board\n(empty)";
    const lines = ["## Proposal_Board"];
    for (const p of this.#proposals) {
      lines.push(`${p.id} ${q(p.title)} [${p.kind === "new" ? "new capability" : "improvement"}, purpose ${p.purpose}] — for the user: ${p.userChange}${p.evidenceIds.length ? ` (evidence ${p.evidenceIds.join(", ")})` : ""}`);
      for (const r of PERSPECTIVES) {
        const s = p.stances[r];
        if (r === "user_value" && p.verdict) lines.push(`  Facilitator verdict: ${p.verdict.verdict}${p.verdict.rank ? ` #${p.verdict.rank}` : ""} — ${p.verdict.reason}`);
        lines.push(`  ${PLAIN_ROLE[r]}: ${s ? `${s.stance}${s.conditions ? ` (only if ${s.conditions})` : ""} — ${s.reason}${s.evidenceIds.length ? ` (${s.evidenceIds.join(", ")})` : ""}` : "no stance yet"}`);
      }
    }
    lines.push("", "## Evidence_Pool (checked by Studio code)");
    for (const it of this.#pool.values()) {
      const snip = normalize(it.snippet);
      lines.push(`${it.id} ${it.path}${it.line ? `:${it.line}` : ""} "${snip.length > 160 ? `${snip.slice(0, 160)}…` : snip}" — ${it.status === "passed" ? "found in the file" : `NOT found (${it.reason})`}`);
    }
    return lines.join("\n");
  }
}

// ---- speaker choice (R11.1): fixed rules over the signals, by code ----
export interface Signal {
  roleId: Perspective;
  speak: boolean;
  kind?: "disagree" | "answer" | "add" | "agree";
  about?: string;
  intent?: string;
}
const KIND_ORDER = { disagree: 0, answer: 1, add: 2, agree: 3 } as const;
export function pickNext(o: { signals: Signal[]; last: RoleId | null; addressed: Perspective | null; missing: Record<Perspective, string[]> }): { next: Perspective | null; reason: string } {
  if (o.addressed && o.addressed !== o.last) return { next: o.addressed, reason: "you addressed it" };
  // When every proposal has a view from all three, only a disagreement or an answer keeps the discussion going.
  const complete = PERSPECTIVES.every((r) => o.missing[r].length === 0);
  const wanting = o.signals.filter((s) => s.speak && s.roleId !== o.last && (!complete || s.kind === "disagree" || s.kind === "answer"));
  if (wanting.length > 0) {
    const best = [...wanting].sort((a, b) => KIND_ORDER[a.kind ?? "add"] - KIND_ORDER[b.kind ?? "add"] || o.missing[b.roleId].length - o.missing[a.roleId].length || PERSPECTIVES.indexOf(a.roleId) - PERSPECTIVES.indexOf(b.roleId))[0]!;
    return { next: best.roleId, reason: best.kind === "disagree" ? "a disagreement goes first" : best.kind === "answer" ? "it answers a question" : "it asked to speak" };
  }
  const lacking = PERSPECTIVES.filter((r) => r !== o.last && o.missing[r].length > 0).sort((a, b) => o.missing[b].length - o.missing[a].length);
  if (lacking[0]) return { next: lacking[0], reason: "the board still needs its view" };
  return { next: null, reason: "Every proposal has a view from all three perspectives." };
}

