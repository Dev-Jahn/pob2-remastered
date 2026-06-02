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

  it('covers the Skills tab keys (DESIGN §10.5): groups, costs, category chips, inspector', () => {
    // Skills tab (§10.5): the 2-region headings + group toggle, the immediate
    // reservation / spirit costs, the active/support/buff/aura/minion category
    // chips (with the explicit `unsupported` chip for an active gem missing its
    // category metadata, §6.4), and the main-skill inspector sections.
    const required: StringKey[] = [
      // Region headings + group toggle.
      'skills.groups',
      'skills.inspector',
      'skills.group.enabled',
      // Immediate reservation / spirit cost.
      'skills.reservation',
      'skills.spirit',
      // Gem fields.
      'skills.gem.enabled',
      'skills.gem.level',
      'skills.gem.quality',
      // Category chips.
      'skills.category.active',
      'skills.category.support',
      'skills.category.buff',
      'skills.category.aura',
      'skills.category.minion',
      'skills.category.unsupported',
      // Inspector sections.
      'skills.inspector.empty',
      'skills.inspector.damageBreakdown',
      'skills.inspector.supportContribution',
      'skills.inspector.gemDelta',
    ];
    for (const key of required) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it('covers the Config tab keys (DESIGN §10.8): presets, options, affects/unsupported', () => {
    // Config tab (§10.8): the region headings, the scenario presets (general
    // mapping / bossing / full charges / shocked enemy / cursed enemy / low life /
    // custom), the affected-calc-items label, and the unsupported-control marker.
    const required: StringKey[] = [
      'config.presets',
      'config.options',
      'config.preset.generalMapping',
      'config.preset.bossing',
      'config.preset.fullCharges',
      'config.preset.shockedEnemy',
      'config.preset.cursedEnemy',
      'config.preset.lowLife',
      'config.preset.custom',
      'config.affects',
      'config.unsupported',
    ];
    for (const key of required) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it('covers the Calcs tab keys (DESIGN §10.7): breakdown sections, sources, trace chrome', () => {
    // Calcs tab (§10.7): the per-stat chrome (최종값 / delta / "값 없음" missing
    // marker), the breakdown section names (Summary / Offence / Defence / Resource
    // + Raw trace), the formula-trace chrome (기여 source list / formula / upstream
    // raw stat id), the classified contribution source-kind labels (item / passive
    // / skillGem / supportGem / config / buff), and the "trace 없음" marker.
    const required: StringKey[] = [
      // Per-stat chrome.
      'calcs.finalValue',
      'calcs.delta',
      'calcs.missing',
      // Breakdown section names.
      'calcs.section.summary',
      'calcs.section.offence',
      'calcs.section.defence',
      'calcs.section.resource',
      'calcs.section.rawTrace',
      // Formula-trace chrome.
      'calcs.sources',
      'calcs.formula',
      'calcs.upstreamStatId',
      // Contribution source-kind labels (DESIGN §10.7 source list classification).
      'calcs.source.item',
      'calcs.source.passive',
      'calcs.source.skillGem',
      'calcs.source.supportGem',
      'calcs.source.config',
      'calcs.source.buff',
      // "trace 없음" marker (§6.4 NO-FALLBACK).
      'calcs.noTrace',
    ];
    for (const key of required) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
    }
  });

  it('covers the Overview stat-row label keys (DESIGN §10.3, §8.1): offence/defence/resource', () => {
    // Overview stat-row labels (§10.3): the offence/defence/resource card rows
    // resolve their label through `t` so the missing-stat fallback labels AND the
    // visible stat-row labels are Korean under ko-KR (CARRYOVER p2/stat-label-locale,
    // doneCriteria "UI 문자열 100%"). Every key below must exist in both locales and
    // — being a real translation, not a copy — read differently ko≠en (§8.1).
    const statKeys: StringKey[] = [
      // Offence card rows.
      'overview.stat.totalDps',
      'overview.stat.averageDamage',
      'overview.stat.critChance',
      'overview.stat.critMultiplier',
      'overview.stat.speed',
      // Defence card rows.
      'overview.stat.life',
      'overview.stat.mana',
      'overview.stat.energyShield',
      'overview.stat.armour',
      'overview.stat.evasion',
      'overview.stat.fireResist',
      'overview.stat.coldResist',
      'overview.stat.lightningResist',
      'overview.stat.chaosResist',
      'overview.stat.totalEhp',
      // Resource card rows.
      'overview.stat.spirit',
      'overview.stat.spiritReserved',
      'overview.stat.manaReserved',
      'overview.stat.manaUnreserved',
    ];
    for (const key of statKeys) {
      expect(koKeys).toContain(key);
      expect(enKeys).toContain(key);
      // The Korean stat label is a real translation, never the English copy (§8.1).
      expect(t('ko-KR', key)).not.toBe(t('en-US', key));
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
