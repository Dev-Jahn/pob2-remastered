/**
 * LocalizedTerm — the bilingual term record (DESIGN §8.3). Every later Phase 6
 * task (PoE2DB importer, generated dictionaries, bilingual search index) writes
 * against this shape. This module is pure types plus a tiny runtime validator;
 * no dictionary content lives here.
 */
import { LOCALIZATION_DOMAINS, type LocalizationDomain } from './index.js';

/**
 * Match confidence for a ko↔en mapping (DESIGN §8.3 LocalizedTerm.confidence,
 * §8.5 matching strategy): `exact` id/name hit, `slug` PoE2DB-anchor hit, `fuzzy`
 * normalized-text guess, `manual` human-reviewed override.
 */
export const TERM_CONFIDENCES = ['exact', 'slug', 'fuzzy', 'manual'] as const;

/** One confidence level (DESIGN §8.3 LocalizedTerm.confidence). */
export type TermConfidence = (typeof TERM_CONFIDENCES)[number];

/**
 * Provenance of a term (DESIGN §8.3 LocalizedTerm.source, §15.3): `upstream` from
 * vendored PoB2 data, `poe2db` from the import pipeline, `manual` from an override,
 * `generated` derived/synthesized.
 */
export const TERM_SOURCES = ['upstream', 'poe2db', 'manual', 'generated'] as const;

/** One provenance source (DESIGN §8.3 LocalizedTerm.source). */
export type TermSource = (typeof TERM_SOURCES)[number];

/** The localization domain union, re-exported from §8.3's vocabulary. */
export type TermDomain = LocalizationDomain;

/** The bilingual term record (DESIGN §8.3). */
export interface LocalizedTerm {
  /** Stable internal id. */
  id: string;
  /** Localizable domain this term belongs to. */
  domain: TermDomain;
  /** Canonical English name — the primary join key against upstream data. */
  canonicalEn: string;
  /** Korean display name (DESIGN §8.1: 인게임 한국어 우선). */
  ko: string;
  /** English search aliases (DESIGN §8.1: never dropped, drive ko/en search). */
  aliasesEn: string[];
  /** Korean search aliases. */
  aliasesKo: string[];
  /** PoE2DB anchor slug, when known (DESIGN §8.5 matching key). */
  slug?: string;
  /** PoE2DB reference URL, kept separate from generated mapping (DESIGN §15.3). */
  poe2dbUrl?: string;
  /** Upstream Data ids this term maps to (DESIGN §8.4 "Match upstream Data ids"). */
  upstreamIds: string[];
  /** Match confidence for this mapping. */
  confidence: TermConfidence;
  /** Where this mapping came from. */
  source: TermSource;
  /** ISO-8601 timestamp of the last update. */
  updatedAt: string;
}

const CONFIDENCES: ReadonlySet<string> = new Set(TERM_CONFIDENCES);
const SOURCES: ReadonlySet<string> = new Set(TERM_SOURCES);

// LOCALIZATION_DOMAINS lives in the package barrel (index.ts), which re-exports
// this module — a value-level import cycle. Reading it at module-init time would
// touch the binding before the barrel finishes initializing it (ReferenceError).
// Resolve it lazily on first validation instead, by which point the cycle is
// settled and the live binding is populated.
let domainSet: ReadonlySet<string> | undefined;
function domains(): ReadonlySet<string> {
  return (domainSet ??= new Set(LOCALIZATION_DOMAINS));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Validate a candidate term record (DESIGN §8.3): all required fields present and
 * well-typed, and `domain`/`confidence`/`source` within their enums. Optional
 * `slug`/`poe2dbUrl`, when present, must be strings. Narrows to LocalizedTerm so
 * callers (importer, dictionary loader) get a typed record without re-checking.
 */
export function isValidTerm(value: unknown): value is LocalizedTerm {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Record<string, unknown>;

  if (typeof t.id !== 'string') return false;
  if (typeof t.canonicalEn !== 'string') return false;
  if (typeof t.ko !== 'string') return false;
  if (typeof t.updatedAt !== 'string') return false;

  if (typeof t.domain !== 'string' || !domains().has(t.domain)) return false;
  if (typeof t.confidence !== 'string' || !CONFIDENCES.has(t.confidence)) return false;
  if (typeof t.source !== 'string' || !SOURCES.has(t.source)) return false;

  if (!isStringArray(t.aliasesEn)) return false;
  if (!isStringArray(t.aliasesKo)) return false;
  if (!isStringArray(t.upstreamIds)) return false;

  if (t.slug !== undefined && typeof t.slug !== 'string') return false;
  if (t.poe2dbUrl !== undefined && typeof t.poe2dbUrl !== 'string') return false;

  return true;
}
