import { describe, expect, it } from 'vitest';
import type { LocalizedTerm } from '../src/index.js';
import {
  MVP_THRESHOLDS,
  computeCoverage,
  checkCoverage,
  type CoverageDomain,
} from '../src/coverage.js';

// Phase 6 coverage gate (DESIGN §8.7 translation coverage thresholds, §2.1 "UI
// 문자열 100%"). Resolved by `pnpm --filter @pob2/localization test coverage` ->
// `vitest run coverage` (the `coverage` filename substring).
//
// coverage.ts computes per-domain translation coverage — translated upstream ids
// over total upstream ids committed in that domain — and grades it against the
// §8.7 MVP bars. NO-FALLBACK: a domain with NO committed upstream ids is honestly
// 0% (never an assumed 100%), and an under-target domain FAILS the gate. The UI
// 100% leg is satisfied externally (loc-stat-label-localize + the @pob2/ui
// i18n.test ko/en key-parity check) and is cross-referenced — never silently
// auto-passed here.

const updatedAt = '2026-06-02T00:00:00.000Z';

function term(
  over: Partial<LocalizedTerm> & Pick<LocalizedTerm, 'id' | 'domain' | 'canonicalEn'>,
): LocalizedTerm {
  return {
    ko: '한국어',
    aliasesEn: [over.canonicalEn],
    aliasesKo: [],
    upstreamIds: [over.id],
    confidence: 'exact',
    source: 'generated',
    updatedAt,
    ...over,
  };
}

describe('MVP_THRESHOLDS — pins the DESIGN §8.7 translation coverage table', () => {
  it('encodes every §8.7 MVP bar exactly', () => {
    // DESIGN §8.7 (MVP column): UI 100, keyword 95+, skill/support gem 95+, item
    // base 90+, unique 90+, passive node 85+, mod/stat description 70+.
    expect(MVP_THRESHOLDS).toEqual({
      ui: 100,
      keyword: 95,
      skill: 95,
      support_gem: 95,
      base: 90,
      unique: 90,
      passive: 85,
      mod: 70,
      stat: 70,
    });
  });

  it('pins UI at 100% — the §2.1 "UI 문자열 100%" bar', () => {
    expect(MVP_THRESHOLDS.ui).toBe(100);
  });

  it('pins keyword and skill/support-gem at 95%+', () => {
    expect(MVP_THRESHOLDS.keyword).toBe(95);
    expect(MVP_THRESHOLDS.skill).toBe(95);
    expect(MVP_THRESHOLDS.support_gem).toBe(95);
  });

  it('pins item base and unique at 90%+, passive at 85%+, mod/stat at 70%+', () => {
    expect(MVP_THRESHOLDS.base).toBe(90);
    expect(MVP_THRESHOLDS.unique).toBe(90);
    expect(MVP_THRESHOLDS.passive).toBe(85);
    expect(MVP_THRESHOLDS.mod).toBe(70);
    expect(MVP_THRESHOLDS.stat).toBe(70);
  });
});

describe('computeCoverage — translated upstream ids / total upstream ids per domain', () => {
  it('reports 100% for a domain whose every committed upstream id is translated', () => {
    const dict: Record<string, LocalizedTerm> = {
      'keyword.Evasion': term({ id: 'keyword.Evasion', domain: 'keyword', canonicalEn: 'Evasion' }),
      'keyword.Energy_Shield': term({
        id: 'keyword.Energy_Shield',
        domain: 'keyword',
        canonicalEn: 'Energy Shield',
      }),
    };
    const cov = computeCoverage(dict);
    expect(cov.keyword.total).toBe(2);
    expect(cov.keyword.translated).toBe(2);
    expect(cov.keyword.percent).toBe(100);
  });

  it('counts an entry with an EMPTY ko string as untranslated (lowers coverage)', () => {
    const dict: Record<string, LocalizedTerm> = {
      'skill.A': term({ id: 'skill.A', domain: 'skill', canonicalEn: 'A' }),
      // committed to the universe (has an upstream id) but NOT translated (ko empty)
      'skill.B': term({ id: 'skill.B', domain: 'skill', canonicalEn: 'B', ko: '' }),
    };
    const cov = computeCoverage(dict);
    expect(cov.skill.total).toBe(2);
    expect(cov.skill.translated).toBe(1);
    expect(cov.skill.percent).toBe(50);
  });

  it('counts each distinct upstream id in the universe, not each dictionary entry', () => {
    const dict: Record<string, LocalizedTerm> = {
      'base.Multi': term({
        id: 'base.Multi',
        domain: 'base',
        canonicalEn: 'Multi',
        upstreamIds: ['Base A', 'Base B'],
      }),
    };
    const cov = computeCoverage(dict);
    expect(cov.base.total).toBe(2);
    expect(cov.base.translated).toBe(2);
  });

  it('anchors a keyword with NO src/Data id on its slug/term id (§8.5 — slug IS the anchor)', () => {
    const dict: Record<string, LocalizedTerm> = {
      // Keywords live in PoE2DB; their upstream anchor is the slug, not a src/Data id,
      // so upstreamIds is legitimately empty — the term still counts (anchored by its id).
      'keyword.Evasion': term({
        id: 'keyword.Evasion',
        domain: 'keyword',
        canonicalEn: 'Evasion',
        slug: 'Evasion',
        upstreamIds: [],
      }),
    };
    const cov = computeCoverage(dict);
    expect(cov.keyword.total).toBe(1);
    expect(cov.keyword.translated).toBe(1);
    expect(cov.keyword.percent).toBe(100);
  });

  it('NO-FALLBACK: a domain with no committed upstream ids is 0%, never an assumed 100%', () => {
    const cov = computeCoverage({});
    for (const domain of Object.keys(MVP_THRESHOLDS) as CoverageDomain[]) {
      expect(cov[domain].percent).toBe(0);
    }
  });
});

describe('checkCoverage — grades each domain against its §8.7 MVP bar', () => {
  function fullyTranslated(domain: CoverageDomain, n: number): Record<string, LocalizedTerm> {
    const dict: Record<string, LocalizedTerm> = {};
    for (let i = 0; i < n; i++) {
      const id = `${domain}.id${i}`;
      dict[id] = term({ id, domain, canonicalEn: `Name ${i}` });
    }
    return dict;
  }

  it('passes a domain whose coverage meets or exceeds its threshold', () => {
    // 100% keyword coverage >= 95% bar
    const result = checkCoverage(fullyTranslated('keyword', 20));
    const keyword = result.find((r) => r.domain === 'keyword');
    expect(keyword?.ok).toBe(true);
    expect(keyword?.percent).toBe(100);
  });

  it('fails an under-target domain (the threshold-table guarantee)', () => {
    // 19 of 20 base ids translated -> 95% < 90%? No: 95% >= 90% passes. Make it
    // 17/20 = 85% which is BELOW the 90% item-base bar.
    const dict = fullyTranslated('base', 17);
    for (let i = 0; i < 3; i++) {
      const id = `base.untranslated${i}`;
      dict[id] = term({ id, domain: 'base', canonicalEn: `Untranslated ${i}`, ko: '' });
    }
    const result = checkCoverage(dict);
    const base = result.find((r) => r.domain === 'base');
    expect(base?.percent).toBe(85);
    expect(base?.threshold).toBe(90);
    expect(base?.ok).toBe(false);
  });

  it('NO-FALLBACK: a missing domain counts as 0% and fails, never skipped', () => {
    // Empty dictionary: every data domain is 0% and below its (>0) bar.
    const result = checkCoverage({});
    const dataDomains = result.filter((r) => r.domain !== 'ui');
    for (const r of dataDomains) {
      expect(r.percent).toBe(0);
      expect(r.ok).toBe(false);
    }
    // Every MVP domain is graded — none is silently dropped.
    expect(new Set(result.map((r) => r.domain))).toEqual(new Set(Object.keys(MVP_THRESHOLDS)));
  });

  it('grades the UI domain from the external i18n key-parity proof, not the dictionary', () => {
    // UI strings live in @pob2/ui (i18n.test ko/en key-parity = 100%), not in this
    // term dictionary. The UI leg is cross-referenced: when the external proof is
    // satisfied it passes at 100%; it is never silently auto-passed from an empty
    // dictionary (that would violate NO-FALLBACK).
    const ok = checkCoverage({}, { uiKeyParity: true }).find((r) => r.domain === 'ui');
    expect(ok?.percent).toBe(100);
    expect(ok?.ok).toBe(true);

    const broken = checkCoverage({}, { uiKeyParity: false }).find((r) => r.domain === 'ui');
    expect(broken?.percent).toBe(0);
    expect(broken?.ok).toBe(false);
  });
});
