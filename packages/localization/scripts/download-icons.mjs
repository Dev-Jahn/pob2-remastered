// download-icons.mjs — icon collector + AssetRef manifest (DESIGN §9.2; 2026-06-02 bundling policy).
//
// Reads the live-collected terms (collect-live.mjs output), downloads each referenced PoE2DB/poecdn
// icon into a gitignored cache (content kept out of git; sha256 + source URL travel in the manifest),
// and writes a committed AssetRef manifest the Tauri packaging step bundles into the app.
//
//   node packages/localization/scripts/download-icons.mjs [--no-fetch]
//
// Icons are static CDN assets, so a small concurrency is used (no per-request page-rate-limit), and
// any already-cached file (by sha-stable basename) is never re-fetched. --no-fetch verifies the
// manifest against the existing cache only (offline).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const collectedPath = join(pkgRoot, 'generated', 'collected-poe2db.json');
const iconCacheDir = join(pkgRoot, '.cache', 'icons'); // gitignored
const manifestPath = join(pkgRoot, 'assets', 'asset-manifest.json'); // committed

const UA =
  'pob2-remastered-localization-bot/0.1 (non-commercial fork; +https://github.com/Dev-Jahn/pob2-remastered)';
const CONCURRENCY = 6;
const ATTRIBUTION = 'Path of Exile 2 © Grinding Gear Games; icon via PoE2DB (poe2db.tw)';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
// Stable local filename: domain + source basename (deduped). Avoids collisions across domains.
const localName = (domain, url) => `${domain}/${basename(new URL(url).pathname)}`;

async function pool(items, n, worker) {
  const results = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function downloadIcons(terms, { noFetch } = {}) {
  // Unique icon URLs → the term ids that use them.
  const byUrl = new Map();
  for (const t of terms) {
    if (!t.iconUrl) continue;
    (byUrl.get(t.iconUrl) ?? byUrl.set(t.iconUrl, []).get(t.iconUrl)).push(t);
  }
  const urls = [...byUrl.keys()];
  const fileFor = new Map(); // url → { localPath, sha256 }
  let fetched = 0;
  let cached = 0;
  let failed = 0;

  await pool(urls, CONCURRENCY, async (url) => {
    const sample = byUrl.get(url)[0];
    const rel = localName(sample.domain, url);
    const abs = join(iconCacheDir, rel);
    try {
      let buf;
      if (existsSync(abs)) {
        buf = readFileSync(abs);
        cached += 1;
      } else if (noFetch) {
        failed += 1;
        return;
      } else {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, buf);
        fetched += 1;
      }
      fileFor.set(url, { localPath: join('icons', rel), sha256: sha256(buf) });
    } catch {
      failed += 1;
    }
  });

  // AssetRef manifest (DESIGN §9.2): one entry per term that has a resolved icon.
  const assets = [];
  for (const t of terms) {
    if (!t.iconUrl) continue;
    const f = fileFor.get(t.iconUrl);
    if (!f) continue;
    assets.push({
      id: t.id,
      domain: t.domain,
      source: 'poe2db',
      remoteUrl: t.iconUrl,
      localPath: f.localPath,
      sha256: f.sha256,
      licenseStatus: 'allowed', // 2026-06-02 legal review: non-commercial bundling authorized
      attribution: ATTRIBUTION,
    });
  }
  assets.sort((a, b) => a.id.localeCompare(b.id));
  return { assets, stats: { urls: urls.length, fetched, cached, failed } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const noFetch = process.argv.includes('--no-fetch');
  const terms = JSON.parse(readFileSync(collectedPath, 'utf8'));
  const { assets, stats } = await downloadIcons(terms, { noFetch });
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        $comment:
          'AssetRef manifest (DESIGN §9.2). Icon bytes live in the gitignored .cache/icons/; ' +
          'sha256 + remoteUrl let packaging fetch/verify/bundle them. Non-commercial bundling ' +
          'authorized 2026-06-02 (see DATA_SOURCES.md). All icons © GGG.',
        generatedFrom: 'collected-poe2db.json',
        count: assets.length,
        assets,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  console.log(
    `icons: ${stats.urls} unique URLs — fetched ${stats.fetched}, cached ${stats.cached}, failed ${stats.failed}; ` +
      `manifest: ${assets.length} AssetRefs → ${join('assets', 'asset-manifest.json')}`,
  );
}
