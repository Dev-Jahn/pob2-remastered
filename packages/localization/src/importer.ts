/**
 * Offline PoE2DB importer (DESIGN §8.4 import pipeline step D, §14.3).
 *
 * Reads CHECKED-IN cached PoE2DB kr+us HTML fixtures from a fixture directory and
 * extracts slug/name/icon/stat-text per §8.4 step D, normalizes names, pairs the kr
 * and us pages by their (language-independent) PoE2DB slug, and emits an in-memory
 * list of partially-filled {@link LocalizedTerm} records.
 *
 * This importer is OFFLINE BY CONSTRUCTION: it takes a fixture directory and reads
 * from disk — it never performs HTTP. Live scraping is out of scope (DESIGN §14.3,
 * dev-workflow §2: external network → fixed cached HTML).
 *
 * Per §14.3 a parser failure must FAIL (so CI fails) rather than silently degrade:
 * a malformed fixture — a recognized entry missing a required field, or a page with
 * no recognizable entries — THROWS. It never returns an empty/partial result to hide
 * a broken source schema.
 *
 * "Partially filled": these records carry the bilingual name/slug pulled from PoE2DB
 * with `source: 'poe2db'` and `confidence: 'slug'` (matched on the slug anchor, §8.5).
 * Matching against upstream `src/Data` ids is a LATER §8.4 step (F), so `upstreamIds`
 * is left empty here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalizedTerm, TermDomain } from './term.js';

/** One PoE2DB page fixture: a page filename and the term domain it maps into. */
interface PageSpec {
  /** Fixture filename, identical under the kr/ and us/ locale subdirectories. */
  file: string;
  /** The §8.3 LocalizedTerm domain this page's entries belong to. */
  domain: TermDomain;
}

/**
 * The fixture pages to import, per §8.4 ("Extract slug/name/icon/stat text" for a
 * representative keyword / item base / skill gem set). PoE2DB's item-base and
 * skill-gem pages map onto the `base` and `skill` term domains respectively.
 */
const PAGES: readonly PageSpec[] = [
  { file: 'keyword.html', domain: 'keyword' },
  { file: 'item.html', domain: 'base' },
  { file: 'gem.html', domain: 'skill' },
];

/** CSS class prefix PoE2DB uses for a given term domain's entry markup. */
const DOMAIN_PREFIX: Partial<Record<TermDomain, string>> = {
  keyword: 'keyword',
  base: 'item',
  skill: 'skill',
};

/** A single entry extracted from one PoE2DB page (§8.4 step D fields). */
export interface ParsedEntry {
  /** PoE2DB anchor slug — the language-independent join key (§8.5). */
  slug: string;
  /** Localized display name for this page's locale, normalized. */
  name: string;
  /** Icon image URL (a remote asset reference, never bundled — §9). */
  icon: string;
  /** Localized stat/description text for this page's locale, normalized. */
  statText: string;
}

/** Thrown when a fixture violates the expected PoE2DB schema (DESIGN §14.3). */
export class FixtureParseError extends Error {
  override name = 'FixtureParseError';
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/** Decode the small set of HTML entities our fixtures use, then collapse whitespace. */
function normalizeText(raw: string): string {
  const decoded = raw.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (m) => ENTITIES[m] ?? m);
  return decoded.replace(/\s+/g, ' ').trim();
}

/** Slice each `<div class="poe2db-<prefix>" ...>…</div>` entry block out of a page. */
function entryBlocks(html: string, prefix: string): string[] {
  const open = new RegExp(`<div\\b[^>]*class="[^"]*\\bpoe2db-${prefix}\\b[^"]*"[^>]*>`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = open.exec(html)) !== null) {
    // Keep the opening <div …> tag (it carries data-slug), then take its inner
    // content up to the balanced closing </div>.
    const openTag = match[0];
    const rest = html.slice(match.index + openTag.length);
    const end = closingDivIndex(rest);
    blocks.push(openTag + rest.slice(0, end));
  }
  return blocks;
}

/** Index of the `</div>` that closes the block, accounting for nested `<div>`s. */
function closingDivIndex(html: string): number {
  const tag = /<\/?div\b[^>]*>/g;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(html)) !== null) {
    if (match[0].startsWith('</')) {
      if (depth === 0) return match.index;
      depth -= 1;
    } else {
      depth += 1;
    }
  }
  return html.length;
}

function attr(block: string, name: string): string | undefined {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(block)?.[1];
}

function classText(block: string, className: string): string | undefined {
  const m = new RegExp(
    `<(span|div)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)</\\1>`,
  ).exec(block);
  return m?.[2];
}

function imgSrc(block: string, className: string): string | undefined {
  return new RegExp(`<img\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*\\bsrc="([^"]*)"`).exec(
    block,
  )?.[1];
}

/**
 * Parse one PoE2DB page (en-US or ko-KR) for the given domain into its entries,
 * extracting slug/name/icon/stat-text per §8.4 step D.
 *
 * Throws {@link FixtureParseError} (DESIGN §14.3) when the page has no recognizable
 * entries, or when an entry is missing any required field — never silently returns
 * an empty/partial list.
 */
export function parseDomainPage(html: string, domain: TermDomain): ParsedEntry[] {
  const prefix = DOMAIN_PREFIX[domain];
  if (prefix === undefined) {
    throw new FixtureParseError(`no PoE2DB page mapping for domain "${domain}"`);
  }

  const blocks = entryBlocks(html, prefix);
  if (blocks.length === 0) {
    throw new FixtureParseError(`no poe2db-${prefix} entries found in page (malformed fixture)`);
  }

  return blocks.map((block, i) => {
    const slug = attr(block, 'data-slug');
    const nameRaw = classText(block, `${prefix}-name`);
    const icon = imgSrc(block, `${prefix}-icon`);
    const statRaw = classText(block, `${prefix}-stat`);

    const missing: string[] = [];
    if (slug === undefined) missing.push('slug');
    if (nameRaw === undefined) missing.push('name');
    if (icon === undefined) missing.push('icon');
    if (statRaw === undefined) missing.push('stat');
    if (missing.length > 0) {
      throw new FixtureParseError(
        `poe2db-${prefix} entry #${i + 1} is missing required field(s): ${missing.join(', ')} ` +
          `(malformed fixture; DESIGN §14.3)`,
      );
    }

    return {
      slug: slug as string,
      name: normalizeText(nameRaw as string),
      icon: icon as string,
      statText: normalizeText(statRaw as string),
    };
  });
}

function indexBySlug(entries: ParsedEntry[]): Map<string, ParsedEntry> {
  const map = new Map<string, ParsedEntry>();
  for (const entry of entries) map.set(entry.slug, entry);
  return map;
}

/**
 * Import every PoE2DB page pair under `fixtureDir/{us,kr}` into partially-filled
 * {@link LocalizedTerm} records (DESIGN §8.4). For each domain the us and kr pages
 * are paired by slug: the us name becomes `canonicalEn`, the kr name becomes `ko`.
 *
 * The English name is kept as a search alias and never dropped (§8.1). Throws
 * (DESIGN §14.3) on any malformed page, or when a slug present in one locale is
 * absent in the other (a source-schema mismatch, not something to silently skip).
 */
export function importFromFixtures(fixtureDir: string): LocalizedTerm[] {
  const updatedAt = new Date().toISOString();
  const terms: LocalizedTerm[] = [];

  for (const { file, domain } of PAGES) {
    const usHtml = readFileSync(join(fixtureDir, 'us', file), 'utf8');
    const krHtml = readFileSync(join(fixtureDir, 'kr', file), 'utf8');

    const usEntries = parseDomainPage(usHtml, domain);
    const krEntries = parseDomainPage(krHtml, domain);
    const krBySlug = indexBySlug(krEntries);

    for (const us of usEntries) {
      const kr = krBySlug.get(us.slug);
      if (kr === undefined) {
        throw new FixtureParseError(
          `slug "${us.slug}" present in us/${file} but absent in kr/${file} ` +
            `(locale page mismatch; DESIGN §14.3)`,
        );
      }

      const aliasesEn = us.statText && us.statText !== us.name ? [us.name, us.statText] : [us.name];
      const aliasesKo = kr.statText && kr.statText !== kr.name ? [kr.statText] : [];

      terms.push({
        id: `${domain}.${us.slug}`,
        domain,
        canonicalEn: us.name,
        ko: kr.name,
        aliasesEn,
        aliasesKo,
        slug: us.slug,
        upstreamIds: [],
        confidence: 'slug',
        source: 'poe2db',
        updatedAt,
      });
    }
  }

  return terms;
}
