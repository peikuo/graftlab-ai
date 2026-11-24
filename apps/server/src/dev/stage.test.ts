import { describe, expect, it } from "vitest";
import { shellCommand } from "./stage.ts";

describe("shellCommand", () => {
  it("quotes every argument and splits a one-string command into words", () => {
    expect(shellCommand(["python", "-m", "pytest", "a b.py"])).toBe("'python' '-m' 'pytest' 'a b.py'");
    expect(shellCommand(["uv run manage.py test bookmarks.tests.test_x"])).toBe("'uv' 'run' 'manage.py' 'test' 'bookmarks.tests.test_x'");
    expect(shellCommand(["it's"])).toBe("'it'\\''s'");
  });
});
describe("ownModelClients (R40.23)", () => {
  it("names files outside the AI client that call the chat endpoint or read GL_AI_*", async () => {
    const { ownModelClients } = await import("./stage.ts");
    const patch = [
      "+++ b/bookmarks/services/ai.py",
      '+    url = os.environ["GL_AI_BASE_URL"] + "/chat/completions"',
      "+++ b/graftlab_ai/__init__.py",
      '+    base = os.environ.get("GL_AI_BASE_URL")',
      "+++ b/bookmarks/tests/test_ai.py",
      '+    os.environ["GL_AI_MODEL"] = "m"',
      "+++ b/bookmarks/views.py",
      "+    r = graftlab_ai.ask(system, user)",
    ].join("\n");
    expect(ownModelClients(patch, "graftlab_ai")).toEqual(["bookmarks/services/ai.py"]);
  });
});
