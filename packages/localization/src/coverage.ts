/**
 * Per-domain translation coverage against the DESIGN §8.7 MVP thresholds.
 *
 * The §8.7 table sets a MVP coverage bar per localization area (UI 100%, keyword
 * 95%+, skill/support gem 95%+, item base 90%+, unique 90%+, passive node 85%+,
 * mod/stat description 70%+). This module turns the generated ko-KR dictionary into
 * a per-domain coverage number and grades it against those bars — it is the metric
 * behind the Phase 6 `coverage` gate (`coverage:check`, see scripts/coverage-check.mjs).
 *
 * METRIC (DESIGN §8.7, task loc-coverage-check): per domain,
 *
 *     coverage = translated upstream ids / total upstream ids committed in that domain
 *
 * The "total upstream ids" universe is the set of distinct upstream ANCHORS the dictionary
 * commits in that domain. A term anchors on its `upstreamIds` (each id is one unit) when it
 * has them; a term with no `src/Data` id anchors on its single PoE2DB slug/term id instead
 * (DESIGN §8.5: keyword's primary key IS its PoE2DB anchor slug, which has no separate
 * `src/Data` id). An anchor counts as "translated" when its term carries a non-empty Korean
 * string.
 *
 * NO-FALLBACK (golden rule 3, §8.7 "real numbers only"): a domain with no committed
 * upstream ids is honestly 0% — never an assumed 100% from an empty store — so the gate
 * FAILS until the data exists. The UI 100% leg is NOT measured from this term dictionary
 * (UI strings live in @pob2/ui); it is satisfied by loc-stat-label-localize + the
 * @pob2/ui i18n.test ko/en key-parity check and is cross-referenced via the
 * `uiKeyParity` proof — passing only when that external check passes, never auto-passed.
 */
import type { Dictionary } from './dictionary.js';
import type { LocalizedTerm } from './term.js';

/** A coverage domain — one row of the DESIGN §8.7 MVP threshold table. */
export type CoverageDomain =
  | 'ui'
  | 'keyword'
  | 'skill'
  | 'support_gem'
  | 'base'
  | 'unique'
  | 'passive'
  | 'mod'
  | 'stat';

/**
 * The DESIGN §8.7 MVP coverage bars (percent), one per localization area.
 *
 *   | 영역 (area)           | MVP  |
 *   | UI 문자열             | 100% |
 *   | Keyword              | 95%+ |
 *   | Skill/support gem    | 95%+ |
 *   | Item base            | 90%+ |
 *   | Unique item          | 90%+ |
 *   | Passive node         | 85%+ |
 *   | Mod/stat description | 70%+ |
 */
export const MVP_THRESHOLDS: Record<CoverageDomain, number> = {
  ui: 100,
  keyword: 95,
  skill: 95,
  support_gem: 95,
  base: 90,
  unique: 90,
  passive: 85,
  mod: 70,
  stat: 70,
};

/** Coverage measured for one domain: translated upstream ids over the total universe. */
export interface DomainCoverage {
  /** Distinct upstream ids committed in this domain (the denominator). */
  total: number;
  /** Of those, how many are translated — have a non-empty Korean string (the numerator). */
  translated: number;
  /** translated/total as an integer percent (0 when total is 0 — NO-FALLBACK, never 100). */
  percent: number;
}

/** The full per-domain coverage map (every §8.7 MVP domain present, none dropped). */
export type Coverage = Record<CoverageDomain, DomainCoverage>;

/** One graded domain: its measured percent vs. its §8.7 MVP bar. */
export interface CoverageResult {
  domain: CoverageDomain;
  percent: number;
  threshold: number;
  ok: boolean;
}

/** External proofs for domains NOT measured from the term dictionary. */
export interface CoverageContext {
  /**
   * Whether the @pob2/ui i18n ko/en key-parity check passes (the §2.1 "UI 문자열 100%"
   * proof, loc-stat-label-localize). The UI leg passes at 100% iff this is true —
   * cross-referenced, never auto-passed from an empty dictionary (NO-FALLBACK).
   */
  uiKeyParity?: boolean;
}

/** The domains whose universe is the dictionary's committed upstream ids (UI is external). */
const DATA_DOMAINS: CoverageDomain[] = [
  'keyword',
  'skill',
  'support_gem',
  'base',
  'unique',
  'passive',
  'mod',
  'stat',
];

/** A term counts toward translation when it carries a non-empty Korean string (§8.1). */
function isTranslated(term: LocalizedTerm): boolean {
  return term.ko.trim().length > 0;
}

/** translated/total as an integer percent; 0/0 is 0% (NO-FALLBACK), never 100%. */
function toPercent(translated: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((translated / total) * 100);
}

/**
 * Compute per-domain translation coverage over the dictionary's committed upstream-id
 * universe (DESIGN §8.7). Each distinct upstream id is counted once per domain; it is
 * "translated" when its term carries a non-empty Korean string. The UI domain is not
 * derived from this term dictionary (see {@link checkCoverage}) and reports 0/0 here.
 */
export function computeCoverage(dict: Dictionary): Coverage {
  // domain -> upstream id -> translated?  (a later translated entry for the same id wins)
  const universe = new Map<CoverageDomain, Map<string, boolean>>();
  for (const domain of DATA_DOMAINS) universe.set(domain, new Map());

  for (const term of Object.values(dict)) {
    const bucket = universe.get(term.domain as CoverageDomain);
    if (bucket === undefined) continue; // a domain outside the §8.7 table (e.g. area/boss)
    const translated = isTranslated(term);
    // A term anchors on its src/Data upstream ids; a term with none (a keyword, whose
    // upstream anchor IS its PoE2DB slug — §8.5) anchors on its single term id instead.
    const anchors = term.upstreamIds.length > 0 ? term.upstreamIds : [term.id];
    for (const anchor of anchors) {
      // Once an anchor is translated by any committing term it stays translated.
      bucket.set(anchor, (bucket.get(anchor) ?? false) || translated);
    }
  }

  const coverage = {} as Coverage;
  for (const domain of Object.keys(MVP_THRESHOLDS) as CoverageDomain[]) {
    const bucket = universe.get(domain);
    if (bucket === undefined) {
      // UI (and any non-data domain): universe is not the term dictionary.
      coverage[domain] = { total: 0, translated: 0, percent: 0 };
      continue;
    }
    const total = bucket.size;
    let translated = 0;
    for (const isOk of bucket.values()) if (isOk) translated++;
    coverage[domain] = { total, translated, percent: toPercent(translated, total) };
  }
  return coverage;
}

/**
 * Grade every §8.7 MVP domain against its threshold (DESIGN §8.7). Returns one
 * {@link CoverageResult} per domain — none is ever skipped (NO-FALLBACK: a missing
 * domain is graded at 0% and fails). The UI leg is graded from the external
 * `uiKeyParity` proof (loc-stat-label-localize + the @pob2/ui i18n key-parity check),
 * NOT from the term dictionary: it reads 100% when the proof passes, 0% otherwise.
 */
export function checkCoverage(dict: Dictionary, ctx: CoverageContext = {}): CoverageResult[] {
  const coverage = computeCoverage(dict);
  const results: CoverageResult[] = [];
  for (const domain of Object.keys(MVP_THRESHOLDS) as CoverageDomain[]) {
    const threshold = MVP_THRESHOLDS[domain];
    let percent: number;
    if (domain === 'ui') {
      // UI 100% leg: cross-referenced to the external i18n key-parity proof.
      percent = ctx.uiKeyParity ? 100 : 0;
    } else {
      percent = coverage[domain].percent;
    }
    results.push({ domain, percent, threshold, ok: percent >= threshold });
  }
  return results;
}
