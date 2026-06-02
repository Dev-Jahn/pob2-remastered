/**
 * Coverage dashboard view-model (DESIGN §18 "coverage dashboard", §8.7 translation
 * coverage thresholds).
 *
 * A pure, framework-free transform that turns the loc-coverage metric (the
 * per-domain `Coverage` map produced by @pob2/localization's coverage.ts —
 * translated upstream ids / total committed in that domain) into the rows the
 * Settings/About → localization screen renders: one row per §8.7 MVP-threshold
 * domain, each carrying the localized (ko/en) domain label key, the
 * translated/total count, the measured percent, its MVP + Stable target, and a
 * pass / under-target status grade. No React, no I/O — data in, data out — so the
 * dashboard rows are unit-tested apart from any renderer (DESIGN §5.1: UI layer
 * holds view-models).
 *
 * NO-FALLBACK (DESIGN §8.7 "real numbers only", §6.4, golden rule 3): a domain
 * with no committed ids (0/0) is honestly 0% and graded UNDER TARGET — never an
 * assumed 100% from an empty store. This view-model only re-shapes the coverage
 * numbers it is given against the §8.7 bars; it never computes, defaults, or
 * fabricates a coverage value.
 */
import type { StringKey } from '../i18n/index.js';

/**
 * One coverage domain — a row of the DESIGN §8.7 MVP/Stable threshold table.
 *
 * Structurally mirrors @pob2/localization's `CoverageDomain`; re-declared here so
 * this pure transform does not pull the runtime localization package into the UI
 * layer (DESIGN §5.1, mirroring how the Overview view-model re-declares
 * `BuildSummary`). The producer's `Coverage` map is consumed as plain data.
 */
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

/** Coverage measured for one domain (the loc-coverage metric's `DomainCoverage`). */
export interface DomainCoverage {
  /** Distinct upstream ids committed in this domain (the denominator). */
  total: number;
  /** Of those, how many are translated (the numerator). */
  translated: number;
  /** translated/total as an integer percent (0 when total is 0 — NO-FALLBACK). */
  percent: number;
}

/** The full per-domain coverage map the dashboard consumes (loc-coverage output). */
export type Coverage = Record<CoverageDomain, DomainCoverage>;

/**
 * The DESIGN §8.7 MVP coverage bars (percent), one per localization area. Mirrors
 * @pob2/localization's `MVP_THRESHOLDS` — the dashboard's MVP target column.
 *
 *   | 영역 (area)           | MVP  |
 *   | UI 문자열             | 100% |
 *   | Keyword              | 95%+ |
 *   | Skill/support gem    | 95%+ |
 *   | Item base            | 90%+ |
 *   | Unique item          | 90%+ |
 *   | Passive node         | 85%+ |
 *   | Mod/stat description  | 70%+ |
 */
export const COVERAGE_MVP_THRESHOLDS: Record<CoverageDomain, number> = {
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

/**
 * The DESIGN §8.7 Stable coverage bars (percent) — the dashboard's Stable target
 * column (the second column of the §8.7 table).
 *
 *   | 영역 (area)           | Stable |
 *   | UI 문자열             | 100%   |
 *   | Keyword              | 99%+   |
 *   | Skill/support gem    | 99%+   |
 *   | Item base            | 98%+   |
 *   | Unique item          | 98%+   |
 *   | Passive node         | 95%+   |
 *   | Mod/stat description  | 90%+   |
 */
export const COVERAGE_STABLE_THRESHOLDS: Record<CoverageDomain, number> = {
  ui: 100,
  keyword: 99,
  skill: 99,
  support_gem: 99,
  base: 98,
  unique: 98,
  passive: 95,
  mod: 90,
  stat: 90,
};

/** i18n key for each domain's display label (resolved through `t` by the renderer). */
const DOMAIN_LABEL_KEY: Record<CoverageDomain, StringKey> = {
  ui: 'coverage.domain.ui',
  keyword: 'coverage.domain.keyword',
  skill: 'coverage.domain.skill',
  support_gem: 'coverage.domain.supportGem',
  base: 'coverage.domain.base',
  unique: 'coverage.domain.unique',
  passive: 'coverage.domain.passive',
  mod: 'coverage.domain.mod',
  stat: 'coverage.domain.stat',
};

/** §8.7 threshold-table order — the order the dashboard rows render in. */
const DOMAIN_ORDER: readonly CoverageDomain[] = [
  'ui',
  'keyword',
  'skill',
  'support_gem',
  'base',
  'unique',
  'passive',
  'mod',
  'stat',
];

/** A domain's grade vs. its MVP bar: met when at/above it, under target otherwise. */
export type CoverageStatus = 'met' | 'under-target';

/** One dashboard row: a graded domain coverage line for the §18 dashboard. */
export interface CoverageDashboardRow {
  /** The §8.7 domain this row grades. */
  domain: CoverageDomain;
  /** i18n key for the localized (ko/en) domain label (renderer resolves via `t`). */
  labelKey: StringKey;
  /** Translated upstream ids in this domain (the numerator). */
  translated: number;
  /** Total committed upstream ids in this domain (the denominator). */
  total: number;
  /** translated/total as an integer percent (0 for a 0/0 domain — NO-FALLBACK). */
  percent: number;
  /** This domain's §8.7 MVP target percent. */
  mvpTarget: number;
  /** This domain's §8.7 Stable target percent. */
  stableTarget: number;
  /** 'met' iff percent ≥ the MVP bar, else 'under-target' (a 0/0 domain is under). */
  status: CoverageStatus;
}

/** The full dashboard model: an i18n title key plus one row per §8.7 domain. */
export interface CoverageDashboardModel {
  /** i18n key for the dashboard title (Settings/About → localization). */
  titleKey: StringKey;
  rows: CoverageDashboardRow[];
}

/** Grade one domain's coverage against its MVP bar (≥ bar → met, else under). */
function gradeRow(domain: CoverageDomain, dc: DomainCoverage): CoverageDashboardRow {
  const mvpTarget = COVERAGE_MVP_THRESHOLDS[domain];
  return {
    domain,
    labelKey: DOMAIN_LABEL_KEY[domain],
    translated: dc.translated,
    total: dc.total,
    percent: dc.percent,
    mvpTarget,
    stableTarget: COVERAGE_STABLE_THRESHOLDS[domain],
    status: dc.percent >= mvpTarget ? 'met' : 'under-target',
  };
}

/**
 * Build the §18 coverage-dashboard model from the loc-coverage metric. Pure: every
 * row's number traces straight to the supplied `Coverage` map; a 0/0 domain stays
 * 0% and is graded under target (NO-FALLBACK — never coerced to a passing 100%).
 */
export function buildCoverageDashboardModel(coverage: Coverage): CoverageDashboardModel {
  return {
    titleKey: 'coverage.title',
    rows: DOMAIN_ORDER.map((domain) => gradeRow(domain, coverage[domain])),
  };
}
