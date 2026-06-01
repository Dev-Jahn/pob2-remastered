// i18n baseline test (DESIGN §8.1, §2.1 "UI 문자열 100%"). Asserts the ko/en UI
// string dictionaries are complete and consistent:
//   - the en and ko key sets are identical (so neither locale silently misses a
//     string — the §2.1 "UI 문자열 100%" coverage bar),
//   - every key resolves to a non-empty string in both locales via `t`,
//   - translated entries differ between ko and en (the Korean baseline is real
//     translation, not a copy of the English source).
import { describe, it, expect } from 'vitest';
import { t, stringsKo, stringsEn } from '../src/index.js';
import type { Locale, StringKey } from '../src/index.js';

const koKeys = Object.keys(stringsKo) as StringKey[];
const enKeys = Object.keys(stringsEn) as StringKey[];
const locales: Locale[] = ['ko-KR', 'en-US'];

describe('@pob2/ui i18n baseline', () => {
  it('exposes identical key sets for ko and en', () => {
    expect(new Set(koKeys)).toEqual(new Set(enKeys));
  });

  it('covers the nav, overview, and warning keys later tasks need', () => {
    // Spot-check a representative key from each group required by §10.2 (nav),
    // §10.3 (overview cards), and §10.3 warning card so the baseline cannot be
    // emptied out without failing.
    const required: StringKey[] = [
      'nav.overview',
      'nav.skills',
      'nav.passiveTree',
      'nav.items',
      'nav.calcs',
      'nav.config',
      'nav.importExport',
      'overview.card.offence',
      'overview.card.defence',
      'overview.card.resources',
      'overview.card.warnings',
      'overview.card.recentChanges',
      'warning.requirementsNotMet',
      'warning.resistanceLow',
      'warning.unsupportedModifier',
      'warning.itemParseFailed',
    ];
    for (const key of required) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it('covers the Items tab keys (DESIGN §10.4): toolbar, slots, library, inspector', () => {
    // Items tab redesign (§10.4): the header toolbar (item-set selector, clipboard
    // import, craft, trade), the equipped-gear slot labels, the item library
    // search/filter, the inspector action group (duplicate/delete/share/equip/
    // compare), the parsed/unsupported affix badges, and the shared-item scope.
    const required: StringKey[] = [
      // Header toolbar.
      'items.title',
      'items.set.label',
      'items.set.default',
      'items.importFromClipboard',
      'items.craft',
      'items.trade',
      // Equipped gear column + slot labels.
      'items.equippedGear',
      'items.slot.weapon1',
      'items.slot.weapon2',
      'items.slot.helmet',
      'items.slot.body',
      'items.slot.gloves',
      'items.slot.boots',
      'items.slot.ring1',
      'items.slot.ring2',
      'items.slot.amulet',
      'items.slot.belt',
      'items.slot.charm',
      'items.slot.flask',
      // Item library: search + filters + scope.
      'items.library',
      'items.search.placeholder',
      'items.filter.slot',
      'items.filter.type',
      'items.filter.requirements',
      'items.scope.build',
      'items.scope.shared',
      // Inspector + action group.
      'items.inspector',
      'items.action.duplicate',
      'items.action.delete',
      'items.action.share',
      'items.action.changeSlot',
      'items.action.compare',
      'items.action.craftFromBase',
      // Affix badges.
      'items.badge.parsed',
      'items.badge.unsupported',
    ];
    for (const key of required) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it('resolves every key to a non-empty string in both locales', () => {
    for (const locale of locales) {
      for (const key of enKeys) {
        const value = t(locale, key);
        expect(typeof value).toBe('string');
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });

  it('uses distinct ko and en text for every key (no untranslated copies)', () => {
    for (const key of enKeys) {
      expect(t('ko-KR', key)).not.toBe(t('en-US', key));
    }
  });

  it('keeps the English alias inside each Korean entry (§8.1 alias convention)', () => {
    // §8.1: "회피 (Evasion)" — the Korean baseline never drops the English alias
    // so users can move between English guides and the Korean client.
    for (const key of enKeys) {
      const en = t('en-US', key);
      const ko = t('ko-KR', key);
      expect(ko).toContain(`(${en})`);
    }
  });
});
