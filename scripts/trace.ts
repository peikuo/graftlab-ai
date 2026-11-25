// Prints the local prompt trace of a Task for reading (R35; design.md, "Prompt trace").
//   npx tsx scripts/trace.ts <taskDir> [filter]
// <taskDir> is data/tasks/<taskId> (copied from the host where the Task ran). The filter matches the file name or
// the role, for example "reviewer" or "F3-test_agent". Without a filter it lists the traces.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const [dir, filter] = process.argv.slice(2);
if (!dir) {
  console.error("usage: npx tsx scripts/trace.ts <taskDir> [filter]");
  process.exit(2);
}
const tdir = join(dir, "traces");
if (!existsSync(tdir)) {
  console.error(`no traces in ${tdir}`);
  process.exit(1);
}
const entries = readdirSync(tdir).sort();
const cut = (s: unknown, n = 4000) => {
  const t = typeof s === "string" ? s : JSON.stringify(s, null, 1);
  return t.length > n ? `${t.slice(0, n)}\n… (${t.length - n} more characters; open the file for all)` : t;
};
if (!filter) {
  for (const e of entries) {
    const p = join(tdir, e);
    if (statSync(p).isDirectory()) console.log(`${e}/  (in-container agent attempt: inputs and conversation.json)`);
    else {
      const t = JSON.parse(readFileSync(p, "utf8"));
      console.log(`${e}  ${t.roleId} ${t.purpose} · ${t.messages?.length ?? 0} messages · ${t.toolResults?.filter((r: { ok: boolean }) => !r.ok).length ?? 0} refused · ${t.result?.stopReason}${t.result?.error ? ` (${t.result.error})` : ""}`);
    }
  }
  process.exit(0);
}
for (const e of entries.filter((x) => x.includes(filter) || (!statSync(join(tdir, x)).isDirectory() && JSON.parse(readFileSync(join(tdir, x), "utf8")).roleId === filter))) {
  const p = join(tdir, e);
  console.log(`\n######## ${e}`);
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) console.log(`--- ${f}\n${cut(readFileSync(join(p, f), "utf8"), f === "conversation.json" ? 20000 : 3000)}`);
    continue;
  }
  const t = JSON.parse(readFileSync(p, "utf8"));
  console.log(`role ${t.roleId} · ${t.purpose} · model ${t.model} · thinking ${t.thinkingLevel} · ${t.startedAt} → ${t.endedAt}`);
  console.log(`tools: ${t.tools.map((x: { name: string }) => x.name).join(", ")}`);
  console.log(`=== system prompt\n${cut(t.systemPrompt, 3000)}\n=== prompt\n${cut(t.prompt, 6000)}`);
  const results = new Map<string, { name: string; ok: boolean; text: string }[]>();
  for (const r of t.toolResults) results.set(r.name, [...(results.get(r.name) ?? []), r]);
  for (const m of t.messages) {
    console.log(`=== ${m.id} (${m.stopReason})`);
    if (m.reasoning) console.log(`[reasoning]\n${cut(m.reasoning, 3000)}`);
    if (m.text) console.log(`[text]\n${cut(m.text, 3000)}`);
    for (const c of m.toolCalls) {
      console.log(`[tool call] ${c.name}\n${cut(c.arguments, 3000)}`);
      const r = results.get(c.name)?.shift();
      if (r) console.log(`[result ${r.ok ? "ok" : "REFUSED"}]\n${cut(r.text, 1500)}`);
    }
  }
  console.log(`=== result ${JSON.stringify(t.result)}`);
}
