// The demo story on MOCK DATA: linkding from the URL to a verified feature. Texts are written for the demo and
// are not model output. The script waits for the Judge at the question, the decision review and the checkpoint.
import type { Draft, ReviewItem } from "../components/DecisionReview.tsx";
import type { DecisionDesk } from "./decision.ts";
import type { DemoEngine } from "./engine.ts";

const role = (roleId: "moderator" | "product" | "architecture" | "risk_and_security" | "verification" | "tech_manager") => ({ kind: "role" as const, roleId });
const hash = (s: string) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(16).padStart(8, "0");
};
const item = (i: Omit<ReviewItem, "hash">): ReviewItem => ({ ...i, hash: hash(JSON.stringify(i)) });

function firstDraft(answer: string): Draft {
  return {
    draftId: "d1",
    number: 1,
    items: [
      item({ id: "purpose", title: "1 What we make AI-powered", summary: "Adding a bookmark: suggest tags from your own tags (purpose B: AI helps, you decide)." }),
      item({ id: "scope", title: "2 Scope", summary: "In: tag suggestions on the add form. Out: bulk retagging, creating new tags, other pages." }),
      item({
        id: "approach",
        title: "3 How we build it",
        summary: "Three options were assessed by the team.",
        options: [
          { id: "ui", label: "A “Suggest tags” button on the add form", detail: "effort M · risk low", complete: true },
          { id: "agent", label: "A separate agent that tags new bookmarks through the API", detail: "effort S · risk medium", complete: true },
          { id: "mix", label: "Both", detail: "effort L", complete: false },
        ],
      }),
      item({ id: "ui", title: "4 What you will see", summary: `A “Suggest tags” button under the tag field. Suggestions appear as a dropdown list. ${answer === "auto" ? "They are applied automatically." : "Nothing is applied until you click one."}` }),
      item({
        id: "checks",
        title: "5 How success is checked",
        summary: "The Verifier (code, no AI) runs these checks after the build:",
        details: ["Browser check: the add form shows “Suggest tags”, clicking it shows your tags", "linkding's own tests for tag suggestions pass"],
        unverified: "one cited file (bookmarks/views/ai.py) does not exist in the repository",
      }),
      item({ id: "risks", title: "6 Risks", summary: "Suggestions could show tags from another user. Mitigation: suggestions are read only from the signed-in user's tags." }),
      item({ id: "open", title: "7 Open questions", summary: "None left after your answer in the meeting." }),
    ],
  };
}

function revise(d: Draft, rejected: { item: ReviewItem; reason: string }[]): Draft {
  const reasons = new Map(rejected.map((r) => [r.item.id, r.reason]));
  return {
    draftId: `d${d.number + 1}`,
    number: d.number + 1,
    items: d.items.map((i) => {
      const reason = reasons.get(i.id);
      if (!reason) return i;
      const { hash: _h, ...rest } = i;
      return item({ ...rest, summary: `${i.summary.replace("as a dropdown list", "as clickable chips")} (Revised after your note: “${reason}”.)`, ...(i.unverified ? {} : {}) });
    }),
  };
}

async function replyToMessages(e: DemoEngine): Promise<void> {
  for (const m of e.takeMessages()) {
    await e.say("moderator", `You said: “${m.text}”. Noted. I will keep it in mind for the next step and bring it into the decision if it changes anything.`);
  }
}

export async function runDemo(e: DemoEngine, desk: DecisionDesk, url: string): Promise<void> {
  // F1-F2: reading
  e.emit("task_created", { url, owner: "sissbruecker", repo: "linkding", repoKind: "adapted", adapterId: "linkding", runtimeRulesVersion: "demo" });
  e.emit("node_entered", { from: null, to: "reading", edgeId: "task_start" });
  for (const [path, bytes] of [
    ["README.md", 6120],
    ["bookmarks/models.py", 14872],
    ["bookmarks/api/serializers.py", 6410],
    ["bookmarks/api/routes.py", 9730],
    ["bookmarks/services/tags.py", 1810],
    ["bookmarks/templates/bookmarks/form.html", 5320],
  ] as const) {
    await e.sleep(650);
    e.emit("file_read", { path, bytes }, role("architecture"));
  }
  await e.sleep(400);
  e.emit("finding_recorded", { kind: "endpoint", text: "There is a REST API to create, change and archive bookmarks", evidence: [{ path: "bookmarks/api/routes.py", snippet: "class BookmarkViewSet", status: "passed" }], evidenceStatus: "passed" }, role("architecture"));
  await e.sleep(400);
  e.emit("finding_recorded", { kind: "finding", text: "Tags are typed by hand; nothing suggests them", evidence: [{ path: "bookmarks/services/tags.py", snippet: "def get_or_create_tags", status: "passed" }], evidenceStatus: "passed" }, role("architecture"));
  await e.sleep(500);
  e.enter("adapter_branch", "reading_done");
  await e.sleep(500);

  // F4-F5: try the app (the Judge may start the meeting early)
  let early = false;
  void e.waitSignal("start_meeting").then(() => (early = true));
  e.enter("sandbox_start", "adapted_repo");
  e.emit("tool_started", { callId: "sb", tool: "sandbox_start", inputSummary: "linkding 1.47.0 with test data" });
  await e.sleep(3000);
  e.emit("tool_finished", { callId: "sb", tool: "sandbox_start", ok: true, outputSummary: "app ready in 34 s, 12 test bookmarks loaded" });
  if (!early) {
    e.enter("browser_experience", "sandbox_ready");
    const op = role("product");
    const steps: [string, string, boolean, string?][] = [
      ["open", "the bookmarks page", true, "A list of 12 bookmarks with search and a tag cloud"],
      ["click", "button “Add bookmark”", false],
      ["look", "at the page again", true, "The control is a link, not a button"],
      ["click", "link “Add bookmark”", true, "The add form: URL, title, description, tags"],
      ["type", "a URL into the URL field", true, "Title and description are filled in, tags stay empty"],
    ];
    for (const [action, target, ok, seen] of steps) {
      if (early) break;
      await e.sleep(1400);
      e.emit("browser_action", { action, target, ok }, op);
      if (!ok) e.emit("failure", { failureClass: "interface_call_failure", source: "browser", detail: `could not ${action} ${target}: not on the page` }, op);
      if (seen) {
        await e.sleep(600);
        e.emit("browser_observation", { snapshotSummary: seen, screenshotRef: `mock-${action}` }, op);
      }
    }
  }
  if (e.hasSignal("start_meeting")) e.signal("start_meeting"); // clear the pending signal
  e.enter("meeting", early ? "experience_judge_end" : "experience_done");

  // F3: meeting
  e.emit("evidence_summary", { findings: ["REST API for bookmarks", "Tags are typed by hand"], skipped: [], experienceNotes: early ? ["You started the meeting early"] : ["Adding a bookmark needs tags typed by hand", "One failed click, recovered"], screenshotRefs: [], partial: early });
  const queued = e.takeMessages();
  if (queued.length > 0) e.emit("judge_message_delivered", { clientMsgIds: queued.map((m) => m.clientMsgId), deliveredTo: ["moderator", "product", "architecture", "risk_and_security", "verification"] });
  await e.say("moderator", `Welcome. We read 6 files${early ? " and you started the meeting early, so the app test is partial" : " and tried the app: adding a bookmark works, but every tag must be typed by hand"}.${queued.length ? ` You asked: “${queued.map((m) => m.text).join("”, “")}”. We will cover it.` : ""} Product, where can AI help most?`);
  await e.say(
    "product",
    "The add form is where people spend effort. Suggesting tags from the tags they already use saves typing and keeps their tag list tidy. The user should stay in control.",
    "Who is the user? Someone saving links quickly. Pain: typing tags, inconsistent tags. AI can suggest, but must not invent a messy tag list. Purpose B: AI helps, the person decides.",
  );
  await e.say("architecture", "This is a small change: one endpoint that returns matching tags, and a button in the add form. The data is already there in the tag table.");
  await e.say("risk_and_security", "One risk: never suggest tags from another user's data. Suggestions must only use the signed-in user's tags.");
  await replyToMessages(e);
  const q = await e.ask(
    "q1",
    { kind: "question", title: "Should suggested tags be applied automatically, or only after you click them?", body: "Product prefers you to confirm each tag. Architecture says automatic is simpler to build.", options: [{ id: "confirm", label: "Only after I click them" }, { id: "auto", label: "Automatically" }], allowFreeText: true },
    role("moderator"),
  );
  const answer = q.optionId ?? "text";
  await e.say("moderator", q.text ? `Thanks. Your answer: “${q.text}”. We will write the decision draft with that.` : answer === "auto" ? "Thanks: suggestions are applied automatically. We will write the decision draft with that." : "Thanks: nothing is applied until you click a suggestion. We will write the decision draft with that.");
  await e.say("verification", "I will turn the decision into checks the Verifier can run without AI: a browser check on the form and linkding's own tests.");
  e.enter("deciding", "meeting_summary_valid");

  // F6: decision with item review and freeze
  let draft = firstDraft(answer);
  for (;;) {
    await e.say("moderator", draft.number === 1 ? "The decision draft is ready. Please review each item on the right." : `Draft ${draft.number} is ready. We changed only the items you rejected; the others keep your verdict.`);
    desk.setDraft(draft);
    e.enter("awaiting_confirmation", "draft_valid");
    await e.waitSignal("decision");
    const rejected = desk.rejected();
    if (rejected.length === 0) break;
    e.enter("deciding", "send_back");
    await e.say("architecture", `Revising ${rejected.map((r) => r.item.title.replace(/^\d+ /, "")).join(" and ")} using your reasons.`);
    draft = revise(draft, rejected);
  }
  e.emit("decision_doc_version", { version: 1, content: { draft: draft.draftId, approach: desk.selected }, hash: hash(JSON.stringify(draft)) });
  e.emit("decision_doc_frozen", { version: 1, hash: hash(JSON.stringify(draft)), confirmedBy: "you", confirmedAt: new Date().toISOString() }, { kind: "judge" });
  e.enter("frozen", "freeze");
  await e.sleep(600);

  // F7-F8: planning and documents
  e.enter("planning", "frozen_recorded");
  await e.say("product", "Two stories. S1: suggest tags on the add form. S2: the same on the edit form. Each has a contract: what it must do, what it must not do, how it is checked.");
  e.emit("artifact_updated", { artifactKind: "doc", ref: "backlog", title: "Product backlog (2 stories)" });
  e.enter("documenting", "backlog_valid");
  for (const t of ["Requirements", "Design", "Tasks", "Task board"]) {
    await e.sleep(700);
    e.emit("artifact_updated", { artifactKind: t === "Task board" ? "task_board" : "doc", ref: t.toLowerCase().replace(" ", "-"), title: t });
  }
  e.enter("adapter_branch_2", "docs_complete");
  e.enter("target_check", "adapted_execute");
  e.emit("tool_started", { callId: "tc", tool: "target_check", inputSummary: "baseline app starts" });
  await e.sleep(1500);
  e.emit("tool_finished", { callId: "tc", tool: "target_check", ok: true, outputSummary: "ok" });
  await replyToMessages(e);

  // F10: build story S1
  e.enter("story_develop", "check_passed_source");
  const ca = { kind: "code_agent" as const };
  e.emit("tool_started", { callId: "c1", tool: "read", inputSummary: "bookmarks/services/tags.py" }, ca);
  await e.sleep(900);
  e.emit("tool_finished", { callId: "c1", tool: "read", ok: true, outputSummary: "" }, ca);
  await e.say("code_agent", "I will add a tag lookup for the signed-in user and a button on the form. One thing is not clear from the contract.");
  e.emit("question_opened", { questionId: "dq1", from: "code_agent", askedParty: "judge", kind: "feature", text: "Should suggestions include tags you used only once?" }, ca);
  const dq = await e.ask(
    "q2",
    { kind: "question", title: "Should suggestions include tags you have used only once?", body: "The developer stopped to ask instead of guessing. This is about how the feature behaves, so it comes to you.", options: [{ id: "yes", label: "Yes, all my tags" }, { id: "often", label: "Only tags I use often" }], allowFreeText: true },
    role("moderator"),
  );
  e.emit("question_answered", { questionId: "dq1", answer: dq.text ?? (dq.optionId === "often" ? "only tags used often" : "all tags") }, ca);
  for (const [i, f] of ["bookmarks/services/tags.py", "bookmarks/views/bookmarks.py", "bookmarks/templates/bookmarks/form.html", "bookmarks/settings.py"].entries()) {
    e.emit("tool_started", { callId: `w${i}`, tool: "edit", inputSummary: f }, ca);
    await e.sleep(800);
    e.emit("tool_finished", { callId: `w${i}`, tool: "edit", ok: true, outputSummary: "" }, ca);
  }
  e.emit("code_change", { storyId: "S1", attempt: 1, changedFiles: ["bookmarks/services/tags.py", "bookmarks/views/bookmarks.py", "bookmarks/templates/bookmarks/form.html", "bookmarks/settings.py"], diffRef: "diff-1" }, ca);
  e.enter("story_review", "attempt_finished");
  await e.say("tech_manager", "The change to settings is not part of this story's contract. Please remove it and keep the rest.");
  e.emit("review_verdict", { storyId: "S1", attempt: 1, verdict: "request_changes", reasons: ["settings changed outside the contract"], label: "reviewed by Tech_Manager (LLM judgment)" }, role("tech_manager"));
  e.enter("story_develop", "request_changes");
  e.emit("tool_started", { callId: "w9", tool: "edit", inputSummary: "revert bookmarks/settings.py" }, ca);
  await e.sleep(900);
  e.emit("tool_finished", { callId: "w9", tool: "edit", ok: true, outputSummary: "" }, ca);
  e.emit("code_change", { storyId: "S1", attempt: 2, changedFiles: ["bookmarks/services/tags.py", "bookmarks/views/bookmarks.py", "bookmarks/templates/bookmarks/form.html"], diffRef: "diff-2" }, ca);
  e.enter("story_review", "attempt_finished");
  await e.say("tech_manager", "Now the change stays inside the contract. Approved. This is my judgment only; the Verifier decides success.");
  e.emit("review_verdict", { storyId: "S1", attempt: 2, verdict: "approve", reasons: [], label: "reviewed by Tech_Manager (LLM judgment)" }, role("tech_manager"));
  e.enter("story_run", "approve");
  e.emit("tool_started", { callId: "run", tool: "start changed app", inputSummary: "" });
  await e.sleep(2200);
  e.emit("tool_finished", { callId: "run", tool: "start changed app", ok: true, outputSummary: "healthy" });

  for (let round = 1; ; round++) {
    e.enter("story_checkpoint", round === 1 ? "run_healthy" : "run_healthy");
    const c = await e.ask(
      `c${round}`,
      { kind: "checkpoint", title: "S1 Suggest tags on the add form", body: "This is the changed app. Click “Suggest tags” to see your own tags. Is this what you wanted?", options: [{ id: "ok", label: "Yes, this is right" }, { id: "no", label: "Not right" }], allowFreeText: true },
      role("moderator"),
    );
    if (c.optionId === "ok") break;
    e.enter("story_develop", "checkpoint_feedback");
    await e.say("code_agent", `Adjusting based on your feedback${c.text ? `: “${c.text}”` : ""}.`);
    await e.sleep(1500);
    e.emit("code_change", { storyId: "S1", attempt: 3, changedFiles: ["bookmarks/templates/bookmarks/form.html"], diffRef: "diff-3" }, ca);
    e.enter("story_review", "attempt_finished");
    e.emit("review_verdict", { storyId: "S1", attempt: 3, verdict: "approve", reasons: [], label: "reviewed by Tech_Manager (LLM judgment)" }, role("tech_manager"));
    e.enter("story_run", "approve");
    await e.sleep(1500);
  }

  e.enter("verifying", "checkpoint_done");
  await e.sleep(1500);
  e.emit("verifier_result", { storyId: "S1", checkId: "browser-1", items: [{ item: "add form shows Suggest tags", pass: true, expected: "visible", actual: "visible" }, { item: "click shows your tags", pass: true, expected: "python, django", actual: "python, django" }, { item: "no other user's tags", pass: true, expected: "none", actual: "none" }], pass: true }, { kind: "verifier" });
  await e.sleep(1200);
  e.emit("verifier_result", { storyId: "S1", checkId: "tests-1", items: [{ item: "bookmarks/tests/test_tag_suggestions.py", pass: true, expected: "pass", actual: "6 passed" }], pass: true }, { kind: "verifier" });
  e.enter("success", "verified_last");
  e.emit("terminal_reached", { terminal: "success", summary: { verifierPassed: 4, verifierFailed: 0, failuresByClass: { interface_call_failure: 1 }, unconfirmed: [], label: "Demo: story S1 only (mock data)" } });
}
