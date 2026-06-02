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

// Skills view-models (DESIGN §10.5 Skills tab, §6.3 skills.getGroups /
// setGemGroup, §6.4 NO-FALLBACK). Pure, framework-free transforms: the card-unit
// skill-group model (group toggle + spirit/reservation + classified gem chips —
// active/support/buff/aura/minion, with an explicit `unsupported` chip for an
// active gem missing from the category metadata) and the GemInput payload builders
// for setGemGroup (toggle / add / remove).
export {
  buildSkillGroupsModel,
  groupToGemInputs,
  toggleGemEnabled,
  addGem,
  removeGem,
} from './skills/skills-model.js';
export type {
  GemChipCategory,
  GemMetaCategory,
  GemCategoryMeta,
  SkillGemChip,
  SkillGroupCardModel,
  SkillsViewModel,
} from './skills/skills-model.js';

// Skills components: render the §10.5 view-models in the 2-region layout. SkillsPanel
// (skill-group card list | main-skill inspector) owns the selected-skill state and
// shows the inspector damage breakdown / support gem contribution / gem level·quality
// delta; SkillGroupCard (group enabled toggle + immediate reservation/spirit costs +
// classified active/support/buff/aura/minion chips, with an `unsupported` chip carrying
// an icon AND a text label per §11.3); GemRow (one gem chip: category chip as a data
// attribute never color-only, level/quality verbatim, enabled toggle).
export { SkillsPanel } from './skills/SkillsPanel.js';
export type {
  SkillsPanelProps,
  SkillInspectorModel,
  DamageBreakdownRow,
  SupportContributionRow,
  GemDeltaRow,
} from './skills/SkillsPanel.js';
export { SkillGroupCard, GemRow } from './skills/SkillGroupCard.js';
export type { SkillGroupCardProps, GemRowProps } from './skills/SkillGroupCard.js';

// Config view-model (DESIGN §10.8 Config tab, §6.3 config.getOptions /
// config.setOption, §6.4 NO-FALLBACK). Pure, framework-free transforms: the
// scenario-preset-centric model (config.getOptions → typed check/count/list
// option inputs, each wired to its dependent modifiers + the calc stats it
// affects on change), the §10.8 scenario presets (general mapping / bossing /
// full charges / shocked enemy / cursed enemy / low life / custom), and the
// builders that reduce a preset (or a custom edit) to the { optionId, value }[]
// config.setOption payload. An unknown control type → an explicit `unsupported`
// input, never a guessed default.
export {
  buildConfigModel,
  presetToConfigOptions,
  setOptionValue,
  CONFIG_PRESETS,
} from './config/config-model.js';
export type {
  ConfigInputKind,
  StatImpactMap,
  ConfigOptionInput,
  ConfigOptionValue,
  ConfigPresetId,
  ConfigPreset,
  ConfigViewModel,
} from './config/config-model.js';

// Config components: render the §10.8 view-model in the 2-region layout. ConfigPanel
// (scenario-preset selector | typed option list) owns the selected-preset state and
// reduces a chosen preset to its { optionId, value }[] config.setOption payload;
// ConfigOptionRow (one typed option: check checkbox / count number / list input, with
// the immediately-shown affected calc items and a §10.1.6 visual split between the
// editable control and the read-only results — an `unsupported` control type renders an
// icon AND a text label per §11.3, never a fabricated default).
export { ConfigPanel } from './config/ConfigPanel.js';
export type { ConfigPanelProps } from './config/ConfigPanel.js';
export { ConfigOptionRow } from './config/ConfigOptionRow.js';
export type { ConfigOptionRowProps } from './config/ConfigOptionRow.js';

// Calcs breakdown view-model (DESIGN §10.7 Calcs tab, §6.3 calc.run /
// calc.explain, §6.4 NO-FALLBACK). Pure, framework-free transform: turns a
// calc.run result (final values) + its calc.explain traces (sources / formula /
// upstream raw stat id) into the §10.7 breakdown tree — Summary / Offence{Hit,
// Crit, Ailments, DoT} / Defence{Life·ES·Mana, Resistances, Armour·Evasion, EHP}
// / Resource / Raw trace. Each leaf exposes 최종값, before/after delta, the
// contribution source list (item/passive/skillGem/supportGem/config/buff),
// formula trace, upstream raw stat id, and 한국어/영어 labels. A stat absent from
// calc.run → explicit present:false missing (never 0); a present stat with no
// explain → explicit { explained:false, reason:'noTrace' } "trace 없음" marker.
export { buildCalcsModel, CALCS_BREAKDOWN_SPEC } from './calcs/calcs-model.js';
export type {
  CalcsSectionId,
  CalcsGroupId,
  BreakdownDelta,
  BreakdownTrace,
  BreakdownStat,
  CalcsGroup,
  CalcsSection,
  CalcsViewModel,
  CalcsStatSpec,
  CalcsGroupSpec,
  CalcsSectionSpec,
  CalcsBreakdownSpec,
} from './calcs/calcs-model.js';

// Calcs components: render the §10.7 breakdown view-model as the breakdown
// explorer (gates VISUAL[4] '/calcs'). CalcsPanel (the Summary / Offence /
// Defence / Resource + Raw-trace collapsible breakdown tree) owns the debounced
// calc.explain dispatch — expanding a stat row without a loaded trace fires
// onExplain(statId) so the host can fetch it; an already-loaded trace is never
// refetched. BreakdownSection (one collapsible section: ko/en heading + sub-groups
// of stat rows, each row showing 최종값 + before/after delta + 한/영 label and
// expanding to its FormulaTrace). FormulaTrace (the contribution source list
// classified item/passive/skillGem/supportGem/config/buff + formula trace string +
// upstream raw stat id, or the localized "trace 없음" marker for an unexplained stat).
export { CalcsPanel } from './calcs/CalcsPanel.js';
export type { CalcsPanelProps } from './calcs/CalcsPanel.js';
export { BreakdownSection } from './calcs/BreakdownSection.js';
export type { BreakdownSectionProps } from './calcs/BreakdownSection.js';
export { FormulaTrace } from './calcs/FormulaTrace.js';
export type { FormulaTraceProps } from './calcs/FormulaTrace.js';
