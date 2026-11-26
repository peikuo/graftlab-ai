import { describe, expect, it } from "vitest";
import { AccessCodes, parseAccessCodes } from "./access.ts";

describe("access codes (R28.7)", () => {
  it("is off without codes and refuses short codes in the configuration", () => {
    const a = new AccessCodes({ codes: [] });
    expect(a.required).toBe(false);
    expect(a.unlocked(undefined)).toBe(true);
    expect(a.takeTask(undefined)).toEqual({ ok: true });
    expect(parseAccessCodes(" judge-code-1 , judge-code-2 ")).toEqual(["judge-code-1", "judge-code-2"]);
    expect(parseAccessCodes(undefined)).toEqual([]);
    expect(() => parseAccessCodes("short")).toThrow(/code 1 is shorter/);
  });

  it("unlocks a session with any configured code", () => {
    const a = new AccessCodes({ codes: ["aaaaaaaa", "bbbbbbbb"] });
    expect(a.unlocked("s1")).toBe(false);
    expect(a.unlock("s1", "bbbbbbbb", "ip")).toEqual({ ok: true, codeIndex: 1 });
    expect(a.unlocked("s1")).toBe(true);
    expect(a.unlocked("s2")).toBe(false);
  });

  it("backs off after 5 wrong codes from one address and lets it try again after 15 min", () => {
    let now = 0;
    const a = new AccessCodes({ codes: ["aaaaaaaa"], now: () => now });
    for (let i = 0; i < 5; i++) expect(a.unlock("s", "wrong-code", "ip1")).toMatchObject({ ok: false, status: 401 });
    expect(a.unlock("s", "aaaaaaaa", "ip1")).toMatchObject({ ok: false, status: 429, retryAfterS: 900 });
    expect(a.unlock("s2", "aaaaaaaa", "ip2")).toMatchObject({ ok: true });
    now += 15 * 60_000 + 1;
    expect(a.unlock("s", "aaaaaaaa", "ip1")).toMatchObject({ ok: true });
  });

  it("counts wrong codes only inside the window", () => {
    let now = 0;
    const a = new AccessCodes({ codes: ["aaaaaaaa"], now: () => now });
    for (let i = 0; i < 4; i++) a.unlock("s", "x", "ip");
    now += 16 * 60_000;
    expect(a.unlock("s", "x", "ip")).toMatchObject({ status: 401 });
    expect(a.unlock("s", "aaaaaaaa", "ip")).toMatchObject({ ok: true });
  });

  it("caps Tasks per code per UTC day, shared by every session of that code", () => {
    let now = Date.parse("2026-12-01T10:00:00Z");
    const a = new AccessCodes({ codes: ["aaaaaaaa", "bbbbbbbb"], dailyTasks: 2, now: () => now });
    expect(a.takeTask("s1")).toMatchObject({ ok: false, status: 403 });
    a.unlock("s1", "aaaaaaaa", "ip");
    a.unlock("s2", "aaaaaaaa", "ip");
    a.unlock("s3", "bbbbbbbb", "ip");
    expect(a.takeTask("s1")).toEqual({ ok: true });
    expect(a.takeTask("s2")).toEqual({ ok: true });
    expect(a.takeTask("s1")).toMatchObject({ ok: false, status: 429 });
    expect(a.takeTask("s3")).toEqual({ ok: true });
    a.returnTask("s2");
    expect(a.takeTask("s2")).toEqual({ ok: true });
    now = Date.parse("2026-12-02T00:00:01Z");
    expect(a.takeTask("s1")).toEqual({ ok: true });
  });
});
