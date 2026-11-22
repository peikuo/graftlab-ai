// Read-only GitHub client (design.md, "Repo_Reader"; R9.4, R10.1, R34.1, R34.4, R34.5).
// The token is used only here, in a request header, and never appears in an event, a log line or an error
// message (first guard, R30.15). Error messages are rebuilt from the status code and the path only.

export interface GitHubConfig {
  token?: string;
  apiBase?: string; // default https://api.github.com
  rawBase?: string; // default https://raw.githubusercontent.com
  fetchImpl?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly kind: "not_found" | "not_public" | "rate_limited" | "http" | "network",
  ) {
    super(message);
  }
}

export interface RepoMeta {
  owner: string;
  repo: string;
  defaultBranch: string;
  sha: string;
}

export interface TreeEntry {
  path: string;
  size: number;
}

export class GitHub {
  #token: string | undefined;
  #api: string;
  #raw: string;
  #fetch: typeof fetch;

  constructor(cfg: GitHubConfig = {}) {
    this.#token = cfg.token;
    this.#api = (cfg.apiBase ?? "https://api.github.com").replace(/\/$/, "");
    this.#raw = (cfg.rawBase ?? "https://raw.githubusercontent.com").replace(/\/$/, "");
    this.#fetch = cfg.fetchImpl ?? fetch;
  }

  async #get(url: string, what: string, withToken: boolean): Promise<Response> {
    let res: Response;
    try {
      res = await this.#fetch(url, {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "graftlab-ai",
          ...(withToken && this.#token ? { authorization: `Bearer ${this.#token}` } : {}),
        },
      });
    } catch {
      throw new GitHubError(`could not reach GitHub while reading ${what}`, 0, "network");
    }
    if (res.ok) return res;
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 || (res.status === 403 && remaining === "0")) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const at = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC` : "";
      throw new GitHubError(`GitHub rate limit reached while reading ${what} (remaining ${remaining ?? "unknown"})${at}`, res.status, "rate_limited");
    }
    if (res.status === 404) throw new GitHubError(`GitHub says this repository does not exist or is not public (HTTP 404)`, 404, "not_found");
    throw new GitHubError(`GitHub returned HTTP ${res.status} while reading ${what}`, res.status, "http");
  }

  /** Repository metadata and the commit SHA of the default branch (R9.4). Refuses non-public repositories. */
  async meta(owner: string, repo: string): Promise<RepoMeta> {
    const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const info = (await (await this.#get(this.#api + path, "the repository", true)).json()) as { private?: boolean; visibility?: string; default_branch?: string; name?: string; owner?: { login?: string } };
    if (info.private === true || (info.visibility && info.visibility !== "public")) {
      throw new GitHubError("GitHub says this repository is not public", 403, "not_public");
    }
    const branch = info.default_branch ?? "main";
    const b = (await (await this.#get(`${this.#api}${path}/branches/${encodeURIComponent(branch)}`, "the default branch", true)).json()) as { commit?: { sha?: string } };
    const sha = b.commit?.sha;
    if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new GitHubError("GitHub did not return a commit for the default branch", 0, "http");
    return { owner: info.owner?.login ?? owner, repo: info.name ?? repo, defaultBranch: branch, sha };
  }

  /** The recursive file tree at a commit (blobs only). */
  async tree(meta: RepoMeta): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const url = `${this.#api}/repos/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/git/trees/${meta.sha}?recursive=1`;
    const t = (await (await this.#get(url, "the file list", true)).json()) as { tree?: { path: string; type: string; size?: number }[]; truncated?: boolean };
    const entries = (t.tree ?? []).filter((e) => e.type === "blob").map((e) => ({ path: e.path, size: e.size ?? 0 }));
    return { entries, truncated: t.truncated === true };
  }

  /** Raw file content at a commit. The token is not sent to the raw host. */
  async file(meta: RepoMeta, path: string): Promise<Uint8Array> {
    const url = `${this.#raw}/${encodeURIComponent(meta.owner)}/${encodeURIComponent(meta.repo)}/${meta.sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const res = await this.#get(url, path, false);
    return new Uint8Array(await res.arrayBuffer());
  }
}
