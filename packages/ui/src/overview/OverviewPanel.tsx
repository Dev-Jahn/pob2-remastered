/**
 * OverviewPanel — the Overview tab's three §10.3 stat cards (DESIGN §10.3).
 *
 * `OffenceCard` / `DefenceCard` / `ResourceCard` are thin wrappers that bind the
 * matching card of an {@link OverviewModel} to a {@link StatCard}. They exist so a
 * host can mount one card in isolation (e.g. a compact inspector) while
 * `OverviewPanel` lays out all three together for the full Overview tab.
 *
 * All card titles and the missing-value markers are resolved through the i18n
 * resolver inside `StatCard`, so the panel itself carries no hard-coded text.
 */
import type { Locale } from '../i18n/index.js';
import { StatCard } from './StatCard.js';
import type { OverviewCard, OverviewModel } from './view-model.js';

export interface OverviewCardProps {
  /** Active locale, drives label resolution. */
  locale: Locale;
  /** The view-model card this wrapper renders. */
  card: OverviewCard;
}

export function OffenceCard({ locale, card }: OverviewCardProps) {
  return <StatCard locale={locale} card={card} />;
}

export function DefenceCard({ locale, card }: OverviewCardProps) {
  return <StatCard locale={locale} card={card} />;
}

export function ResourceCard({ locale, card }: OverviewCardProps) {
  return <StatCard locale={locale} card={card} />;
}

export interface OverviewPanelProps {
  /** Active locale, drives label resolution across all three cards. */
  locale: Locale;
  /** The full Overview view-model (summary + offence/defence/resource cards). */
  model: OverviewModel;
}

export function OverviewPanel({ locale, model }: OverviewPanelProps) {
  return (
    <div className="pob-overview">
      <OffenceCard locale={locale} card={model.offence} />
      <DefenceCard locale={locale} card={model.defence} />
      <ResourceCard locale={locale} card={model.resource} />
    </div>
  );
}
