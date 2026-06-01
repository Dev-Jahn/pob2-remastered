/**
 * WarningPanel — the Overview warning card (DESIGN §10.3 warning card, §11.3).
 *
 * Lists each {@link Warning} from the warning view-model as a row carrying BOTH a
 * non-color icon glyph and a text label, so meaning never rides on color alone
 * (§11.3: "붉은색만 쓰지 않고 icon + text label 제공. 색각 이상 접근성을 고려."). The label is
 * resolved through the package `t` resolver from the warning's `i18nKey` — never
 * a pre-rendered string — so it stays localized (§8.1). When a warning carries a
 * verbatim source line (`detail`, §8.6 step 4), it is echoed beneath the label.
 *
 * `data-severity` is exposed for styling, but it is *additive*: the glyph and the
 * text label already convey the warning without any color.
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { Warning, WarningModel, WarningSeverity } from './warnings.js';

/**
 * Non-color glyph per severity (§11.3). These are text characters, not colors, so
 * the icon carries meaning on its own for color-blind users.
 */
const SEVERITY_ICON: Record<WarningSeverity, string> = {
  error: '⛔',
  warning: '⚠',
  info: 'ℹ',
};

export interface WarningPanelProps {
  /** Active locale, drives every warning label. */
  locale: Locale;
  /** The warning view-model (the ordered §10.3 warning-card rows). */
  model: WarningModel;
}

function WarningRow({ warning, locale }: { warning: Warning; locale: Locale }) {
  return (
    <li
      className="pob-warning-panel__row"
      role="listitem"
      data-severity={warning.severity}
      data-code={warning.code}
    >
      <span className="pob-warning-panel__icon" data-warning-icon aria-hidden="true">
        {SEVERITY_ICON[warning.severity]}
      </span>
      <span className="pob-warning-panel__body">
        <span className="pob-warning-panel__label" data-warning-label>
          {t(locale, warning.i18nKey)}
        </span>
        {warning.detail !== undefined ? (
          <span className="pob-warning-panel__detail">{warning.detail}</span>
        ) : null}
      </span>
    </li>
  );
}

export function WarningPanel({ locale, model }: WarningPanelProps) {
  return (
    <section className="pob-warning-panel" aria-label={t(locale, 'overview.card.warnings')}>
      <h3 className="pob-warning-panel__title">{t(locale, 'overview.card.warnings')}</h3>
      <ul className="pob-warning-panel__rows" role="list">
        {model.warnings.map((warning) => (
          <WarningRow key={warning.code} warning={warning} locale={locale} />
        ))}
      </ul>
    </section>
  );
}
