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
} as const;
