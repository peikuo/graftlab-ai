// Adds the docker-save style manifest.json to an OCI layout so that `docker load` accepts it (classic image store).
// Usage: node scripts/make-docker-load-manifest.mjs <ociDir> <repoTag>
import fs from 'node:fs'; import path from 'node:path';
const [dir, tag] = process.argv.slice(2);
const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
const man = JSON.parse(fs.readFileSync(path.join(dir, 'blobs/sha256', idx.manifests[0].digest.slice(7)), 'utf8'));
const entry = [{ Config: `blobs/sha256/${man.config.digest.slice(7)}`, RepoTags: [tag], Layers: man.layers.map(l => `blobs/sha256/${l.digest.slice(7)}`) }];
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(entry));
console.log(`manifest.json written: config + ${entry[0].Layers.length} layers`);
