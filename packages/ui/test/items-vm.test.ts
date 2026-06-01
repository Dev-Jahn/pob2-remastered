// Items tab view-model test (DESIGN §10.4 Items tab redesign, §6.4 NO-FALLBACK).
//
// Three pure, framework-free transforms power the Items tab:
//
//   (1) buildEquippedGridModel(equipped)  — slot-ordered §10.4 ItemCard models
//       (rarity color key, baseType, requirement chips, mod summary, optional
//       +DPS / -EHP delta chips).
//   (2) filterItems(items, query)         — item-library search/filter (slot /
//       type / requirements, ko↔en parallel tokens) + sort.
//   (3) buildEquipDeltaModel(before, after) — calc before/after stat delta → the
//       §10.4 "+DPS / -EHP" display chips.
//
// All three are pure (data in, data out): no React, no I/O. They obey the §6.4
// NO-FALLBACK rule — a value the core did not supply is an explicit `missing`
// marker, a real `0` is preserved as a value (never coerced to missing, never
// fabricated).
import { describe, it, expect } from 'vitest';
import type { EquippedItem, EquipDelta } from '@pob2/schema';
import {
  buildEquippedGridModel,
  EQUIP_SLOT_ORDER,
  filterItems,
  buildEquipDeltaModel,
} from '../src/index.js';
import type {
  EquippedGridModel,
  ItemCardModel,
  LibraryItem,
  EquipDeltaModel,
  DeltaChip,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A Rare pair of boots, mirroring the §10.4 Item card example (Sorrow Sole /
// Hunting Shoes). Both a recognised mod summary and an unsupported line, so the
// card must carry the supported lines and the unsupported badge separately.
const BOOTS: EquippedItem = {
  slot: 'Boots',
  itemId: 'item-boots-1',
  name: 'Sorrow Sole',
  rarity: 'Rare',
  baseName: 'Hunting Shoes',
  requirements: { level: 33, str: 0, dex: 62, int: 0 },
  summaryMods: ['+18% to Fire Resistance', '25% increased Movement Speed'],
  unsupportedMods: ['Mirror something the parser cannot read'],
};

// A Normal (white) helmet with no mods and zero requirements — exercises the
// real-0 path: a 0 requirement is a value, it must NOT be dropped as missing.
const HELMET: EquippedItem = {
  slot: 'Helmet',
  itemId: 'item-helmet-1',
  name: 'Iron Hat',
  rarity: 'Normal',
  baseName: 'Iron Hat',
  requirements: { level: 0, str: 0, dex: 0, int: 0 },
  summaryMods: [],
  unsupportedMods: [],
};

// A Unique weapon to pin the rarity color-key mapping across all tiers.
const WEAPON: EquippedItem = {
  slot: 'Weapon 1',
  itemId: 'item-weapon-1',
  name: 'Starforge',
  rarity: 'Unique',
  baseName: 'Infernal Sword',
  requirements: { level: 67, str: 113, dex: 0, int: 0 },
  summaryMods: ['+200 to maximum Life'],
  unsupportedMods: [],
};

// ---------------------------------------------------------------------------
// (1) buildEquippedGridModel — §10.4 Item card
// ---------------------------------------------------------------------------

describe('buildEquippedGridModel (§10.4 equipped gear grid)', () => {
  it('emits one card per slot in EQUIP_SLOT_ORDER, occupied or empty', () => {
    const model: EquippedGridModel = buildEquippedGridModel([BOOTS, WEAPON]);
    // Every canonical slot appears, exactly once, in canonical order.
    expect(model.cards.map((c) => c.slot)).toEqual([...EQUIP_SLOT_ORDER]);
  });

  it('places each item in its own slot and leaves the rest empty', () => {
    const model = buildEquippedGridModel([BOOTS, WEAPON]);
    const bySlot = new Map(model.cards.map((c) => [c.slot, c]));

    const boots = bySlot.get('Boots')!;
    expect(boots.occupied).toBe(true);

    const weapon = bySlot.get('Weapon 1')!;
    expect(weapon.occupied).toBe(true);

    const body = bySlot.get('Body Armour')!;
    expect(body.occupied).toBe(false);
    expect(body.item).toBeUndefined();
  });

  it('maps an occupied card: name, baseType, rarity color key, slot i18n key', () => {
    const card = cardFor(buildEquippedGridModel([BOOTS]), 'Boots');
    expect(card.occupied).toBe(true);
    const item = card.item!;
    expect(item.name).toBe('Sorrow Sole');
    expect(item.baseType).toBe('Hunting Shoes');
    expect(item.rarityColorKey).toBe('rare');
    expect(card.slotKey).toBe('items.slot.boots');
  });

  it('maps rarity → a stable lowercase color key across all tiers', () => {
    expect(cardFor(buildEquippedGridModel([HELMET]), 'Helmet').item!.rarityColorKey).toBe('normal');
    expect(cardFor(buildEquippedGridModel([BOOTS]), 'Boots').item!.rarityColorKey).toBe('rare');
    expect(cardFor(buildEquippedGridModel([WEAPON]), 'Weapon 1').item!.rarityColorKey).toBe(
      'unique',
    );
  });

  it('builds requirement chips only for the requirements the item actually has', () => {
    // Boots: level 33, dex 62 — str/int are 0 and must NOT appear as chips.
    const boots = cardFor(buildEquippedGridModel([BOOTS]), 'Boots').item!;
    const kinds = boots.requirementChips.map((c) => c.kind);
    expect(kinds).toEqual(['level', 'dex']);
    const level = boots.requirementChips.find((c) => c.kind === 'level')!;
    expect(level.value).toBe(33);
    const dex = boots.requirementChips.find((c) => c.kind === 'dex')!;
    expect(dex.value).toBe(62);
  });

  it('emits NO requirement chips when every requirement is 0 (a real 0, not invented)', () => {
    const helmet = cardFor(buildEquippedGridModel([HELMET]), 'Helmet').item!;
    expect(helmet.requirementChips).toEqual([]);
  });

  it('carries the recognised mod summary and the unsupported lines separately', () => {
    const boots = cardFor(buildEquippedGridModel([BOOTS]), 'Boots').item!;
    expect(boots.modSummary).toEqual(['+18% to Fire Resistance', '25% increased Movement Speed']);
    expect(boots.unsupportedMods).toEqual(['Mirror something the parser cannot read']);
  });

  it('attaches equip delta chips to a card when a delta model is supplied for it', () => {
    const delta = buildEquipDeltaModel(
      [{ statId: 'TotalDPS', before: 100, after: 112.4, delta: 12.4 }],
      undefined,
    );
    const model = buildEquippedGridModel([BOOTS], { 'item-boots-1': delta });
    const boots = cardFor(model, 'Boots').item!;
    expect(boots.deltaChips.length).toBe(1);
    expect(boots.deltaChips[0]!.statId).toBe('TotalDPS');
  });

  it('leaves deltaChips empty when no delta model is supplied (no fabricated delta)', () => {
    const boots = cardFor(buildEquippedGridModel([BOOTS]), 'Boots').item!;
    expect(boots.deltaChips).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (2) filterItems — item-library search / filter / sort
// ---------------------------------------------------------------------------

const LIB: LibraryItem[] = [
  {
    itemId: 'lib-boots',
    name: 'Sorrow Sole',
    nameKo: '슬픔의 밑창',
    baseType: 'Hunting Shoes',
    baseTypeKo: '사냥 신발',
    slot: 'Boots',
    type: 'Boots',
    rarity: 'Rare',
    requirements: { level: 33, str: 0, dex: 62, int: 0 },
  },
  {
    itemId: 'lib-sword',
    name: 'Starforge',
    nameKo: '별조각',
    baseType: 'Infernal Sword',
    baseTypeKo: '지옥불 검',
    slot: 'Weapon 1',
    type: 'Two Hand Sword',
    rarity: 'Unique',
    requirements: { level: 67, str: 113, dex: 0, int: 0 },
  },
  {
    itemId: 'lib-helm',
    name: 'Iron Hat',
    nameKo: '철 모자',
    baseType: 'Iron Hat',
    baseTypeKo: '철 모자',
    slot: 'Helmet',
    type: 'Helmet',
    rarity: 'Normal',
    requirements: { level: 5, str: 9, dex: 0, int: 0 },
  },
];

describe('filterItems (§10.4 item library search/filter/sort)', () => {
  it('returns every item (in name order) for an empty query', () => {
    // English-name order: "Iron Hat" < "Sorrow Sole" < "Starforge".
    const out = filterItems(LIB, {});
    expect(out.map((i) => i.itemId)).toEqual(['lib-helm', 'lib-boots', 'lib-sword']);
  });

  it('matches an English name token (case-insensitive, substring)', () => {
    const out = filterItems(LIB, { text: 'star' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-sword']);
  });

  it('matches an English base-type token', () => {
    const out = filterItems(LIB, { text: 'hunting' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-boots']);
  });

  it('matches a Korean name token (ko↔en parallel search, DESIGN §10.1)', () => {
    const out = filterItems(LIB, { text: '별조각' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-sword']);
  });

  it('matches a Korean base-type token', () => {
    const out = filterItems(LIB, { text: '사냥' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-boots']);
  });

  it('filters by slot', () => {
    const out = filterItems(LIB, { slot: 'Boots' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-boots']);
  });

  it('filters by type', () => {
    const out = filterItems(LIB, { type: 'Helmet' });
    expect(out.map((i) => i.itemId)).toEqual(['lib-helm']);
  });

  it('filters by max level requirement (keeps items the character can equip)', () => {
    const out = filterItems(LIB, { maxLevel: 33 });
    expect(out.map((i) => i.itemId).sort()).toEqual(['lib-boots', 'lib-helm']);
  });

  it('combines text + slot + req filters (all must hold)', () => {
    const out = filterItems(LIB, { text: 'o', slot: 'Boots', maxLevel: 40 });
    expect(out.map((i) => i.itemId)).toEqual(['lib-boots']);
  });

  it('returns no rows when nothing matches (no fallback to all items)', () => {
    expect(filterItems(LIB, { text: 'zzz-nonexistent' })).toEqual([]);
  });

  it('sorts by level requirement ascending when requested, name-tiebreak', () => {
    const out = filterItems(LIB, {}, 'level');
    expect(out.map((i) => i.itemId)).toEqual(['lib-helm', 'lib-boots', 'lib-sword']);
  });

  it('does not mutate the input array', () => {
    const snapshot = LIB.map((i) => i.itemId);
    filterItems(LIB, {}, 'level');
    expect(LIB.map((i) => i.itemId)).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// (3) buildEquipDeltaModel — §10.4 +DPS / -EHP delta chips
// ---------------------------------------------------------------------------

describe('buildEquipDeltaModel (§10.4 equip delta chips, §6.4 NO-FALLBACK)', () => {
  const deltas: EquipDelta[] = [
    { statId: 'TotalDPS', before: 100, after: 112.4, delta: 12.4 },
    { statId: 'TotalEHP', before: 1000, after: 969, delta: -31 },
    { statId: 'Armour', before: 0, after: 0, delta: 0 },
  ];

  it('produces one chip per supplied delta, preserving stat id & numbers', () => {
    const model: EquipDeltaModel = buildEquipDeltaModel(deltas, undefined);
    expect(model.chips.length).toBe(3);
    const dps = chip(model, 'TotalDPS');
    expect(dps.before).toBe(100);
    expect(dps.after).toBe(112.4);
    expect(dps.delta).toBe(12.4);
  });

  it('classifies sign: gain / loss / neutral (a real 0 delta is neutral, not dropped)', () => {
    const model = buildEquipDeltaModel(deltas, undefined);
    expect(chip(model, 'TotalDPS').direction).toBe('gain');
    expect(chip(model, 'TotalEHP').direction).toBe('loss');
    const armour = chip(model, 'Armour');
    expect(armour.direction).toBe('neutral');
    expect(armour.delta).toBe(0);
  });

  it('marks a stat the core did not return as missing (NOT a fabricated 0 delta)', () => {
    // We ask for CritChance but the core only returned the three above.
    const model = buildEquipDeltaModel(deltas, ['CritChance']);
    const crit = chip(model, 'CritChance');
    expect(crit.missing).toBe(true);
    expect(crit.before).toBeUndefined();
    expect(crit.after).toBeUndefined();
    expect(crit.delta).toBeUndefined();
    expect(crit.direction).toBe('missing');
  });

  it('keeps a returned stat present even when it is also in the requested list', () => {
    const model = buildEquipDeltaModel(deltas, ['TotalDPS']);
    const dps = chip(model, 'TotalDPS');
    expect(dps.missing).toBeUndefined();
    expect(dps.delta).toBe(12.4);
  });

  it('orders requested-but-missing chips after the returned ones', () => {
    const model = buildEquipDeltaModel(deltas, ['CritChance', 'Speed']);
    const ids = model.chips.map((c) => c.statId);
    expect(ids).toEqual(['TotalDPS', 'TotalEHP', 'Armour', 'CritChance', 'Speed']);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function cardFor(model: EquippedGridModel, slot: string): ItemCardModel {
  const found = model.cards.find((c) => c.slot === slot);
  if (!found) throw new Error(`no card for slot ${slot}`);
  return found;
}

function chip(model: EquipDeltaModel, statId: string): DeltaChip {
  const found = model.chips.find((c) => c.statId === statId);
  if (!found) throw new Error(`no chip for statId ${statId}`);
  return found;
}
