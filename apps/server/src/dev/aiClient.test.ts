// The prewritten AI client library (R40.23) has Python tests; they run here when python3 is available.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
const dir = join(import.meta.dirname, "../../../../runtime-libs/python");
const python = spawnSync("python3", ["--version"]).status === 0;
describe("graftlab_ai Python client", () => {
  it.skipIf(!python)("passes its own unit tests", () => {
    const r = spawnSync("python3", ["-m", "unittest", "test_graftlab_ai"], { cwd: dir, encoding: "utf8", env: { ...process.env, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" } });
    expect(r.stderr).toMatch(/OK/);
    expect(r.status).toBe(0);
  });
});
