/**
 * Config tab view-model — DESIGN §10.8 Config tab. A pure, framework-free
 * transform that turns the `config.getOptions` response into the scenario-preset-
 * centric Config model: per-option INPUT models typed by control kind, each wired
 * to its dependent modifiers and to the calc stats it affects when changed, plus
 * the §10.8 scenario presets and the pure builders that reduce a preset (or a
 * custom edit) to the `{ optionId, value }[]` payload for `config.setOption`.
 *
 * Per §10.8 the Config tab leads with scenario presets — general mapping /
 * bossing / full charges / shocked enemy / cursed enemy / low life / custom —
 * rather than one long flat option list. Each option is also linked to its
 * dependent modifier ids and to the calc items it influences, so the UI can show
 * the impact of a change immediately ("변경 시 영향을 받는 계산 항목을 즉시 표시").
 *
 * NO-FALLBACK (DESIGN §6.4): an option whose control `type` is not a known kind
 * (check / count / list) becomes an explicit `unsupported` input — never a
 * guessed `check` (or any other) default. An option with no impact-map entry gets
 * an empty `affectedStats`, never a fabricated stat. A real `false` / `0` value
 * is preserved as a value, never coerced to missing.
 */
import type { ConfigGetOptionsResponse, ConfigOptionCard } from '@pob2/schema';

/**
 * The input control kind of a §10.8 config option. `check` / `count` / `list`
 * are the known control types; an option whose core `type` is none of these is
 * `unsupported` (NO-FALLBACK), never one of the known kinds by default.
 */
export type ConfigInputKind = 'check' | 'count' | 'list' | 'unsupported';

/** Per-option calc-stat impact: optionId → the stat ids it affects (DESIGN §10.8). */
export type StatImpactMap = Readonly<Record<string, readonly string[]>>;

/**
 * One typed config-option input on the §10.8 Config tab. `kind` selects the
 * control (boolean toggle / number / enumerated choice / unsupported), `value` is
 * the current setting, `dependentModifiers` are the mods the option feeds, and
 * `affectedStats` are the calc items the change influences (DESIGN §10.8).
 */
export interface ConfigOptionInput {
  optionId: string;
  kind: ConfigInputKind;
  label: string;
  /** Current value: boolean for check, number for count, string for list. */
  value: unknown;
  /** Modifier ids this option feeds when set (DESIGN §10.8 dependent modifier). */
  dependentModifiers: string[];
  /** Calc stat ids affected when this option changes (DESIGN §10.8). */
  affectedStats: string[];
}

/** A single `{ optionId, value }` to send through config.setOption (DESIGN §6.3). */
export interface ConfigOptionValue {
  optionId: string;
  value: unknown;
}

/** The id of one §10.8 scenario preset. */
export type ConfigPresetId =
  | 'generalMapping'
  | 'bossing'
  | 'fullCharges'
  | 'shockedEnemy'
  | 'cursedEnemy'
  | 'lowLife'
  | 'custom';

/**
 * One §10.8 scenario preset: a labelled bundle of `{ optionId, value }` entries
 * that `presetToConfigOptions` reduces to the config.setOption payload. The
 * `custom` preset carries no entries — it is the starting point the user edits
 * via `setOptionValue`.
 */
export interface ConfigPreset {
  id: ConfigPresetId;
  label: string;
  /** The option values this preset applies (empty for `custom`). */
  values: ConfigOptionValue[];
}

/** The Config tab view-model: typed option inputs + the §10.8 scenario presets. */
export interface ConfigViewModel {
  inputs: ConfigOptionInput[];
  presets: ConfigPreset[];
}

/**
 * The §10.8 scenario presets, in canonical order. Each non-custom preset reduces
 * to a `{ optionId, value }[]` config.setOption payload (DESIGN §10.8 "각 preset은
 * setConfigOption로 보낼 목록으로 환원"); `custom` is the empty, user-built scenario.
 */
export const CONFIG_PRESETS: readonly ConfigPreset[] = [
  {
    id: 'generalMapping',
    label: '일반 맵핑',
    values: [{ optionId: 'enemyIsBoss', value: false }],
  },
  {
    id: 'bossing',
    label: '보스전',
    values: [{ optionId: 'enemyIsBoss', value: true }],
  },
  {
    id: 'fullCharges',
    label: '최대 충전',
    values: [
      { optionId: 'usePowerCharges', value: 3 },
      { optionId: 'useFrenzyCharges', value: 3 },
      { optionId: 'useEnduranceCharges', value: 3 },
    ],
  },
  {
    id: 'shockedEnemy',
    label: '감전된 적',
    values: [{ optionId: 'conditionEnemyShocked', value: true }],
  },
  {
    id: 'cursedEnemy',
    label: '저주받은 적',
    values: [{ optionId: 'conditionEnemyCursed', value: true }],
  },
  {
    id: 'lowLife',
    label: '저생명',
    values: [{ optionId: 'conditionLowLife', value: true }],
  },
  {
    id: 'custom',
    label: '사용자 지정',
    values: [],
  },
];

/** The known control types, resolved from the core `ConfigOptionCard.type`. */
const KNOWN_KINDS: ReadonlySet<string> = new Set(['check', 'count', 'list']);

/** Resolve an option's control kind, or `unsupported` for an unknown type. */
function inputKind(type: string): ConfigInputKind {
  return KNOWN_KINDS.has(type) ? (type as ConfigInputKind) : 'unsupported';
}

/** Build one typed §10.8 input from a config-option card and the impact map. */
function toInput(card: ConfigOptionCard, impact: StatImpactMap): ConfigOptionInput {
  return {
    optionId: card.optionId,
    kind: inputKind(card.type),
    label: card.label,
    value: card.value,
    dependentModifiers: [...card.dependentModifiers],
    affectedStats: [...(impact[card.optionId] ?? [])],
  };
}

/**
 * Build the §10.8 Config view-model from a `config.getOptions` response.
 *
 * Each option yields one typed input, in response order: a `check` option becomes
 * a boolean toggle, `count` a number, `list` an enumerated choice, and any other
 * control type an explicit `unsupported` input (NO-FALLBACK). Each input carries
 * its dependent modifier ids and the calc stats it affects (resolved from
 * `impact`; an option with no entry gets an empty `affectedStats`). The model also
 * exposes the shared `CONFIG_PRESETS` scenario list.
 */
export function buildConfigModel(
  response: ConfigGetOptionsResponse,
  impact: StatImpactMap = {},
): ConfigViewModel {
  return {
    inputs: response.options.map((card) => toInput(card, impact)),
    presets: [...CONFIG_PRESETS],
  };
}

/**
 * Reduce a §10.8 scenario preset to the flat `{ optionId, value }[]` list to send
 * through config.setOption (DESIGN §10.8). Returns a new list; the preset is never
 * mutated. The `custom` preset reduces to an empty list (user-built).
 */
export function presetToConfigOptions(preset: ConfigPreset): ConfigOptionValue[] {
  return preset.values.map((v) => ({ optionId: v.optionId, value: v.value }));
}

/**
 * Set one option's value in a custom-scenario `{ optionId, value }[]` payload
 * (DESIGN §10.8 custom scenario). An existing entry is updated in place
 * (order preserved); an absent optionId is appended. Returns a new list; the
 * input is never mutated. A real `false` / `0` value is stored as-is, never
 * coerced away (NO-FALLBACK).
 */
export function setOptionValue(
  values: ConfigOptionValue[],
  optionId: string,
  value: unknown,
): ConfigOptionValue[] {
  if (values.some((v) => v.optionId === optionId)) {
    return values.map((v) => (v.optionId === optionId ? { optionId, value } : v));
  }
  return [...values, { optionId, value }];
}
