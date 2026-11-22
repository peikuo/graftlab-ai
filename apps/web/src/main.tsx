// Placeholder entry. The Workspace skeleton follows in milestone 3 (tasks.md),
// laid out after the mocks in .kiro/specs/graftlab-ai/ui/.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { NODE_IDS } from "@graftlab/shared";

function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>GraftLab AI</h1>
      <p>Foundations build. Flow_Graph nodes: {NODE_IDS.length}</p>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
