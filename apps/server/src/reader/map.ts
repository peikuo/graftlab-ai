// Repo_Map (design.md, "Repo_Memo", layer 1; R10.7): built by Studio code, no LLM. For every downloaded file:
// size, lines, language, top-level symbols found by per-language regular expressions, imports resolved to
// files of the repository, and whether the file only gets a map entry (tests, vendored and generated code).

export interface MapEntry {
  path: string;
  bytes: number;
  lines: number;
  language: string;
  symbols: string[];
  /** Repository files this file imports (resolved by code, best effort). */
  imports: string[];
  /** Tests, vendored and generated files get a map entry only, no LLM memo. */
  mapOnly: boolean;
  mapOnlyReason?: "test" | "vendored" | "generated";
}

export interface RepoMap {
  entries: MapEntry[];
  byPath: Map<string, MapEntry>;
  /** Directories ("" is the root) with their direct child files and child directories. */
  dirs: Map<string, { files: string[]; subdirs: string[] }>;
}

const LANG: [RegExp, string][] = [
  [/\.py$/, "python"],
  [/\.(ts|tsx|mts|cts)$/, "typescript"],
  [/\.(js|jsx|mjs|cjs)$/, "javascript"],
  [/\.go$/, "go"],
  [/\.rs$/, "rust"],
  [/\.(java|kt)$/, "jvm"],
  [/\.rb$/, "ruby"],
  [/\.php$/, "php"],
  [/\.(c|h|cc|cpp|hpp)$/, "c"],
  [/\.(md|mdx|rst|txt)$/, "docs"],
  [/\.(html|htm|jinja|j2|hbs|vue|svelte)$/, "markup"],
  [/\.(css|scss|sass|less)$/, "style"],
  [/\.(json|ya?ml|toml|ini|cfg|env\.example)$/, "config"],
  [/(^|\/)(Dockerfile|Makefile|Procfile)$/, "build"],
  [/\.(sh|bash|ps1)$/, "script"],
];

export function languageOf(path: string): string {
  for (const [re, lang] of LANG) if (re.test(path)) return lang;
  return "other";
}

export function mapOnlyReason(path: string): MapEntry["mapOnlyReason"] | undefined {
  const p = path.toLowerCase();
  if (/(^|\/)(tests?|__tests__|spec|specs|tests_e2e|e2e)\//.test(p) || /(^|\/)(test_[^/]+|[^/]+_test\.[a-z]+|[^/]+\.(test|spec)\.[a-z]+)$/.test(p)) return "test";
  if (/(^|\/)(vendor|vendors|third_party|node_modules|static\/vendor)\//.test(p)) return "vendored";
  if (/\.min\.(js|css)$/.test(p) || /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|uv\.lock|cargo\.lock|go\.sum)$/.test(p) || /(^|\/)migrations\//.test(p) || /\.(generated|pb)\.[a-z]+$/.test(p)) return "generated";
  return undefined;
}

// Top-level symbols per language: names only, cheap and deterministic.
const SYMBOLS: Record<string, RegExp[]> = {
  python: [/^class\s+([A-Za-z_]\w*)/gm, /^(?:async\s+)?def\s+([A-Za-z_]\w*)/gm, /^([A-Z][A-Z0-9_]{2,})\s*=/gm],
  typescript: [/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm, /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, /^class\s+([A-Za-z_$][\w$]*)/gm],
  javascript: [/^export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/gm, /^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm, /^class\s+([A-Za-z_$][\w$]*)/gm],
  go: [/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm, /^type\s+([A-Za-z_]\w*)/gm],
  rust: [/^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|mod)\s+([A-Za-z_]\w*)/gm],
  jvm: [/^\s*(?:public\s+)?(?:abstract\s+|final\s+)?(?:class|interface|enum|object)\s+([A-Za-z_]\w*)/gm],
  ruby: [/^\s*(?:class|module)\s+([A-Z]\w*)/gm, /^\s*def\s+([a-z_]\w*[?!]?)/gm],
  php: [/^\s*(?:abstract\s+|final\s+)?class\s+([A-Za-z_]\w*)/gm, /^\s*function\s+([A-Za-z_]\w*)/gm],
  docs: [/^#{1,2}\s+(.+?)\s*$/gm],
};

export function symbolsOf(language: string, text: string, max = 40): string[] {
  const out: string[] = [];
  for (const re of SYMBOLS[language] ?? []) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const name = m[1]!.slice(0, 80);
      if (!out.includes(name)) out.push(name);
      if (out.length >= max) return out;
    }
  }
  return out;
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function normalizeJoin(base: string, rel: string): string | null {
  const parts = base ? base.split("/") : [];
  for (const seg of rel.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(seg);
  }
  return parts.join("/");
}

/** Imports resolved to repository files, by language conventions (best effort, never executed). */
export function importsOf(path: string, language: string, text: string, files: Set<string>): string[] {
  const found = new Set<string>();
  const tryPaths = (candidates: string[]) => {
    for (const c of candidates) if (files.has(c)) {
      if (c !== path) found.add(c);
      return;
    }
  };
  if (language === "python") {
    for (const m of text.matchAll(/^\s*(?:from\s+([.\w]+)\s+import|import\s+([\w.]+))/gm)) {
      const mod = (m[1] ?? m[2])!;
      let base: string;
      if (mod.startsWith(".")) {
        const dots = mod.match(/^\.+/)![0].length;
        let d = dirOf(path);
        for (let i = 1; i < dots; i++) d = dirOf(d);
        base = normalizeJoin(d, mod.slice(dots).replace(/\./g, "/")) ?? "";
      } else base = mod.replace(/\./g, "/");
      if (base) tryPaths([`${base}.py`, `${base}/__init__.py`]);
    }
  } else if (language === "typescript" || language === "javascript") {
    for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = (m[1] ?? m[2] ?? m[3])!;
      if (!spec.startsWith(".")) continue;
      const base = normalizeJoin(dirOf(path), spec);
      if (!base) continue;
      const stem = base.replace(/\.(js|mjs|cjs|jsx|ts|tsx)$/, "");
      tryPaths([base, `${stem}.ts`, `${stem}.tsx`, `${stem}.js`, `${stem}.jsx`, `${stem}.mjs`, `${stem}/index.ts`, `${stem}/index.tsx`, `${stem}/index.js`]);
    }
  }
  return [...found].sort();
}

export function buildRepoMap(files: { path: string; text: string }[]): RepoMap {
  const set = new Set(files.map((f) => f.path));
  const entries: MapEntry[] = files.map((f) => {
    const language = languageOf(f.path);
    const reason = mapOnlyReason(f.path);
    return {
      path: f.path,
      bytes: Buffer.byteLength(f.text, "utf8"),
      lines: f.text === "" ? 0 : f.text.split("\n").length,
      language,
      symbols: symbolsOf(language, f.text),
      imports: importsOf(f.path, language, f.text, set),
      mapOnly: reason !== undefined,
      ...(reason ? { mapOnlyReason: reason } : {}),
    };
  });
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const dirs = new Map<string, { files: string[]; subdirs: string[] }>();
  const ensure = (d: string) => {
    let x = dirs.get(d);
    if (!x) {
      x = { files: [], subdirs: [] };
      dirs.set(d, x);
      if (d !== "") {
        const parent = dirOf(d);
        const p = ensure(parent);
        if (!p.subdirs.includes(d)) p.subdirs.push(d);
      }
    }
    return x;
  };
  ensure("");
  for (const e of entries) ensure(dirOf(e.path)).files.push(e.path);
  for (const x of dirs.values()) x.subdirs.sort();
  return { entries, byPath: new Map(entries.map((e) => [e.path, e])), dirs };
}

/** Directories ordered deepest first, for the bottom-up memo build. */
export function dirsDeepestFirst(map: RepoMap): string[] {
  return [...map.dirs.keys()].sort((a, b) => (b === "" ? -1 : b.split("/").length) - (a === "" ? -1 : a.split("/").length) || a.localeCompare(b));
}
