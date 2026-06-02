// Config tab view-model test (DESIGN §10.8 Config tab, §6.3 config.getOptions /
// config.setOption, §6.4 NO-FALLBACK).
//
// Per §10.8 the Config tab is scenario-preset-centric, not one long option list.
// Three pure, framework-free concerns power it:
//
//   (1) buildConfigModel(response, impactMap) — turns a `config.getOptions`
//       response into per-option INPUT models typed by control kind
//       (check → boolean toggle; count → number; list → enumerated choice), each
//       carrying its current value, its dependent modifier ids, and — via the
//       supplied impact map — the calc stat ids it affects when changed
//       (§10.8 "변경 시 영향을 받는 계산 항목을 즉시 표시"). It also exposes the §10.8
//       scenario presets (general mapping / bossing / full charges / shocked
//       enemy / cursed enemy / low life / custom).
//   (2) presetToConfigOptions(preset) — reduces a scenario preset to the flat
//       `{ optionId, value }[]` list to send through config.setOption (§10.8 "각
//       preset은 setConfigOption로 보낼 목록으로 환원").
//   (3) setOptionValue(values, optionId, value) — the pure custom-scenario edit
//       that builds the same `{ optionId, value }[]` payload.
//
// All obey §6.4 NO-FALLBACK: an option whose control `type` is not a known kind
// (check/count/list) becomes an explicit `unsupported` input — never a guessed
// `check` (or any other) default. A preset entry whose optionId is absent from
// the response is surfaced as `unknownOptions`, never silently dropped. A real
// `false` / `0` value is preserved, never coerced to missing.
import { describe, it, expect } from 'vitest';
import type {
  ConfigOptionCard,
  ConfigGetOptionsResponse,
  ConfigSetOptionRequest,
} from '@pob2/schema';
import {
  buildConfigModel,
  presetToConfigOptions,
  setOptionValue,
  CONFIG_PRESETS,
} from '../src/index.js';
import type {
  ConfigInputKind,
  ConfigPresetId,
  ConfigViewModel,
  ConfigOptionValue,
  StatImpactMap,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A check (boolean) option — "enemy is shocked".
const SHOCKED: ConfigOptionCard = {
  optionId: 'conditionShockedEnemy',
  type: 'check',
  label: '적이 감전됨',
  value: false,
  dependentModifiers: ['EnemyModifier'],
};

// A count (number) option — power charge count, current real 0.
const POWER_CHARGES: ConfigOptionCard = {
  optionId: 'usePowerCharges',
  type: 'count',
  label: '강화 충전 수',
  value: 0,
  dependentModifiers: ['PowerCharge'],
};

// A list (enumerated) option — which curse is on the enemy.
const ENEMY_CURSE: ConfigOptionCard = {
  optionId: 'conditionEnemyCursed',
  type: 'list',
  label: '적에게 걸린 저주',
  value: 'none',
  dependentModifiers: ['CurseEffect'],
};

// A check option used by the bossing / low-life presets.
const BOSS: ConfigOptionCard = {
  optionId: 'enemyIsBoss',
  type: 'check',
  label: '적이 보스임',
  value: false,
  dependentModifiers: ['EnemyResist', 'EnemyAilmentThreshold'],
};

const LOW_LIFE: ConfigOptionCard = {
  optionId: 'conditionLowLife',
  type: 'check',
  label: '저생명 상태',
  value: false,
  dependentModifiers: ['LowLifeModifier'],
};

// An option whose control `type` is not a known kind — must become an explicit
// `unsupported` input (NO-FALLBACK), never a guessed `check`.
const MYSTERY: ConfigOptionCard = {
  optionId: 'mysteryOption',
  type: 'colorpicker',
  label: '알 수 없는 옵션',
  value: '#fff',
  dependentModifiers: [],
};

const RESPONSE: ConfigGetOptionsResponse = {
  options: [SHOCKED, POWER_CHARGES, ENEMY_CURSE, BOSS, LOW_LIFE, MYSTERY],
};

// Which calc stats each option's dependent modifiers affect (DESIGN §10.8 "변경
// 시 영향을 받는 계산 항목"). Keyed by optionId.
const IMPACT: StatImpactMap = {
  conditionShockedEnemy: ['TotalDPS', 'AverageHit'],
  usePowerCharges: ['CritChance', 'TotalDPS'],
  conditionEnemyCursed: ['TotalDPS'],
  enemyIsBoss: ['TotalDPS', 'EffectiveHitPool'],
  conditionLowLife: ['Life'],
  // 'mysteryOption' intentionally absent → no affected stats.
};

// ---------------------------------------------------------------------------
// (1) buildConfigModel — §10.8 typed option inputs + impact mapping + presets
// ---------------------------------------------------------------------------

describe('buildConfigModel (§10.8 typed option inputs)', () => {
  it('emits one input per option, in response order', () => {
    const model: ConfigViewModel = buildConfigModel(RESPONSE, IMPACT);
    expect(model.inputs.map((i) => i.optionId)).toEqual([
      'conditionShockedEnemy',
      'usePowerCharges',
      'conditionEnemyCursed',
      'enemyIsBoss',
      'conditionLowLife',
      'mysteryOption',
    ]);
  });

  it('types a check option as a boolean `check` input, preserving real false', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const input = model.inputs.find((i) => i.optionId === 'conditionShockedEnemy')!;
    expect(input.kind).toBe<ConfigInputKind>('check');
    expect(input.value).toBe(false);
    expect(input.label).toBe('적이 감전됨');
  });

  it('types a count option as a number `count` input, preserving real 0', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const input = model.inputs.find((i) => i.optionId === 'usePowerCharges')!;
    expect(input.kind).toBe<ConfigInputKind>('count');
    expect(input.value).toBe(0);
  });

  it('types a list option as a string `list` input', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const input = model.inputs.find((i) => i.optionId === 'conditionEnemyCursed')!;
    expect(input.kind).toBe<ConfigInputKind>('list');
    expect(input.value).toBe('none');
  });

  it('marks an unknown control type `unsupported` (NO-FALLBACK)', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const input = model.inputs.find((i) => i.optionId === 'mysteryOption')!;
    expect(input.kind).toBe<ConfigInputKind>('unsupported');
    // Unsupported, never a fabricated `check` default.
    expect(input.kind).not.toBe('check');
    // The raw value is preserved as-is for display.
    expect(input.value).toBe('#fff');
  });

  it('carries the dependent modifier ids per input (§10.8 dependent modifier)', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const boss = model.inputs.find((i) => i.optionId === 'enemyIsBoss')!;
    expect(boss.dependentModifiers).toEqual(['EnemyResist', 'EnemyAilmentThreshold']);
  });

  it('maps each option to the calc stats it affects when changed (§10.8)', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const shocked = model.inputs.find((i) => i.optionId === 'conditionShockedEnemy')!;
    expect(shocked.affectedStats).toEqual(['TotalDPS', 'AverageHit']);
  });

  it('gives an option with no impact entry an empty affectedStats (NO-FALLBACK)', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    const mystery = model.inputs.find((i) => i.optionId === 'mysteryOption')!;
    expect(mystery.affectedStats).toEqual([]);
  });

  it('exposes the §10.8 scenario presets in canonical order', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    expect(model.presets.map((p) => p.id)).toEqual<ConfigPresetId[]>([
      'generalMapping',
      'bossing',
      'fullCharges',
      'shockedEnemy',
      'cursedEnemy',
      'lowLife',
      'custom',
    ]);
  });

  it('reuses the shared CONFIG_PRESETS table for the preset list', () => {
    const model = buildConfigModel(RESPONSE, IMPACT);
    expect(model.presets).toEqual(CONFIG_PRESETS);
  });
});

// ---------------------------------------------------------------------------
// (2) presetToConfigOptions — §10.8 preset → setConfigOption payload list
// ---------------------------------------------------------------------------

describe('presetToConfigOptions (§10.8 preset → setOption payload)', () => {
  it('reduces the bossing preset to a flat { optionId, value }[] list', () => {
    const bossing = CONFIG_PRESETS.find((p) => p.id === 'bossing')!;
    const payloads = presetToConfigOptions(bossing);
    expect(payloads).toEqual<ConfigOptionValue[]>([{ optionId: 'enemyIsBoss', value: true }]);
  });

  it('reduces the shocked-enemy preset to its single check entry', () => {
    const shocked = CONFIG_PRESETS.find((p) => p.id === 'shockedEnemy')!;
    expect(presetToConfigOptions(shocked)).toEqual<ConfigOptionValue[]>([
      { optionId: 'conditionEnemyShocked', value: true },
    ]);
  });

  it('reduces the full-charges preset to its count entries', () => {
    const full = CONFIG_PRESETS.find((p) => p.id === 'fullCharges')!;
    const payloads = presetToConfigOptions(full);
    // Each entry is a maxed charge count — a real number, not a boolean.
    expect(payloads.every((p) => typeof p.value === 'number')).toBe(true);
    expect(payloads.map((p) => p.optionId)).toContain('usePowerCharges');
  });

  it('reduces the custom preset to an empty payload list (user-built)', () => {
    const custom = CONFIG_PRESETS.find((p) => p.id === 'custom')!;
    expect(presetToConfigOptions(custom)).toEqual<ConfigOptionValue[]>([]);
  });

  it('produces values directly usable as config.setOption requests', () => {
    const cursed = CONFIG_PRESETS.find((p) => p.id === 'cursedEnemy')!;
    const [first] = presetToConfigOptions(cursed);
    const request: ConfigSetOptionRequest = {
      buildId: 'b1',
      optionId: first.optionId,
      value: first.value,
    };
    expect(request.optionId).toBe(first.optionId);
    expect(request.value).toBe(first.value);
  });
});

// ---------------------------------------------------------------------------
// (3) setOptionValue — the custom-scenario edit builder
// ---------------------------------------------------------------------------

describe('setOptionValue (§10.8 custom scenario edit → setOption payload)', () => {
  const base: ConfigOptionValue[] = [
    { optionId: 'enemyIsBoss', value: true },
    { optionId: 'usePowerCharges', value: 3 },
  ];

  it('updates the value of an existing entry, preserving order', () => {
    const next = setOptionValue(base, 'usePowerCharges', 5);
    expect(next).toEqual<ConfigOptionValue[]>([
      { optionId: 'enemyIsBoss', value: true },
      { optionId: 'usePowerCharges', value: 5 },
    ]);
    // Pure: input not mutated.
    expect(base[1].value).toBe(3);
  });

  it('appends a new entry when the optionId is absent', () => {
    const next = setOptionValue(base, 'conditionShockedEnemy', true);
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual<ConfigOptionValue>({
      optionId: 'conditionShockedEnemy',
      value: true,
    });
    // Pure: original untouched.
    expect(base).toHaveLength(2);
  });

  it('preserves a real false / 0 value, never coercing it away (NO-FALLBACK)', () => {
    const next = setOptionValue(base, 'enemyIsBoss', false);
    expect(next.find((v) => v.optionId === 'enemyIsBoss')?.value).toBe(false);
    const zeroed = setOptionValue(base, 'usePowerCharges', 0);
    expect(zeroed.find((v) => v.optionId === 'usePowerCharges')?.value).toBe(0);
  });
});
