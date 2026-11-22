// Evidence checker property and examples (tasks.md 6.3, 6.5; R24).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checkConclusion, checkRef, filesFrom } from "./check.ts";

// Feature: graftlab-ai, Property 9: Evidence check marks
describe("Property 9: evidence check marks", () => {
  const word = fc.stringMatching(/^[a-z_(){}=.:]{1,8}$/);
  const content = fc.array(fc.tuple(word, fc.constantFrom(" ", "  ", "\n", "\t", "\n    ")), { minLength: 1, maxLength: 40 }).map((ws) => ws.map(([w, s]) => w + s).join(""));
  const fileSet = fc.dictionary(fc.constantFrom("a.py", "b/c.ts", "d.md", "e/f.go"), content, { minKeys: 1 });
  // An independent oracle: rebuild the normalized form from whitespace-separated tokens.
  const tokens = (s: string) => s.split(/\s+/).filter(Boolean);
  const refArb = (files: Record<string, string>) => {
    const paths = Object.keys(files);
    const fromFile = fc.constantFrom(...paths).chain((p) => {
      const t = tokens(files[p]!);
      return fc.tuple(fc.nat({ max: t.length - 1 }), fc.integer({ min: 1, max: 6 }), fc.constantFrom(" ", "\n  ", "\t")).map(([i, n, sep]) => ({ path: p, snippet: t.slice(i, i + n).join(sep) }));
    });
    const random = fc.record({ path: fc.constantFrom(...paths, "missing.py", "skipped.bin"), snippet: fc.string({ maxLength: 30 }) });
    return fc.oneof(fromFile, random);
  };
  it("a conclusion passes iff one reference names a downloaded file containing the snippet (8+ non-whitespace chars)", () => {
    fc.assert(
      fc.property(
        fileSet.chain((files) => fc.tuple(fc.constant(files), fc.array(refArb(files), { maxLength: 4 }))),
        ([files, refs]) => {
          const set = filesFrom(new Map(Object.entries(files)), ["skipped.bin"]);
          const r = checkConclusion(refs, set);
          const oracle = refs.some((ref) => {
            const text = files[ref.path];
            if (text === undefined) return false;
            if (ref.snippet.replace(/\s/g, "").length < 8) return false;
            return tokens(text).join(" ").includes(tokens(ref.snippet).join(" "));
          });
          expect(r.status === "passed").toBe(oracle);
          // every conclusion has a passed reference or the Unverified mark, and every reference has a status
          expect(r.status === "passed" ? r.evidence.some((e) => e.status === "passed") : r.evidence.every((e) => e.status === "unverified")).toBe(true);
          for (const e of r.evidence) expect(e.status === "passed" || typeof e.reason === "string").toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("evidence checker examples (R24.2, R24.3)", () => {
  const files = filesFrom(new Map([["bookmarks/models.py", "class Bookmark(models.Model):\n    url = models.CharField(\n        max_length=2048)\n"]]), ["logo.png"]);
  it("passes across different whitespace and keeps the line number", () => {
    expect(checkRef({ path: "bookmarks/models.py", line: 2, snippet: "url = models.CharField( max_length=2048)" }, files)).toEqual({ path: "bookmarks/models.py", line: 2, snippet: "url = models.CharField( max_length=2048)", status: "passed" });
  });
  it("names the reason when a reference fails", () => {
    expect(checkRef({ path: "nope.py", snippet: "class Bookmark" }, files).reason).toBe("file_missing");
    expect(checkRef({ path: "logo.png", snippet: "class Bookmark" }, files).reason).toBe("not_downloaded");
    expect(checkRef({ path: "bookmarks/models.py", snippet: "class B" }, files).reason).toBe("snippet_too_short");
    expect(checkRef({ path: "bookmarks/models.py", snippet: "class Tag(models.Model)" }, files).reason).toBe("snippet_absent");
  });
  it("a conclusion without references is Unverified", () => {
    expect(checkConclusion([], files).status).toBe("unverified");
  });
});
