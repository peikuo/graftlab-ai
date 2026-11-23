// Verifier `api_readback` check (design.md, "Verifier", "Adapter contract"; R22.4, R22.5, R22.7, R22.9, R29.4).
// Studio code, no LLM: reads every item through the Adapter (all pages), compares each expectation with the
// Adapter's comparator against the read-back and the pre-state snapshot, and returns one result per item. Success is
// decided only here, never by a role's statement.
import type { Adapter, Expectation, ItemResult, TargetClient, TargetItem } from "@graftlab/shared";

export interface ReadbackResult {
  pass: boolean;
  items: ItemResult[];
}

export async function runReadback(adapter: Pick<Adapter, "hooks">, client: TargetClient, expect: Expectation[], preState: TargetItem[]): Promise<ReadbackResult> {
  let readBack: TargetItem[];
  try {
    readBack = await adapter.hooks.readAll(client);
  } catch (e) {
    // A read that fails is a failed check with the reason, never a skipped one.
    return { pass: false, items: [{ item: "read back", pass: false, expected: "all items readable", actual: (e as Error).message }] };
  }
  const items = expect.map((x) => adapter.hooks.comparator.compare(x, readBack, preState));
  return { pass: items.length > 0 && items.every((i) => i.pass), items };
}

/** The pre-state snapshot taken before any write (a planned create of an existing key is then compared as an update). */
export async function snapshot(adapter: Pick<Adapter, "hooks">, client: TargetClient): Promise<TargetItem[]> {
  return adapter.hooks.readAll(client);
}
