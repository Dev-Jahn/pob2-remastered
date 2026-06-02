import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidTerm, type LocalizedTerm } from '../src/index.js';
import { importFromFixtures, parseDomainPage } from '../src/importer.js';

// Phase 6 importer gate (DESIGN §8.4 import pipeline step D, §14.3 parser failure):
//   `pnpm --filter @pob2/localization test importer` -> `vitest run importer`
// resolves THIS file by its `importer` filename substring.
//
// The importer is OFFLINE: it reads CHECKED-IN cached PoE2DB kr+us HTML fixtures
// (committed under fixtures/poe2db/) — it never fetches. It extracts
// slug/name/icon/stat-text (§8.4 step D), normalizes names, pairs kr+us by slug, and
// emits partially-filled LocalizedTerm records. Per §14.3 a malformed fixture must
// FAIL (throw), never silently yield an empty/partial result.

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, '..', 'fixtures', 'poe2db');
const corruptDir = join(fixtureDir, 'corrupt');

function indexBySlug(terms: LocalizedTerm[]): Map<string, LocalizedTerm> {
  return new Map(terms.map((t) => [t.slug ?? '', t]));
}

describe('importFromFixtures (DESIGN §8.4)', () => {
  const terms = importFromFixtures(fixtureDir);
  const bySlug = indexBySlug(terms);

  it('emits well-formed LocalizedTerm records', () => {
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(isValidTerm(term)).toBe(true);
      // Partially filled: matched by PoE2DB slug, sourced from poe2db, upstream id
      // matching is a LATER §8.4 step (F) so upstreamIds is still empty.
      expect(term.source).toBe('poe2db');
      expect(term.confidence).toBe('slug');
      expect(term.upstreamIds).toEqual([]);
    }
  });

  it('extracts slug/name/ko/en for a representative keyword', () => {
    const evasion = bySlug.get('Evasion');
    expect(evasion).toBeDefined();
    expect(evasion?.domain).toBe('keyword');
    expect(evasion?.slug).toBe('Evasion');
    expect(evasion?.canonicalEn).toBe('Evasion');
    expect(evasion?.ko).toBe('회피');
  });

  it('extracts slug/name/ko/en for a representative item base', () => {
    const shoes = bySlug.get('Hunting_Shoes');
    expect(shoes).toBeDefined();
    expect(shoes?.domain).toBe('base');
    expect(shoes?.slug).toBe('Hunting_Shoes');
    expect(shoes?.canonicalEn).toBe('Hunting Shoes');
    expect(shoes?.ko).toBe('사냥용 신발');
  });

  it('extracts slug/name/ko/en for a representative skill gem', () => {
    const whirl = bySlug.get('Whirling_Assault');
    expect(whirl).toBeDefined();
    expect(whirl?.domain).toBe('skill');
    expect(whirl?.slug).toBe('Whirling_Assault');
    expect(whirl?.canonicalEn).toBe('Whirling Assault');
    expect(whirl?.ko).toBe('소용돌이 강타');
  });

  it('keeps the English name as a search alias and never drops it (§8.1)', () => {
    const energyShield = bySlug.get('Energy_Shield');
    expect(energyShield?.canonicalEn).toBe('Energy Shield');
    expect(energyShield?.aliasesEn).toContain('Energy Shield');
  });
});

describe('parseDomainPage (DESIGN §8.4 step D)', () => {
  it('extracts the icon URL and stat text for each entry', () => {
    const html = `
      <div class="poe2db-keyword" data-slug="Evasion">
        <a name="Evasion" id="Evasion"></a>
        <img class="keyword-icon" src="https://web.poecdn.com/image/keyword/Evasion.png">
        <span class="keyword-name">Evasion</span>
        <div class="keyword-stat">Evasion Rating reduces the chance to be hit by attacks.</div>
      </div>`;
    const entries = parseDomainPage(html, 'keyword');
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry?.slug).toBe('Evasion');
    expect(entry?.name).toBe('Evasion');
    expect(entry?.icon).toBe('https://web.poecdn.com/image/keyword/Evasion.png');
    expect(entry?.statText).toBe('Evasion Rating reduces the chance to be hit by attacks.');
  });

  it('normalizes collapsed whitespace and HTML entities in names (§8.4 normalize)', () => {
    const html = `
      <div class="poe2db-item" data-slug="Smithing_Hammer">
        <a name="Smithing_Hammer"></a>
        <img class="item-icon" src="x.png">
        <span class="item-name">  Smith&amp;ing   Hammer
        </span>
        <div class="item-stat">Physical Damage: 18-31</div>
      </div>`;
    const entries = parseDomainPage(html, 'base');
    expect(entries[0]?.name).toBe('Smith&ing Hammer');
  });
});

describe('§14.3 — a malformed fixture FAILS rather than yielding empty', () => {
  it('throws when an entry is missing its required name field', () => {
    expect(() => importFromFixtures(corruptDir)).toThrow(/parse|malformed|name/i);
  });

  it('throws on a page that recognizes no entries at all', () => {
    expect(() => parseDomainPage('<html><body>no entries here</body></html>', 'keyword')).toThrow(
      /no .*entries|malformed|parse/i,
    );
  });

  it('throws — never returns [] — for a structurally broken entry', () => {
    const broken = `
      <div class="poe2db-keyword" data-slug="Evasion">
        <a name="Evasion"></a>
        <div class="keyword-stat">stat only, no name, no icon</div>
      </div>`;
    let threw = false;
    try {
      parseDomainPage(broken, 'keyword');
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
