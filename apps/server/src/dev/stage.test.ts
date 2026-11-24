import { describe, expect, it } from "vitest";
import { shellCommand } from "./stage.ts";

describe("shellCommand", () => {
  it("quotes every argument and splits a one-string command into words", () => {
    expect(shellCommand(["python", "-m", "pytest", "a b.py"])).toBe("'python' '-m' 'pytest' 'a b.py'");
    expect(shellCommand(["uv run manage.py test bookmarks.tests.test_x"])).toBe("'uv' 'run' 'manage.py' 'test' 'bookmarks.tests.test_x'");
    expect(shellCommand(["it's"])).toBe("'it'\\''s'");
  });
});
