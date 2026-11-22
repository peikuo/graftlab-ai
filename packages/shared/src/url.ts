// GitHub repository URL parsing and Adapter matching (design.md, "packages/shared"; R9.2, R9.3, R9.5).
// Accepted forms: owner/repo with or without scheme (http, https), with or without "www.", with an optional
// trailing slash or ".git". Everything else is refused with an error that names the expected form.

export const EXPECTED_FORM = "https://github.com/<owner>/<repository>";

// GitHub user and organization names: letters, digits and single hyphens, 1-39 characters, no leading or trailing hyphen.
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// Repository names: letters, digits, ".", "_" and "-", up to 100 characters, not "." or "..".
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

export type ParsedRepoUrl = { ok: true; owner: string; repo: string; normalized: string } | { ok: false; error: string };

export function isValidOwner(owner: string): boolean {
  return OWNER.test(owner);
}

export function isValidRepo(repo: string): boolean {
  return REPO.test(repo) && repo !== "." && repo !== ".." && !repo.toLowerCase().endsWith(".git");
}

export function formatRepoUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}`;
}

export function parseRepoUrl(input: string): ParsedRepoUrl {
  const refuse: ParsedRepoUrl = { ok: false, error: `This is not a GitHub repository address. Expected: ${EXPECTED_FORM}` };
  const text = input.trim();
  const m = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s?#]+)\/([^/\s?#]+?)(?:\.git)?\/?$/i.exec(text);
  if (!m) return refuse;
  const owner = m[1]!;
  const repo = m[2]!;
  if (!isValidOwner(owner) || !isValidRepo(repo)) return refuse;
  return { ok: true, owner, repo, normalized: formatRepoUrl(owner, repo) };
}

/** Case-insensitive match of a normalized owner and repository against an Adapter's match pair (R9.5). */
export function matchesAdapter(parsed: { owner: string; repo: string }, adapter: { match: { owner: string; repo: string } }): boolean {
  return parsed.owner.toLowerCase() === adapter.match.owner.toLowerCase() && parsed.repo.toLowerCase() === adapter.match.repo.toLowerCase();
}
