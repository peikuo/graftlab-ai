// Reads the LLM_Proxy's request log (design.md, "LLM_Proxy"; R22.11, R30.19): one line per forwarded request,
// `<method> <path> <status> #<n> <caller>[ in=<input> cached=<cached> out=<output>]`. Lines of other forms are skipped.
export interface ProxyCall {
  n: number;
  caller: "agents" | "app";
  path: string;
  status: number;
  input: number;
  cached: number;
  output: number;
}
const LINE = /^(?:GET|POST) (\S+) (\d{3}) #(\d+) (agents|app)(?: in=(\d+) cached=(\d+) out=(\d+))?$/;
export function parseProxyLog(text: string): ProxyCall[] {
  const out: ProxyCall[] = [];
  for (const raw of text.split("\n")) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    out.push({ path: m[1]!, status: Number(m[2]), n: Number(m[3]), caller: m[4] as ProxyCall["caller"], input: Number(m[5] ?? 0), cached: Number(m[6] ?? 0), output: Number(m[7] ?? 0) });
  }
  return out;
}
/** The highest request number seen so far (the start of a counting window). */
export const lastCallNumber = (calls: ProxyCall[]) => calls.reduce((a, c) => Math.max(a, c.n), 0);
/** The app's chat calls after request number `after`, summed. */
export function appCallsSince(calls: ProxyCall[], after: number): { calls: number; ok: number; statuses: number[]; inputTokens: number; cachedTokens: number; outputTokens: number } {
  const mine = calls.filter((c) => c.caller === "app" && c.n > after && c.path === "/chat/completions");
  return {
    calls: mine.length,
    ok: mine.filter((c) => c.status < 300).length,
    statuses: mine.map((c) => c.status),
    inputTokens: mine.reduce((a, c) => a + c.input, 0),
    cachedTokens: mine.reduce((a, c) => a + c.cached, 0),
    outputTokens: mine.reduce((a, c) => a + c.output, 0),
  };
}
