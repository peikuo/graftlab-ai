// Generates packages/shared/test/fixtures/synthetic-gathering-meeting.jsonl (tasks.md 3.2, development only).
// SYNTHETIC: hand-written to build and check the Workspace UI before real runs exist. It is not a recording of
// a real run and must never be shown or published as one. Real, sanitized fixtures replace it as stages are built.
// Run: node scripts/fixtures/make-synthetic.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";

type Actor = { kind: "role"; roleId: string } | { kind: "system" } | { kind: "judge" };
const role = (roleId: string): Actor => ({ kind: "role", roleId });
const system: Actor = { kind: "system" };

const lines: unknown[] = [];
let t = 0;
let node = "reading";
const ev = (type: string, payload: unknown, actor: Actor = system, gap = 400) => {
  t += gap;
  lines.push({ at: t, event: { type, node, actor, payload } });
};
const enter = (to: string, edgeId: string, gap = 600) => {
  ev("node_entered", { from: node, to, edgeId }, system, gap);
  node = to;
};

/** A streamed message: started, progress, reasoning deltas, text deltas, completed. */
function say(roleId: string, id: string, reasoning: string, text: string) {
  const a = role(roleId);
  ev("message_started", { messageId: id, roleId, purpose: "statement" }, a, 500);
  t += 1800; // waiting for the model
  let r = 0;
  if (reasoning) {
    ev("message_progress", { messageId: id, phase: "thinking", textChars: 0, reasoningChars: 0 }, a, 0);
    for (let i = 0; i < reasoning.length; i += 7) {
      t += 70;
      lines.push({ at: t, delta: { messageId: id, channel: "reasoning", text: reasoning.slice(i, i + 7) } });
      r = i + 7;
      if (i > 0 && i % 210 === 0) ev("message_progress", { messageId: id, phase: "thinking", textChars: 0, reasoningChars: r }, a, 0);
    }
  }
  ev("message_progress", { messageId: id, phase: "speaking", textChars: 0, reasoningChars: reasoning.length }, a, 200);
  for (let i = 0; i < text.length; i += 5) {
    t += 55;
    lines.push({ at: t, delta: { messageId: id, channel: "text", text: text.slice(i, i + 5) } });
    if (i > 0 && i % 200 === 0) ev("message_progress", { messageId: id, phase: "speaking", textChars: i, reasoningChars: reasoning.length }, a, 0);
  }
  ev("message_completed", { messageId: id, text, ...(reasoning ? { reasoning } : {}), finishReason: "stop" }, a, 150);
}

ev("task_created", { url: "https://github.com/sissbruecker/linkding", owner: "sissbruecker", repo: "linkding", repoKind: "adapted", adapterId: "linkding", runtimeRulesVersion: "0.1.0" }, system, 0);
for (const [path, bytes] of [
  ["README.md", 6120],
  ["bookmarks/models.py", 14872],
  ["bookmarks/api/serializers.py", 6410],
  ["bookmarks/api/routes.py", 9730],
  ["bookmarks/services/tags.py", 1810],
  ["bookmarks/services/bookmarks.py", 11220],
] as const) {
  ev("file_read", { path, bytes }, role("architecture"), 900);
}
ev("finding_recorded", { kind: "endpoint", text: "REST API: /api/bookmarks/ supports create, PATCH and archive with token auth", evidence: [{ path: "bookmarks/api/routes.py", snippet: "class BookmarkViewSet" }], evidenceStatus: "passed" }, role("architecture"));
ev("finding_recorded", { kind: "finding", text: "Tags are free text per user; nothing suggests them", evidence: [{ path: "bookmarks/services/tags.py", snippet: "def get_or_create_tags" }], evidenceStatus: "passed" }, role("architecture"));
enter("adapter_branch", "reading_done");
enter("sandbox_start", "adapted_repo");
ev("tool_started", { callId: "sb1", tool: "sandbox_start", inputSummary: "linkding 1.47.0 (pinned digest)" }, system, 300);
ev("tool_finished", { callId: "sb1", tool: "sandbox_start", ok: true, outputSummary: "health in 34 s, test data seeded, equality check passed" }, system, 4000);
enter("browser_experience", "sandbox_ready");
const op = role("product");
ev("browser_action", { action: "browser_open", target: "/bookmarks", ok: true }, op, 1500);
ev("browser_observation", { snapshotSummary: "Bookmarks list with search, tag cloud and 12 items", screenshotRef: "shots/1.jpg" }, op, 900);
ev("browser_action", { action: "browser_click", target: 'button "Add bookmark"', ok: false }, op, 1500);
ev("failure", { failureClass: "interface_call_failure", source: "browser", detail: 'target button "Add bookmark" not found in the last snapshot' }, op, 200);
ev("browser_action", { action: "browser_snapshot", target: "", ok: true }, op, 900);
ev("browser_action", { action: "browser_click", target: 'link "Add bookmark"', ok: true }, op, 1200);
ev("browser_observation", { snapshotSummary: "Add form: URL, title, description, tags (free text)", screenshotRef: "shots/2.jpg" }, op, 900);
ev("judge_message", { clientMsgId: "j1", to: "all", text: "Look at how tags are entered.", status: "queued", deliveredTo: [] }, { kind: "judge" }, 800);
enter("meeting", "experience_done", 1200);
ev("evidence_summary", { findings: ["REST API with token auth", "Tags are free text per user"], skipped: [], experienceNotes: ["Add form needs manual tags", "One failed click, recovered"], screenshotRefs: ["shots/1.jpg", "shots/2.jpg"], partial: false }, system, 300);
ev("judge_message_delivered", { clientMsgIds: ["j1"], deliveredTo: ["moderator", "product", "architecture", "risk_and_security", "verification"] }, system, 200);
say("moderator", "m1", "", "Evidence summary: 6 files read, browser experience complete with one failed click. The Judge asked us to look at how tags are entered. Product, please start.");
say(
  "product",
  "m2",
  "Tags are user-specific. A suggestion has to come from the user's own vocabulary, otherwise it adds noise. The add form is the place where the user decides.",
  "Suggest tags on the add form, taken only from the user's existing tags, and let the user confirm each one. Evidence: bookmarks/services/tags.py and the add form in browser step 5.",
);
ev("card_opened", { cardId: "q1", kind: "question", title: "Should suggested tags be applied automatically or only after you confirm?", body: "The roles disagree. Product prefers confirmation; Architecture says automatic is simpler.", options: [{ id: "confirm", label: "After I confirm" }, { id: "auto", label: "Automatically" }], allowFreeText: true }, role("moderator"), 700);

const out = join(import.meta.dirname, "../../packages/shared/test/fixtures/synthetic-gathering-meeting.jsonl");
writeFileSync(out, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
console.log(`wrote ${lines.length} lines, ${(t / 1000).toFixed(1)} s, to ${out}`);
