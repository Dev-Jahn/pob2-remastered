/**
 * @pob2/ui i18n resolver (DESIGN §8.1, §2.1 "UI 문자열 100%").
 *
 * Surfaces the ko/en UI string baseline behind a single typed `t(locale, key)`
 * lookup. The English dictionary is the source of truth for `StringKey`; the
 * Korean dictionary is checked against that key type, so the two locales cannot
 * drift out of coverage without failing typecheck.
 */
import { stringsEn } from './strings.en.js';
import { stringsKo } from './strings.ko.js';

/** Locale tags the UI speaks (DESIGN §8.1: default ko-KR, en-US alias). */
export type Locale = 'ko-KR' | 'en-US';

/** Every UI string key, derived from the English source-of-truth dictionary. */
export type StringKey = keyof typeof stringsEn;

const dictionaries: Record<Locale, Record<StringKey, string>> = {
  'ko-KR': stringsKo,
  'en-US': stringsEn,
};

/**
 * Resolve a UI string for `locale`. Both `locale` and `key` are constrained by
 * their union types, so an unknown key or locale fails typecheck rather than
 * returning a missing-translation placeholder.
 */
export function t(locale: Locale, key: StringKey): string {
  return dictionaries[locale][key];
}

export { stringsEn, stringsKo };
