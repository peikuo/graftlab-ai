import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { DemoApp } from "./demo/DemoApp.tsx";
import { ReplayApp } from "./replay/ReplayApp.tsx";
import "./styles.css";

const demo = window.location.pathname.startsWith("/demo");
const replay = /^\/replay\/([^/]+)$/.exec(window.location.pathname)?.[1];
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      {demo ? <DemoApp /> : replay ? <ReplayApp taskId={decodeURIComponent(replay)} /> : <App />}
    </StrictMode>,
  );
