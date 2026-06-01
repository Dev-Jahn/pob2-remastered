// Items tab component test (DESIGN §10.4 Items tab redesign; §11.3 unsupported
// mod accessibility; §8.1 ko/en alias; §6.4 NO-FALLBACK).
//
// These are the React components that render the Items view-models:
//
//   - ItemsPanel  — the §10.4 3-region layout (Equipped Gear grid | Item Library
//     search | Inspector), plus the header toolbar (ItemSetSelector + clipboard
//     import + craft/trade).
//   - ItemCard    — one §10.4 item card: rarity color key (as a data attribute,
//     never color-only), icon placeholder, base type, requirement chips, mod
//     summary, and the +DPS / -EHP equip-delta chips.
//   - ItemLibrary — the search box + slot/type/req filters + a result list that
//     renders the rows filterItems() returns (virtualization-ready: a flat,
//     keyed list the host can swap for a windowed renderer).
//   - ItemInspector — the selected item's original/Korean text, the
//     parsed/unsupported affix badges (icon + text label, §11.3), a roll-range
//     editor placeholder, a slot selector, and the compare/craft/duplicate/
//     delete/share action group.
//   - ItemSetSelector — the header item-set <select>.
//
// The fixtures mirror the §10.4 Item card example (Sorrow Sole / Hunting Shoes):
// a Rare pair of boots with both a recognised mod summary and an unsupported
// line, so the inspector must show the unsupported badge with an icon AND a text
// label (never color-only, §11.3), and the card must carry both a +DPS gain and
// a -EHP loss delta chip.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import type { EquippedItem } from '@pob2/schema';
import {
  buildEquippedGridModel,
  buildEquipDeltaModel,
  ItemsPanel,
  ItemCard,
  ItemLibrary,
  ItemInspector,
  ItemSetSelector,
  t,
} from '../src/index.js';
import type {
  EquippedGridModel,
  EquipDeltaByItemId,
  LibraryItem,
  ItemSetOption,
} from '../src/index.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOOTS: EquippedItem = {
  slot: 'Boots',
  itemId: 'item-boots-1',
  name: 'Sorrow Sole',
  rarity: 'Rare',
  baseName: 'Hunting Shoes',
  requirements: { level: 33, str: 0, dex: 62, int: 0 },
  summaryMods: ['+18% to Fire Resistance', '25% increased Movement Speed'],
  unsupportedMods: ['Mirror something the parser cannot read'],
};

// Per-item equip delta: a +DPS gain and a -EHP loss (the §10.4 +DPS/-EHP chips).
const DELTAS: EquipDeltaByItemId = {
  'item-boots-1': buildEquipDeltaModel(
    [
      { statId: 'TotalDPS', before: 100, after: 112.4, delta: 12.4 },
      { statId: 'TotalEHP', before: 1000, after: 969, delta: -31 },
    ],
    undefined,
  ),
};

const GRID: EquippedGridModel = buildEquippedGridModel([BOOTS], DELTAS);
const BOOTS_CARD = GRID.cards.find((c) => c.slot === 'Boots')!.item!;

const LIBRARY: LibraryItem[] = [
  {
    itemId: 'lib-boots',
    name: 'Sorrow Sole',
    nameKo: '슬픔의 밑창',
    baseType: 'Hunting Shoes',
    baseTypeKo: '사냥 장화',
    slot: 'Boots',
    type: 'Boots',
    rarity: 'Rare',
    requirements: { level: 33, str: 0, dex: 62, int: 0 },
  },
  {
    itemId: 'lib-helm',
    name: 'Iron Hat',
    nameKo: '철 모자',
    baseType: 'Iron Hat',
    baseTypeKo: '철 모자',
    slot: 'Helmet',
    type: 'Helmet',
    rarity: 'Normal',
    requirements: { level: 0, str: 0, dex: 0, int: 0 },
  },
];

const ITEM_SETS: ItemSetOption[] = [
  { id: 'set-default', name: 'Default' },
  { id: 'set-bossing', name: 'Bossing' },
];

// ---------------------------------------------------------------------------
// ItemCard (DESIGN §10.4 Item card)
// ---------------------------------------------------------------------------

describe('ItemCard (DESIGN §10.4 Item card)', () => {
  it('renders the name, base type, and the rarity color key as a data attribute', () => {
    const { container } = render(<ItemCard locale="ko-KR" item={BOOTS_CARD} />);
    expect(screen.getByText('Sorrow Sole')).toBeTruthy();
    expect(screen.getByText('Hunting Shoes')).toBeTruthy();
    // Rarity drives a data attribute (styleable) — never color alone.
    const card = container.querySelector('[data-rarity="rare"]');
    expect(card).toBeTruthy();
  });

  it('renders an icon placeholder (DESIGN §10.4 [icon])', () => {
    const { container } = render(<ItemCard locale="ko-KR" item={BOOTS_CARD} />);
    expect(container.querySelector('[data-item-icon]')).toBeTruthy();
  });

  it('renders a requirement chip per required attribute, none for a 0 requirement (§6.4)', () => {
    const { container } = render(<ItemCard locale="ko-KR" item={BOOTS_CARD} />);
    const chips = container.querySelectorAll('[data-requirement]');
    // Boots require level 33 + dex 62; str/int are 0 → no chip.
    const kinds = Array.from(chips).map((c) => c.getAttribute('data-requirement'));
    expect(kinds).toContain('level');
    expect(kinds).toContain('dex');
    expect(kinds).not.toContain('str');
    expect(kinds).not.toContain('int');
  });

  it('renders the recognised mod summary lines', () => {
    render(<ItemCard locale="ko-KR" item={BOOTS_CARD} />);
    expect(screen.getByText('+18% to Fire Resistance')).toBeTruthy();
    expect(screen.getByText('25% increased Movement Speed')).toBeTruthy();
  });

  it('renders a +DPS gain delta chip and a -EHP loss delta chip with their direction', () => {
    const { container } = render(<ItemCard locale="ko-KR" item={BOOTS_CARD} />);
    const gain = container.querySelector('[data-delta-stat="TotalDPS"]') as HTMLElement;
    const loss = container.querySelector('[data-delta-stat="TotalEHP"]') as HTMLElement;
    expect(gain).toBeTruthy();
    expect(loss).toBeTruthy();
    expect(gain.getAttribute('data-direction')).toBe('gain');
    expect(loss.getAttribute('data-direction')).toBe('loss');
    // The signed magnitudes are shown verbatim (NO-FALLBACK: real values).
    expect(gain.textContent).toContain('12.4');
    expect(loss.textContent).toContain('31');
  });

  it('fires onSelect with the item id when clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(<ItemCard locale="ko-KR" item={BOOTS_CARD} onSelect={onSelect} />);
    fireEvent.click(container.querySelector('[data-item-card]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('item-boots-1');
  });
});

// ---------------------------------------------------------------------------
// ItemLibrary (DESIGN §10.4 Item Library: search + filters + result list)
// ---------------------------------------------------------------------------

describe('ItemLibrary (DESIGN §10.4 Item Library)', () => {
  it('renders a search box and slot/type/requirement filter controls', () => {
    render(<ItemLibrary locale="ko-KR" items={LIBRARY} />);
    expect(screen.getByPlaceholderText(t('ko-KR', 'items.search.placeholder'))).toBeTruthy();
    // The three §10.4 filters are present (slot / type / requirements).
    expect(screen.getByLabelText(t('ko-KR', 'items.filter.slot'))).toBeTruthy();
    expect(screen.getByLabelText(t('ko-KR', 'items.filter.type'))).toBeTruthy();
  });

  it('renders one result row per library item by default (no filter)', () => {
    const { container } = render(<ItemLibrary locale="ko-KR" items={LIBRARY} />);
    expect(container.querySelectorAll('[data-library-row]')).toHaveLength(2);
  });

  it('narrows the result list by the free-text search (ko↔en parallel, §10.1)', () => {
    const { container } = render(<ItemLibrary locale="ko-KR" items={LIBRARY} />);
    const search = screen.getByPlaceholderText(
      t('ko-KR', 'items.search.placeholder'),
    ) as HTMLInputElement;
    // A Korean token matches the row whose Korean name carries it.
    fireEvent.change(search, { target: { value: '슬픔' } });
    const rows = container.querySelectorAll('[data-library-row]');
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).getAttribute('data-item-id')).toBe('lib-boots');
  });

  it('narrows the result list by the slot filter', () => {
    const { container } = render(<ItemLibrary locale="ko-KR" items={LIBRARY} />);
    fireEvent.change(screen.getByLabelText(t('ko-KR', 'items.filter.slot')), {
      target: { value: 'Helmet' },
    });
    const rows = container.querySelectorAll('[data-library-row]');
    expect(rows).toHaveLength(1);
    expect((rows[0] as HTMLElement).getAttribute('data-item-id')).toBe('lib-helm');
  });

  it('fires onSelect with the item id when a result row is clicked', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <ItemLibrary locale="ko-KR" items={LIBRARY} onSelect={onSelect} />,
    );
    fireEvent.click(container.querySelector('[data-item-id="lib-boots"]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('lib-boots');
  });
});

// ---------------------------------------------------------------------------
// ItemInspector (DESIGN §10.4 Item inspector)
// ---------------------------------------------------------------------------

describe('ItemInspector (DESIGN §10.4 Item inspector, §11.3)', () => {
  const INSPECTED = {
    itemId: 'item-boots-1',
    name: 'Sorrow Sole',
    baseType: 'Hunting Shoes',
    rarityColorKey: 'rare',
    sourceText: 'Sorrow Sole\nHunting Shoes\n+18% to Fire Resistance',
    translatedText: '슬픔의 밑창\n사냥 장화\n+18% 화염 저항',
    parsedMods: ['+18% to Fire Resistance', '25% increased Movement Speed'],
    unsupportedMods: ['Mirror something the parser cannot read'],
    slot: 'Boots',
  };

  it('renders the original source text and the Korean translated text', () => {
    render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    // English name appears in the header + the verbatim source block.
    expect(screen.getAllByText(/Sorrow Sole/).length).toBeGreaterThan(0);
    // The Korean translated text block carries the localized name.
    expect(screen.getByText(/슬픔의 밑창/)).toBeTruthy();
  });

  it('marks every parsed mod with the parsed badge', () => {
    const { container } = render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    const parsed = container.querySelectorAll('[data-affix="parsed"]');
    expect(parsed).toHaveLength(2);
  });

  it('marks an unsupported mod with an icon AND a text label — never color-only (§11.3)', () => {
    const { container } = render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    const unsupported = container.querySelector('[data-affix="unsupported"]') as HTMLElement;
    expect(unsupported).toBeTruthy();
    // A non-color icon glyph...
    const icon = unsupported.querySelector('[data-affix-icon]');
    expect(icon).toBeTruthy();
    expect((icon as HTMLElement).textContent?.trim().length).toBeGreaterThan(0);
    // ...AND a localized "Unsupported" text label, so meaning is not color-only.
    expect(within(unsupported).getByText(t('ko-KR', 'items.badge.unsupported'))).toBeTruthy();
    // The verbatim unsupported line is echoed.
    expect(within(unsupported).getByText('Mirror something the parser cannot read')).toBeTruthy();
  });

  it('renders a roll-range editor placeholder', () => {
    const { container } = render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    expect(container.querySelector('[data-roll-range-editor]')).toBeTruthy();
  });

  it('renders a slot selector defaulting to the item slot', () => {
    render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    const slotSelect = screen.getByLabelText(
      t('ko-KR', 'items.action.changeSlot'),
    ) as HTMLSelectElement;
    expect(slotSelect.value).toBe('Boots');
  });

  it('renders the compare/craft/duplicate/delete/share action group', () => {
    render(<ItemInspector locale="ko-KR" item={INSPECTED} />);
    expect(screen.getByText(t('ko-KR', 'items.action.compare'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.action.craftFromBase'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.action.duplicate'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.action.delete'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.action.share'))).toBeTruthy();
  });

  it('fires the action callbacks when an action button is pressed', () => {
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    render(
      <ItemInspector
        locale="ko-KR"
        item={INSPECTED}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(screen.getByText(t('ko-KR', 'items.action.duplicate')));
    fireEvent.click(screen.getByText(t('ko-KR', 'items.action.delete')));
    expect(onDuplicate).toHaveBeenCalledWith('item-boots-1');
    expect(onDelete).toHaveBeenCalledWith('item-boots-1');
  });

  it('renders an empty-state hint when no item is selected', () => {
    const { container } = render(<ItemInspector locale="ko-KR" item={undefined} />);
    expect(container.querySelector('[data-inspector-empty]')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// ItemSetSelector (DESIGN §10.4 header toolbar)
// ---------------------------------------------------------------------------

describe('ItemSetSelector (DESIGN §10.4 header toolbar)', () => {
  it('renders one option per item set, with the active set selected', () => {
    render(<ItemSetSelector locale="ko-KR" sets={ITEM_SETS} activeSetId="set-bossing" />);
    const select = screen.getByLabelText(t('ko-KR', 'items.set.label')) as HTMLSelectElement;
    expect(select.value).toBe('set-bossing');
    expect(within(select).getAllByRole('option')).toHaveLength(2);
  });

  it('fires onChange with the chosen set id', () => {
    const onChange = vi.fn();
    render(
      <ItemSetSelector
        locale="ko-KR"
        sets={ITEM_SETS}
        activeSetId="set-default"
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(t('ko-KR', 'items.set.label')), {
      target: { value: 'set-bossing' },
    });
    expect(onChange).toHaveBeenCalledWith('set-bossing');
  });
});

// ---------------------------------------------------------------------------
// ItemsPanel (DESIGN §10.4 3-region layout)
// ---------------------------------------------------------------------------

describe('ItemsPanel (DESIGN §10.4 3-region layout)', () => {
  const props = {
    locale: 'ko-KR' as const,
    grid: GRID,
    library: LIBRARY,
    itemSets: ITEM_SETS,
    activeSetId: 'set-default',
  };

  it('renders all three regions: equipped grid | library | inspector', () => {
    const { container } = render(<ItemsPanel {...props} />);
    expect(container.querySelector('[data-region="equipped"]')).toBeTruthy();
    expect(container.querySelector('[data-region="library"]')).toBeTruthy();
    expect(container.querySelector('[data-region="inspector"]')).toBeTruthy();
  });

  it('renders the localized region headings (§8.1)', () => {
    render(<ItemsPanel {...props} />);
    expect(screen.getByText(t('ko-KR', 'items.equippedGear'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.library'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.inspector'))).toBeTruthy();
  });

  it('renders the header toolbar: item-set selector + clipboard import + craft + trade', () => {
    render(<ItemsPanel {...props} />);
    expect(screen.getByLabelText(t('ko-KR', 'items.set.label'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.importFromClipboard'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.craft'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.trade'))).toBeTruthy();
  });

  it('renders one equipped-grid card per canonical slot (occupied + empty)', () => {
    const { container } = render(<ItemsPanel {...props} />);
    const equipped = container.querySelector('[data-region="equipped"]') as HTMLElement;
    // 12 canonical slots in EQUIP_SLOT_ORDER.
    expect(equipped.querySelectorAll('[data-slot]')).toHaveLength(12);
  });

  it('selecting an equipped item card shows it in the inspector', () => {
    const { container } = render(<ItemsPanel {...props} />);
    const equipped = container.querySelector('[data-region="equipped"]') as HTMLElement;
    fireEvent.click(equipped.querySelector('[data-item-card]') as HTMLElement);
    const inspector = container.querySelector('[data-region="inspector"]') as HTMLElement;
    // The inspector now shows the selected item's name, not the empty state.
    expect(inspector.querySelector('[data-inspector-empty]')).toBeNull();
    expect(within(inspector).getAllByText(/Sorrow Sole/).length).toBeGreaterThan(0);
  });
});
