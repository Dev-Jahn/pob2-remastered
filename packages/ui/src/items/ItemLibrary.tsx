/**
 * ItemLibrary — the §10.4 Item Library column (DESIGN §10.4 "Item Library"):
 * a search box + slot / type / requirement filters + a result list.
 *
 * The search and filters drive {@link filterItems} (the pure view-model), so the
 * ko↔en parallel search (§10.1: "슬픔" finds "Sorrow Sole") and the NO-FALLBACK
 * empty-vs-no-match semantics live in one place. Each result is a flat, keyed row
 * carrying `data-item-id` — the list is *virtualization-ready*: a host can swap
 * the `<ul>` body for a windowed renderer without changing the row contract.
 *
 * The slot / type filter options are derived from the library itself (the slots
 * and types actually present), so the dropdowns never offer an empty filter. The
 * requirement filter is a max-level numeric input (the character-can-equip cut).
 * All control labels resolve through `t` (§8.1).
 */
import { useMemo, useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { filterItems } from './library-search.js';
import type { LibraryItem, ItemFilterQuery } from './library-search.js';

export interface ItemLibraryProps {
  /** Active locale, drives the control labels. */
  locale: Locale;
  /** The full library to search (build + shared scope, resolved by the host). */
  items: LibraryItem[];
  /** Called with the item id when a result row is selected. */
  onSelect?: (itemId: string) => void;
}

/** Distinct, sorted values of one string field across the library (filter options). */
function distinct(items: LibraryItem[], pick: (i: LibraryItem) => string): string[] {
  return Array.from(new Set(items.map(pick))).sort((a, b) => a.localeCompare(b));
}

export function ItemLibrary({ locale, items, onSelect }: ItemLibraryProps) {
  const [text, setText] = useState('');
  const [slot, setSlot] = useState('');
  const [type, setType] = useState('');
  const [maxLevel, setMaxLevel] = useState('');

  const slots = useMemo(() => distinct(items, (i) => i.slot), [items]);
  const types = useMemo(() => distinct(items, (i) => i.type), [items]);

  const results = useMemo(() => {
    const query: ItemFilterQuery = {
      text: text || undefined,
      slot: slot || undefined,
      type: type || undefined,
      maxLevel: maxLevel === '' ? undefined : Number(maxLevel),
    };
    return filterItems(items, query);
  }, [items, text, slot, type, maxLevel]);

  return (
    <div className="pob-item-library">
      <input
        className="pob-item-library__search"
        type="search"
        placeholder={t(locale, 'items.search.placeholder')}
        aria-label={t(locale, 'items.search.placeholder')}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />

      <div className="pob-item-library__filters">
        <label className="pob-item-library__filter">
          <span className="pob-item-library__filter-label">{t(locale, 'items.filter.slot')}</span>
          <select
            aria-label={t(locale, 'items.filter.slot')}
            value={slot}
            onChange={(event) => setSlot(event.target.value)}
          >
            <option value="">—</option>
            {slots.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <label className="pob-item-library__filter">
          <span className="pob-item-library__filter-label">{t(locale, 'items.filter.type')}</span>
          <select
            aria-label={t(locale, 'items.filter.type')}
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">—</option>
            {types.map((ty) => (
              <option key={ty} value={ty}>
                {ty}
              </option>
            ))}
          </select>
        </label>

        <label className="pob-item-library__filter">
          <span className="pob-item-library__filter-label">
            {t(locale, 'items.filter.requirements')}
          </span>
          <input
            type="number"
            min={0}
            aria-label={t(locale, 'items.filter.requirements')}
            value={maxLevel}
            onChange={(event) => setMaxLevel(event.target.value)}
          />
        </label>
      </div>

      <ul className="pob-item-library__results" role="list">
        {results.map((item) => (
          <li
            key={item.itemId}
            className="pob-item-library__row"
            role="listitem"
            data-library-row
            data-item-id={item.itemId}
            onClick={() => onSelect?.(item.itemId)}
          >
            <span className="pob-item-library__row-name" data-rarity={item.rarity.toLowerCase()}>
              {item.name}
            </span>
            <span className="pob-item-library__row-base">{item.baseType}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
