// Node ids of the Flow_Graph (design.md, "Flow_Graph", node table).
// Kept in their own module so events.ts and graph.ts can both import them without a cycle.

export const TERMINAL_IDS = ["success", "failed", "aborted", "analysis_only", "docs_only"] as const;

export const NODE_IDS = [
  // evidence gathering
  "reading",
  "adapter_branch",
  "sandbox_start",
  "browser_experience",
  // meeting and decision
  "meeting",
  "prototype",
  "deciding",
  "awaiting_confirmation",
  "frozen",
  // planning and documents
  "planning",
  "documenting",
  "adapter_branch_2",
  "target_check",
  // source-change stories
  "story_develop",
  "story_review",
  "story_ask",
  "story_run",
  "story_checkpoint",
  "verifying",
  // API-operation stories
  "api_read",
  "api_plan",
  "api_suggest",
  "api_confirm",
  "api_try_one",
  "api_write_batch",
  "api_read_back",
  // terminals
  ...TERMINAL_IDS,
] as const;

export type NodeId = (typeof NODE_IDS)[number];
export type TerminalId = (typeof TERMINAL_IDS)[number];

export const GATHERING_NODES = ["sandbox_start", "browser_experience"] as const satisfies readonly NodeId[];
export const EVIDENCE_GATHERING_NODES = ["reading", ...GATHERING_NODES] as const satisfies readonly NodeId[];

export function isTerminal(node: NodeId): node is TerminalId {
  return (TERMINAL_IDS as readonly string[]).includes(node);
}
