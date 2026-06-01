/**
 * Navigation — the left-rail tab list of the app shell (DESIGN §10.2 App shell).
 *
 * Renders the §10.2 navigation order (Overview, Skills, Passive Tree, Items,
 * Calcs, Config, Import/Export, Party, Compare, Notes) as a list. Every label is
 * resolved through the i18n resolver `t` for the active `locale`, so the rail is
 * fully localized and carries no hard-coded English. The active item is marked
 * via `aria-current` and a parent-supplied `onSelect` reports tab changes.
 */
import { t } from '../i18n/index.js';
import type { Locale, StringKey } from '../i18n/index.js';

/** A navigation tab id (DESIGN §10.2), used by callers to drive the workspace. */
export type NavTab =
  | 'overview'
  | 'skills'
  | 'passiveTree'
  | 'items'
  | 'calcs'
  | 'config'
  | 'importExport'
  | 'party'
  | 'compare'
  | 'notes';

/** Tab order and i18n key for each rail entry (DESIGN §10.2). */
export const NAV_ITEMS: ReadonlyArray<{ id: NavTab; key: StringKey }> = [
  { id: 'overview', key: 'nav.overview' },
  { id: 'skills', key: 'nav.skills' },
  { id: 'passiveTree', key: 'nav.passiveTree' },
  { id: 'items', key: 'nav.items' },
  { id: 'calcs', key: 'nav.calcs' },
  { id: 'config', key: 'nav.config' },
  { id: 'importExport', key: 'nav.importExport' },
  { id: 'party', key: 'nav.party' },
  { id: 'compare', key: 'nav.compare' },
  { id: 'notes', key: 'nav.notes' },
];

export interface NavigationProps {
  /** Active locale, drives label resolution. */
  locale: Locale;
  /** Currently selected tab (controlled by the parent). */
  active?: NavTab;
  /** Called with the tab id when a rail entry is clicked. */
  onSelect?: (tab: NavTab) => void;
}

export function Navigation({ locale, active, onSelect }: NavigationProps) {
  return (
    <nav className="pob-nav" aria-label={t(locale, 'nav.overview')}>
      <ul className="pob-nav__list" role="list">
        {NAV_ITEMS.map(({ id, key }) => {
          const isActive = id === active;
          return (
            <li key={id} className="pob-nav__item" role="listitem">
              <button
                type="button"
                className="pob-nav__link"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect?.(id)}
              >
                {t(locale, key)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
