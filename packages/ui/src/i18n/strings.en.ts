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
} as const;
