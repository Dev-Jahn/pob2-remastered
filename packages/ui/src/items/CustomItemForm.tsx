/**
 * CustomItemForm — the §10.4 custom-item creation control (DESIGN §10.4 custom item
 * creation, §6.3 items.createCustom): a base-item selector + a modifier textarea.
 *
 * The host owns the create call (via {@link useItemsTab}'s `createCustom`); this
 * component collects the chosen base id and the typed modifier lines and hands them
 * up through `onCreate(baseId, mods)`. Each non-empty, trimmed line becomes one
 * {@link ItemModInput} (`{ text }`); blank lines are dropped so an empty modifier is
 * never created (DESIGN §6.4 NO-FALLBACK).
 *
 * With no base available there is nothing to create — `onCreate` is not called (a
 * fabricated base id would be a wrong guess, §6.4). All chrome resolves through the
 * i18n resolver `t` (§8.1).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { ItemModInput } from '@pob2/schema';

/** One selectable item base for the §10.4 custom-item base selector. */
export interface ItemBaseOption {
  id: string;
  name: string;
}

export interface CustomItemFormProps {
  /** Active locale, drives every label. */
  locale: Locale;
  /** The item bases to choose from (DESIGN §10.4 "base 선택"). */
  bases: ItemBaseOption[];
  /** Called with the chosen base id + the parsed mod inputs on create. */
  onCreate: (baseId: string, mods: ItemModInput[]) => void;
}

/** Split a modifier textarea into one ItemModInput per non-empty trimmed line. */
function parseMods(raw: string): ItemModInput[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((text) => ({ text }));
}

export function CustomItemForm({ locale, bases, onCreate }: CustomItemFormProps) {
  // Default to the first base when one exists; '' (no base) when the list is empty.
  const [baseId, setBaseId] = useState(bases[0]?.id ?? '');
  const [modText, setModText] = useState('');

  const baseLabel = t(locale, 'items.custom.base');
  const modsLabel = t(locale, 'items.custom.mods');

  function handleCreate() {
    // No base chosen → nothing to create (NO-FALLBACK, §6.4).
    if (baseId === '') return;
    onCreate(baseId, parseMods(modText));
  }

  return (
    <div className="pob-custom-item" data-custom-item-form>
      <h4 className="pob-custom-item__title">{t(locale, 'items.custom.title')}</h4>

      <label className="pob-custom-item__field">
        <span className="pob-custom-item__label">{baseLabel}</span>
        <select
          className="pob-custom-item__base"
          aria-label={baseLabel}
          value={baseId}
          onChange={(event) => setBaseId(event.target.value)}
        >
          {bases.map((base) => (
            <option key={base.id} value={base.id}>
              {base.name}
            </option>
          ))}
        </select>
      </label>

      <label className="pob-custom-item__field">
        <span className="pob-custom-item__label">{modsLabel}</span>
        <textarea
          className="pob-custom-item__mods"
          aria-label={modsLabel}
          value={modText}
          onChange={(event) => setModText(event.target.value)}
        />
      </label>

      <button type="button" className="pob-custom-item__create" onClick={handleCreate}>
        {t(locale, 'items.custom.create')}
      </button>
    </div>
  );
}
