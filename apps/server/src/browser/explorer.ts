// The app experience (design.md, "Browser_Use"; R14.1-R14.14). The Explorer (pi agent) uses the running Sandbox
// in a browser before the meeting: it sees ARIA snapshots, acts by role and name, and records what it observed.
// Every action is one `browser_action` plus one `browser_observation` with the screenshot saved by code. Limits:
// 40 actions, 5 failed actions in a row, the time budget; reaching one ends the experience with what was observed.
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { obj, opt, str } from "@earendil-works/pi-schema";
import type { TurnOptions, TurnResult } from "../runtime/pi.ts";
import type { NodeHandler } from "../tasks/runner.ts";
import { BrowserSession, type ActionResult, type BrowserLoginSpec, type Target } from "./session.ts";

type Ctx = Parameters<NodeHandler>[0];
export const MAX_ACTIONS = 40;
export const MAX_FAILS_IN_A_ROW = 5;

export interface ExperienceOptions {
  baseUrl: string;
  taskDir: string;
  login?: BrowserLoginSpec;
  /** The Explorer's role text and the shared system prompt (Runtime_Rules). */
  systemPrompt: string;
  roleText: string;
  /** What the app is and what the test data holds, in words (Repo_Brief summary and the Adapter's test data note). */
  appNote: string;
  runTurn: (o: Pick<TurnOptions, "roleId" | "purpose" | "systemPrompt" | "prompt" | "tools" | "signal" | "idPrefix" | "thinkingLevel" | "emit">) => Promise<TurnResult>;
  budgetMs: number;
  session?: BrowserSession;
}
export interface ExperienceResult {
  ok: boolean;
  reason?: string;
  notes: string[];
  shots: string[];
  actions: number;
}

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], details: {} });

export async function runExperience(ctx: Ctx, o: ExperienceOptions): Promise<ExperienceResult> {
  const actor = { kind: "role" as const, roleId: "explorer" as const };
  const session = o.session ?? new BrowserSession(o.baseUrl, { taskDir: o.taskDir, prefix: "explore" });
  const notes: string[] = [];
  const shots: string[] = [];
  let actions = 0;
  let failsInRow = 0;
  let stop: string | null = null;
  let finished = false;
  const ac = new AbortController();
  const onAbort = () => ac.abort();
  ctx.signal.addEventListener("abort", onAbort);
  const timer = setTimeout(() => {
    stop = `the experience reached its time budget of ${Math.round(o.budgetMs / 60_000)} min`;
    ac.abort();
  }, o.budgetMs);
  const record = async (action: string, target: string, r: ActionResult) => {
    if (r.shot) shots.push(r.shot);
    await ctx.emit({ type: "browser_action", actor, payload: { action, target, ok: r.ok } });
    // R14.6: a failed action is recorded before the next action may run.
    if (!r.ok) await ctx.emit({ type: "failure", actor, payload: { failureClass: "interface_call_failure", source: "browser", detail: r.detail } });
    await ctx.emit({ type: "browser_observation", actor, payload: { snapshotSummary: r.detail, ...(r.shot ? { screenshotRef: r.shot } : {}) } });
  };
  const act = async (action: string, target: string, fn: () => Promise<ActionResult>): Promise<ReturnType<typeof text>> => {
    if (stop) return text(`Stopped: ${stop}. Call finish_experience.`);
    if (++actions > MAX_ACTIONS) {
      stop = `the experience reached its limit of ${MAX_ACTIONS} actions`;
      ac.abort();
      return text(`Stopped: ${stop}.`);
    }
    const r = await fn();
    await record(action, target, r);
    failsInRow = r.ok ? 0 : failsInRow + 1;
    if (failsInRow >= MAX_FAILS_IN_A_ROW) {
      stop = `${MAX_FAILS_IN_A_ROW} actions in a row failed`;
      ac.abort();
    }
    const snap = await session.snapshot();
    return text(`${r.ok ? "Done" : "Failed"}: ${r.detail}\n\nPage ${snap.path}${snap.truncated ? " (snapshot cut at 8 KB)" : ""}:\n${snap.text}`);
  };
  const target = (a: { role?: string; name?: string; text?: string }): Target => ({ ...(a.role ? { role: a.role } : {}), ...(a.name ? { name: a.name } : {}), ...(a.text ? { text: a.text } : {}) });
  const tname = (a: { role?: string; name?: string; text?: string }) => (a.role ? `${a.role} "${a.name ?? ""}"` : `"${a.text ?? a.name ?? ""}"`);
  const tools: AgentTool<any>[] = [
    { name: "browser_open", label: "browser_open", description: "Open a page of the app by its path, for example /bookmarks.", parameters: obj({ path: str() }), execute: async (_i, a: { path: string }) => act("open", a.path, () => session.open(String(a.path ?? "/"))) },
    { name: "browser_click", label: "browser_click", description: "Click an element named in the last snapshot: role and name (for example button \"Save\"), or a visible text.", parameters: obj({ role: opt(str()), name: opt(str()), text: opt(str()) }), execute: async (_i, a) => act("click", tname(a), () => session.click(target(a))) },
    { name: "browser_fill", label: "browser_fill", description: "Type into a field named in the last snapshot (role textbox and its name).", parameters: obj({ role: opt(str()), name: opt(str()), text: opt(str()), value: str() }), execute: async (_i, a: { role?: string; name?: string; text?: string; value: string }) => act("fill", tname(a), () => session.fill(target(a), String(a.value ?? ""))) },
    { name: "browser_press", label: "browser_press", description: "Press a key, for example Enter.", parameters: obj({ key: str() }), execute: async (_i, a: { key: string }) => act("press", String(a.key), () => session.press(String(a.key ?? ""))) },
    {
      name: "browser_snapshot",
      label: "browser_snapshot",
      description: "The current page as an accessibility snapshot (roles and names).",
      parameters: obj({}),
      execute: async () => {
        const s = await session.snapshot();
        return text(`Page ${s.path}${s.truncated ? " (cut at 8 KB)" : ""}:\n${s.text}`);
      },
    },
    {
      name: "record_note",
      label: "record_note",
      description: "Record one observation about how the app works today, in plain words for the meeting (what a person does, what is slow or manual, what the app already does).",
      parameters: obj({ note: str() }),
      execute: async (_i, a: { note: string }) => {
        const n = String(a.note ?? "").trim().slice(0, 400);
        if (!n) return { ...text("Empty note."), isError: true };
        notes.push(n);
        await ctx.emit({ type: "finding_recorded", actor, payload: { kind: "finding", text: `Tried the app: ${n}`, evidence: [], evidenceStatus: "none" } });
        return text("Noted.");
      },
    },
    {
      name: "finish_experience",
      label: "finish_experience",
      description: "End the experience when you have seen the main workflows.",
      parameters: obj({ summary: str() }),
      execute: async () => {
        finished = true;
        return { ...text("Finished."), terminate: true };
      },
    },
  ];
  try {
    const first = await session.start(o.login);
    actions++;
    await record("log in", "Studio code", first);
    if (!first.ok) return { ok: false, reason: first.detail, notes, shots, actions };
    const snap = await session.snapshot();
    const prompt = [
      `# Your role\n\n${o.roleText}`,
      `# The app\n${o.appNote}`,
      `# Limits\nAt most ${MAX_ACTIONS} actions; ${MAX_FAILS_IN_A_ROW} failed actions in a row end the experience; about ${Math.round(o.budgetMs / 60_000)} minutes.`,
      `# You are logged in. Current page ${snap.path}:\n${snap.text}`,
      "Use the app like a person would, record_note what you observe, then finish_experience. Tell the Judge in at most 40 words what you are about to try.",
    ].join("\n\n---\n\n");
    const r = await o.runTurn({ roleId: "explorer", purpose: "operator", systemPrompt: o.systemPrompt, prompt, tools, signal: ac.signal, idPrefix: `${ctx.task.taskId}-explore`, thinkingLevel: "off", emit: ctx.emit });
    if (ctx.signal.aborted) return { ok: notes.length > 0, reason: "you started the meeting early", notes, shots, actions };
    if (stop) return { ok: false, reason: stop, notes, shots, actions };
    if (!finished && notes.length === 0) return { ok: false, reason: r.error ?? "the Explorer recorded no observation", notes, shots, actions };
    return { ok: true, notes, shots, actions };
  } catch (e) {
    return { ok: false, reason: (e as Error).message.split("\n")[0]!.slice(0, 200), notes, shots, actions };
  } finally {
    clearTimeout(timer);
    ctx.signal.removeEventListener("abort", onAbort);
    await session.close();
  }
}
