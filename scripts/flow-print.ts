// Prints the Flow_Graph node list and one accepted and one rejected transition (tasks.md 2.11).
// Run: npm run flow:print
import { EDGES, GLOBAL_EDGES, NODES, NODE_IDS, edgesFrom, initialTaskState, transition } from "../packages/shared/src/index.ts";

console.log(`Flow_Graph: ${NODE_IDS.length} nodes, ${EDGES.length} edges, ${GLOBAL_EDGES.length} global edges\n`);
for (const id of NODE_IDS) {
  const n = NODES[id];
  const out = edgesFrom(id, { includeGlobal: false }).map((x) => `${x.id}→${x.to}`);
  const timeout = n.timeoutS === null ? "-" : `${n.timeoutS}s`;
  console.log(`${id.padEnd(22)} ${n.kind.padEnd(10)} ${timeout.padStart(6)}  ${out.join(", ") || "(terminal)"}`);
}

const task = initialTaskState({
  taskId: "demo",
  url: "https://github.com/sissbruecker/linkding",
  owner: "sissbruecker",
  repo: "linkding",
  repoKind: "adapted",
  adapterId: "linkding",
  runtimeRulesVersion: "0.1.0",
  startedAt: new Date().toISOString(),
  deadlineAt: new Date(Date.now() + 90 * 60_000).toISOString(),
});

const accepted = transition({ ...task, outcome: "done" }, "reading_done");
console.log("\nAccepted:", JSON.stringify(accepted.event));
const rejected = transition({ ...task, node: "frozen" }, "frozen_recorded");
console.log("Rejected:", JSON.stringify(rejected.event));
