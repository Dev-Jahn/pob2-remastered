/**
 * ItemSetSelector — the Items header item-set picker (DESIGN §10.4 header toolbar
 * "[Item Set: Default ▼]").
 *
 * A controlled `<select>`: the host owns `activeSetId` and is told the next id via
 * `onChange`. The accessible label is resolved through the i18n resolver `t` (the
 * `items.set.label` key), so the control carries no hard-coded text (§8.1).
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';

/** One selectable item set (DESIGN §10.4 / §12.1 itemSets). */
export interface ItemSetOption {
  id: string;
  name: string;
}

export interface ItemSetSelectorProps {
  /** Active locale, drives the accessible label. */
  locale: Locale;
  /** The item sets to choose from. */
  sets: ItemSetOption[];
  /** Currently active item-set id (controlled by the host). */
  activeSetId: string;
  /** Called with the chosen set id when the selection changes. */
  onChange?: (setId: string) => void;
}

export function ItemSetSelector({ locale, sets, activeSetId, onChange }: ItemSetSelectorProps) {
  const label = t(locale, 'items.set.label');
  return (
    <label className="pob-item-set" data-item-set-selector>
      <span className="pob-item-set__label">{label}</span>
      <select
        className="pob-item-set__select"
        aria-label={label}
        value={activeSetId}
        onChange={(event) => onChange?.(event.target.value)}
      >
        {sets.map((set) => (
          <option key={set.id} value={set.id}>
            {set.name}
          </option>
        ))}
      </select>
    </label>
  );
}
