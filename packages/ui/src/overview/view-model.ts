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
 */
export type OverviewField =
  | { statId: string; label: string; present: true; value: number }
  | { statId: string; label: string; present: false; missing: true; value?: undefined };

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
 * The stat ids each card requests, in display order, with the fallback label to
 * show when the stat is missing (a present stat carries its own `calc.run`
 * label). Stat ids are the upstream PoB `mainOutput` keys the core emits
 * (overlays/lua/modern_api.lua CORE_STATS) plus the standard upstream crit /
 * speed / reservation keys for the §10.3 fields the curated set does not yet
 * surface — so those resolve to `missing` rather than a fabricated value.
 */
const OFFENCE_SPEC: ReadonlyArray<readonly [statId: string, label: string]> = [
  ['TotalDPS', 'Total DPS'],
  ['AverageDamage', 'Average Damage'],
  ['CritChance', 'Critical Hit Chance'],
  ['CritMultiplier', 'Critical Damage Bonus'],
  ['Speed', 'Attack/Cast Rate'],
];

const DEFENCE_SPEC: ReadonlyArray<readonly [statId: string, label: string]> = [
  ['Life', 'Life'],
  ['Mana', 'Mana'],
  ['EnergyShield', 'Energy Shield'],
  ['Armour', 'Armour'],
  ['Evasion', 'Evasion'],
  ['FireResist', 'Fire Resistance'],
  ['ColdResist', 'Cold Resistance'],
  ['LightningResist', 'Lightning Resistance'],
  ['ChaosResist', 'Chaos Resistance'],
  ['TotalEHP', 'Effective Hit Pool'],
];

const RESOURCE_SPEC: ReadonlyArray<readonly [statId: string, label: string]> = [
  ['Spirit', 'Spirit'],
  ['SpiritReserved', 'Spirit Reserved'],
  ['ManaReserved', 'Mana Reserved'],
  ['ManaUnreserved', 'Mana Unreserved'],
];

/** Resolve one card field from the stat lookup, marking absent stats as missing. */
function toField(
  byId: ReadonlyMap<string, StatResult>,
  statId: string,
  fallbackLabel: string,
): OverviewField {
  const stat = byId.get(statId);
  if (stat === undefined) {
    return { statId, label: fallbackLabel, present: false, missing: true };
  }
  return { statId, label: stat.label, present: true, value: stat.value };
}

function buildCard(
  byId: ReadonlyMap<string, StatResult>,
  titleKey: OverviewCard['titleKey'],
  spec: ReadonlyArray<readonly [string, string]>,
): OverviewCard {
  return { titleKey, fields: spec.map(([statId, label]) => toField(byId, statId, label)) };
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
