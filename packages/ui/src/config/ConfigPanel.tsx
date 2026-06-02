/**
 * ConfigPanel — the §10.8 Config tab 2-region layout (DESIGN §10.8 "단일 긴 옵션
 * 목록 대신 scenario preset 중심"):
 *
 *   ┌──────────────────────────┬──────────────────────────────────┐
 *   │ Scenario Presets         │ Options                          │
 *   │ (preset selector)        │ (typed option rows)              │
 *   │                          │                                  │
 *   │ [ General Mapping ]      │  적이 감전됨  [x]  영향: TotalDPS │
 *   │ [ Bossing        ]       │  강화 충전 수 [ 0] 영향: …        │
 *   │ [ Full Charges   ]  …    │  …                               │
 *   └──────────────────────────┴──────────────────────────────────┘
 *
 * Per §10.8 the Config tab leads with the scenario presets — general mapping /
 * bossing / full charges / shocked enemy / cursed enemy / low life / custom —
 * rather than one long flat option list. Choosing a preset reduces it (via
 * `presetToConfigOptions`) to the `{ optionId, value }[]` payload and reports it
 * up as `onApplyPreset(presetId, payload)` so the host can send each entry through
 * config.setOption. Editing an individual option is reported up via
 * `onChangeOption(optionId, value)`.
 *
 * The two regions carry `data-region="presets|options"` so the layout is
 * machine-checkable. The panel owns only the *selected preset* state (highlighting
 * the chosen scenario); everything rendered — the option inputs, the presets — is
 * supplied by the p4-config-vm model, so the panel stays free of app/IO coupling
 * (like the Items / Skills / Overview panels). All chrome text resolves through
 * `t` (§8.1).
 *
 * NO-FALLBACK (§6.4): the option rows render only what the model hands them — an
 * unsupported control type stays unsupported, an option with no affected stats
 * shows no results region (both delegated to {@link ConfigOptionRow}).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale, StringKey } from '../i18n/index.js';
import { ConfigOptionRow } from './ConfigOptionRow.js';
import { presetToConfigOptions } from './config-model.js';
import type {
  ConfigOptionValue,
  ConfigPreset,
  ConfigPresetId,
  ConfigViewModel,
} from './config-model.js';

/** i18n key for each §10.8 scenario-preset label (the model label is ko-only). */
const PRESET_KEY: Record<ConfigPresetId, StringKey> = {
  generalMapping: 'config.preset.generalMapping',
  bossing: 'config.preset.bossing',
  fullCharges: 'config.preset.fullCharges',
  shockedEnemy: 'config.preset.shockedEnemy',
  cursedEnemy: 'config.preset.cursedEnemy',
  lowLife: 'config.preset.lowLife',
  custom: 'config.preset.custom',
};

export interface ConfigPanelProps {
  /** Active locale, drives every label across the two regions. */
  locale: Locale;
  /** The §10.8 Config view-model (p4-config-vm): typed inputs + scenario presets. */
  model: ConfigViewModel;
  /**
   * Called with (presetId, payload) when a scenario preset is applied. `payload`
   * is the preset reduced to its `{ optionId, value }[]` config.setOption list.
   */
  onApplyPreset?: (presetId: ConfigPresetId, payload: ConfigOptionValue[]) => void;
  /** Called with (optionId, value) when an individual option is edited. */
  onChangeOption?: (optionId: string, value: unknown) => void;
}

export function ConfigPanel(props: ConfigPanelProps) {
  const { locale, model } = props;
  const [selectedPreset, setSelectedPreset] = useState<ConfigPresetId | undefined>(undefined);

  const handleApplyPreset = (preset: ConfigPreset) => {
    setSelectedPreset(preset.id);
    props.onApplyPreset?.(preset.id, presetToConfigOptions(preset));
  };

  return (
    <div className="pob-config">
      <div className="pob-config__regions">
        <section className="pob-config__region pob-config__presets" data-region="presets">
          <h3 className="pob-config__region-title">{t(locale, 'config.presets')}</h3>
          <div className="pob-config__preset-list">
            {model.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="pob-config__preset"
                data-preset-id={preset.id}
                data-selected={preset.id === selectedPreset ? 'true' : undefined}
                onClick={() => handleApplyPreset(preset)}
              >
                {t(locale, PRESET_KEY[preset.id])}
              </button>
            ))}
          </div>
        </section>

        <section className="pob-config__region pob-config__options" data-region="options">
          <h3 className="pob-config__region-title">{t(locale, 'config.options')}</h3>
          <div className="pob-config__option-list">
            {model.inputs.map((input) => (
              <ConfigOptionRow
                key={input.optionId}
                locale={locale}
                input={input}
                onChangeOption={props.onChangeOption}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
