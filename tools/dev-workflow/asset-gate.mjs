// asset-gate.mjs — validate an AssetRef manifest before bundling into a release
// (DESIGN §9.2; production-wiring review 2026-06-02). The 2026-06-02 legal review
// authorized non-commercial bundling, so this gate enforces the bundling contract:
// every asset is schema-complete, `allowed` (never do_not_bundle/unknown in a release),
// carries a 64-hex sha256 + attribution, and — with --integrity — its cached bytes hash
// to the recorded sha256. NO-FALLBACK: any violation fails (the manifest can't half-ship).
//
//   node tools/dev-workflow/asset-gate.mjs <manifest.json> [--integrity <assetRoot>]
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const REQUIRED = [
  'id',
  'domain',
  'source',
  'remoteUrl',
  'localPath',
  'sha256',
  'licenseStatus',
  'attribution',
];

/**
 * Validate an AssetRef manifest `{ assets: AssetRef[] }`. With `assetRoot` set,
 * also verifies each asset's cached bytes (`join(assetRoot, localPath)`) hash to its
 * recorded sha256. Returns `{ ok, errors }` — pure except the optional file reads.
 */
export function validateManifest(manifest, { assetRoot } = {}) {
  const errors = [];
  if (!manifest || !Array.isArray(manifest.assets)) {
    return { ok: false, errors: ['manifest.assets must be an array'] };
  }
  manifest.assets.forEach((a, i) => {
    const id = a?.id ?? `#${i}`;
    for (const f of REQUIRED) {
      if (a?.[f] === undefined || a[f] === '') errors.push(`${id}: missing ${f}`);
    }
    if (a?.licenseStatus !== undefined && a.licenseStatus !== 'allowed') {
      errors.push(`${id}: licenseStatus '${a.licenseStatus}' — only 'allowed' may ship`);
    }
    if (typeof a?.sha256 === 'string' && !/^[a-f0-9]{64}$/.test(a.sha256)) {
      errors.push(`${id}: sha256 is not a 64-hex digest`);
    }
    if (assetRoot && typeof a?.localPath === 'string' && typeof a?.sha256 === 'string') {
      const file = join(assetRoot, a.localPath);
      if (!existsSync(file)) {
        errors.push(`${id}: cached asset missing for integrity check: ${a.localPath}`);
      } else if (createHash('sha256').update(readFileSync(file)).digest('hex') !== a.sha256) {
        errors.push(`${id}: sha256 integrity mismatch for ${a.localPath}`);
      }
    }
  });
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [manifestPath, integrityFlag, assetRoot] = process.argv.slice(2);
  if (!manifestPath) {
    console.error('usage: asset-gate.mjs <manifest.json> [--integrity <assetRoot>]');
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const opts = integrityFlag === '--integrity' ? { assetRoot } : {};
  const { ok, errors } = validateManifest(manifest, opts);
  if (ok) {
    console.log(`asset-gate: OK — ${manifest.assets.length} AssetRefs valid`);
    process.exit(0);
  }
  console.error(`asset-gate: ${errors.length} violation(s):`);
  for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
  process.exit(1);
}
