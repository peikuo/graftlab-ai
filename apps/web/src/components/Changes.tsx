// Code changes (R4.9) inside Engineering_Details, and AI usage (R30.19). Both come from events only: the diff text
// travels in `code_change`, the whole change in `change_summary`, the tokens in `message_completed` and `ai_usage`.
import { usageSummary, type UiState } from "@graftlab/shared";
import { ACTOR_LABEL } from "../roles.ts";
const STATUS: Record<string, string> = { added: "new", modified: "changed", deleted: "deleted" };
export function CodeChanges({ state }: { state: UiState }) {
  if (state.codeChanges.length === 0 && !state.changeSummary) return null;
  return (
    <div className="changes">
      <h4>Code changes</h4>
      {state.codeChanges.map((c) => {
        const files = c.files ?? c.changedFiles.map((p) => ({ path: p, status: "modified", added: 0, removed: 0, planned: true }));
        const add = files.reduce((a, f) => a + f.added, 0);
        const rem = files.reduce((a, f) => a + f.removed, 0);
        const by = c.by === "test_agent" ? "Test_Agent, tests" : "Code_Agent";
        return (
          <details key={c.seq} className="fold change">
            <summary>
              {c.storyId} · {c.by === "test_agent" ? `tests, try ${c.attempt}` : `attempt ${c.attempt}`} · {by} · {files.length} files, +{add} −{rem}
            </summary>
            <table className="ftable small">
              <tbody>
                {files.map((f) => (
                  <tr key={f.path}>
                    <td className="mono">{f.path}</td>
                    <td>{STATUS[f.status] ?? f.status}</td>
                    <td className="num">+{f.added}</td>
                    <td className="num">−{f.removed}</td>
                    <td>{f.planned ? <span className="badge slate">planned</span> : <span className="badge amber">unplanned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {c.patch !== undefined && (
              <details className="fold">
                <summary>Diff text{c.patchTruncated ? " (cut at 150 KB)" : ""}</summary>
                <pre className="diff">
                  {c.patch.split("\n").map((l, i) => (
                    <span key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
                      {l}
                      {"\n"}
                    </span>
                  ))}
                </pre>
              </details>
            )}
          </details>
        );
      })}
      {state.changeSummary && (
        <details className="fold change" open>
          <summary>
            Whole change of main against the pinned commit · {state.changeSummary.files.length} files, +{state.changeSummary.added} −{state.changeSummary.removed}
          </summary>
          <table className="ftable small">
            <tbody>
              {state.changeSummary.files.map((f) => (
                <tr key={f.path}>
                  <td className="mono">{f.path}</td>
                  <td>{STATUS[f.status] ?? f.status}</td>
                  <td className="num">+{f.added}</td>
                  <td className="num">−{f.removed}</td>
                  <td>{f.studio ? <span className="badge slate">Studio-provided</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small mono">
            {state.changeSummary.base.slice(0, 12)} → {state.changeSummary.head.slice(0, 12)}
          </p>
        </details>
      )}
    </div>
  );
}
const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} M` : n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(n));
export function UsageView({ state }: { state: UiState }) {
  const u = usageSummary(state);
  if (u.rows.length === 0) return null;
  const money = (x?: number) => (x === undefined ? "" : `${x.toFixed(x < 1 ? 4 : 2)} ${u.currency}`);
  return (
    <div className="usage">
      <h4>
        AI usage <span className="badge slate">{u.label}</span>
      </h4>
      <table className="ftable small">
        <thead>
          <tr>
            <th>Who</th>
            <th className="num">Calls</th>
            <th className="num">Input</th>
            <th className="num">of it cached</th>
            <th className="num">Output</th>
            {u.currency && <th className="num">Cost</th>}
          </tr>
        </thead>
        <tbody>
          {u.rows.map((r) => (
            <tr key={r.actor}>
              <td>{r.actor === "app" ? "The changed app (counted by the LLM_Proxy)" : (ACTOR_LABEL[r.actor]?.name ?? r.actor)}</td>
              <td className="num">{r.calls}</td>
              <td className="num">{fmt(r.inputTokens)}</td>
              <td className="num">{fmt(r.cachedTokens)}</td>
              <td className="num">{fmt(r.outputTokens)}</td>
              {u.currency && <td className="num">{money(r.cost)}</td>}
            </tr>
          ))}
          <tr className="total">
            <td>Total</td>
            <td className="num">{u.total.calls}</td>
            <td className="num">{fmt(u.total.inputTokens)}</td>
            <td className="num">{fmt(u.total.cachedTokens)}</td>
            <td className="num">{fmt(u.total.outputTokens)}</td>
            {u.currency && <td className="num">{money(u.total.cost)}</td>}
          </tr>
        </tbody>
      </table>
      <p className="muted small">Token counts as reported by the model. "Calls" counts complete messages for agents and model requests for the app.</p>
    </div>
  );
}
