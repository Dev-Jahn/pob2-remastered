import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type LocalizedTerm } from '../src/index.js';
import { buildSearchIndex, search, type SearchDocument } from '../src/search.js';

// Phase 6 bilingual-search gate (DESIGN §8.1 ko/en parallel search, §11.2 search index):
//   `pnpm --filter @pob2/localization test search` -> `vitest run search`
// resolves THIS file by its `search` filename substring.
//
// search.ts builds a SearchDocument index (§11.2: id/domain/titleKo/titleEn/
// aliasesKo/aliasesEn/tags) over the generated dictionary, with a query function
// that resolves a term from EITHER language and from aliases. The §8.1 worked
// example: '회피', 'evasion', 'ev', '회피도' all hit the SAME canonical Evasion doc;
// a user crossing between an English build guide and the Korean client never loses
// the term (the English alias is never dropped, §8.1).

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
    source: 'generated',
    updatedAt,
    ...over,
  };
}

// A small bilingual dictionary mirroring the §8.1 example. The Evasion keyword
// carries the English abbreviation alias `ev` and the Korean alias `회피도` so the
// four worked-example queries below all resolve to it.
const dict: Record<string, LocalizedTerm> = {
  'keyword.Evasion': term({
    id: 'keyword.Evasion',
    domain: 'keyword',
    canonicalEn: 'Evasion',
    ko: '회피',
    aliasesEn: ['Evasion', 'ev'],
    aliasesKo: ['회피도'],
    slug: 'Evasion',
    upstreamIds: ['Evasion'],
    confidence: 'exact',
  }),
  'keyword.Energy_Shield': term({
    id: 'keyword.Energy_Shield',
    domain: 'keyword',
    canonicalEn: 'Energy Shield',
    ko: '에너지 보호막',
    aliasesEn: ['Energy Shield', 'es'],
    aliasesKo: ['에너지 보호막', '에쉴'],
    slug: 'Energy_Shield',
    confidence: 'slug',
  }),
  'skill.Whirling_Assault': term({
    id: 'skill.Whirling_Assault',
    domain: 'skill',
    canonicalEn: 'Whirling Assault',
    ko: '소용돌이 강타',
    aliasesEn: ['Whirling Assault'],
    aliasesKo: ['소용돌이 강타'],
    upstreamIds: ['Metadata/Items/Gems/SkillGemWhirlingAssault'],
    confidence: 'exact',
  }),
};

describe('localization bilingual search (scaffold)', () => {
  it('declares ko-KR and en-US as the bilingual search locales', () => {
    expect(SUPPORTED_LOCALES).toContain('ko-KR');
    expect(SUPPORTED_LOCALES).toContain('en-US');
    expect(DEFAULT_LOCALE).toBe('ko-KR');
  });
});

describe('buildSearchIndex (DESIGN §11.2 SearchDocument)', () => {
  const index = buildSearchIndex(dict);

  it('emits one §11.2 SearchDocument per dictionary entry', () => {
    expect(index.documents.length).toBe(Object.keys(dict).length);
  });

  it('maps the §8.3 LocalizedTerm onto the §11.2 SearchDocument shape', () => {
    const doc = index.documents.find((d) => d.id === 'keyword.Evasion');
    expect(doc).toBeDefined();
    const ev = doc as SearchDocument;
    expect(ev.id).toBe('keyword.Evasion');
    expect(ev.domain).toBe('keyword');
    expect(ev.titleKo).toBe('회피');
    expect(ev.titleEn).toBe('Evasion');
    expect(ev.aliasesEn).toContain('ev');
    expect(ev.aliasesKo).toContain('회피도');
    // domain is carried as a search tag (§11.2 tags)
    expect(ev.tags).toContain('keyword');
  });
});

describe('search — §8.1 ko/en bilingual resolution', () => {
  const index = buildSearchIndex(dict);
  const evasionId = 'keyword.Evasion';

  it('resolves the Korean canonical term (회피) to the Evasion doc', () => {
    const hits = search(index, '회피');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe(evasionId);
  });

  it('resolves the English canonical term (evasion) to the Evasion doc', () => {
    const hits = search(index, 'evasion');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe(evasionId);
  });

  it('resolves the English abbreviation alias (ev) to the Evasion doc', () => {
    const hits = search(index, 'ev');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe(evasionId);
  });

  it('resolves the Korean alias (회피도) to the Evasion doc', () => {
    const hits = search(index, '회피도');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.id).toBe(evasionId);
  });

  it('the four §8.1 worked-example queries all hit the SAME canonical doc', () => {
    const ids = ['회피', 'evasion', 'ev', '회피도'].map((q) => search(index, q)[0]?.id);
    expect(ids).toEqual([evasionId, evasionId, evasionId, evasionId]);
  });

  it('is case-insensitive for the English path', () => {
    expect(search(index, 'EVASION')[0]?.id).toBe(evasionId);
    expect(search(index, 'Ev')[0]?.id).toBe(evasionId);
  });

  it('returns empty for an unknown query — no fabricated hit (NO-FALLBACK, §8.1)', () => {
    expect(search(index, '존재하지않는단어')).toEqual([]);
    expect(search(index, 'zzzznotaterm')).toEqual([]);
  });

  it('returns empty for a blank query (no term to resolve)', () => {
    expect(search(index, '')).toEqual([]);
    expect(search(index, '   ')).toEqual([]);
  });
});
