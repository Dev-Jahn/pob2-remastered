/**
 * ConfigOptionRow — one §10.8 Config tab option (DESIGN §10.8 "각 config option은
 * dependent modifier와 연결 · 변경 시 영향을 받는 계산 항목을 즉시 표시"):
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ 적이 감전됨                       [x]   영향: TotalDPS …  │
 *   │ (label)                      (editable)  (calc results)   │
 *   └──────────────────────────────────────────────────────────┘
 *
 * Renders a {@link ConfigOptionInput} from the p4-config-vm. The control is typed
 * by the input `kind`: `check` → a boolean checkbox, `count` → a number input,
 * `list` → an enumerated string input. The change is reported upward as
 * `onChangeOption(optionId, value)` with the value already parsed to the kind's
 * type (a count yields a `number`, a check a `boolean`), so the host can hand it
 * straight to config.setOption.
 *
 * §10.1.6 (수정 가능한 값과 계산 결과를 명확히 구분한다): the editable control sits in a
 * `data-editable` region; the calc items the change affects sit in a separate,
 * read-only `data-affected-stats` region. The two visual languages never mix —
 * the control is never inside the results region.
 *
 * §6.4 / §11.3 (NO-FALLBACK + unsupported accessibility): an option whose control
 * `kind` is `unsupported` renders no editable control at all — a non-colour icon
 * glyph AND the localized "Unsupported" text label instead, never a fabricated
 * `check` default. An option with no `affectedStats` renders no results region,
 * never a fabricated stat.
 *
 * The component is pure props: it owns no state and performs no IO (changes are
 * reported upward as callbacks). All labels resolve through `t` (§8.1).
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { ConfigOptionInput } from './config-model.js';

/** Non-colour glyph for an unsupported control (§11.3: meaning carried by the icon). */
const UNSUPPORTED_ICON = '⚠';

export interface ConfigOptionRowProps {
  /** Active locale, drives the affected-items label and the unsupported marker. */
  locale: Locale;
  /** The §10.8 typed option input to render. */
  input: ConfigOptionInput;
  /**
   * Called with (optionId, value) when the control changes. `value` is already
   * parsed to the kind's type: a boolean for `check`, a number for `count`, a
   * string for `list`. Never fired for an `unsupported` row (no control).
   */
  onChangeOption?: (optionId: string, value: unknown) => void;
}

/** The editable control for a known input kind, or `null` for `unsupported`. */
function OptionControl({
  input,
  onChangeOption,
}: {
  input: ConfigOptionInput;
  onChangeOption?: (optionId: string, value: unknown) => void;
}) {
  const optionId = input.optionId;
  switch (input.kind) {
    case 'check':
      return (
        <input
          type="checkbox"
          data-option-control
          checked={input.value === true}
          onChange={(e) => onChangeOption?.(optionId, e.target.checked)}
        />
      );
    case 'count':
      return (
        <input
          type="number"
          data-option-control
          value={String(input.value)}
          onChange={(e) => onChangeOption?.(optionId, Number(e.target.value))}
        />
      );
    case 'list':
      return (
        <input
          type="text"
          data-option-control
          value={String(input.value)}
          onChange={(e) => onChangeOption?.(optionId, e.target.value)}
        />
      );
    case 'unsupported':
      return null;
  }
}

export function ConfigOptionRow({ locale, input, onChangeOption }: ConfigOptionRowProps) {
  const unsupported = input.kind === 'unsupported';
  return (
    <div
      className="pob-config-option"
      data-option-row
      data-option-id={input.optionId}
      data-kind={input.kind}
    >
      <span className="pob-config-option__label">{input.label}</span>

      <span className="pob-config-option__editable" data-editable>
        {unsupported ? (
          <span className="pob-config-option__unsupported">
            <span
              className="pob-config-option__unsupported-icon"
              data-unsupported-icon
              aria-hidden="true"
            >
              {UNSUPPORTED_ICON}
            </span>
            <span className="pob-config-option__unsupported-label">
              {t(locale, 'config.unsupported')}
            </span>
          </span>
        ) : (
          <OptionControl input={input} onChangeOption={onChangeOption} />
        )}
      </span>

      {input.affectedStats.length > 0 ? (
        <span className="pob-config-option__affected" data-affected-stats>
          <span className="pob-config-option__affected-label">{t(locale, 'config.affects')}</span>
          <ul className="pob-config-option__affected-list" role="list">
            {input.affectedStats.map((statId) => (
              <li
                key={statId}
                className="pob-config-option__affected-stat"
                role="listitem"
                data-stat-id={statId}
              >
                {statId}
              </li>
            ))}
          </ul>
        </span>
      ) : null}
    </div>
  );
}
