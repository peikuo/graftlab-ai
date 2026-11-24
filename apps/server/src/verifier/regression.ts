// Regression_Check (design.md, "Verifier"; R22.10): the target's whole test suite on `main` and on the pinned
// commit, compared test by test by code. No LLM. The output parser is chosen by the Adapter's `regression.format`.
import type { PayloadOf } from "@graftlab/shared";

export interface SuiteRun {
  /** Tests run, from the runner's summary; null when the summary is missing (the suite did not run). */
  ran: number | null;
  /** Ids of failing tests (failures and errors). */
  failed: string[];
  exitCode: number;
}

/**
 * Django's test runner (unittest): failures are reported under `FAIL: <test> (<dotted id>)` and
 * `ERROR: <test> (<dotted id>)` headers, the count in `Ran N tests`. The id in parentheses names the test.
 */
export function parseDjango(output: string, exitCode: number): SuiteRun {
  const failed = new Set<string>();
  let ran: number | null = null;
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r$/, "");
    const h = /^(?:FAIL|ERROR): (\S+)(?: \(([^)]+)\))?\s*$/.exec(line);
    if (h) failed.add(h[2] ? `${h[2]}${h[2].endsWith(`.${h[1]}`) ? "" : `.${h[1]}`}` : h[1]!);
    const r = /^Ran (\d+) tests? in /.exec(line);
    if (r) ran = Number(r[1]);
  }
  return { ran, failed: [...failed].sort(), exitCode };
}

/** The candidate module files of a dotted test id (`a.b.test_x.Case.test_y` gives a/b/test_x.py and shorter). */
export function moduleFiles(id: string): string[] {
  const parts = id.replace(/^unittest\.loader\._FailedTest\./, "").split(".");
  const out: string[] = [];
  for (let i = parts.length; i >= 1; i--) out.push(`${parts.slice(0, i).join("/")}.py`);
  return out;
}

/** Compares the two runs (R22.10). `existedAtPin` tells whether a file existed at the pinned commit. */
export function compareRuns(baseline: SuiteRun, main: SuiteRun, existedAtPin: (path: string) => boolean, cached: boolean): PayloadOf<"regression_result"> {
  const before = new Set(baseline.failed);
  const regressions: string[] = [];
  const newFailing: string[] = [];
  for (const id of main.failed) {
    if (before.has(id)) continue;
    (moduleFiles(id).some(existedAtPin) ? regressions : newFailing).push(id);
  }
  const ranMain = main.ran ?? 0;
  const ranBase = baseline.ran ?? 0;
  // A run without a summary did not run; a non-zero exit without any named failure is not explained either.
  const mainRan = main.ran !== null && !(main.exitCode !== 0 && main.failed.length === 0);
  return {
    baseline: { ran: ranBase, failed: baseline.failed },
    main: { ran: ranMain, failed: main.failed },
    newTests: ranMain - ranBase,
    regressions,
    newFailing,
    cached,
    pass: mainRan && regressions.length === 0 && newFailing.length === 0,
  };
}
