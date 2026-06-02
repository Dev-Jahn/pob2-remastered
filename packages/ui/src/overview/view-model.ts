/**
 * Overview view-model — DESIGN §10.3 Overview tab.
 *
 * A pure, framework-free transform that turns a `calc.run` result (a
 * `CalcRunResponse` / `StatResult[]` from @pob2/schema) plus a `BuildSummary`
 * into the Overview card model: an offence card, a defence card, and a resource
 * card (§10.3 구성). No React, no I/O — just data in, data out — so the cards can
 * be unit-tested and reused by any renderer.
 *
 * NO-FALLBACK (DESIGN §6.4, §10.3, golden-test "real stats only"): a stat the
 * core did not emit is surfaced as an explicit `missing` field, never coerced to
 * `0`. `0` is itself a real value (e.g. EnergyShield 0, Armour 0) and stays
 * present. The view-model only re-shapes the stats `calc.run` gave it — it does
 * not compute, default, or invent any value.
 */
import type { CalcRunResponse, StatResult } from '@pob2/schema';
import type { StringKey } from '../i18n/index.js';

/**
 * Plain build summary the headless runner serializes on load. Structurally
 * mirrors `@pob2/core-client`'s `BuildSummary`; declared here so this pure
 * transform does not depend on the runtime core-client package (DESIGN §5.1:
 * the UI layer holds view-models, the host layer owns the runner).
 */
export interface BuildSummary {
  className?: string;
  ascendancyName?: string;
  level?: number;
  itemCount?: number;
}

/**
 * One stat slot in a card. Either the stat was present in the `calc.run` result
 * (`present: true`, with its real numeric `value`) or it was absent (`present:
 * false`, `missing: true`, `value` undefined). Discriminated on `present` so a
 * missing stat can never be read as `0`.
 *
 * The row label is carried as an i18n `labelKey` (not a baked-in string) so the
 * renderer resolves it through `t(locale, labelKey)` — both the missing-stat
 * fallback label and the visible present-stat label localize under ko-KR (§8.1,
 * §10.3; closes the carried-over Phase 2 English-label gap).
 */
export type OverviewField =
  | { statId: string; labelKey: StringKey; present: true; value: number }
  | { statId: string; labelKey: StringKey; present: false; missing: true; value?: undefined };

/** A single Overview card: a title key plus its ordered fields (§10.3). */
export interface OverviewCard {
  /** i18n key for the card title (see @pob2/ui i18n `overview.card.*`). */
  titleKey: 'overview.card.offence' | 'overview.card.defence' | 'overview.card.resources';
  fields: OverviewField[];
}

/** The full Overview model: the three §10.3 cards plus the build summary header. */
export interface OverviewModel {
  summary: BuildSummary;
  offence: OverviewCard;
  defence: OverviewCard;
  resource: OverviewCard;
}

/**
 * The stat ids each card requests, in display order, paired with the i18n
 * `labelKey` the renderer resolves through `t(locale, labelKey)`. The key drives
 * both a present row's label and a missing row's fallback label, so the labels
 * localize under ko-KR (§8.1, §10.3) instead of the English `calc.run` text.
 * Stat ids are the upstream PoB `mainOutput` keys the core emits
 * (overlays/lua/modern_api.lua CORE_STATS) plus the standard upstream crit /
 * speed / reservation keys for the §10.3 fields the curated set does not yet
 * surface — so those resolve to `missing` rather than a fabricated value.
 */
const OFFENCE_SPEC: ReadonlyArray<readonly [statId: string, labelKey: StringKey]> = [
  ['TotalDPS', 'overview.stat.totalDps'],
  ['AverageDamage', 'overview.stat.averageDamage'],
  ['CritChance', 'overview.stat.critChance'],
  ['CritMultiplier', 'overview.stat.critMultiplier'],
  ['Speed', 'overview.stat.speed'],
];

const DEFENCE_SPEC: ReadonlyArray<readonly [statId: string, labelKey: StringKey]> = [
  ['Life', 'overview.stat.life'],
  ['Mana', 'overview.stat.mana'],
  ['EnergyShield', 'overview.stat.energyShield'],
  ['Armour', 'overview.stat.armour'],
  ['Evasion', 'overview.stat.evasion'],
  ['FireResist', 'overview.stat.fireResist'],
  ['ColdResist', 'overview.stat.coldResist'],
  ['LightningResist', 'overview.stat.lightningResist'],
  ['ChaosResist', 'overview.stat.chaosResist'],
  ['TotalEHP', 'overview.stat.totalEhp'],
];

const RESOURCE_SPEC: ReadonlyArray<readonly [statId: string, labelKey: StringKey]> = [
  ['Spirit', 'overview.stat.spirit'],
  ['SpiritReserved', 'overview.stat.spiritReserved'],
  ['ManaReserved', 'overview.stat.manaReserved'],
  ['ManaUnreserved', 'overview.stat.manaUnreserved'],
];

/** Resolve one card field from the stat lookup, marking absent stats as missing. */
function toField(
  byId: ReadonlyMap<string, StatResult>,
  statId: string,
  labelKey: StringKey,
): OverviewField {
  const stat = byId.get(statId);
  if (stat === undefined) {
    return { statId, labelKey, present: false, missing: true };
  }
  return { statId, labelKey, present: true, value: stat.value };
}

function buildCard(
  byId: ReadonlyMap<string, StatResult>,
  titleKey: OverviewCard['titleKey'],
  spec: ReadonlyArray<readonly [string, StringKey]>,
): OverviewCard {
  return { titleKey, fields: spec.map(([statId, labelKey]) => toField(byId, statId, labelKey)) };
}

/**
 * Build the Overview card model (DESIGN §10.3) from a `calc.run` result and a
 * build summary. Pure: every field traces to a stat the core emitted, or to an
 * explicit `missing` marker (never a fabricated `0`).
 */
export function buildOverviewModel(calc: CalcRunResponse, summary: BuildSummary): OverviewModel {
  const byId = new Map<string, StatResult>(calc.stats.map((s) => [s.statId, s]));
  return {
    summary,
    offence: buildCard(byId, 'overview.card.offence', OFFENCE_SPEC),
    defence: buildCard(byId, 'overview.card.defence', DEFENCE_SPEC),
    resource: buildCard(byId, 'overview.card.resources', RESOURCE_SPEC),
  };
}
