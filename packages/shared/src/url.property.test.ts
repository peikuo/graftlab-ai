import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatRepoUrl, isValidOwner, isValidRepo, matchesAdapter, parseRepoUrl } from "./url.ts";

const ownerArb = fc.stringMatching(/^[A-Za-z0-9](?:[A-Za-z0-9]|-[A-Za-z0-9]){0,12}$/).filter(isValidOwner);
const repoArb = fc.stringMatching(/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,20}$/).filter(isValidRepo);

const formArb = (owner: string, repo: string) =>
  fc
    .record({
      scheme: fc.constantFrom("", "http://", "https://", "HTTPS://"),
      www: fc.constantFrom("", "www."),
      host: fc.constantFrom("github.com", "GitHub.com"),
      git: fc.boolean(),
      slash: fc.boolean(),
      pad: fc.constantFrom("", " ", "  "),
    })
    .map((f) => `${f.pad}${f.scheme}${f.www}${f.host}/${owner}/${repo}${f.git ? ".git" : ""}${f.slash ? "/" : ""}${f.pad}`);

const adapter = { match: { owner: "sissbruecker", repo: "linkding" } };

describe("GitHub URL parsing", () => {
  // Feature: graftlab-ai, Property 14: Home URL validation round trip
  it("every accepted form parses to the same owner and repository, and format then parse is the identity", () => {
    fc.assert(
      fc.property(
        ownerArb.chain((o) => repoArb.chain((r) => formArb(o, r).map((input) => ({ o, r, input })))),
        ({ o, r, input }) => {
          const p = parseRepoUrl(input);
          expect(p).toEqual({ ok: true, owner: o, repo: r, normalized: formatRepoUrl(o, r) });
          if (p.ok) expect(parseRepoUrl(p.normalized)).toEqual(p);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("strings outside the grammar are refused with the expected form", () => {
    const outside = fc.oneof(
      fc.string({ maxLength: 40 }),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `https://gitlab.com/${o}/${r}`),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `https://github.com/${o}/${r}/tree/main`),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `https://github.com/${o}`),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `https://github.com/-${o}/${r}`),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `https://github.com/${o}/${r}?tab=readme`),
      fc.tuple(ownerArb, repoArb).map(([o, r]) => `ftp://github.com/${o}/${r}`),
    );
    fc.assert(
      fc.property(outside, (s) => {
        const m = /^\s*(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?\s*$/i.exec(s);
        fc.pre(!(m && isValidOwner(m[1]!) && isValidRepo(m[2]!)));
        const p = parseRepoUrl(s);
        expect(p.ok).toBe(false);
        if (!p.ok) expect(p.error).toContain("https://github.com/<owner>/<repository>");
      }),
      { numRuns: 300 },
    );
  });

  it("the Adapted_Repo label is given iff the pair matches the Adapter case-insensitively", () => {
    const pairArb = fc.oneof(
      fc.tuple(ownerArb, repoArb),
      fc.tuple(fc.constantFrom("sissbruecker", "SissBruecker", "SISSBRUECKER"), fc.constantFrom("linkding", "LinkDing", "linkding-fork")),
    );
    fc.assert(
      fc.property(pairArb, ([o, r]) => {
        const p = parseRepoUrl(formatRepoUrl(o, r));
        fc.pre(p.ok);
        if (p.ok) expect(matchesAdapter(p, adapter)).toBe(o.toLowerCase() === "sissbruecker" && r.toLowerCase() === "linkding");
      }),
      { numRuns: 200 },
    );
  });

  it("examples", () => {
    expect(parseRepoUrl("github.com/sissbruecker/linkding")).toMatchObject({ ok: true, normalized: "https://github.com/sissbruecker/linkding" });
    expect(parseRepoUrl("https://github.com/sissbruecker/linkding.git")).toMatchObject({ ok: true, repo: "linkding" });
    expect(parseRepoUrl("https://github.com/sissbruecker/linkding/issues").ok).toBe(false);
    expect(parseRepoUrl("linkding").ok).toBe(false);
  });
});
