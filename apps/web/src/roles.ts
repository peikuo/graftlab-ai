// Presence_Card data (design.md, "UI design": avatars and names). Descriptions follow the requirements roles table.
import type { ActorKey } from "@graftlab/shared";

export interface RoleCard {
  key: ActorKey;
  name: string;
  avatar: string;
  description: string;
  /** The Verifier is code, not an LLM: a different card with no reasoning section (design.md, "UI design"). */
  kind: "agent" | "verifier";
}

export const ROLE_CARDS: RoleCard[] = [
  { key: "moderator", name: "Moderator", avatar: "🧙", description: "Runs the meeting, summarizes, asks you", kind: "agent" },
  { key: "product", name: "Product", avatar: "🎃", description: "User value and workflows, A or B", kind: "agent" },
  { key: "architecture", name: "Architecture", avatar: "🦇", description: "Interfaces, data and integration", kind: "agent" },
  { key: "risk_and_security", name: "Risk_and_Security", avatar: "💀", description: "Risks; rules are enforced by code", kind: "agent" },
  { key: "verification", name: "Verification", avatar: "👻", description: "Acceptance criteria and checks", kind: "agent" },
  { key: "tech_manager", name: "Tech_Manager", avatar: "🐈", description: "Reviews changes against the contract", kind: "agent" },
  { key: "code_agent", name: "Code_Agent", avatar: "🧪", description: "Develops inside the Task container", kind: "agent" },
  { key: "verifier", name: "Verifier", avatar: "⚖", description: "code, no LLM · the only judge of success", kind: "verifier" },
];

export const ACTOR_LABEL: Record<string, { name: string; avatar: string }> = {
  ...Object.fromEntries(ROLE_CARDS.map((r) => [r.key, { name: r.name, avatar: r.avatar }])),
  judge: { name: "You", avatar: "🧑" },
  system: { name: "Studio", avatar: "⚙" },
};
