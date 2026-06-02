/**
 * ItemsPanel — the §10.4 Items tab 3-region layout (DESIGN §10.4 레이아웃):
 *
 *   ┌ header toolbar: [Item Set ▼] [Import from Clipboard] [Craft] [Trade] ┐
 *   ├──────────────────┬───────────────────────┬──────────────────────────┤
 *   │ Equipped Gear    │ Item Library          │ Inspector                │
 *   │ (slot card grid) │ (search + filters)    │ (selected item)          │
 *   └──────────────────┴───────────────────────┴──────────────────────────┘
 *
 * The three regions carry `data-region="equipped|library|inspector"` so the
 * layout is machine-checkable. The panel owns only the *selected item* state:
 * clicking an equipped {@link ItemCard} (or a library row) routes that item into
 * the {@link ItemInspector}. Everything else — the grid model, the library rows,
 * the item-set list — is supplied by the host (this panel stays free of app/IO
 * coupling, like the Overview panel). All chrome text resolves through `t` (§8.1).
 */
import { useMemo, useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { ItemCard } from './ItemCard.js';
import { ItemLibrary } from './ItemLibrary.js';
import { ItemInspector } from './ItemInspector.js';
import type { InspectedItem } from './ItemInspector.js';
import { ItemSetSelector } from './ItemSetSelector.js';
import type { ItemSetOption } from './ItemSetSelector.js';
import type { EquippedGridModel, ItemCardModel, EquippedItemCard } from './equipped-model.js';
import type { LibraryItem } from './library-search.js';

export interface ItemsPanelProps {
  /** Active locale, drives every label across the three regions. */
  locale: Locale;
  /** The equipped-gear grid model (slot-ordered §10.4 cards). */
  grid: EquippedGridModel;
  /** The item library to search in the middle region. */
  library: LibraryItem[];
  /** The item sets for the header selector (DESIGN §10.4 header toolbar). */
  itemSets: ItemSetOption[];
  /** Active item-set id (controlled by the host). */
  activeSetId: string;
  /**
   * An item to show in the inspector when nothing in the grid/library is selected
   * (DESIGN §10.4 inspector, §8.6 clipboard import). The host supplies the last
   * clipboard-imported item here; a subsequent grid/library click takes precedence
   * over it. Absent until the host has an item to inspect (NO-FALLBACK, §6.4).
   */
  inspectedItem?: InspectedItem;
  /** Header toolbar callbacks. */
  onChangeSet?: (setId: string) => void;
  onImportFromClipboard?: () => void;
  onCraft?: () => void;
  onTrade?: () => void;
}

/** Map a §10.4 equipped item-card body (in `slot`) to the inspector's view of it. */
function toInspected(card: EquippedItemCard, slot: string): InspectedItem {
  return {
    itemId: card.itemId,
    name: card.name,
    baseType: card.baseType,
    rarityColorKey: card.rarityColorKey,
    sourceText: [card.name, card.baseType, ...card.modSummary, ...card.unsupportedMods].join('\n'),
    translatedText: [card.name, card.baseType, ...card.modSummary].join('\n'),
    parsedMods: card.modSummary,
    unsupportedMods: card.unsupportedMods,
    slot,
  };
}

export function ItemsPanel(props: ItemsPanelProps) {
  const { locale, grid, library, itemSets, activeSetId } = props;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  // Every occupied slot card, indexed by item id, so a selection resolves to the
  // card body *and* its slot (the inspector's slot selector needs the slot).
  const cardById = useMemo(() => {
    const map = new Map<string, ItemCardModel>();
    for (const card of grid.cards) {
      if (card.item) map.set(card.item.itemId, card);
    }
    return map;
  }, [grid]);

  const selectedCard = selectedId ? cardById.get(selectedId) : undefined;
  // A grid/library selection takes precedence; otherwise fall back to the host's
  // externally-supplied item (e.g. the last clipboard import, §8.6).
  const inspectedItem =
    selectedCard?.item !== undefined
      ? toInspected(selectedCard.item, selectedCard.slot)
      : props.inspectedItem;

  return (
    <div className="pob-items">
      <div className="pob-items__toolbar">
        <ItemSetSelector
          locale={locale}
          sets={itemSets}
          activeSetId={activeSetId}
          onChange={props.onChangeSet}
        />
        {/* Render each toolbar action ONLY when the host wired its callback, so an
            unimplemented action (Craft/Trade) shows no dead button (review follow-up). */}
        {props.onImportFromClipboard && (
          <button type="button" className="pob-items__tool" onClick={props.onImportFromClipboard}>
            {t(locale, 'items.importFromClipboard')}
          </button>
        )}
        {props.onCraft && (
          <button type="button" className="pob-items__tool" onClick={props.onCraft}>
            {t(locale, 'items.craft')}
          </button>
        )}
        {props.onTrade && (
          <button type="button" className="pob-items__tool" onClick={props.onTrade}>
            {t(locale, 'items.trade')}
          </button>
        )}
      </div>

      <div className="pob-items__regions">
        <section className="pob-items__region pob-items__equipped" data-region="equipped">
          <h3 className="pob-items__region-title">{t(locale, 'items.equippedGear')}</h3>
          <div className="pob-items__grid">
            {grid.cards.map((card) => (
              <div
                key={card.slot}
                className="pob-items__slot"
                data-slot={card.slot}
                data-occupied={card.occupied ? 'true' : undefined}
              >
                <span className="pob-items__slot-label">{t(locale, card.slotKey)}</span>
                {card.item ? (
                  <ItemCard locale={locale} item={card.item} onSelect={setSelectedId} />
                ) : (
                  <div className="pob-items__slot-empty" data-slot-empty aria-hidden="true" />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="pob-items__region pob-items__library" data-region="library">
          <h3 className="pob-items__region-title">{t(locale, 'items.library')}</h3>
          <ItemLibrary locale={locale} items={library} onSelect={setSelectedId} />
        </section>

        <section className="pob-items__region pob-items__inspector" data-region="inspector">
          <h3 className="pob-items__region-title">{t(locale, 'items.inspector')}</h3>
          <ItemInspector locale={locale} item={inspectedItem} />
        </section>
      </div>
    </div>
  );
}
