import { describe, expect, it } from "vitest";
import { detectOpen, EnvironmentProposalSchema, openDevEnv, proposalProblem, renderDockerfile, renderSetup, type EnvironmentProposal } from "./env.ts";

const py: EnvironmentProposal = { kind: "library", language: "python", install: ['pip install -r requirements-dev.txt'], test: ["python", "-m", "pytest", "-q"], difficulty: "simple", risks: [], summary: "A small library with pytest tests." };

describe("open execution environment (R42)", () => {
  it("detects the language and the repository's own container configuration", () => {
    expect(detectOpen(["buku.py", "setup.py", "requirements.txt", "tests/test_x.py"])).toEqual({ language: "python", containerConfig: [], dependencyFiles: ["setup.py", "requirements.txt"], notPossible: null });
    expect(detectOpen(["Dockerfile", "package.json", "src/index.js", "web/node_modules/x/package.json"])).toMatchObject({ language: "node", containerConfig: ["Dockerfile"] });
    expect(detectOpen(["pyproject.toml", "frontend/package.json", ".devcontainer/devcontainer.json", "compose.yaml"])).toMatchObject({ language: "python", containerConfig: [".devcontainer/devcontainer.json", "compose.yaml"] });
    expect(detectOpen(["main.go", "go.mod", "Dockerfile"]).notPossible).toMatch(/Python and Node/);
  });
  it("stops a service without its own container configuration", () => {
    expect(proposalProblem({ ...py, kind: "service" }, detectOpen(["setup.py"]))).toMatch(/service without its own container configuration/);
    expect(proposalProblem({ ...py, kind: "service" }, detectOpen(["setup.py", "Dockerfile"]))).toBeNull();
    expect(proposalProblem(py, detectOpen(["setup.py"]))).toBeNull();
    expect(proposalProblem({ ...py, language: "node" }, detectOpen(["setup.py"]))).toMatch(/repository is python/);
  });
  it("renders the Dockerfile from the template and the setup script from the commands", () => {
    const d = renderDockerfile("graftlab/dev-sandbox-linkding:latest", py);
    expect(d).toContain("FROM graftlab/dev-sandbox-linkding:latest");
    expect(d).toContain("ENV PYTHONPATH=/work/src:/work");
    expect(d.trim().split("\n").at(-1)).toBe("WORKDIR /work");
    const s = renderSetup(py);
    expect(s).toContain("python3 -m venv /opt/open-venv");
    expect(s.trim().split("\n").at(-1)).toBe("pip install -r requirements-dev.txt");
    expect(renderSetup({ ...py, language: "node", install: ["npm ci"] })).not.toContain("venv");
    expect(openDevEnv({ ...py, language: "node" }).prebuilt).toEqual(["node_modules"]);
  });
  it("refuses multi-line commands and unknown fields", () => {
    expect(EnvironmentProposalSchema.safeParse({ ...py, install: ["a\nb"] }).success).toBe(false);
    expect(EnvironmentProposalSchema.safeParse({ ...py, extra: 1 }).success).toBe(false);
  });
});
