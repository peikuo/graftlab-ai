// The plan in feature words (R19.11) and the Output_Docs view (R4.1, R20.8, R20.10). Everything comes from
// events: the plan from plan_proposed, the documents from output_doc. Assessments carry their LLM label.
import { markdownToHtml } from "../markdown.ts";
import { describeCheck, OUTPUT_DOC_TITLES, PlanSchema, storyEffort, type OutputDocKind, type Plan, type RequirementsDoc, type TaskBoard, type UiState } from "@graftlab/shared";

export function parsePlan(content: unknown): Plan | null {
  const r = PlanSchema.safeParse(content);
  return r.success ? r.data : null;
}

function Effort({ plan, storyId }: { plan: Plan; storyId: string }) {
  const effort = storyEffort(plan, storyId);
  return (
    <>
      <span className={`badge ${effort === "large" ? "red" : effort === "medium" ? "amber" : effort === "small" ? "green" : ""}`}>effort {effort}</span>
      {effort === "large" && <span className="badge red">Large change: engineering risk</span>}
    </>
  );
}

/** The stories the Judge confirms or sends back. */
export function PlanStories({ plan }: { plan: Plan }) {
  const risk = (id: string) => plan.assessments.risk.find((a) => a.storyId === id);
  const feas = (id: string) => plan.assessments.feasibility.find((a) => a.storyId === id);
  return (
    <div className="plan">
      <p className="plan-goal">
        <b>Sprint goal:</b> {plan.sprintPlan.goal}
      </p>
      <ol className="plan-stories">
        {plan.backlog.stories.map((s) => (
          <li key={s.id} className="plan-story">
            <div className="plan-story-head">
              <b>{s.title}</b> <Effort plan={plan} storyId={s.id} />
              <span className="badge">{s.featureContract.executionKind === "source_change" ? "changes the code" : "uses the app's API"}</span>
            </div>
            <p>{s.featureContract.feature}</p>
            <p className="small">
              <span aria-hidden="true">👁</span> You will see: {s.demoPoint.description}
            </p>
            <details className="fold small">
              <summary>What it should and should not do</summary>
              <ul className="clean">
                {s.featureContract.shouldDo.map((x) => (
                  <li key={x}>✓ {x}</li>
                ))}
                {s.featureContract.shouldNotDo.map((x) => (
                  <li key={x}>✕ {x}</li>
                ))}
              </ul>
              {s.featureContract.acceptanceChecks.length > 0 && (
                <>
                  <p className="muted">Checked by the Verifier (code, no AI):</p>
                  <ul className="clean">
                    {s.featureContract.acceptanceChecks.map((c) => (
                      <li key={c.id}>{describeCheck(c)}</li>
                    ))}
                  </ul>
                </>
              )}
              {(feas(s.id)?.concerns || risk(s.id)?.risk) && (
                <p className="muted">
                  LLM assessment, not a guarantee: {[feas(s.id)?.concerns, risk(s.id)?.risk ? `risk: ${risk(s.id)!.risk}${risk(s.id)!.conditions ? ` (only if ${risk(s.id)!.conditions})` : ""}` : ""].filter(Boolean).join(" · ")}
                </p>
              )}
            </details>
          </li>
        ))}
      </ol>
      {plan.facilitatorNote && (
        <p className="small">
          <b>Facilitator:</b> {plan.facilitatorNote}
        </p>
      )}
    </div>
  );
}

function DocBody({ kind, content }: { kind: OutputDocKind; content: unknown }) {
  const c = content as Record<string, unknown>;
  switch (kind) {
    case "product_backlog": {
      const stories = (c.stories ?? []) as Plan["backlog"]["stories"];
      return (
        <ol className="clean small">
          {stories.map((s) => (
            <li key={s.id}>
              <b>
                {s.id} {s.title}
              </b>{" "}
              (priority {s.priority}) — {s.userStory}
              <div className="muted">Demo: {s.demoPoint.description}</div>
            </li>
          ))}
        </ol>
      );
    }
    case "sprint_plan":
      return (
        <p className="small">
          Goal: {String(c.goal)} · stories {((c.storyIds ?? []) as string[]).join(", ")}
        </p>
      );
    case "definition_of_done":
      return (
        <ul className="clean small">
          {((c.checklist ?? []) as string[]).map((x) => (
            <li key={x}>☐ {x}</li>
          ))}
        </ul>
      );
    case "task_board": {
      const label = { to_do: "to do", in_progress: "in progress", done: "done", blocked: "blocked" } as const;
      return (
        <table className="small board-table">
          <tbody>
            {(c as TaskBoard).items.map((i) => (
              <tr key={i.id}>
                <td>{i.storyId}</td>
                <td>{i.title}</td>
                <td>
                  <span className={`badge ${i.status === "done" ? "green" : i.status === "blocked" ? "red" : i.status === "in_progress" ? "amber" : ""}`}>{label[i.status]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    case "requirements":
      return (
        <ul className="clean small">
          {(c as RequirementsDoc).items.map((i) => (
            <li key={i.id}>
              {i.storyId}: {i.text}
            </li>
          ))}
        </ul>
      );
    default:
      return null;
  }
}

/** The Output_Docs of the Task; a document of an older Decision_Doc version is marked (R20.10). */
export function DocsList({ state }: { state: UiState }) {
  const current = Math.max(0, ...state.decisionDocs.filter((d) => d.frozen).map((d) => d.version));
  const docs = Object.values(state.outputDocs).filter((d): d is NonNullable<typeof d> => !!d).sort((a, b) => a.seq - b.seq);
  if (docs.length === 0) return null;
  return (
    <ul className="clean docs-list">
      {docs.map((d) => (
        <li key={d.kind} className="doc-row">
          <details className="fold">
            <summary>
              <span aria-hidden="true">📄</span> {OUTPUT_DOC_TITLES[d.kind as OutputDocKind]} <span className="muted small">· Decision v{d.decisionVersion}</span>
              {d.decisionVersion < current && <span className="badge amber">based on an older version</span>}
            </summary>
            {d.markdown ? <article className="md-doc" dangerouslySetInnerHTML={{ __html: markdownToHtml(d.markdown) }} /> : <DocBody kind={d.kind as OutputDocKind} content={d.content} />}
            <div className="mono muted small">{d.ref}</div>
          </details>
        </li>
      ))}
    </ul>
  );
}
