/**
 * @pob2/ui — the React UI package (DESIGN §5.1 UI layer, §10 UI/UX). This is the
 * scaffold barrel: it re-exports the package version and will grow to export the
 * app shell, tabs, and shared components as later phases land.
 */
export { UI_VERSION } from './version.js';

// i18n: ko/en UI string baseline + resolver (DESIGN §8.1, §2.1 "UI 문자열 100%").
export { t, stringsEn, stringsKo } from './i18n/index.js';
export type { Locale, StringKey } from './i18n/index.js';

// App shell: 3-pane frame + nav rail + ko/en locale toggle (DESIGN §10.2).
export { AppShell } from './shell/AppShell.js';
export type { AppShellProps } from './shell/AppShell.js';
export { Navigation, NAV_ITEMS } from './shell/Navigation.js';
export type { NavigationProps, NavTab } from './shell/Navigation.js';
export { LocaleToggle } from './shell/LocaleToggle.js';
export type { LocaleToggleProps } from './shell/LocaleToggle.js';

// Overview view-model: maps calc.run stats -> §10.3 stat cards (pure logic).
export { buildOverviewModel } from './overview/view-model.js';
export type {
  BuildSummary,
  OverviewField,
  OverviewCard,
  OverviewModel,
} from './overview/view-model.js';

// Warning view-model: derives §10.3 warning-card rows (resist-below-cap +
// unsupported-line passthrough) from calc.run stats + parseClipboard unsupported[].
export { buildWarningModel } from './overview/warnings.js';
export type {
  Warning,
  WarningSeverity,
  WarningModel,
  WarningModelInput,
} from './overview/warnings.js';

// Overview components: render the §10.3 view-models. StatCard (title + stat rows
// with §10.1 layering), the OffenceCard/DefenceCard/ResourceCard wrappers +
// OverviewPanel, and WarningPanel (icon + text label per §11.3).
export { StatCard } from './overview/StatCard.js';
export type { StatCardProps } from './overview/StatCard.js';
export { OverviewPanel, OffenceCard, DefenceCard, ResourceCard } from './overview/OverviewPanel.js';
export type { OverviewPanelProps, OverviewCardProps } from './overview/OverviewPanel.js';
export { WarningPanel } from './overview/WarningPanel.js';
export type { WarningPanelProps } from './overview/WarningPanel.js';

// Command palette: Ctrl+K global palette over build commands, with bilingual
// (titleKo/titleEn/aliases) filtering and Enter-to-run (DESIGN §11.1, §11.2,
// §10.1 "회피/evasion/ev" parity). Commands are pure props (no app coupling).
export { CommandPalette } from './command-palette/CommandPalette.js';
export type { CommandPaletteProps } from './command-palette/CommandPalette.js';
export { filterCommands, matchCommand, commandTokens } from './command-palette/search.js';
export type { Command } from './command-palette/search.js';

// Items view-models (DESIGN §10.4 Items tab, §6.4 NO-FALLBACK). Pure, framework-
// free transforms: the slot-ordered equipped-gear grid (Item card model with
// rarity color key, baseType, requirement chips, mod summary, +DPS/-EHP delta
// chips), the ko↔en item-library search/filter/sort, and the equip-delta chips.
export { buildEquippedGridModel, EQUIP_SLOT_ORDER } from './items/equipped-model.js';
export type {
  EquipSlot,
  RequirementChip,
  ItemCardModel,
  EquippedItemCard,
  EquippedGridModel,
  EquipDeltaByItemId,
} from './items/equipped-model.js';
export { filterItems } from './items/library-search.js';
export type { LibraryItem, ItemFilterQuery, ItemSort } from './items/library-search.js';
export { buildEquipDeltaModel } from './items/delta-model.js';
export type { DeltaDirection, DeltaChip, EquipDeltaModel } from './items/delta-model.js';

// Items components: render the §10.4 view-models in the 3-region layout. ItemsPanel
// (equipped grid | library search | inspector) + its toolbar, ItemCard (rarity
// data-attr, icon placeholder, base type, requirement chips, mod summary, +DPS/-EHP
// delta chips), ItemLibrary (search + slot/type/req filters + virtualization-ready
// result list), ItemInspector (원문/한국어 텍스트, parsed/unsupported badges with
// icon+text per §11.3, roll-range editor placeholder, slot selector, action group),
// and ItemSetSelector (header item-set picker).
export { ItemsPanel } from './items/ItemsPanel.js';
export type { ItemsPanelProps } from './items/ItemsPanel.js';
export { ItemCard } from './items/ItemCard.js';
export type { ItemCardProps } from './items/ItemCard.js';
export { ItemLibrary } from './items/ItemLibrary.js';
export type { ItemLibraryProps } from './items/ItemLibrary.js';
export { ItemInspector } from './items/ItemInspector.js';
export type { ItemInspectorProps, InspectedItem } from './items/ItemInspector.js';
export { ItemSetSelector } from './items/ItemSetSelector.js';
export type { ItemSetSelectorProps, ItemSetOption } from './items/ItemSetSelector.js';

// Items container hook + components (DESIGN §10.4 Items tab redesign, §8.6 ko/en
// clipboard paste, §6.3 items.parseClipboard/createCustom, §5.1 injectable client):
// useItemsTab (clipboard import → inspector, custom item creation, shared item
// scope filter), ClipboardImport (paste textarea + import button → inspector with
// parsed/unsupported split), CustomItemForm (base select + mod input → onCreate).
export { useItemsTab } from './items/useItemsTab.js';
export type {
  ItemsClient,
  LibraryScope,
  UseItemsTabOptions,
  UseItemsTabResult,
} from './items/useItemsTab.js';
export { ClipboardImport } from './items/ClipboardImport.js';
export type { ClipboardImportProps } from './items/ClipboardImport.js';
export { CustomItemForm } from './items/CustomItemForm.js';
export type { CustomItemFormProps, ItemBaseOption } from './items/CustomItemForm.js';
