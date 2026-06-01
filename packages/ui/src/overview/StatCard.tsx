/**
 * StatCard — a titled card of labeled stat rows (DESIGN §10.3 Overview cards).
 *
 * §10.1 "수정값과 계산 결과 구분" + §6.4 (localized label vs machine stat id): each
 * row binds an {@link OverviewField} from the view-model. The row layers three
 * things distinctly —
 *   - the human label (the `calc.run` localized label for a present stat, or the
 *     view-model's fallback label for a missing one),
 *   - the value column, and
 *   - the machine `statId`, surfaced as a `data-stat-id` attribute so a row can be
 *     located and styled by its upstream id.
 *
 * NO-FALLBACK (DESIGN §6.4, §10.1): a *missing* field is rendered with a distinct
 * marker (an em dash, plus `data-missing="true"` and an accessible label) — never
 * coerced to `0`. A real `0` (e.g. EnergyShield 0) is a present value and renders
 * as "0".
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { OverviewCard, OverviewField } from './view-model.js';

/** Distinct visual marker for a stat the core did not emit (§10.1 NO-FALLBACK). */
const MISSING_MARKER = '—';

export interface StatCardProps {
  /** Active locale, drives the card title (and the missing-value aria text). */
  locale: Locale;
  /** The view-model card to render (title key + ordered fields). */
  card: OverviewCard;
}

function StatRow({ field, locale }: { field: OverviewField; locale: Locale }) {
  return (
    <li
      className="pob-stat-card__row"
      role="listitem"
      data-stat-id={field.statId}
      data-missing={field.present ? undefined : 'true'}
    >
      <span className="pob-stat-card__label">{field.label}</span>
      {field.present ? (
        <span className="pob-stat-card__value">{field.value}</span>
      ) : (
        <span
          className="pob-stat-card__value pob-stat-card__value--missing"
          aria-label={t(locale, 'overview.missing')}
        >
          {MISSING_MARKER}
        </span>
      )}
    </li>
  );
}

export function StatCard({ locale, card }: StatCardProps) {
  return (
    <section className="pob-stat-card" aria-label={t(locale, card.titleKey)}>
      <h3 className="pob-stat-card__title">{t(locale, card.titleKey)}</h3>
      <ul className="pob-stat-card__rows" role="list">
        {card.fields.map((field) => (
          <StatRow key={field.statId} field={field} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
