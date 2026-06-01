/**
 * Equip delta view-model — DESIGN §10.4 ("+DPS / -EHP" item-card delta chips),
 * §16.3 ("item equip delta"). A pure, framework-free transform that turns the
 * before/after stat deltas an `items.compare` pass returns (`EquipDelta[]` from
 * @pob2/schema) into display chips: stat id, the raw before/after/delta numbers,
 * and a sign `direction` a renderer can colour (gain / loss / neutral).
 *
 * NO-FALLBACK (DESIGN §6.4): a stat the core never returned is surfaced as an
 * explicit `missing` chip (`direction: 'missing'`, no numbers) — never a
 * fabricated `0` delta. A real `0` delta is kept as a `neutral` chip with
 * `delta === 0`, because `0` is itself a value (e.g. Armour unchanged), not an
 * absence. The transform only re-shapes the deltas the core gave it.
 */
import type { EquipDelta } from '@pob2/schema';

/** Which way a stat moved when swapping the item in (DESIGN §10.4 +DPS / -EHP). */
export type DeltaDirection = 'gain' | 'loss' | 'neutral' | 'missing';

/**
 * One delta chip. Either the core returned this stat's before/after (`missing`
 * absent, all three numbers present) or it did not (`missing: true`,
 * `direction: 'missing'`, numbers undefined). Discriminated on `missing` so an
 * absent stat can never be read as a `0` delta.
 */
export interface DeltaChip {
  /** Machine-readable upstream stat id (DESIGN §6.4). */
  statId: string;
  direction: DeltaDirection;
  before?: number;
  after?: number;
  delta?: number;
  missing?: true;
}

/** The equip-delta model: the §10.4 chips, returned-then-missing in order. */
export interface EquipDeltaModel {
  chips: DeltaChip[];
}

/** Classify a real (present) delta's sign. A `0` delta is `neutral`, not absent. */
function directionOf(delta: number): DeltaDirection {
  if (delta > 0) return 'gain';
  if (delta < 0) return 'loss';
  return 'neutral';
}

/**
 * Build the §10.4 equip-delta chips from the deltas `items.compare` returned.
 *
 * `requestedStatIds`, when given, names the stats a card wants to show. Any of
 * those the core did NOT return is appended as an explicit `missing` chip (after
 * the returned ones), so the UI shows a missing marker rather than a fabricated
 * `0` (DESIGN §6.4). A requested stat that WAS returned stays its real chip.
 */
export function buildEquipDeltaModel(
  deltas: EquipDelta[],
  requestedStatIds: string[] | undefined,
): EquipDeltaModel {
  const returned = new Set(deltas.map((d) => d.statId));

  const chips: DeltaChip[] = deltas.map((d) => ({
    statId: d.statId,
    direction: directionOf(d.delta),
    before: d.before,
    after: d.after,
    delta: d.delta,
  }));

  for (const statId of requestedStatIds ?? []) {
    if (returned.has(statId)) continue;
    chips.push({ statId, direction: 'missing', missing: true });
  }

  return { chips };
}
