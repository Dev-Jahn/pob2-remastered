// collect-live.mjs — live PoE2DB collector (DESIGN §8.4, §14.3; 2026-06-02 bundling policy).
//
// Responsible scraping: identifies via User-Agent, respects robots (Allow: /), rate-limits
// (>=1s between fetches), and caches every page to disk so a re-run never re-fetches. Parses
// the REAL PoE2DB page structure (not the Phase-6 synthetic fixtures) into bilingual term
// records + icon refs, and writes a deterministic collected artifact the dictionary build merges.
//
//   node packages/localization/scripts/collect-live.mjs [--domains keyword,gem,...] [--no-fetch]
//
// --no-fetch parses only cached pages (offline / CI-safe). Network fetch is opt-in (default on).
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const cacheDir = join(pkgRoot, '.cache', 'poe2db');
const outPath = join(pkgRoot, 'generated', 'collected-poe2db.json');

const UA =
  'pob2-remastered-localization-bot/0.1 (non-commercial fork; +https://github.com/Dev-Jahn/pob2-remastered)';
const RATE_MS = 1500; // >= 1s between network fetches (responsible)
const ICON_CDN = 'https://cdn.poe2db.tw';

// Each domain maps to its PoE2DB path + the LocalizedTerm domain it feeds (term.ts vocabulary)
// + the parser for that page's structure. (Function decls below are hoisted, so referencing
// them here is fine.)
export const DOMAINS = {
  keyword: { path: 'Keywords', termDomain: 'keyword', parse: parsePoe2dbCards },
  skill: { path: 'Skill_Gems', termDomain: 'skill', parse: parseFigureCards },
  support_gem: { path: 'Support_Gems', termDomain: 'support_gem', parse: parseFigureCards },
};

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};
const decode = (s) => s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m]);
const stripTags = (s) =>
  decode(s.replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parse a real PoE2DB category page into raw cards. The card shape (verified against the live
 * kr/us Keywords pages, 974 cards each) is:
 *   <div class="d-flex border-top rounded">
 *     <div class="flex-shrink-0">[<img ... src="ICON">]</div>
 *     <div class="flex-grow-1 ms-2">
 *       <a href="SLUG" class="strong fontinSmallCaps">NAME</a>
 *       <div class="fontinRegular">DESC</div>
 *     ...
 * Returns [{ slug, name, desc, iconUrl }] in document order. Pure — no I/O.
 */
export function parsePoe2dbCards(html) {
  const cardRe =
    /<div class="flex-shrink-0">(.*?)<\/div>\s*<div class="flex-grow-1 ms-2">\s*<a href="([^"]+)" class="strong fontinSmallCaps">([^<]+)<\/a>\s*<div class="fontinRegular">(.*?)<\/div>/gs;
  const iconRe = /<img[^>]+src="([^"]+)"/;
  const cards = [];
  for (const m of html.matchAll(cardRe)) {
    const [, iconHtml, slug, name, descHtml] = m;
    const icon = iconRe.exec(iconHtml);
    cards.push({
      slug: decode(slug).trim(),
      name: stripTags(name),
      desc: stripTags(descHtml),
      iconUrl: icon ? (icon[1].startsWith('http') ? icon[1] : ICON_CDN + icon[1]) : undefined,
    });
  }
  return cards;
}

/**
 * Parse a PoE2DB gem-grid page (Skill_Gems / Support_Gems). Each gem is a
 *   <figure class="text-center mb-0">
 *     <a href="SLUG"><img class="size64" src="ICON"></a>
 *     <figcaption><a class="gem_*" href="/us/SLUG">NAME</a></figcaption>
 * Returns [{ slug, name, desc:'', iconUrl }], deduped by slug. Pure — no I/O.
 */
export function parseFigureCards(html) {
  const figRe =
    /<figure class="text-center mb-0">\s*<a href="([^"]+)"[^>]*>\s*<img[^>]*src="([^"]+)"[^>]*>\s*<\/a>\s*<figcaption>\s*<a[^>]*>([^<]+)<\/a>/gs;
  const cards = [];
  const seen = new Set();
  for (const m of html.matchAll(figRe)) {
    const [, slug, icon, name] = m;
    const s = decode(slug).trim();
    if (seen.has(s)) continue;
    seen.add(s);
    cards.push({
      slug: s,
      name: stripTags(name),
      desc: '',
      iconUrl: icon.startsWith('http') ? icon : ICON_CDN + icon,
    });
  }
  return cards;
}

/** Pair kr + us cards by slug into LocalizedTerm records (DESIGN §8.3). */
export function pairCards(krCards, usCards, termDomain, updatedAt) {
  const us = new Map(usCards.map((c) => [c.slug, c]));
  const terms = [];
  const unpaired = [];
  for (const kr of krCards) {
    const u = us.get(kr.slug);
    if (!u) {
      unpaired.push(kr.slug);
      continue;
    }
    terms.push({
      id: `${termDomain}.${kr.slug}`,
      domain: termDomain,
      canonicalEn: u.name,
      ko: kr.name,
      aliasesEn: [u.name, ...(u.desc ? [u.desc] : [])],
      aliasesKo: [kr.name, ...(kr.desc ? [kr.desc] : [])],
      slug: kr.slug,
      poe2dbUrl: `https://poe2db.tw/us/${kr.slug}`,
      iconUrl: kr.iconUrl ?? u.iconUrl,
      upstreamIds: [],
      confidence: 'slug',
      source: 'poe2db',
      updatedAt,
    });
  }
  return { terms, unpaired };
}

// ── fetch w/ cache + rate-limit ────────────────────────────────────────────────
let lastFetch = 0;
async function fetchCached(locale, pathName, { noFetch }) {
  const file = join(cacheDir, locale, `${pathName}.html`);
  if (existsSync(file)) return readFileSync(file, 'utf8');
  if (noFetch) throw new Error(`no cached page for ${locale}/${pathName} and --no-fetch set`);
  const wait = RATE_MS - (Date.now() - lastFetch);
  if (wait > 0) await sleep(wait);
  const url = `https://poe2db.tw/${locale}/${pathName}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Encoding': 'gzip' } });
  lastFetch = Date.now();
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const html = await res.text();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html, 'utf8');
  return html;
}

export async function collect(domainKeys, opts) {
  const all = [];
  const report = {};
  for (const key of domainKeys) {
    const d = DOMAINS[key];
    if (!d) throw new Error(`unknown domain ${key}`);
    const krHtml = await fetchCached('kr', d.path, opts);
    const usHtml = await fetchCached('us', d.path, opts);
    const krCards = d.parse(krHtml);
    const usCards = d.parse(usHtml);
    if (krCards.length === 0 || usCards.length === 0)
      throw new Error(
        `${key}: parsed 0 cards (kr=${krCards.length} us=${usCards.length}) — structure changed?`,
      );
    const { terms, unpaired } = pairCards(krCards, usCards, d.termDomain, opts.updatedAt);
    report[key] = {
      kr: krCards.length,
      us: usCards.length,
      paired: terms.length,
      unpaired: unpaired.length,
    };
    all.push(...terms);
  }
  return { terms: all, report };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const noFetch = args.includes('--no-fetch');
  const domArg = args.find((a) => a.startsWith('--domains='))?.split('=')[1];
  const domainKeys = domArg ? domArg.split(',') : Object.keys(DOMAINS);
  // Deterministic provenance date (not wall-clock) so the artifact is reproducible.
  const updatedAt = '2026-06-02T00:00:00.000Z';
  const { terms, report } = await collect(domainKeys, { noFetch, updatedAt });
  terms.sort((a, b) => a.id.localeCompare(b.id));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(terms, null, 2) + '\n', 'utf8');
  console.log(`collected ${terms.length} terms → ${join('generated', 'collected-poe2db.json')}`);
  for (const [k, r] of Object.entries(report))
    console.log(`  ${k}: kr=${r.kr} us=${r.us} paired=${r.paired} unpaired=${r.unpaired}`);
}
