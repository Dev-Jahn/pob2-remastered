/**
 * CoverageDashboard — the Settings/About → localization screen view of the
 * loc-coverage metric (DESIGN §18 "coverage dashboard", §8.7 thresholds).
 *
 * A thin renderer over {@link buildCoverageDashboardModel}: a titled table whose
 * rows are one §8.7 domain each, showing the localized domain label, the
 * translated/total count, the measured percent, the MVP/Stable targets, and a
 * pass/under-target status.
 *
 * §11.3 (status never color-only) + §8.7 (real numbers only): each row exposes its
 * status as a `data-status` attribute AND a localized text status label, so an
 * under-target domain is visibly flagged (not merely a non-green cell) and a screen
 * reader gets the status as text. The percent cell shows the real measured number —
 * a 0/0 domain reads "0%", never a fabricated value (NO-FALLBACK).
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { buildCoverageDashboardModel } from './coverage-dashboard.js';
import type { Coverage, CoverageDashboardRow, CoverageStatus } from './coverage-dashboard.js';

/** i18n key for each status's localized text label (§11.3: status carries text). */
const STATUS_LABEL_KEY: Record<
  CoverageStatus,
  'coverage.status.met' | 'coverage.status.underTarget'
> = {
  met: 'coverage.status.met',
  'under-target': 'coverage.status.underTarget',
};

export interface CoverageDashboardProps {
  /** Active locale, drives the title, domain labels, headers, and status text. */
  locale: Locale;
  /** The loc-coverage metric output to render (per-domain coverage map). */
  coverage: Coverage;
}

function CoverageRow({ row, locale }: { row: CoverageDashboardRow; locale: Locale }) {
  return (
    <tr className="pob-coverage__row" data-domain={row.domain} data-status={row.status}>
      <td className="pob-coverage__label">{t(locale, row.labelKey)}</td>
      <td className="pob-coverage__count">
        {row.translated} / {row.total}
      </td>
      <td className="pob-coverage__percent">{row.percent}%</td>
      <td className="pob-coverage__mvp">{row.mvpTarget}%</td>
      <td className="pob-coverage__stable">{row.stableTarget}%</td>
      <td className="pob-coverage__status">{t(locale, STATUS_LABEL_KEY[row.status])}</td>
    </tr>
  );
}

export function CoverageDashboard({ locale, coverage }: CoverageDashboardProps) {
  const model = buildCoverageDashboardModel(coverage);
  return (
    <section className="pob-coverage" aria-label={t(locale, model.titleKey)}>
      <h3 className="pob-coverage__title">{t(locale, model.titleKey)}</h3>
      <table className="pob-coverage__table">
        <thead>
          <tr>
            <th>{t(locale, 'coverage.header.domain')}</th>
            <th>{t(locale, 'coverage.header.count')}</th>
            <th>{t(locale, 'coverage.header.percent')}</th>
            <th>{t(locale, 'coverage.header.mvp')}</th>
            <th>{t(locale, 'coverage.header.stable')}</th>
            <th>{t(locale, 'coverage.header.status')}</th>
          </tr>
        </thead>
        <tbody>
          {model.rows.map((row) => (
            <CoverageRow key={row.domain} row={row} locale={locale} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
