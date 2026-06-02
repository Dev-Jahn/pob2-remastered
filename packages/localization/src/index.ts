/**
 * @pob2/localization — the Korean localization layer (DESIGN §8): the bilingual
 * term store, PoE2DB import pipeline, and ko/en search index that the UI and core
 * client read. This is the Phase 6 scaffold entry: it pins the locale + domain
 * vocabulary the rest of the package is built on (DESIGN §8.1, §8.3) so the three
 * Phase 6 gate commands resolve and execute. The dictionaries, importer, and search
 * index implementations land in later Phase 6 tasks.
 */

/** The UI/search locales (DESIGN §8.1): ko-KR primary, en-US as alias/search token. */
export type Locale = 'ko-KR' | 'en-US';

/** The bilingual locale set the search index is keyed on (DESIGN §8.1, §11.2). */
export const SUPPORTED_LOCALES = ['ko-KR', 'en-US'] as const satisfies readonly Locale[];

/** Default UI language (DESIGN §8.1 "기본 UI 언어는 ko-KR"). */
export const DEFAULT_LOCALE: Locale = 'ko-KR';

/** The localizable domains a LocalizedTerm can belong to (DESIGN §8.3). */
export const LOCALIZATION_DOMAINS = [
  'ui',
  'keyword',
  'item',
  'unique',
  'base',
  'skill',
  'support_gem',
  'passive',
  'ascendancy',
  'mod',
  'stat',
  'area',
  'boss',
] as const;

/** One localizable domain (DESIGN §8.3 LocalizedTerm.domain). */
export type LocalizationDomain = (typeof LOCALIZATION_DOMAINS)[number];

// The §8.3 LocalizedTerm data model: the bilingual term record, its
// confidence/source enums, and the runtime validator every later Phase 6 task
// writes against.
export {
  TERM_CONFIDENCES,
  TERM_SOURCES,
  isValidTerm,
  type LocalizedTerm,
  type TermConfidence,
  type TermSource,
  type TermDomain,
} from './term.js';

// The §8.5 upstream matcher: resolves imported terms to upstream `src/Data` ids with a
// confidence tag, parking fuzzy/unmatched terms in a review queue (NO-FALLBACK, §8.4 F).
export {
  matchTerms,
  loadUpstreamSnapshot,
  type UpstreamId,
  type UpstreamSnapshot,
  type MatchResult,
} from './match.js';

// The §8.4 step H dictionary assembly: runs importer -> match -> assemble for the four
// §18 named domains, layering the manual override store (manual_ko_overrides.json) over
// the generated terms (override WINS), and serializes a deterministic build artifact.
export {
  buildDictionary,
  assembleDictionary,
  serializeDictionary,
  loadManualOverrides,
  type Dictionary,
  type ManualOverride,
  type LoadedOverrides,
} from './dictionary.js';

// The §11.2 bilingual (ko/en) search index: projects the generated dictionary onto
// SearchDocuments and resolves a query from EITHER language or any alias (§8.1) —
// an unknown query returns empty (NO-FALLBACK).
export { buildSearchIndex, search, type SearchDocument, type SearchIndex } from './search.js';
