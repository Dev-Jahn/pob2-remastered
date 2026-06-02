// Skills tab view-model test (DESIGN §10.5 Skills tab, §6.3 skills.getGroups /
// skills.setGemGroup, §6.4 NO-FALLBACK).
//
// Two pure, framework-free concerns power the Skills tab:
//
//   (1) buildSkillGroupsModel(response, gemMeta) — turns a `skills.getGroups`
//       response into card-unit §10.5 skill-group models. Each gem becomes a
//       classified chip: support gems → `support`; active gems are resolved via
//       the supplied gem-category metadata to `active` / `buff` / `aura` /
//       `minion`. Every gem carries level / quality / enabled, and each card
//       surfaces the group `enabled` toggle plus the §10.5 spirit / reservation
//       values.
//   (2) GemInput builders (toggleGemEnabled / addGem / removeGem / groupToGemInputs)
//       — pure functions that construct the `GemInput[]` list to send to
//       skills.setGemGroup (toggle / add / remove).
//
// Both obey §6.4 NO-FALLBACK: an active gem whose category is absent from the
// supplied metadata becomes an explicit `unsupported` chip — never a fabricated
// `active` (or any other) default, never a blank. A real `0` (level / quality /
// spirit / reservation) is preserved as a value, never coerced to missing.
import { describe, it, expect } from 'vitest';
import type { GemInput, SkillGemRef, SkillGroupCard, SkillsGetGroupsResponse } from '@pob2/schema';
import {
  buildSkillGroupsModel,
  toggleGemEnabled,
  addGem,
  removeGem,
  groupToGemInputs,
} from '../src/index.js';
import type { SkillsViewModel, GemChipCategory, GemCategoryMeta } from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIREBALL: SkillGemRef = {
  gemId: 'gem-fireball',
  name: 'Fireball',
  level: 20,
  quality: 23,
  enabled: true,
};

// A minion active gem — distinguishes the `minion` chip from a plain `active`.
const RAISE_ZOMBIE: SkillGemRef = {
  gemId: 'gem-raise-zombie',
  name: 'Raise Zombie',
  level: 1,
  quality: 0,
  enabled: true,
};

// An aura active gem.
const DETERMINATION: SkillGemRef = {
  gemId: 'gem-determination',
  name: 'Determination',
  level: 10,
  quality: 0,
  enabled: false,
};

// A buff active gem.
const WAR_BANNER: SkillGemRef = {
  gemId: 'gem-war-banner',
  name: 'War Banner',
  level: 5,
  quality: 0,
  enabled: true,
};

// An active gem with NO entry in the category metadata — must yield an explicit
// `unsupported` chip (NO-FALLBACK), never a guessed `active`.
const MYSTERY_GEM: SkillGemRef = {
  gemId: 'gem-mystery',
  name: 'Mystery Skill',
  level: 1,
  quality: 0,
  enabled: true,
};

const ADDED_FOCUS: SkillGemRef = {
  gemId: 'gem-added-fire',
  name: 'Added Fire Damage',
  level: 20,
  quality: 0,
  enabled: true,
};

// The category metadata the view-model consumes to refine an active gem's chip.
// Support gems never need an entry (their chip is `support` by group position).
const GEM_META: GemCategoryMeta = {
  'gem-fireball': 'active',
  'gem-raise-zombie': 'minion',
  'gem-determination': 'aura',
  'gem-war-banner': 'buff',
  // 'gem-mystery' intentionally absent → unsupported.
};

// A fully-populated socket group: an active gem + a support gem, with real
// spirit / reservation values.
const MAIN_GROUP: SkillGroupCard = {
  groupId: 'group-1',
  label: 'Fireball',
  enabled: true,
  spirit: 0,
  reservation: 0,
  activeGems: [FIREBALL],
  supportGems: [ADDED_FOCUS],
};

// An aura group with a non-zero spirit reservation and a disabled toggle.
const AURA_GROUP: SkillGroupCard = {
  groupId: 'group-2',
  label: 'Determination',
  enabled: false,
  spirit: 50,
  reservation: 0,
  activeGems: [DETERMINATION],
  supportGems: [],
};

const RESPONSE: SkillsGetGroupsResponse = {
  groups: [MAIN_GROUP, AURA_GROUP],
};

// ---------------------------------------------------------------------------
// (1) buildSkillGroupsModel — §10.5 skill-group cards
// ---------------------------------------------------------------------------

describe('buildSkillGroupsModel (§10.5 skill group cards)', () => {
  it('emits one card per group, in response order', () => {
    const model: SkillsViewModel = buildSkillGroupsModel(RESPONSE, GEM_META);
    expect(model.cards.map((c) => c.groupId)).toEqual(['group-1', 'group-2']);
  });

  it('carries the group toggle, label, spirit and reservation per card', () => {
    const model = buildSkillGroupsModel(RESPONSE, GEM_META);
    const [main, aura] = model.cards;

    expect(main.label).toBe('Fireball');
    expect(main.enabled).toBe(true);
    expect(main.spirit).toBe(0);
    expect(main.reservation).toBe(0);

    expect(aura.enabled).toBe(false);
    expect(aura.spirit).toBe(50);
  });

  it('classifies support gems as a `support` chip by group position', () => {
    const model = buildSkillGroupsModel(RESPONSE, GEM_META);
    const main = model.cards[0];
    const supportChip = main.chips.find((c) => c.gemId === 'gem-added-fire');
    expect(supportChip?.category).toBe<GemChipCategory>('support');
  });

  it('classifies an active gem via metadata: active / aura / minion / buff', () => {
    const group: SkillGroupCard = {
      groupId: 'g',
      label: 'Mixed',
      enabled: true,
      spirit: 0,
      reservation: 0,
      activeGems: [FIREBALL, RAISE_ZOMBIE, DETERMINATION, WAR_BANNER],
      supportGems: [],
    };
    const model = buildSkillGroupsModel({ groups: [group] }, GEM_META);
    const byId = new Map(model.cards[0].chips.map((c) => [c.gemId, c.category]));

    expect(byId.get('gem-fireball')).toBe('active');
    expect(byId.get('gem-raise-zombie')).toBe('minion');
    expect(byId.get('gem-determination')).toBe('aura');
    expect(byId.get('gem-war-banner')).toBe('buff');
  });

  it('marks an active gem with no metadata entry `unsupported` (NO-FALLBACK)', () => {
    const group: SkillGroupCard = {
      groupId: 'g',
      label: 'Mystery',
      enabled: true,
      spirit: 0,
      reservation: 0,
      activeGems: [MYSTERY_GEM],
      supportGems: [],
    };
    const model = buildSkillGroupsModel({ groups: [group] }, GEM_META);
    const chip = model.cards[0].chips[0];
    expect(chip.category).toBe<GemChipCategory>('unsupported');
    // It is unsupported, never a fabricated `active` default.
    expect(chip.category).not.toBe('active');
  });

  it('keeps each gem level / quality / enabled and never fabricates 0', () => {
    const model = buildSkillGroupsModel(RESPONSE, GEM_META);
    const fireball = model.cards[0].chips.find((c) => c.gemId === 'gem-fireball')!;
    expect(fireball.level).toBe(20);
    expect(fireball.quality).toBe(23);
    expect(fireball.enabled).toBe(true);
    expect(fireball.name).toBe('Fireball');

    const aura = model.cards[1].chips.find((c) => c.gemId === 'gem-determination')!;
    // Real 0 quality is preserved as a value, not coerced to missing.
    expect(aura.quality).toBe(0);
    expect(aura.enabled).toBe(false);
  });

  it('lists active chips before support chips within a card', () => {
    const model = buildSkillGroupsModel(RESPONSE, GEM_META);
    const cats = model.cards[0].chips.map((c) => c.category);
    expect(cats).toEqual<GemChipCategory[]>(['active', 'support']);
  });
});

// ---------------------------------------------------------------------------
// (2) GemInput builders — the skills.setGemGroup payload
// ---------------------------------------------------------------------------

describe('groupToGemInputs (§6.3 setGemGroup payload from a card)', () => {
  it('flattens active-then-support gems into GemInput order', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    expect(inputs).toEqual<GemInput[]>([
      { gemId: 'gem-fireball', level: 20, quality: 23, enabled: true },
      { gemId: 'gem-added-fire', level: 20, quality: 0, enabled: true },
    ]);
  });
});

describe('toggleGemEnabled (§10.5 enabled toggle → setGemGroup payload)', () => {
  it('flips only the targeted gem`s enabled flag, preserving the rest', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const next = toggleGemEnabled(inputs, 'gem-fireball');

    expect(next.find((g) => g.gemId === 'gem-fireball')?.enabled).toBe(false);
    // Untouched gems keep their flags.
    expect(next.find((g) => g.gemId === 'gem-added-fire')?.enabled).toBe(true);
    // Pure: the input list is not mutated.
    expect(inputs.find((g) => g.gemId === 'gem-fireball')?.enabled).toBe(true);
  });

  it('is a no-op when the gem id is not in the list', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const next = toggleGemEnabled(inputs, 'gem-absent');
    expect(next).toEqual(inputs);
    expect(next).not.toBe(inputs);
  });
});

describe('addGem (§10.5 add gem → setGemGroup payload)', () => {
  it('appends a new GemInput to the list', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const added: GemInput = {
      gemId: 'gem-spell-echo',
      level: 1,
      quality: 0,
      enabled: true,
    };
    const next = addGem(inputs, added);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual(added);
    // Pure: original untouched.
    expect(inputs).toHaveLength(2);
  });

  it('rejects a duplicate gem id (returns the list unchanged)', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const dup: GemInput = {
      gemId: 'gem-fireball',
      level: 1,
      quality: 0,
      enabled: true,
    };
    const next = addGem(inputs, dup);
    expect(next).toEqual(inputs);
    expect(next).not.toBe(inputs);
  });
});

describe('removeGem (§10.5 remove gem → setGemGroup payload)', () => {
  it('drops the targeted gem, preserving order of the rest', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const next = removeGem(inputs, 'gem-fireball');
    expect(next.map((g) => g.gemId)).toEqual(['gem-added-fire']);
    // Pure: original untouched.
    expect(inputs).toHaveLength(2);
  });

  it('is a no-op when the gem id is not in the list', () => {
    const inputs = groupToGemInputs(MAIN_GROUP);
    const next = removeGem(inputs, 'gem-absent');
    expect(next).toEqual(inputs);
    expect(next).not.toBe(inputs);
  });
});
