// Publishes chosen Replay_Files for the public front end (task 17.6; R27.13). The chosen set replaces what is in
// the output folder, so the home page list equals the set named here.
//   npx tsx scripts/replay-publish.ts [--out <dir>] [--private <file>] <replayDir> <taskId>...
// <replayDir> holds <taskId>.json and <taskId>/shots/*.jpg (data/replays of the host where the Tasks ran). The output
// (default data/replay-publish) holds <taskId>.json, <taskId>/shots/ and index.json; the front end serves it at
// /replays/. --private names a file of KEY=VALUE lines whose values must not appear in a published Replay (for
// example host names or addresses of your own deployment).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkReplay, siteValues, type PublishEntry } from "./replayPublish.ts";

const args = process.argv.slice(2);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const root = resolve(import.meta.dirname, "..");
const stage = resolve(option("--out") ?? join(root, "data/replay-publish"));
const privateFile = option("--private");
const [dir, ...ids] = args;
if (!dir || ids.length === 0) {
  console.error("usage: replay-publish.ts [--out <dir>] [--private <file>] <replayDir> <taskId>...");
  process.exit(2);
}
if (privateFile && !existsSync(privateFile)) {
  console.error(`--private: ${privateFile} does not exist`);
  process.exit(2);
}
const site = siteValues(privateFile ? readFileSync(privateFile, "utf8") : "");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const index: PublishEntry[] = [];
let refused = 0;
for (const id of ids) {
  if (!/^[a-z0-9._-]{1,80}$/.test(id)) {
    console.error(`${id}: invalid Task id`);
    refused++;
    continue;
  }
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) {
    console.error(`${id}: no Replay_File`);
    refused++;
    continue;
  }
  const text = readFileSync(file, "utf8");
  const r = checkReplay(id, text, site);
  if (!r.ok) {
    console.error(`${id}: refused (${r.problems.join("; ")})`);
    refused++;
    continue;
  }
  writeFileSync(join(stage, `${id}.json`), text);
  let shots = 0;
  for (const name of r.shots) {
    const src = join(dir, id, "shots", name);
    if (!existsSync(src)) continue;
    mkdirSync(join(stage, id, "shots"), { recursive: true });
    copyFileSync(src, join(stage, id, "shots", name));
    shots++;
  }
  index.push(r.entry);
  console.log(`${id}: ok (${r.entry.terminal}, ${shots} of ${r.shots.length} screenshots)`);
}
if (refused > 0) {
  console.error(`${refused} Replay(s) refused; nothing uploaded`);
  process.exit(1);
}
index.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
writeFileSync(join(stage, "index.json"), JSON.stringify(index));
console.log(`wrote ${index.length} Replay(s) to ${stage}`);
