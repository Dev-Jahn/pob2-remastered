import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isValidTerm, type LocalizedTerm } from '../src/index.js';
import {
  assembleDictionary,
  buildDictionary,
  serializeDictionary,
  type ManualOverride,
} from '../src/dictionary.js';
import type { UpstreamSnapshot } from '../src/match.js';

// Phase 6 dictionary-build gate (DESIGN §8.4 step H, §18 named domains):
//   `pnpm --filter @pob2/localization test dictionary` -> `vitest run dictionary`
// resolves THIS file by its `dictionary` filename substring.
//
// dictionary.ts runs importer -> match and assembles the GENERATED ko-KR dictionary
// (Record<id, LocalizedTerm>) layered with a manual override store
// (manual_ko_overrides.json) that WINS over generated entries (§8.4 step G->J->H).
// It covers the four §18 named domains: keyword / item (base+unique) /
// skill (gem+support) / passive. The assembled dictionary is DETERMINISTIC
// (same input -> byte-identical output) and every entry keeps its English alias
// (§8.1 — aliasesEn is never emptied).

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const fixtureDir = join(pkgRoot, 'fixtures', 'poe2db');

// A small deterministic upstream snapshot mirroring the fixtures, so assembly runs
// without reading vendor/ at test time (the importer + match modules are exercised
// in their own suites). Names match the checked-in PoE2DB fixtures.
const snapshot: UpstreamSnapshot = {
  keyword: [
    { id: 'Evasion', name: 'Evasion', slug: 'Evasion' },
    { id: 'Energy_Shield', name: 'Energy Shield', slug: 'Energy_Shield' },
    { id: 'Ailment', name: 'Ailment', slug: 'Ailment' },
  ],
  skill: [{ id: 'Metadata/Items/Gems/SkillGemWhirlingAssault', name: 'Whirling Assault' }],
  support_gem: [],
  base: [{ id: 'Hunting Shoes', name: 'Hunting Shoes' }],
  unique: [],
  mod: [],
  stat: [],
};

const updatedAt = '2026-06-02T00:00:00.000Z';

function term(
  over: Partial<LocalizedTerm> & Pick<LocalizedTerm, 'id' | 'domain' | 'canonicalEn'>,
): LocalizedTerm {
  return {
    ko: '',
    aliasesEn: [],
    aliasesKo: [],
    upstreamIds: [],
    confidence: 'slug',
    source: 'poe2db',
    updatedAt,
    ...over,
  };
}

describe('buildDictionary (DESIGN §8.4 step H)', () => {
  const dict = buildDictionary(fixtureDir, snapshot);

  it('assembles a Record<id, LocalizedTerm> keyed by stable term id', () => {
    const entries = Object.values(dict);
    expect(entries.length).toBeGreaterThan(0);
    for (const [id, t] of Object.entries(dict)) {
      expect(t.id).toBe(id);
      expect(isValidTerm(t)).toBe(true);
    }
  });

  it('covers the four §18 named domains via the generated source', () => {
    // keyword, item base (item domain), skill gem are present from fixtures.
    expect(dict['keyword.Evasion']?.domain).toBe('keyword');
    expect(dict['base.Hunting_Shoes']?.domain).toBe('base');
    expect(dict['skill.Whirling_Assault']?.domain).toBe('skill');
    expect(dict['keyword.Evasion']?.ko).toBe('회피');
  });

  it('carries the upstream id from the match step onto matched entries', () => {
    expect(dict['keyword.Evasion']?.upstreamIds).toEqual(['Evasion']);
    expect(dict['skill.Whirling_Assault']?.upstreamIds).toEqual([
      'Metadata/Items/Gems/SkillGemWhirlingAssault',
    ]);
  });

  it('keeps every entry’s English alias — aliasesEn is never emptied (§8.1)', () => {
    for (const t of Object.values(dict)) {
      expect(t.aliasesEn.length).toBeGreaterThan(0);
      // the canonical English name is always reachable as a search token
      expect(t.aliasesEn).toContain(t.canonicalEn);
    }
  });
});

describe('assembleDictionary — manual override layering (DESIGN §8.4 step J wins over H)', () => {
  const generated: LocalizedTerm[] = [
    term({
      id: 'keyword.Evasion',
      domain: 'keyword',
      canonicalEn: 'Evasion',
      ko: '회피(자동)',
      aliasesEn: ['Evasion'],
      slug: 'Evasion',
      upstreamIds: ['Evasion'],
      confidence: 'exact',
      source: 'generated',
    }),
    term({
      id: 'skill.Whirling_Assault',
      domain: 'skill',
      canonicalEn: 'Whirling Assault',
      ko: '소용돌이 강타',
      aliasesEn: ['Whirling Assault'],
      slug: 'Whirling_Assault',
      upstreamIds: ['Metadata/Items/Gems/SkillGemWhirlingAssault'],
      confidence: 'exact',
      source: 'generated',
    }),
  ];

  const overrides: ManualOverride[] = [
    // Override an existing generated entry: human term wins.
    { id: 'keyword.Evasion', ko: '회피(수동확정)' },
    // Add a brand-new manual entry not present in the generated set.
    {
      id: 'passive.Acrobatics',
      domain: 'passive',
      canonicalEn: 'Acrobatics',
      ko: '곡예',
      aliasesEn: ['Acrobatics'],
      upstreamIds: ['node-12345'],
    },
  ];

  const dict = assembleDictionary(generated, overrides);

  it('lets a manual override beat the generated term for the same id', () => {
    expect(dict['keyword.Evasion']?.ko).toBe('회피(수동확정)');
    expect(dict['keyword.Evasion']?.source).toBe('manual');
    expect(dict['keyword.Evasion']?.confidence).toBe('manual');
  });

  it('preserves untouched generated entries', () => {
    expect(dict['skill.Whirling_Assault']?.ko).toBe('소용돌이 강타');
    expect(dict['skill.Whirling_Assault']?.source).toBe('generated');
  });

  it('admits a brand-new manual-only entry (passive domain, §18)', () => {
    expect(dict['passive.Acrobatics']?.ko).toBe('곡예');
    expect(dict['passive.Acrobatics']?.source).toBe('manual');
    expect(isValidTerm(dict['passive.Acrobatics'])).toBe(true);
  });

  it('does not empty the English alias when overriding (§8.1)', () => {
    // override carried no aliasesEn -> the generated entry’s alias is preserved.
    expect(dict['keyword.Evasion']?.aliasesEn).toContain('Evasion');
    expect(dict['keyword.Evasion']?.aliasesEn.length).toBeGreaterThan(0);
  });

  it('every assembled entry validates as a LocalizedTerm', () => {
    for (const t of Object.values(dict)) expect(isValidTerm(t)).toBe(true);
  });
});

describe('serializeDictionary — deterministic build artifact (DESIGN §12.2 Localization JSON)', () => {
  const dictA = buildDictionary(fixtureDir, snapshot);
  const dictB = buildDictionary(fixtureDir, snapshot);

  it('produces byte-identical output for the same input', () => {
    expect(serializeDictionary(dictA)).toBe(serializeDictionary(dictB));
  });

  it('orders keys deterministically regardless of insertion order', () => {
    const a = assembleDictionary(
      [
        term({ id: 'b.two', domain: 'keyword', canonicalEn: 'Two', aliasesEn: ['Two'] }),
        term({ id: 'a.one', domain: 'keyword', canonicalEn: 'One', aliasesEn: ['One'] }),
      ],
      [],
    );
    const b = assembleDictionary(
      [
        term({ id: 'a.one', domain: 'keyword', canonicalEn: 'One', aliasesEn: ['One'] }),
        term({ id: 'b.two', domain: 'keyword', canonicalEn: 'Two', aliasesEn: ['Two'] }),
      ],
      [],
    );
    expect(serializeDictionary(a)).toBe(serializeDictionary(b));
    // keys are sorted ascending
    const keys = Object.keys(JSON.parse(serializeDictionary(a)) as Record<string, unknown>);
    expect(keys).toEqual([...keys].sort());
  });

  it('ends with a trailing newline (stable diff-friendly artifact)', () => {
    expect(serializeDictionary(dictA).endsWith('\n')).toBe(true);
  });

  it('stamps updatedAt from authored provenance, never the build’s wall-clock', () => {
    // Every entry's updatedAt must be the checked-in provenance date (2026-06-02),
    // not "now" — otherwise the artifact would drift on every rebuild.
    for (const t of Object.values(dictA)) {
      expect(t.updatedAt).toBe('2026-06-02T00:00:00.000Z');
    }
  });
});
