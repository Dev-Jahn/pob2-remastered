/**
 * AppShell — the 3-pane application frame (DESIGN §10.2 App shell).
 *
 * Layout (top to bottom):
 *   - header: build name + active skill + ko/en LocaleToggle,
 *   - body: left Navigation rail, center workspace slot, right Inspector slot,
 *   - footer: status bar (warnings / unsupported mods / update state / latency).
 *
 * The workspace and inspector are slot props the host tab fills, keeping the
 * shell agnostic of tab content. All chrome text (header labels, status bar, nav
 * labels, toggle labels) is resolved through the i18n resolver `t` for the active
 * `locale`, satisfying the §2.1 "UI 문자열 100%" coverage bar.
 */
import type { ReactNode } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { Navigation } from './Navigation.js';
import type { NavTab } from './Navigation.js';
import { LocaleToggle } from './LocaleToggle.js';

export interface AppShellProps {
  /** Active locale, drives every resolved label (controlled by the host). */
  locale: Locale;
  /** Called with the next locale when the header LocaleToggle is switched. */
  onLocaleChange: (next: Locale) => void;
  /** Human-readable build name shown in the header (e.g. "Martial Artist / Monk"). */
  buildName: string;
  /** Active main-skill name shown in the header (e.g. "Whirling Assault"). */
  activeSkill: string;
  /** Center workspace pane content (tab-specific canvas/table/forms). */
  workspace: ReactNode;
  /** Right inspector pane content (selected entity info / delta / explanation). */
  inspector: ReactNode;
  /** Currently selected nav tab (controlled by the host). */
  activeTab?: NavTab;
  /** Called with the tab id when a nav rail entry is selected. */
  onSelectTab?: (tab: NavTab) => void;
  /** Optional status-bar content; defaults to the localized "Ready" label. */
  status?: ReactNode;
}

export function AppShell({
  locale,
  onLocaleChange,
  buildName,
  activeSkill,
  workspace,
  inspector,
  activeTab = 'overview',
  onSelectTab,
  status,
}: AppShellProps) {
  return (
    <div className="pob-shell">
      <header className="pob-shell__header">
        <div className="pob-shell__build">
          <span className="pob-shell__label">{t(locale, 'shell.buildLabel')}</span>
          <span className="pob-shell__value">{buildName}</span>
        </div>
        <div className="pob-shell__skill">
          <span className="pob-shell__label">{t(locale, 'shell.activeSkillLabel')}</span>
          <span className="pob-shell__value">{activeSkill}</span>
        </div>
        <div className="pob-shell__header-actions">
          <LocaleToggle locale={locale} onChange={onLocaleChange} />
        </div>
      </header>

      <div className="pob-shell__body">
        <aside className="pob-shell__nav">
          <Navigation locale={locale} active={activeTab} onSelect={onSelectTab} />
        </aside>
        <main className="pob-shell__workspace">{workspace}</main>
        <aside className="pob-shell__inspector" aria-label={t(locale, 'overview.card.warnings')}>
          {inspector}
        </aside>
      </div>

      <footer className="pob-shell__status" role="status">
        {status ?? t(locale, 'shell.statusReady')}
      </footer>
    </div>
  );
}
