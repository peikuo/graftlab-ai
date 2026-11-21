// Usage: node scripts/fetch-oci.mjs <sha256:indexDigest> <outDir> <refName>   (the repository is fixed below)
// Then run scripts/make-docker-load-manifest.mjs <outDir> <repoTag> and tar the directory with:
//   COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata -C <outDir> -cf image.tar .
// Download one image by digest from ghcr.io into an OCI layout, verifying every blob's sha256.
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto'; import { pipeline } from 'node:stream/promises'; import { Readable } from 'node:stream';
const repo = 'sissbruecker/linkding'; const indexDigest = process.argv[2]; const out = process.argv[3]; const refName = process.argv[4];
const tokRes = await fetch(`https://ghcr.io/token?service=ghcr.io&scope=repository:${repo}:pull`); const token = (await tokRes.json()).token;
const H = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' };
fs.mkdirSync(path.join(out, 'blobs/sha256'), { recursive: true });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
async function getManifest(digest) { const r = await fetch(`https://ghcr.io/v2/${repo}/manifests/${digest}`, { headers: H }); if (!r.ok) throw new Error('manifest ' + digest + ' ' + r.status); const buf = Buffer.from(await r.arrayBuffer()); if ('sha256:' + sha(buf) !== digest) throw new Error('manifest digest mismatch ' + digest); fs.writeFileSync(path.join(out, 'blobs/sha256', digest.slice(7)), buf); return JSON.parse(buf); }
const index = await getManifest(indexDigest);
const pick = index.manifests.find(m => m.platform && m.platform.os === 'linux' && m.platform.architecture === 'amd64');
console.log('index ok, platform manifest:', pick.digest);
const man = await getManifest(pick.digest);
async function getBlob(desc) {
  const file = path.join(out, 'blobs/sha256', desc.digest.slice(7)); const hash = crypto.createHash('sha256');
  const r = await fetch(`https://ghcr.io/v2/${repo}/blobs/${desc.digest}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'follow' });
  if (!r.ok) throw new Error('blob ' + desc.digest + ' ' + r.status);
  let n = 0; const ws = fs.createWriteStream(file);
  await pipeline(Readable.fromWeb(r.body), async function* (src) { for await (const c of src) { hash.update(c); n += c.length; yield c; } }, ws);
  if ('sha256:' + hash.digest('hex') !== desc.digest) throw new Error('BLOB DIGEST MISMATCH ' + desc.digest);
  if (desc.size && n !== desc.size) throw new Error('size mismatch ' + desc.digest);
  console.log('blob ok', desc.digest.slice(7, 19), (n / 1048576).toFixed(1) + ' MB');
}
await getBlob(man.config); for (const l of man.layers) await getBlob(l);
fs.writeFileSync(path.join(out, 'oci-layout'), JSON.stringify({ imageLayoutVersion: '1.0.0' }));
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ schemaVersion: 2, mediaType: 'application/vnd.oci.image.index.v1+json', manifests: [{ mediaType: man.mediaType || 'application/vnd.oci.image.manifest.v1+json', digest: pick.digest, size: fs.statSync(path.join(out, 'blobs/sha256', pick.digest.slice(7))).size, annotations: { 'org.opencontainers.image.ref.name': refName } }] }));
console.log('layout written; config', man.config.digest, 'layers', man.layers.length);
