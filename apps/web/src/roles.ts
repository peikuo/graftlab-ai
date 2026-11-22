// Agents shown in the Team panel (requirements.md, "Roles and Queue Rules"; design.md, "UI design").
// Agents are split by function; the three Meeting_Perspectives appear only during the meeting and the decision.
import type { ActorKey } from "@graftlab/shared";

export type CardGroup = "work" | "meeting" | "checker";

export interface RoleCard {
  key: ActorKey;
  name: string;
  /** What the agent does, in a few plain words (shown under the name). */
  job: string;
  avatar: string;
  group: CardGroup;
  /** The Verifier is code, not an LLM: a different card with no reasoning section. */
  kind: "agent" | "verifier";
}

export const ROLE_CARDS: RoleCard[] = [
  { key: "reader", name: "Reader", job: "Reads the code", avatar: "🦇", group: "work", kind: "agent" },
  { key: "explorer", name: "Explorer", job: "Tries the app in a browser", avatar: "🕷", group: "work", kind: "agent" },
  { key: "facilitator", name: "Facilitator", job: "Runs the meeting, writes the decision", avatar: "🧙", group: "work", kind: "agent" },
  { key: "planner", name: "Planner", job: "Splits work into stories", avatar: "📜", group: "work", kind: "agent" },
  { key: "code_agent", name: "Code_Agent", job: "Builds in a private copy", avatar: "🧪", group: "work", kind: "agent" },
  { key: "reviewer", name: "Reviewer", job: "Reviews each change", avatar: "🐈", group: "work", kind: "agent" },
  { key: "user_value", name: "User_Value", job: "What users gain", avatar: "🎃", group: "meeting", kind: "agent" },
  { key: "feasibility", name: "Feasibility", job: "How it can be built", avatar: "🧟", group: "meeting", kind: "agent" },
  { key: "risk", name: "Risk", job: "What can go wrong", avatar: "💀", group: "meeting", kind: "agent" },
  { key: "verifier", name: "Verifier", job: "Checks the result · code, no AI", avatar: "⚖", group: "checker", kind: "verifier" },
];

export const ACTOR_LABEL: Record<string, { name: string; avatar: string }> = {
  ...Object.fromEntries(ROLE_CARDS.map((r) => [r.key, { name: r.name, avatar: r.avatar }])),
  judge: { name: "You", avatar: "🙂" },
  system: { name: "Studio", avatar: "⚙" },
};
