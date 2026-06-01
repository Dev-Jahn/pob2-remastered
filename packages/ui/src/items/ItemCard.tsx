/**
 * ItemCard — one §10.4 Item card (DESIGN §10.4 "Item card"):
 *
 *   ┌─────────────────────────────┐
 *   │ [icon] Sorrow Sole          │   ← icon placeholder + name
 *   │ Hunting Shoes               │   ← base type
 *   │ Rare · Boots                │   ← rarity (data-rarity, NOT color-only)
 *   │ Armour 45 · Evasion 120     │   ← mod summary
 *   │ +12.4% DPS  -3.1% EHP       │   ← +DPS / -EHP equip-delta chips
 *   │ [Fire Res] [Move Speed]     │
 *   └─────────────────────────────┘
 *
 * Renders an {@link EquippedItemCard} view-model body. The rarity is exposed as a
 * `data-rarity` attribute (the stable lowercase color key) so a stylesheet can
 * colour the card without meaning ever riding on colour alone. Requirement chips
 * carry their machine `data-requirement` kind; the §10.4 +DPS/-EHP delta chips
 * carry `data-delta-stat` + `data-direction` (gain / loss / neutral / missing) so
 * a renderer can sign/colour them. The whole card is a button-role region that
 * calls `onSelect(itemId)` so a host can route it into the inspector.
 *
 * NO-FALLBACK (DESIGN §6.4): the view-model already dropped 0-valued requirements
 * and never fabricated deltas; this component only renders what it was handed. A
 * `missing` delta chip shows a distinct marker, never a fabricated "0".
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { EquippedItemCard, RequirementChip } from './equipped-model.js';
import type { DeltaChip } from './delta-model.js';

/** Distinct marker for a delta the core never returned (§6.4 NO-FALLBACK). */
const MISSING_MARKER = '—';

/** i18n key for each requirement-chip kind (e.g. "Level", "Str"). */
const REQUIREMENT_KEY = {
  level: 'items.req.level',
  str: 'items.req.str',
  dex: 'items.req.dex',
  int: 'items.req.int',
} as const;

export interface ItemCardProps {
  /** Active locale, drives the requirement-chip labels. */
  locale: Locale;
  /** The §10.4 item-card body to render. */
  item: EquippedItemCard;
  /** Called with the item id when the card is selected (routes to inspector). */
  onSelect?: (itemId: string) => void;
}

/** Render a signed delta magnitude, e.g. `+12.4` / `-31`. A 0 reads `0`. */
function signedDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function DeltaChipView({ chip }: { chip: DeltaChip }) {
  return (
    <span
      className="pob-item-card__delta"
      data-delta-stat={chip.statId}
      data-direction={chip.direction}
    >
      <span className="pob-item-card__delta-stat">{chip.statId}</span>
      <span className="pob-item-card__delta-value">
        {chip.missing ? MISSING_MARKER : signedDelta(chip.delta ?? 0)}
      </span>
    </span>
  );
}

function RequirementChipView({ chip, locale }: { chip: RequirementChip; locale: Locale }) {
  return (
    <span className="pob-item-card__req" data-requirement={chip.kind}>
      {t(locale, REQUIREMENT_KEY[chip.kind])} {chip.value}
    </span>
  );
}

export function ItemCard({ locale, item, onSelect }: ItemCardProps) {
  return (
    <button
      type="button"
      className="pob-item-card"
      data-item-card
      data-rarity={item.rarityColorKey}
      onClick={() => onSelect?.(item.itemId)}
    >
      <div className="pob-item-card__head">
        <span className="pob-item-card__icon" data-item-icon aria-hidden="true" />
        <span className="pob-item-card__name">{item.name}</span>
      </div>
      <div className="pob-item-card__base">{item.baseType}</div>

      {item.requirementChips.length > 0 ? (
        <div className="pob-item-card__reqs">
          {item.requirementChips.map((chip) => (
            <RequirementChipView key={chip.kind} chip={chip} locale={locale} />
          ))}
        </div>
      ) : null}

      {item.modSummary.length > 0 ? (
        <ul className="pob-item-card__mods" role="list">
          {item.modSummary.map((mod, i) => (
            <li key={i} className="pob-item-card__mod" role="listitem">
              {mod}
            </li>
          ))}
        </ul>
      ) : null}

      {item.deltaChips.length > 0 ? (
        <div className="pob-item-card__deltas">
          {item.deltaChips.map((chip) => (
            <DeltaChipView key={chip.statId} chip={chip} />
          ))}
        </div>
      ) : null}
    </button>
  );
}
