/**
 * ItemInspector — the §10.4 Item inspector column (DESIGN §10.4 "Item inspector"):
 * original text, Korean translated text, parsed + unsupported affix lines (each
 * with a parsed/unsupported badge), a roll-range editor placeholder, an equip-slot
 * selector, and the compare / craft / duplicate / delete / share action group.
 *
 * §11.3 (unsupported modifier accessibility): the unsupported badge is NOT
 * colour-only — every unsupported affix carries a non-colour icon glyph AND the
 * localized "Unsupported" text label, so the distinction survives for colour-blind
 * users; the verbatim source line is echoed beside it (§8.6 "원문 보존"). All section
 * headers, badge labels, slot-selector label, and action labels resolve through
 * the i18n resolver `t` (§8.1).
 *
 * With no item selected the inspector renders a localized empty-state hint
 * (`data-inspector-empty`) rather than a blank pane.
 */
import { t } from '../i18n/index.js';
import type { Locale, StringKey } from '../i18n/index.js';
import { EQUIP_SLOT_ORDER } from './equipped-model.js';
import type { EquipSlot } from './equipped-model.js';

/** Non-colour glyphs for the affix badges (§11.3: icon carries meaning, not colour). */
const PARSED_ICON = '✓';
const UNSUPPORTED_ICON = '⚠';

/**
 * The inspector's view of the selected item. Carries the §10.4 inspector fields:
 * identity, the verbatim source + Korean translated text, the parsed vs
 * unsupported mod lines (kept separate per §8.6), and the current equip slot.
 */
export interface InspectedItem {
  itemId: string;
  name: string;
  baseType: string;
  /** Stable lowercase rarity color key (styling hook, not colour-only meaning). */
  rarityColorKey: string;
  /** Verbatim clipboard source text (DESIGN §10.4 "원문 텍스트", §8.6). */
  sourceText: string;
  /** Korean translated text (DESIGN §10.4 "한국어 번역 텍스트"). */
  translatedText: string;
  /** Recognised mod lines (DESIGN §10.4 "internal parsed mods"). */
  parsedMods: string[];
  /** Lines the parser could not recognise (DESIGN §10.4 "unsupported mods", §8.6). */
  unsupportedMods: string[];
  /** Current equip slot, pre-selects the slot selector. */
  slot: string;
}

export interface ItemInspectorProps {
  /** Active locale, drives every label. */
  locale: Locale;
  /** The selected item, or `undefined` for the empty state. */
  item: InspectedItem | undefined;
  /** Called with the chosen slot when the slot selector changes. */
  onChangeSlot?: (itemId: string, slot: string) => void;
  /** Inspector action callbacks (DESIGN §10.4 action group). */
  onCompare?: (itemId: string) => void;
  onCraftFromBase?: (itemId: string) => void;
  onDuplicate?: (itemId: string) => void;
  onDelete?: (itemId: string) => void;
  onShare?: (itemId: string) => void;
}

/** A labeled block of multi-line verbatim text (original / Korean). */
function TextSection({
  titleKey,
  text,
  locale,
}: {
  titleKey: StringKey;
  text: string;
  locale: Locale;
}) {
  return (
    <section className="pob-item-inspector__text">
      <h4 className="pob-item-inspector__section-title">{t(locale, titleKey)}</h4>
      <pre className="pob-item-inspector__source">{text}</pre>
    </section>
  );
}

/** One affix line with its parsed/unsupported badge (icon + text label, §11.3). */
function AffixLine({
  line,
  state,
  locale,
}: {
  line: string;
  state: 'parsed' | 'unsupported';
  locale: Locale;
}) {
  const icon = state === 'parsed' ? PARSED_ICON : UNSUPPORTED_ICON;
  const labelKey: StringKey = state === 'parsed' ? 'items.badge.parsed' : 'items.badge.unsupported';
  return (
    <li className="pob-item-inspector__affix" role="listitem" data-affix={state}>
      <span className="pob-item-inspector__badge" data-affix-badge>
        <span className="pob-item-inspector__badge-icon" data-affix-icon aria-hidden="true">
          {icon}
        </span>
        <span className="pob-item-inspector__badge-label" data-affix-label>
          {t(locale, labelKey)}
        </span>
      </span>
      <span className="pob-item-inspector__affix-text">{line}</span>
    </li>
  );
}

export function ItemInspector(props: ItemInspectorProps) {
  const { locale, item } = props;

  if (item === undefined) {
    return (
      <section className="pob-item-inspector" aria-label={t(locale, 'items.inspector')}>
        <p className="pob-item-inspector__empty" data-inspector-empty>
          {t(locale, 'items.inspector.empty')}
        </p>
      </section>
    );
  }

  const id = item.itemId;
  return (
    <section className="pob-item-inspector" aria-label={t(locale, 'items.inspector')}>
      <header className="pob-item-inspector__header" data-rarity={item.rarityColorKey}>
        <span className="pob-item-inspector__name">{item.name}</span>
        <span className="pob-item-inspector__base">{item.baseType}</span>
      </header>

      <TextSection titleKey="items.inspector.sourceText" text={item.sourceText} locale={locale} />
      <TextSection
        titleKey="items.inspector.translatedText"
        text={item.translatedText}
        locale={locale}
      />

      <section className="pob-item-inspector__affixes">
        <h4 className="pob-item-inspector__section-title">
          {t(locale, 'items.inspector.parsedMods')}
        </h4>
        <ul className="pob-item-inspector__affix-list" role="list">
          {item.parsedMods.map((line, i) => (
            <AffixLine key={`p-${i}`} line={line} state="parsed" locale={locale} />
          ))}
          {item.unsupportedMods.map((line, i) => (
            <AffixLine key={`u-${i}`} line={line} state="unsupported" locale={locale} />
          ))}
        </ul>
      </section>

      <section className="pob-item-inspector__roll">
        <h4 className="pob-item-inspector__section-title">
          {t(locale, 'items.inspector.rollRange')}
        </h4>
        {/* Roll-range editor placeholder (DESIGN §10.4 "roll range editor"). */}
        <div
          className="pob-item-inspector__roll-editor"
          data-roll-range-editor
          aria-disabled="true"
        />
      </section>

      <label className="pob-item-inspector__slot">
        <span className="pob-item-inspector__section-title">
          {t(locale, 'items.action.changeSlot')}
        </span>
        <select
          aria-label={t(locale, 'items.action.changeSlot')}
          value={item.slot}
          onChange={(event) => props.onChangeSlot?.(id, event.target.value)}
        >
          {EQUIP_SLOT_ORDER.map((slot: EquipSlot) => (
            <option key={slot} value={slot}>
              {slot}
            </option>
          ))}
        </select>
      </label>

      <div
        className="pob-item-inspector__actions"
        role="group"
        aria-label={t(locale, 'items.inspector')}
      >
        <button type="button" data-action="compare" onClick={() => props.onCompare?.(id)}>
          {t(locale, 'items.action.compare')}
        </button>
        <button type="button" data-action="craft" onClick={() => props.onCraftFromBase?.(id)}>
          {t(locale, 'items.action.craftFromBase')}
        </button>
        <button type="button" data-action="duplicate" onClick={() => props.onDuplicate?.(id)}>
          {t(locale, 'items.action.duplicate')}
        </button>
        <button type="button" data-action="delete" onClick={() => props.onDelete?.(id)}>
          {t(locale, 'items.action.delete')}
        </button>
        <button type="button" data-action="share" onClick={() => props.onShare?.(id)}>
          {t(locale, 'items.action.share')}
        </button>
      </div>
    </section>
  );
}
