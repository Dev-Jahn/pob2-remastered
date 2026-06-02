// stage-assets.mjs — Copy cached icons into Tauri resources + write runtime lookup index
// (DESIGN §9.2; Tauri asset-bundling pipeline 2026-06-02).
//
// FAIL-CLOSED: calls validateManifest with integrity check first. Any missing / corrupt
// cached icon aborts the entire run — NO-FALLBACK. Only run in the main working tree
// where packages/localization/.cache/icons/ exists.
//
//   node packages/localization/scripts/stage-assets.mjs [--dry-run] [--dest <dir>] [--asset-root <dir>]
//
// Exports:
//   stageAssets(manifest, { assetRoot, destDir }) → { staged, indexPath, errors }
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../../../tools/dev-workflow/asset-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const repoRoot = join(pkgRoot, '..', '..');

const DEFAULT_ASSET_ROOT = join(pkgRoot, '.cache');
const DEFAULT_DEST_DIR = join(repoRoot, 'apps', 'desktop', 'src-tauri', 'resources', 'assets');

/**
 * Stage cached icon assets from assetRoot into destDir and write asset-index.json.
 *
 * FAIL-CLOSED: validates integrity first. Returns `{ staged: 0, errors }` if any
 * violation is found — nothing is copied.
 *
 * @param {object} manifest - AssetRef manifest `{ assets: AssetRef[] }`
 * @param {{ assetRoot: string, destDir: string, dryRun?: boolean }} opts
 * @returns {{ staged: number, indexPath: string, errors: string[] }}
 */
export async function stageAssets(manifest, { assetRoot, destDir, dryRun = false } = {}) {
  assetRoot = assetRoot ?? DEFAULT_ASSET_ROOT;
  destDir = destDir ?? DEFAULT_DEST_DIR;

  // FAIL-CLOSED: integrity check must pass before any copying.
  const { ok, errors } = validateManifest(manifest, { assetRoot });
  if (!ok) {
    return { staged: 0, indexPath: join(destDir, 'asset-index.json'), errors };
  }

  if (dryRun) {
    return {
      staged: manifest.assets.length,
      indexPath: join(destDir, 'asset-index.json'),
      errors: [],
    };
  }

  // Sort for determinism.
  const sorted = [...manifest.assets].sort((a, b) => a.id.localeCompare(b.id));

  for (const asset of sorted) {
    const src = join(assetRoot, asset.localPath);
    const dst = join(destDir, asset.localPath);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
  }

  // Write sorted lookup index: { [assetId]: localPath }
  const index = Object.fromEntries(sorted.map((a) => [a.id, a.localPath]));
  const indexPath = join(destDir, 'asset-index.json');
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n', 'utf8');

  return { staged: manifest.assets.length, indexPath, errors: [] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const destIdx = args.indexOf('--dest');
  const assetRootIdx = args.indexOf('--asset-root');
  const destDir = destIdx !== -1 ? args[destIdx + 1] : DEFAULT_DEST_DIR;
  const assetRoot = assetRootIdx !== -1 ? args[assetRootIdx + 1] : DEFAULT_ASSET_ROOT;

  const manifestPath = join(pkgRoot, 'assets', 'asset-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  if (dryRun) {
    // For dry-run, validate schema only (no integrity since .cache may not exist).
    const { ok, errors } = validateManifest(manifest);
    if (!ok) {
      console.error(`stage-assets: schema violations (${errors.length}):`);
      for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(
      `stage-assets --dry-run: schema OK — ${manifest.assets.length} AssetRefs would be staged to ${destDir}`,
    );
    console.log(`  asset-root: ${assetRoot}`);
    console.log(`  dest:       ${destDir}`);
    process.exit(0);
  }

  const { staged, indexPath, errors } = await stageAssets(manifest, { assetRoot, destDir });
  if (errors.length > 0) {
    console.error(`stage-assets: integrity check failed (${errors.length} violation(s)):`);
    for (const e of errors.slice(0, 50)) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(
    `stage-assets: staged ${staged} assets → ${destDir}; index → ${indexPath}`,
  );
}
