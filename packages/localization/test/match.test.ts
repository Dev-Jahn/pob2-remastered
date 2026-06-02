import { describe, expect, it } from 'vitest';
import { isValidTerm, type LocalizedTerm } from '../src/index.js';
import { loadUpstreamSnapshot, matchTerms, type UpstreamSnapshot } from '../src/match.js';

// Phase 6 upstream-match gate (DESIGN §8.5 Matching 전략, §8.4 step F):
//   `pnpm --filter @pob2/localization test match` -> `vitest run match`
// resolves THIS file by its `match` filename substring.
//
// matchTerms() resolves each imported (PoE2DB) term to upstream `src/Data` ids with
// a confidence tag, per the §8.5 matching table (exact id/name -> exact, anchor slug
// -> slug, normalized-text guess -> fuzzy). NO-FALLBACK (DESIGN §15, golden rule 3):
// a guess is tagged `fuzzy` and parked in the review queue — NEVER silently promoted
// to `exact`/assigned. Unmatched terms also go to the review queue with empty ids.
//
// The matcher is PURE over an in-memory upstream snapshot, so this suite builds a
// small deterministic snapshot inline (no vendor read, no network) — mirroring the
// offline/fixture convention of importer.test.ts.

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

// A representative known keyword + skill gem + item base, plus a base whose English
// name is AMBIGUOUS upstream (two distinct base ids share the normalized name) so it
// cannot be resolved exactly and must land in the review queue tagged `fuzzy`.
const snapshot: UpstreamSnapshot = {
  keyword: [{ id: 'Evasion', name: 'Evasion', slug: 'Evasion' }],
  skill: [{ id: 'Metadata/Items/Gems/SkillGemWhirlingAssault', name: 'Whirling Assault' }],
  support_gem: [],
  base: [
    { id: 'Hunting Shoes', name: 'Hunting Shoes' },
    // Two upstream bases normalize to the same display name -> ambiguous.
    { id: 'Steel Ring (Ezomyte)', name: 'Steel Ring' },
    { id: 'Steel Ring (Vaal)', name: 'Steel Ring' },
  ],
  unique: [],
  mod: [],
  stat: [],
};

const imported: LocalizedTerm[] = [
  term({ id: 'keyword.Evasion', domain: 'keyword', canonicalEn: 'Evasion', slug: 'Evasion' }),
  term({
    id: 'skill.Whirling_Assault',
    domain: 'skill',
    canonicalEn: 'Whirling Assault',
    slug: 'Whirling_Assault',
  }),
  term({
    id: 'base.Hunting_Shoes',
    domain: 'base',
    canonicalEn: 'Hunting Shoes',
    slug: 'Hunting_Shoes',
  }),
  // Ambiguous: name matches two upstream base ids -> fuzzy, queued, NOT assigned.
  term({ id: 'base.Steel_Ring', domain: 'base', canonicalEn: 'Steel Ring', slug: 'Steel_Ring' }),
  // No upstream counterpart at all -> queued unmatched, empty upstreamIds.
  term({
    id: 'base.Phantom_Boots',
    domain: 'base',
    canonicalEn: 'Phantom Boots',
    slug: 'Phantom_Boots',
  }),
];

describe('matchTerms (DESIGN §8.5)', () => {
  const { matched, reviewQueue } = matchTerms(imported, snapshot);

  function find(id: string): LocalizedTerm | undefined {
    return [...matched, ...reviewQueue].find((t) => t.id === id);
  }

  it('exact-matches a known keyword to its upstream keyword id', () => {
    const t = matched.find((m) => m.id === 'keyword.Evasion');
    expect(t).toBeDefined();
    expect(t?.confidence).toBe('exact');
    expect(t?.upstreamIds).toEqual(['Evasion']);
    expect(isValidTerm(t)).toBe(true);
  });

  it('exact-matches a known skill gem to its upstream metadata id', () => {
    const t = matched.find((m) => m.id === 'skill.Whirling_Assault');
    expect(t).toBeDefined();
    expect(t?.confidence).toBe('exact');
    expect(t?.upstreamIds).toEqual(['Metadata/Items/Gems/SkillGemWhirlingAssault']);
  });

  it('exact-matches a known item base to its upstream base type id', () => {
    const t = matched.find((m) => m.id === 'base.Hunting_Shoes');
    expect(t).toBeDefined();
    expect(t?.confidence).toBe('exact');
    expect(t?.upstreamIds).toEqual(['Hunting Shoes']);
  });

  it('parks an ambiguous name in the review queue tagged fuzzy — never force-assigned', () => {
    const queued = reviewQueue.find((t) => t.id === 'base.Steel_Ring');
    expect(queued).toBeDefined();
    expect(queued?.confidence).toBe('fuzzy');
    // NO-FALLBACK: a guess is queued, not silently promoted to a single exact id.
    expect(queued?.upstreamIds).toEqual([]);
    // It must NOT have leaked into the matched (auto-applied) set.
    expect(matched.some((m) => m.id === 'base.Steel_Ring')).toBe(false);
  });

  it('queues an unmatched term with no upstream id rather than guessing', () => {
    const queued = reviewQueue.find((t) => t.id === 'base.Phantom_Boots');
    expect(queued).toBeDefined();
    expect(queued?.upstreamIds).toEqual([]);
    expect(matched.some((m) => m.id === 'base.Phantom_Boots')).toBe(false);
  });

  it('never overlaps: a term is either matched or queued, exactly once', () => {
    const ids = [...matched, ...reviewQueue].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual(imported.map((t) => t.id).sort());
    // every resolved term still validates as a LocalizedTerm
    for (const t of [...matched, ...reviewQueue]) expect(isValidTerm(t)).toBe(true);
  });

  it('preserves matched candidate, since find() is only a convenience helper', () => {
    expect(find('keyword.Evasion')?.confidence).toBe('exact');
  });
});

describe('loadUpstreamSnapshot (DESIGN §8.5 — reads vendored src/Data, never writes it)', () => {
  // Resolve the checked-in upstream Data dir relative to this test file.
  const dataDir = new URL('../../../vendor/PathOfBuilding-PoE2/src/Data', import.meta.url).pathname;

  const snap = loadUpstreamSnapshot(dataDir);

  it('indexes the real upstream skill gem and item base referenced by the fixtures', () => {
    const gem = snap.skill.find((g) => g.name === 'Whirling Assault');
    expect(gem?.id).toBe('Metadata/Items/Gems/SkillGemWhirlingAssault');

    const base = snap.base.find((b) => b.name === 'Hunting Shoes');
    expect(base?.id).toBe('Hunting Shoes');
  });

  it('feeds matchTerms: a real imported gem term resolves exact against the snapshot', () => {
    const gemTerm = term({
      id: 'skill.Whirling_Assault',
      domain: 'skill',
      canonicalEn: 'Whirling Assault',
      slug: 'Whirling_Assault',
    });
    const { matched } = matchTerms([gemTerm], snap);
    expect(matched[0]?.confidence).toBe('exact');
    expect(matched[0]?.upstreamIds).toEqual(['Metadata/Items/Gems/SkillGemWhirlingAssault']);
  });
});
