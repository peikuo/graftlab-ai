import { describe, expect, it } from "vitest";
import { appCallsSince, lastCallNumber, parseProxyLog } from "./usageLog.ts";
describe("LLM_Proxy request log", () => {
  const log = ["llm-proxy listening on 8787", "POST /chat/completions 200 #1 agents in=100 cached=80 out=5", "POST /chat/completions 200 #2 app in=40 cached=0 out=9", "POST (other) 401", "POST /chat/completions 500 #3 app", "GET /models 200 #4 app"].join("\n");
  it("parses forwarded requests and skips other lines", () => {
    const calls = parseProxyLog(log);
    expect(calls.map((c) => c.n)).toEqual([1, 2, 3, 4]);
    expect(lastCallNumber(calls)).toBe(4);
  });
  it("sums only the app's chat calls after the window start", () => {
    const calls = parseProxyLog(log);
    expect(appCallsSince(calls, 1)).toEqual({ calls: 2, ok: 1, statuses: [200, 500], inputTokens: 40, cachedTokens: 0, outputTokens: 9 });
    expect(appCallsSince(calls, 3).calls).toBe(0);
  });
});
