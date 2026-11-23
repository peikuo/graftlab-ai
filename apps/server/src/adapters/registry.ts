// Adapter registry (design.md, "Adapter contract"; R9.5, R13.3, R39.10): every adapters/<id>/adapter.json is
// validated by the contract schema at server start, joined with its hooks, and matched case-insensitively against
// a normalized repository. An invalid Adapter stops the start with the reason; it is never used half-valid.
import { access, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AdapterJsonSchema, isForbiddenAdapterField, matchesAdapter, type Adapter, type AdapterHooks } from "@graftlab/shared";
import { hooks as linkdingHooks } from "../../../../adapters/linkding/index.ts";

/** Hooks by Adapter id: the code part of each Adapter (static imports, so they are type-checked with the server). */
const HOOKS: Record<string, AdapterHooks> = { linkding: linkdingHooks };

export class AdapterError extends Error {}

/** Names of fields anywhere in the JSON that look like a start or build procedure (R39.10). */
export function forbiddenFields(value: unknown, path = ""): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [...(isForbiddenAdapterField(k) ? [`${path}${k}`] : []), ...forbiddenFields(v, `${path}${k}.`)]);
}

export async function loadAdapters(dir: string): Promise<Adapter[]> {
  const out: Adapter[] = [];
  for (const id of (await readdir(dir).catch(() => [] as string[])).sort()) {
    const raw = await readFile(join(dir, id, "adapter.json"), "utf8").catch(() => null);
    if (raw === null) continue; // not an Adapter directory
    const json = JSON.parse(raw) as unknown;
    const bad = forbiddenFields(json);
    if (bad.length) throw new AdapterError(`adapters/${id}: no start or build procedure for the modified target is allowed (${bad.join(", ")})`);
    const parsed = AdapterJsonSchema.safeParse(json);
    if (!parsed.success) throw new AdapterError(`adapters/${id}/adapter.json: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
    if (parsed.data.id !== id) throw new AdapterError(`adapters/${id}: the id in adapter.json is "${parsed.data.id}"`);
    const setup = join(dir, id, parsed.data.devSandbox.dependencySetup);
    if (!(await access(setup).then(() => true, () => false))) throw new AdapterError(`adapters/${id}: devSandbox.dependencySetup ${parsed.data.devSandbox.dependencySetup} does not exist`);
    const hooks = HOOKS[id];
    if (!hooks) throw new AdapterError(`adapters/${id}: no hooks are registered for this Adapter`);
    out.push({ ...parsed.data, hooks });
  }
  return out;
}

/** Case-insensitive match after URL normalization (R9.5). */
export function matchAdapter(adapters: Adapter[], repo: { owner: string; repo: string }): Adapter | undefined {
  return adapters.find((a) => matchesAdapter(repo, a));
}
