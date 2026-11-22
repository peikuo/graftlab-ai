import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { DemoApp } from "./demo/DemoApp.tsx";
import "./styles.css";

const demo = window.location.pathname.startsWith("/demo");
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      {demo ? <DemoApp /> : <App />}
    </StrictMode>,
  );
