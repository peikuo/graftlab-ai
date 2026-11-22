import { describe, expect, it } from "vitest";
import { Lease } from "./lease.ts";

function setup() {
  let now = 0;
  const lease = new Lease({ idleReleaseMs: 120_000, now: () => now });
  return { lease, advance: (ms: number) => (now += ms) };
}

describe("Lease", () => {
  it("the first session becomes the operator; later sessions queue in order", () => {
    const { lease } = setup();
    expect(lease.join("a").role).toBe("operator");
    expect(lease.join("b")).toMatchObject({ role: "queued", position: 1 });
    expect(lease.join("c")).toMatchObject({ role: "queued", position: 2 });
    expect(lease.isOperator("a")).toBe(true);
    expect(lease.isOperator("b")).toBe(false);
    expect(lease.view("x").role).toBe("watching");
  });

  it("releases an idle operator only while no Task is active", () => {
    const { lease, advance } = setup();
    lease.join("a");
    lease.join("b");
    lease.taskStarted();
    advance(121_000);
    lease.heartbeat("b");
    expect(lease.isOperator("a")).toBe(true); // held during the Task
    lease.taskEnded();
    expect(lease.isOperator("b")).toBe(true); // promoted at Task end (R28.5)
    advance(121_000);
    expect(lease.isOperator("b")).toBe(false); // idle release without a Task
  });

  it("a closed queue admits no new sessions but keeps the operator", () => {
    const { lease } = setup();
    lease.join("a");
    lease.setOpen(false);
    expect(lease.join("b").role).toBe("watching");
    expect(lease.isOperator("a")).toBe(true);
  });

  it("leaving promotes the next session", () => {
    const { lease } = setup();
    lease.join("a");
    lease.join("b");
    lease.leave("a");
    expect(lease.isOperator("b")).toBe(true);
  });
});
