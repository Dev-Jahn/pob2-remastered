/**
 * SkillGroupCard + GemRow — one §10.5 Skills tab card (DESIGN §10.5 "skill group을
 * 카드 단위로 표시"):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [x] Fireball                  Spirit 0 · Res 0│   ← group toggle + costs
 *   │ ─────────────────────────────────────────────│
 *   │ [⚔ Active]   Fireball           L20 · Q23  [x]│   ← active gem chip + toggle
 *   │ [+ Support]  Added Fire Damage  L20 · Q0   [x]│   ← support gem chip + toggle
 *   └──────────────────────────────────────────────┘
 *
 * Renders a {@link SkillGroupCardModel} from the p4-skills-vm. The §10.5
 * `active/support/buff/aura/minion` distinction rides on a `data-category`
 * attribute (a stable lowercase key, styleable) AND a localized category-chip
 * text label — never on colour alone (§11.3). The group `enabled` toggle and the
 * §10.5 reservation / spirit costs are surfaced immediately on the card head; each
 * gem (active or support) carries its own enabled toggle.
 *
 * §11.3 (unsupported gem accessibility): an active gem with no category metadata
 * resolved to an `unsupported` chip in the view-model; here that chip renders a
 * non-colour icon glyph AND the localized "Unsupported" text label, so the
 * distinction survives for colour-blind users.
 *
 * The card is selectable: a `data-skill-group-select` control fires `onSelectGroup`
 * so the host can route the group's active skill into the §10.5 inspector. All
 * labels resolve through the i18n resolver `t` (§8.1). The component is pure props:
 * it owns no state and performs no IO (toggles are reported upward as callbacks).
 */
import { t } from '../i18n/index.js';
import type { Locale, StringKey } from '../i18n/index.js';
import type { GemChipCategory, SkillGemChip, SkillGroupCardModel } from './skills-model.js';

/**
 * Non-colour glyph per gem category (§11.3: the icon carries meaning on its own,
 * not colour). `unsupported` uses the warning glyph the rest of the UI uses for a
 * line the core could not resolve (§6.4).
 */
const CATEGORY_ICON: Record<GemChipCategory, string> = {
  active: '⚔',
  support: '＋',
  buff: '✦',
  aura: '◎',
  minion: '☗',
  unsupported: '⚠',
};

/** i18n key for each gem-category chip label (DESIGN §10.5 구분 chip). */
const CATEGORY_KEY: Record<GemChipCategory, StringKey> = {
  active: 'skills.category.active',
  support: 'skills.category.support',
  buff: 'skills.category.buff',
  aura: 'skills.category.aura',
  minion: 'skills.category.minion',
  unsupported: 'skills.category.unsupported',
};

export interface GemRowProps {
  /** Active locale, drives the category-chip and level/quality labels. */
  locale: Locale;
  /** The classified gem chip to render. */
  chip: SkillGemChip;
  /** Called with the gem id when the gem's enabled toggle is pressed. */
  onToggleGem?: (gemId: string) => void;
}

/**
 * One classified gem chip on a §10.5 card: its category chip (icon + text label,
 * never colour-only per §11.3), the gem name, its level/quality, and an enabled
 * toggle. Level / quality are rendered verbatim — a real `0` is shown, never
 * coerced away (§6.4 NO-FALLBACK).
 */
export function GemRow({ locale, chip, onToggleGem }: GemRowProps) {
  return (
    <div className="pob-gem-row" data-gem-row data-category={chip.category}>
      <span className="pob-gem-row__chip" data-gem-chip>
        <span className="pob-gem-row__chip-icon" data-category-icon aria-hidden="true">
          {CATEGORY_ICON[chip.category]}
        </span>
        <span className="pob-gem-row__chip-label" data-category-label>
          {t(locale, CATEGORY_KEY[chip.category])}
        </span>
      </span>
      <span className="pob-gem-row__name">{chip.name}</span>
      <span className="pob-gem-row__stats">
        <span className="pob-gem-row__level" data-gem-level>
          {t(locale, 'skills.gem.level')} {chip.level}
        </span>
        <span className="pob-gem-row__quality" data-gem-quality>
          {t(locale, 'skills.gem.quality')} {chip.quality}
        </span>
      </span>
      <label className="pob-gem-row__toggle">
        <span className="pob-visually-hidden">{t(locale, 'skills.gem.enabled')}</span>
        <input
          type="checkbox"
          data-gem-toggle
          checked={chip.enabled}
          onChange={() => onToggleGem?.(chip.gemId)}
        />
      </label>
    </div>
  );
}

export interface SkillGroupCardProps {
  /** Active locale, drives every label on the card. */
  locale: Locale;
  /** The §10.5 skill-group card model to render. */
  card: SkillGroupCardModel;
  /** Whether this card is the selected main skill (drives `data-selected`). */
  selected?: boolean;
  /** Called with the group id when the card is selected (routes to inspector). */
  onSelectGroup?: (groupId: string) => void;
  /** Called with the group id when the group's enabled toggle is pressed. */
  onToggleGroup?: (groupId: string) => void;
  /** Called with (groupId, gemId) when a gem's enabled toggle is pressed. */
  onToggleGem?: (groupId: string, gemId: string) => void;
}

export function SkillGroupCard(props: SkillGroupCardProps) {
  const { locale, card, selected } = props;
  const groupId = card.groupId;
  return (
    <article
      className="pob-skill-group"
      data-skill-group
      data-group-id={groupId}
      data-selected={selected ? 'true' : undefined}
    >
      <header className="pob-skill-group__head">
        <label className="pob-skill-group__enabled">
          <span className="pob-visually-hidden">{t(locale, 'skills.group.enabled')}</span>
          <input
            type="checkbox"
            data-group-toggle
            checked={card.enabled}
            onChange={() => props.onToggleGroup?.(groupId)}
          />
        </label>
        <button
          type="button"
          className="pob-skill-group__select"
          data-skill-group-select
          onClick={() => props.onSelectGroup?.(groupId)}
        >
          {card.label}
        </button>
        <span className="pob-skill-group__costs">
          <span className="pob-skill-group__cost" data-cost="spirit">
            <span className="pob-skill-group__cost-label">{t(locale, 'skills.spirit')}</span>{' '}
            <span className="pob-skill-group__cost-value">{card.spirit}</span>
          </span>
          <span className="pob-skill-group__cost" data-cost="reservation">
            <span className="pob-skill-group__cost-label">{t(locale, 'skills.reservation')}</span>{' '}
            <span className="pob-skill-group__cost-value">{card.reservation}</span>
          </span>
        </span>
      </header>

      <div className="pob-skill-group__gems">
        {card.chips.map((chip: SkillGemChip) => (
          <GemRow
            key={chip.gemId}
            locale={locale}
            chip={chip}
            onToggleGem={(gemId) => props.onToggleGem?.(groupId, gemId)}
          />
        ))}
      </div>
    </article>
  );
}
