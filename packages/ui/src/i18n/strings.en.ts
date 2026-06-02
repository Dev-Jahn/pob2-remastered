/**
 * English (en-US) UI string baseline (DESIGN §8.1, §2.1 "UI 문자열 100%").
 *
 * This dictionary is the *source of truth* for the i18n key set: `StringKey`
 * (declared in ./index.ts) is derived from `keyof typeof stringsEn`, and the
 * Korean dictionary is typed as `Record<StringKey, string>`, so adding a key
 * here without a matching Korean entry — or vice versa — fails typecheck.
 *
 * Scope is the UI chrome that later Phase 2 tasks render: the navigation rail
 * labels (§10.2 App shell), the Overview tab card titles (§10.3), and the
 * Overview warning card labels (§10.3 warning card). English text doubles as the
 * search/guide alias that every Korean entry preserves per §8.1.
 */
export const stringsEn = {
  // App shell chrome (DESIGN §10.2 App shell): header labels, status bar, and the
  // ko/en locale toggle option labels.
  'shell.buildLabel': 'Build',
  'shell.activeSkillLabel': 'Active Skill',
  'shell.statusReady': 'Ready',
  'locale.ko': 'Korean',
  'locale.en': 'English',

  // Navigation rail (DESIGN §10.2 App shell).
  'nav.overview': 'Overview',
  'nav.skills': 'Skills',
  'nav.passiveTree': 'Passive Tree',
  'nav.items': 'Items',
  'nav.calcs': 'Calcs',
  'nav.config': 'Config',
  'nav.importExport': 'Import/Export',
  'nav.party': 'Party',
  'nav.compare': 'Compare',
  'nav.notes': 'Notes',

  // Overview tab card titles (DESIGN §10.3).
  'overview.card.offence': 'Offence',
  'overview.card.defence': 'Defence',
  'overview.card.resources': 'Resources',
  'overview.card.warnings': 'Warnings',
  'overview.card.recentChanges': 'Recent Changes',

  // Accessible label for a stat the core did not emit — rendered as a distinct
  // marker, never "0" (DESIGN §10.1 "수정값과 계산 결과 구분", NO-FALLBACK).
  'overview.missing': 'Not available',

  // Overview warning card labels (DESIGN §10.3 warning card).
  'warning.requirementsNotMet': 'Requirements Not Met',
  'warning.resistanceLow': 'Resistance Below Cap',
  'warning.unsupportedModifier': 'Unsupported Modifier',
  'warning.itemParseFailed': 'Item Parse Failed',

  // Items tab redesign (DESIGN §10.4). Header toolbar: item-set selector,
  // clipboard import, and the craft/trade entry points.
  'items.title': 'Items',
  'items.set.label': 'Item Set',
  'items.set.default': 'Default',
  'items.importFromClipboard': 'Import from Clipboard',
  'items.craft': 'Craft',
  'items.trade': 'Trade',

  // Equipped Gear column and its slot labels (DESIGN §10.4 layout).
  'items.equippedGear': 'Equipped Gear',
  'items.slot.weapon1': 'Weapon 1',
  'items.slot.weapon2': 'Weapon 2',
  'items.slot.helmet': 'Helmet',
  'items.slot.body': 'Body Armour',
  'items.slot.gloves': 'Gloves',
  'items.slot.boots': 'Boots',
  'items.slot.ring1': 'Ring 1',
  'items.slot.ring2': 'Ring 2',
  'items.slot.amulet': 'Amulet',
  'items.slot.belt': 'Belt',
  'items.slot.charm': 'Charm',
  'items.slot.flask': 'Flask',

  // Item Library column: search box, filters, and the build/shared scope toggle
  // (DESIGN §10.4 "공유 보관함" shared item scope).
  'items.library': 'Item Library',
  'items.search.placeholder': 'Search items',
  'items.filter.slot': 'Slot',
  'items.filter.type': 'Type',
  'items.filter.requirements': 'Requirements',
  'items.scope.build': 'This Build',
  'items.scope.shared': 'Shared Stash',

  // Inspector column: text sections, the roll-range editor, the empty state, and
  // the action group (DESIGN §10.4 item inspector: 원문/한국어 텍스트, roll range editor).
  'items.inspector': 'Inspector',
  'items.inspector.sourceText': 'Original Text',
  'items.inspector.translatedText': 'Korean Text',
  'items.inspector.parsedMods': 'Parsed Modifiers',
  'items.inspector.unsupportedMods': 'Unsupported Modifiers',
  'items.inspector.rollRange': 'Roll Range',
  'items.inspector.empty': 'Select an item to inspect',
  'items.action.duplicate': 'Duplicate',
  'items.action.delete': 'Delete',
  'items.action.share': 'Share to Library',
  'items.action.changeSlot': 'Change Slot',
  'items.action.compare': 'Compare',
  'items.action.craftFromBase': 'Craft from Base',

  // Affix line parsed/unsupported badges (DESIGN §10.4 affix badge).
  'items.badge.parsed': 'Parsed',
  'items.badge.unsupported': 'Unsupported',

  // Requirement-chip labels on an item card (DESIGN §10.4 requirement chip).
  'items.req.level': 'Level',
  'items.req.str': 'Str',
  'items.req.dex': 'Dex',
  'items.req.int': 'Int',

  // Clipboard import (DESIGN §10.4 Import from Clipboard, §8.6 ko/en auto-detect).
  'items.clipboard.pasteLabel': 'Paste item text',

  // Custom item creation (DESIGN §10.4 custom item: base + mods).
  'items.custom.title': 'Create Custom Item',
  'items.custom.base': 'Base Item',
  'items.custom.mods': 'Modifiers, one per line',
  'items.custom.create': 'Create',

  // Skills tab redesign (DESIGN §10.5). The 2-region layout headings: the
  // skill-group card list and the main-skill inspector.
  'skills.title': 'Skills',
  'skills.groups': 'Skill Groups',
  'skills.inspector': 'Inspector',

  // Skill-group card: the group enabled toggle and the immediate reservation /
  // spirit cost (DESIGN §10.5 "reservation과 spirit cost를 즉시 표시").
  'skills.group.enabled': 'Enabled',
  'skills.reservation': 'Reservation',
  'skills.spirit': 'Spirit',
  'skills.gem.enabled': 'Gem Enabled',
  'skills.gem.level': 'Level',
  'skills.gem.quality': 'Quality',

  // Gem category chips (DESIGN §10.5 "active/support/buff/aura/minion 구분 chip").
  // An active gem with no category metadata reads `unsupported` (§6.4, §11.3).
  'skills.category.active': 'Active',
  'skills.category.support': 'Support',
  'skills.category.buff': 'Buff',
  'skills.category.aura': 'Aura',
  'skills.category.minion': 'Minion',
  'skills.category.unsupported': 'Unsupported',

  // Main-skill inspector sections (DESIGN §10.5 inspector: damage breakdown,
  // support gem contribution, gem level/quality delta).
  'skills.inspector.empty': 'Select a skill group to inspect',
  'skills.inspector.damageBreakdown': 'Damage Breakdown',
  'skills.inspector.supportContribution': 'Support Gem Contribution',
  'skills.inspector.gemDelta': 'Gem Level / Quality Delta',

  // Config tab redesign (DESIGN §10.8). The 2-region layout headings: the
  // scenario-preset selector and the typed option list.
  'config.title': 'Config',
  'config.presets': 'Scenario Presets',
  'config.options': 'Options',

  // The §10.8 scenario presets (general mapping / bossing / full charges /
  // shocked enemy / cursed enemy / low life / custom scenario).
  'config.preset.generalMapping': 'General Mapping',
  'config.preset.bossing': 'Bossing',
  'config.preset.fullCharges': 'Full Charges',
  'config.preset.shockedEnemy': 'Shocked Enemy',
  'config.preset.cursedEnemy': 'Cursed Enemy',
  'config.preset.lowLife': 'Low Life',
  'config.preset.custom': 'Custom Scenario',

  // Config option row: the affected-calc-items label (DESIGN §10.8 "변경 시 영향을
  // 받는 계산 항목"), and the unsupported-control marker (§6.4, §11.3).
  'config.affects': 'Affects',
  'config.unsupported': 'Unsupported',

  // Calcs tab breakdown explorer (DESIGN §10.7). The panel title, the per-stat
  // delta / final-value chrome, and the formula-trace labels (source list /
  // formula / upstream raw stat id), plus the "trace 없음" + missing markers.
  'calcs.title': 'Calcs',
  'calcs.finalValue': 'Final Value',
  'calcs.delta': 'Delta',
  'calcs.missing': 'Not computed',
  'calcs.noTrace': 'No trace',
  'calcs.sources': 'Contributions',
  'calcs.formula': 'Formula',
  'calcs.upstreamStatId': 'Upstream Stat Id',

  // Top-level breakdown section names (DESIGN §10.7 tree: Summary / Offence /
  // Defence / Resource / Raw trace). The labels of the §10.7 breakdown spec.
  'calcs.section.summary': 'Summary',
  'calcs.section.offence': 'Offence',
  'calcs.section.defence': 'Defence',
  'calcs.section.resource': 'Resource',
  'calcs.section.rawTrace': 'Raw Trace',

  // Contribution source-kind labels (DESIGN §10.7 "기여 source list" classified by
  // origin — the ExplainSource.kind union: item/passive/skillGem/supportGem/
  // config/buff). The trace renders these next to each source's label and value.
  'calcs.source.item': 'Item',
  'calcs.source.passive': 'Passive',
  'calcs.source.skillGem': 'Skill Gem',
  'calcs.source.supportGem': 'Support Gem',
  'calcs.source.config': 'Config',
  'calcs.source.buff': 'Buff',
} as const;
