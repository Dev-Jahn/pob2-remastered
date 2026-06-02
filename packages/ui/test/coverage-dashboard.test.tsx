// Coverage dashboard test (DESIGN §18 "coverage dashboard", §8.7 translation
// coverage thresholds; §8.1 ko/en alias; §6.4 NO-FALLBACK).
//
// The dashboard is the Settings/About → localization screen view of the
// loc-coverage metric: one row per §8.7 MVP-threshold domain, each carrying the
// localized (ko/en) domain label, the translated/total count, the measured
// percent, its MVP + Stable target, and a pass/under-target status grade.
//
// What these pins guard (the task's three named unit pins):
//   1. an UNDER-TARGET domain renders a distinct 'under target' marker — NOT the
//      met/green status (so a failing domain is visibly flagged, not blended in);
//   2. a MET domain renders 'met';
//   3. the MISSING-coverage domain (0 committed ids → 0/0) shows 0% — never a
//      fabricated 100% from an empty store (DESIGN §8.7 "real numbers only").
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import {
  buildCoverageDashboardModel,
  COVERAGE_MVP_THRESHOLDS,
  COVERAGE_STABLE_THRESHOLDS,
  CoverageDashboard,
  t,
} from '../src/index.js';
import type { Coverage } from '../src/index.js';

afterEach(cleanup);

// A fixture coverage map exercising all three pinned cases:
//   - keyword:   96/100 = 96% ≥ 95 MVP  -> MET
//   - base:      80/100 = 80% <  90 MVP  -> UNDER TARGET
//   - passive:   0/0     = 0%            -> MISSING (NO-FALLBACK 0%, not 100)
// The remaining domains are filled in at their MVP bar so the model is complete
// (every §8.7 domain present) without affecting the three pins under test.
function atBar(domain: keyof typeof COVERAGE_MVP_THRESHOLDS): Coverage[keyof Coverage] {
  const percent = COVERAGE_MVP_THRESHOLDS[domain];
  return { total: 100, translated: percent, percent };
}

const COVERAGE: Coverage = {
  ui: { total: 100, translated: 100, percent: 100 },
  keyword: { total: 100, translated: 96, percent: 96 },
  skill: atBar('skill'),
  support_gem: atBar('support_gem'),
  base: { total: 100, translated: 80, percent: 80 },
  unique: atBar('unique'),
  passive: { total: 0, translated: 0, percent: 0 },
  mod: atBar('mod'),
  stat: atBar('stat'),
};

describe('buildCoverageDashboardModel (DESIGN §18, §8.7)', () => {
  const model = buildCoverageDashboardModel(COVERAGE);

  it('emits one row per §8.7 domain, in threshold-table order', () => {
    expect(model.rows.map((r) => r.domain)).toEqual([
      'ui',
      'keyword',
      'skill',
      'support_gem',
      'base',
      'unique',
      'passive',
      'mod',
      'stat',
    ]);
  });

  it('carries the translated/total count, percent, and MVP/Stable targets per row', () => {
    const keyword = model.rows.find((r) => r.domain === 'keyword');
    expect(keyword).toBeDefined();
    expect(keyword!.translated).toBe(96);
    expect(keyword!.total).toBe(100);
    expect(keyword!.percent).toBe(96);
    expect(keyword!.mvpTarget).toBe(COVERAGE_MVP_THRESHOLDS.keyword);
    expect(keyword!.stableTarget).toBe(COVERAGE_STABLE_THRESHOLDS.keyword);
  });

  it('grades a domain at/above its MVP bar as met', () => {
    const keyword = model.rows.find((r) => r.domain === 'keyword');
    expect(keyword!.status).toBe('met');
  });

  it('grades a domain below its MVP bar as under target (PIN: not met)', () => {
    const base = model.rows.find((r) => r.domain === 'base');
    expect(base!.status).toBe('under-target');
    expect(base!.status).not.toBe('met');
  });

  it('reports the missing-coverage (0/0) domain at 0% — never a fabricated value (PIN)', () => {
    const passive = model.rows.find((r) => r.domain === 'passive');
    expect(passive!.total).toBe(0);
    expect(passive!.translated).toBe(0);
    expect(passive!.percent).toBe(0); // NO-FALLBACK: 0%, not an assumed 100%
    expect(passive!.status).toBe('under-target');
  });

  it('localizes each domain label through the ko/en dashboard i18n keys', () => {
    const keyword = model.rows.find((r) => r.domain === 'keyword');
    // The view-model carries an i18n key; the renderer resolves it via `t`.
    expect(t('ko-KR', keyword!.labelKey)).toBe(t('ko-KR', 'coverage.domain.keyword'));
    expect(t('ko-KR', keyword!.labelKey)).not.toBe(t('en-US', keyword!.labelKey));
  });
});

describe('CoverageDashboard component (DESIGN §18, §8.7, §11.3)', () => {
  it('renders the localized dashboard title (ko-KR)', () => {
    render(<CoverageDashboard locale="ko-KR" coverage={COVERAGE} />);
    expect(screen.getByText(t('ko-KR', 'coverage.title'))).toBeTruthy();
  });

  it('renders an under-target domain with a distinct under-target status marker, not green/met (PIN)', () => {
    const { container } = render(<CoverageDashboard locale="ko-KR" coverage={COVERAGE} />);
    const baseRow = container.querySelector('[data-domain="base"]');
    expect(baseRow).not.toBeNull();
    // The status is exposed as a data attribute (never color-only, §11.3) so it is
    // assertable and a screen reader gets a text status — not just a green cell.
    expect(baseRow!.getAttribute('data-status')).toBe('under-target');
    expect(baseRow!.getAttribute('data-status')).not.toBe('met');
    // A text status label is present (§11.3: status is never color-only).
    expect(
      within(baseRow as HTMLElement).getByText(t('ko-KR', 'coverage.status.underTarget')),
    ).toBeTruthy();
  });

  it('renders a met domain with the met status marker (PIN)', () => {
    const { container } = render(<CoverageDashboard locale="ko-KR" coverage={COVERAGE} />);
    const keywordRow = container.querySelector('[data-domain="keyword"]');
    expect(keywordRow).not.toBeNull();
    expect(keywordRow!.getAttribute('data-status')).toBe('met');
    expect(
      within(keywordRow as HTMLElement).getByText(t('ko-KR', 'coverage.status.met')),
    ).toBeTruthy();
  });

  it('renders the missing-coverage domain as 0%, not a fabricated value (PIN)', () => {
    const { container } = render(<CoverageDashboard locale="ko-KR" coverage={COVERAGE} />);
    const passiveRow = container.querySelector('[data-domain="passive"]');
    expect(passiveRow).not.toBeNull();
    // Its percent cell reads "0%" — and it is graded under-target, not silently met.
    expect(within(passiveRow as HTMLElement).getByText('0%')).toBeTruthy();
    expect(passiveRow!.getAttribute('data-status')).toBe('under-target');
  });

  it('shows the translated/total count for each row', () => {
    const { container } = render(<CoverageDashboard locale="ko-KR" coverage={COVERAGE} />);
    const keywordRow = container.querySelector('[data-domain="keyword"]');
    expect(within(keywordRow as HTMLElement).getByText('96 / 100')).toBeTruthy();
  });
});
