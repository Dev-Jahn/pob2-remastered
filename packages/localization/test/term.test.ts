import { describe, expect, it } from 'vitest';
import { TERM_CONFIDENCES, TERM_SOURCES, isValidTerm, type LocalizedTerm } from '../src/index.js';

// Phase 6 term-model gate (DESIGN §8.3 Localization data model):
//   `pnpm --filter @pob2/localization test term` -> `vitest run term`
// resolves THIS file by its `term` filename substring. It pins the shape every
// later Phase 6 task (importer, dictionaries, search index) writes against: the
// LocalizedTerm record, its domain union, and the confidence/source enums — plus
// the tiny runtime validator that rejects malformed records.

// A fully-formed term that satisfies DESIGN §8.3.
const validTerm: LocalizedTerm = {
  id: 'kw.evasion',
  domain: 'keyword',
  canonicalEn: 'Evasion',
  ko: '회피',
  aliasesEn: ['evasion', 'ev'],
  aliasesKo: ['회피도'],
  slug: 'Evasion',
  poe2dbUrl: 'https://poe2db.tw/kr/Keywords#Evasion',
  upstreamIds: ['Evasion'],
  confidence: 'exact',
  source: 'poe2db',
  updatedAt: '2026-06-02T00:00:00.000Z',
};

describe('LocalizedTerm enums (DESIGN §8.3)', () => {
  it('declares the four confidence levels', () => {
    expect(TERM_CONFIDENCES).toEqual(['exact', 'slug', 'fuzzy', 'manual']);
  });

  it('declares the four provenance sources', () => {
    expect(TERM_SOURCES).toEqual(['upstream', 'poe2db', 'manual', 'generated']);
  });
});

describe('isValidTerm (DESIGN §8.3)', () => {
  it('accepts a fully-formed term', () => {
    expect(isValidTerm(validTerm)).toBe(true);
  });

  it('accepts a term with the optional fields omitted', () => {
    const minimal: LocalizedTerm = {
      id: 'ui.import',
      domain: 'ui',
      canonicalEn: 'Import',
      ko: '가져오기',
      aliasesEn: [],
      aliasesKo: [],
      upstreamIds: [],
      confidence: 'manual',
      source: 'manual',
      updatedAt: '2026-06-02T00:00:00.000Z',
    };
    expect(isValidTerm(minimal)).toBe(true);
  });

  it('rejects a non-object', () => {
    expect(isValidTerm(null)).toBe(false);
    expect(isValidTerm('Evasion')).toBe(false);
    expect(isValidTerm(42)).toBe(false);
  });

  it('rejects a term missing canonicalEn', () => {
    const { canonicalEn, ...rest } = validTerm;
    void canonicalEn;
    expect(isValidTerm(rest)).toBe(false);
  });

  it('rejects a term with an unknown domain', () => {
    expect(isValidTerm({ ...validTerm, domain: 'weapon' })).toBe(false);
  });

  it('rejects a term with an out-of-range confidence', () => {
    expect(isValidTerm({ ...validTerm, confidence: 'guess' })).toBe(false);
  });

  it('rejects a term with an out-of-range source', () => {
    expect(isValidTerm({ ...validTerm, source: 'scraped' })).toBe(false);
  });

  it('rejects a term whose alias arrays are not string arrays', () => {
    expect(isValidTerm({ ...validTerm, aliasesEn: 'evasion' })).toBe(false);
    expect(isValidTerm({ ...validTerm, aliasesKo: [1, 2] })).toBe(false);
    expect(isValidTerm({ ...validTerm, upstreamIds: [null] })).toBe(false);
  });

  it('rejects a term whose optional slug is the wrong type', () => {
    expect(isValidTerm({ ...validTerm, slug: 123 })).toBe(false);
  });
});
