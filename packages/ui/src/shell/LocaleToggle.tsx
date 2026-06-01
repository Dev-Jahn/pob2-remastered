/**
 * LocaleToggle — controlled ko/en language switch in the app-shell header
 * (DESIGN §10.2 App shell, §8.1 locale baseline).
 *
 * Fully controlled: the parent owns the current `locale` and is notified via
 * `onChange(next)` only when the user picks the *other* locale. Clicking the
 * already-active option is a no-op, so the component never echoes the current
 * value back to its owner. Both option labels are resolved through the i18n
 * resolver `t`, so no visible text is hard-coded.
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';

export interface LocaleToggleProps {
  /** Currently active locale (controlled by the parent). */
  locale: Locale;
  /** Called with the newly selected locale when the user switches. */
  onChange: (next: Locale) => void;
}

const OPTIONS: ReadonlyArray<{ value: Locale; key: 'locale.ko' | 'locale.en' }> = [
  { value: 'ko-KR', key: 'locale.ko' },
  { value: 'en-US', key: 'locale.en' },
];

export function LocaleToggle({ locale, onChange }: LocaleToggleProps) {
  return (
    <div className="pob-locale-toggle" role="group" aria-label={t(locale, 'locale.en')}>
      {OPTIONS.map(({ value, key }) => {
        const active = value === locale;
        return (
          <button
            key={value}
            type="button"
            className="pob-locale-toggle__option"
            aria-pressed={active}
            onClick={() => {
              if (!active) onChange(value);
            }}
          >
            {t(locale, key)}
          </button>
        );
      })}
    </div>
  );
}
