/**
 * Equipped-gear grid view-model — DESIGN §10.4 Items tab (equipped gear grid +
 * Item card). A pure, framework-free transform that turns the `EquippedItem[]`
 * an `items.getEquipped` pass returns into the slot-ordered §10.4 grid: one
 * card per canonical slot (occupied or empty), each occupied card carrying the
 * §10.4 Item-card fields — rarity color key, base type, requirement chips, mod
 * summary (recognised + unsupported, kept separate per §8.6), and the optional
 * "+DPS / -EHP" equip-delta chips.
 *
 * NO-FALLBACK (DESIGN §6.4): a requirement of `0` is a real value and yields NO
 * chip (we never show "Requires str 0"), but it is never confused with absence —
 * the item simply has no requirement on that attribute. An unrecognised rarity
 * maps to a stable lowercase color key derived from the rarity string, never to
 * a guessed tier. Delta chips appear only when a delta model is supplied for the
 * item; they are never fabricated.
 */
import type { EquippedItem } from '@pob2/schema';
import type { EquipDeltaModel, DeltaChip } from './delta-model.js';
import type { StringKey } from '../i18n/index.js';

/**
 * Canonical equipped-slot order (DESIGN §10.4 layout: Weapon 1/2 → armour →
 * jewellery → utility). The grid renders one card per entry, in this order,
 * whether or not the slot is occupied.
 */
export const EQUIP_SLOT_ORDER = [
  'Weapon 1',
  'Weapon 2',
  'Helmet',
  'Body Armour',
  'Gloves',
  'Boots',
  'Ring 1',
  'Ring 2',
  'Amulet',
  'Belt',
  'Charm',
  'Flask',
] as const;

/** A canonical equipped-slot name. */
export type EquipSlot = (typeof EQUIP_SLOT_ORDER)[number];

/** Map each canonical slot to its i18n string key (the `items.slot.*` family). */
const SLOT_I18N_KEY: Record<EquipSlot, StringKey> = {
  'Weapon 1': 'items.slot.weapon1',
  'Weapon 2': 'items.slot.weapon2',
  Helmet: 'items.slot.helmet',
  'Body Armour': 'items.slot.body',
  Gloves: 'items.slot.gloves',
  Boots: 'items.slot.boots',
  'Ring 1': 'items.slot.ring1',
  'Ring 2': 'items.slot.ring2',
  Amulet: 'items.slot.amulet',
  Belt: 'items.slot.belt',
  Charm: 'items.slot.charm',
  Flask: 'items.slot.flask',
};

/** One requirement chip on an item card (DESIGN §10.4 "requirement chip"). */
export interface RequirementChip {
  kind: 'level' | 'str' | 'dex' | 'int';
  value: number;
}

/** The §10.4 Item-card model for an occupied slot. */
export interface ItemCardModel {
  /** Canonical slot name (matches `EQUIP_SLOT_ORDER`). */
  slot: EquipSlot;
  /** i18n key for the slot label, resolved via `t` (never hardcoded text). */
  slotKey: StringKey;
  occupied: boolean;
  /** The card body, present only when the slot is occupied. */
  item?: EquippedItemCard;
}

/** The body of an occupied §10.4 Item card. */
export interface EquippedItemCard {
  itemId: string;
  name: string;
  baseType: string;
  /** Stable lowercase rarity color key, e.g. `normal` / `rare` / `unique`. */
  rarityColorKey: string;
  /** Requirement chips, only for the attributes the item actually requires. */
  requirementChips: RequirementChip[];
  /** Recognised mod lines (DESIGN §10.4 mod summary). */
  modSummary: string[];
  /** Lines the parser could not recognise, kept separate (DESIGN §8.6, §10.4). */
  unsupportedMods: string[];
  /** "+DPS / -EHP" equip-delta chips; empty unless a delta model was supplied. */
  deltaChips: DeltaChip[];
}

/** The equipped-gear grid model: the §10.4 cards, in canonical slot order. */
export interface EquippedGridModel {
  cards: ItemCardModel[];
}

/**
 * Equip-delta models keyed by item id. When an entry exists for the item in a
 * slot, its chips populate that card's `deltaChips` (DESIGN §10.4 +DPS / -EHP).
 */
export type EquipDeltaByItemId = Readonly<Record<string, EquipDeltaModel>>;

/** Stable lowercase color key for a rarity string (DESIGN §10.4 "rarity color"). */
function rarityColorKey(rarity: string): string {
  return rarity.trim().toLowerCase();
}

/** Build the requirement chips for an item, dropping every `0`-valued attribute. */
function requirementChips(req: EquippedItem['requirements']): RequirementChip[] {
  const chips: RequirementChip[] = [];
  if (req.level > 0) chips.push({ kind: 'level', value: req.level });
  if (req.str > 0) chips.push({ kind: 'str', value: req.str });
  if (req.dex > 0) chips.push({ kind: 'dex', value: req.dex });
  if (req.int > 0) chips.push({ kind: 'int', value: req.int });
  return chips;
}

function toCardBody(item: EquippedItem, deltas: EquipDeltaByItemId): EquippedItemCard {
  return {
    itemId: item.itemId,
    name: item.name,
    baseType: item.baseName,
    rarityColorKey: rarityColorKey(item.rarity),
    requirementChips: requirementChips(item.requirements),
    modSummary: [...item.summaryMods],
    unsupportedMods: [...item.unsupportedMods],
    deltaChips: deltas[item.itemId]?.chips ?? [],
  };
}

/**
 * Build the §10.4 equipped-gear grid from the items the core has equipped.
 *
 * Every canonical slot yields a card, in `EQUIP_SLOT_ORDER`. An occupied slot
 * carries its Item-card body; an empty slot carries `occupied: false` and no
 * `item`. `deltaByItemId`, when supplied, attaches per-item equip-delta chips.
 */
export function buildEquippedGridModel(
  equipped: EquippedItem[],
  deltaByItemId: EquipDeltaByItemId = {},
): EquippedGridModel {
  const bySlot = new Map(equipped.map((item) => [item.slot, item]));

  const cards: ItemCardModel[] = EQUIP_SLOT_ORDER.map((slot) => {
    const item = bySlot.get(slot);
    return {
      slot,
      slotKey: SLOT_I18N_KEY[slot],
      occupied: item !== undefined,
      item: item ? toCardBody(item, deltaByItemId) : undefined,
    };
  });

  return { cards };
}
