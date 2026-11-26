import { describe, expect, it } from "vitest";
import { DOWN_AFTER_MS, downSeconds } from "./backend.tsx";

describe("backend unreachable banner (17.3)", () => {
  it("shows only after the grace period, with the real seconds since the drop", () => {
    expect(downSeconds(true, 0, 60_000)).toBeNull();
    expect(downSeconds(false, null, 60_000)).toBeNull();
    expect(downSeconds(false, 1000, 1000 + DOWN_AFTER_MS - 1)).toBeNull();
    expect(downSeconds(false, 1000, 1000 + DOWN_AFTER_MS)).toBe(8);
    expect(downSeconds(false, 1000, 1000 + 95_400)).toBe(95);
  });
});
