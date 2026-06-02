/**
 * Build the generated ko-KR dictionary (DESIGN §8.4 step H, §18 named domains).
 *
 * This is the assembly stage of the §8.4 import pipeline:
 *
 *   importer (step D/E) ──▶ match (step F/G) ──▶ Generated dictionary (step H)
 *                                                        ▲
 *                            manual override store ──────┘ (step J wins over H)
 *
 * {@link buildDictionary} runs the offline importer over cached PoE2DB fixtures,
 * resolves the imported terms to upstream `src/Data` ids via {@link matchTerms},
 * marks the resolved set as `source: 'generated'`, and layers a manual override
 * store (`manual_ko_overrides.json`) ON TOP — a human-confirmed term WINS over the
 * generated term for the same id (§8.4 step J → H). The override store is also the
 * home for the §18 domains the importer/match step does not yet cover from fixtures
 * (item unique, passive node, support gem), so the four §18 named domains
 * keyword / item (base+unique) / skill (gem+support) / passive are all reachable.
 *
 * The result is a `Record<id, LocalizedTerm>`. {@link serializeDictionary} renders it
 * to a DETERMINISTIC artifact: keys sorted ascending, stable 2-space JSON, trailing
 * newline — same input → byte-identical output (DESIGN §12.2 Localization JSON). The
 * English alias is NEVER emptied (§8.1): every entry keeps `canonicalEn` as a search
 * token, both for generated entries and across an override merge.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importFromFixtures } from './importer.js';
import { loadUpstreamSnapshot, matchTerms, type UpstreamSnapshot } from './match.js';
import { isValidTerm, type LocalizedTerm, type TermDomain } from './term.js';

/** The assembled generated+manual dictionary: stable term id → its localized record. */
export type Dictionary = Record<string, LocalizedTerm>;

/**
 * One manual override entry from `manual_ko_overrides.json` (DESIGN §8.4 step J).
 *
 * Two shapes, both keyed by `id`:
 *   - PATCH: `id` + the fields to change (typically `ko`). Patches an EXISTING
 *     generated term — unspecified fields (domain, canonicalEn, aliasesEn, …) are
 *     inherited from the generated entry, so the English alias is never lost (§8.1).
 *   - NEW: a full record (domain + canonicalEn + ko + aliasesEn + upstreamIds).
 *     Admits a brand-new manual-only entry for a §18 domain the importer does not
 *     yet produce (item unique, passive node, support gem).
 * Either way the merged result is tagged `source: 'manual'`, `confidence: 'manual'`.
 */
export interface ManualOverride {
  /** Stable term id this override targets (matches a generated id, or introduces a new one). */
  id: string;
  /** Korean display string (the usual reason for an override). */
  ko?: string;
  /** Domain — required when introducing a brand-new manual-only entry. */
  domain?: TermDomain;
  /** Canonical English name — required when introducing a brand-new entry. */
  canonicalEn?: string;
  /** English search aliases (§8.1, never empties the existing alias when omitted). */
  aliasesEn?: string[];
  /** Korean search aliases. */
  aliasesKo?: string[];
  /** PoE2DB anchor slug, when known. */
  slug?: string;
  /** PoE2DB reference URL. */
  poe2dbUrl?: string;
  /** Upstream Data ids this term maps to. */
  upstreamIds?: string[];
  /** Authored ISO-8601 provenance date (checked in, NOT wall-clock — keeps the build deterministic). */
  updatedAt?: string;
  /** Free-form reviewer note (ignored by assembly). */
  note?: string;
}

/** The on-disk shape of `manual_ko_overrides.json`. */
interface OverrideStore {
  /** Store-wide provenance date — the deterministic `updatedAt` stamped onto generated entries. */
  updatedAt: string;
  overrides: ManualOverride[];
}

/** A loaded manual override store: its provenance date + the override entries. */
export interface LoadedOverrides {
  /** Store-wide provenance date (DESIGN §8.3 updatedAt), used to stamp generated entries deterministically. */
  updatedAt: string;
  /** The manual override entries (§8.4 step J). */
  overrides: ManualOverride[];
}

/** Fallback provenance date when an override carries none — fixed (never wall-clock) for determinism. */
const DEFAULT_PROVENANCE = '1970-01-01T00:00:00.000Z';

/** Ensure an entry carries a non-empty English alias including its canonical name (§8.1). */
function withEnglishAlias(term: LocalizedTerm): LocalizedTerm {
  if (term.aliasesEn.includes(term.canonicalEn)) return term;
  return { ...term, aliasesEn: [term.canonicalEn, ...term.aliasesEn] };
}

/**
 * Merge one manual override onto a base term (or build a fresh term when there is no
 * base). The override wins field-by-field; omitted fields fall back to the base so an
 * override that names only `id` + `ko` never empties the English alias (§8.1).
 */
function applyOverride(base: LocalizedTerm | undefined, ov: ManualOverride): LocalizedTerm {
  const merged: LocalizedTerm = {
    id: ov.id,
    domain: ov.domain ?? base?.domain ?? 'ui',
    canonicalEn: ov.canonicalEn ?? base?.canonicalEn ?? '',
    ko: ov.ko ?? base?.ko ?? '',
    aliasesEn: ov.aliasesEn ?? base?.aliasesEn ?? [],
    aliasesKo: ov.aliasesKo ?? base?.aliasesKo ?? [],
    upstreamIds: ov.upstreamIds ?? base?.upstreamIds ?? [],
    confidence: 'manual',
    source: 'manual',
    // Authored provenance, never wall-clock — keeps the build artifact deterministic.
    updatedAt: ov.updatedAt ?? base?.updatedAt ?? DEFAULT_PROVENANCE,
  };
  const slug = ov.slug ?? base?.slug;
  if (slug !== undefined) merged.slug = slug;
  const url = ov.poe2dbUrl ?? base?.poe2dbUrl;
  if (url !== undefined) merged.poe2dbUrl = url;
  return withEnglishAlias(merged);
}

/**
 * Layer the manual override store over the generated terms (DESIGN §8.4 step J → H).
 *
 * PURE: returns a fresh `Record<id, LocalizedTerm>`. Generated terms seed the map;
 * each override then wins for its id — patching an existing entry or adding a new one.
 * Every entry keeps its English alias (§8.1). Throws on a malformed manual entry that
 * does not yield a valid LocalizedTerm (NO-FALLBACK: a broken override fails loudly
 * rather than silently dropping or half-applying — DESIGN §14.3 spirit).
 */
export function assembleDictionary(
  generated: readonly LocalizedTerm[],
  overrides: readonly ManualOverride[],
): Dictionary {
  const dict: Dictionary = {};
  for (const term of generated) {
    dict[term.id] = withEnglishAlias(term);
  }
  for (const ov of overrides) {
    const merged = applyOverride(dict[ov.id], ov);
    if (!isValidTerm(merged)) {
      throw new Error(
        `manual override "${ov.id}" did not produce a valid LocalizedTerm ` +
          `(missing domain/canonicalEn for a new entry?) — DESIGN §8.4 step J`,
      );
    }
    dict[ov.id] = merged;
  }
  return dict;
}

/** Load + validate the manual override store from `manual_ko_overrides.json`. */
export function loadManualOverrides(path: string): LoadedOverrides {
  const raw = readFileSync(path, 'utf8');
  const store = JSON.parse(raw) as OverrideStore;
  if (!Array.isArray(store.overrides)) {
    throw new Error(`manual override store "${path}" has no "overrides" array`);
  }
  return { updatedAt: store.updatedAt ?? DEFAULT_PROVENANCE, overrides: store.overrides };
}

/**
 * Run importer → match → assemble for the four §18 named domains (DESIGN §8.4 step H).
 *
 * Imports the cached PoE2DB fixtures under `fixtureDir`, resolves them to upstream ids
 * against `snapshot` (defaults to a read-only load of the vendored `src/Data` when a
 * `dataDir` is given), marks the resolved terms `source: 'generated'`, then layers the
 * manual override store from `overridePath`. The override store WINS (§8.4 step J).
 */
export function buildDictionary(
  fixtureDir: string,
  snapshot: UpstreamSnapshot,
  overridePath: string = join(fixtureDir, '..', '..', 'manual_ko_overrides.json'),
): Dictionary {
  const imported = importFromFixtures(fixtureDir);
  const { matched, reviewQueue } = matchTerms(imported, snapshot);
  const { updatedAt, overrides } = loadManualOverrides(overridePath);

  // Both auto-matched and review-queued terms enter the generated dictionary: the
  // dictionary records the best-known mapping (matched carries an upstream id; queued
  // carries the bilingual term with empty ids), tagged `generated` (§8.4 step H).
  // `updatedAt` is stamped from the store's authored provenance date — NOT the build's
  // wall-clock — so the same input yields a byte-identical artifact (DESIGN §12.2).
  const generated: LocalizedTerm[] = [...matched, ...reviewQueue].map((t) => ({
    ...t,
    source: 'generated',
    updatedAt,
  }));

  return assembleDictionary(generated, overrides);
}

/**
 * Render the dictionary to a DETERMINISTIC build artifact (DESIGN §12.2): keys sorted
 * ascending, each term's own fields emitted in a fixed order, 2-space indent, trailing
 * newline. Same input → byte-identical output, so `generated/dictionary.json` produces
 * a stable diff across rebuilds.
 */
export function serializeDictionary(dict: Dictionary): string {
  const ordered: Dictionary = {};
  for (const id of Object.keys(dict).sort()) {
    ordered[id] = orderTermFields(dict[id]!);
  }
  return JSON.stringify(ordered, null, 2) + '\n';
}

/** Emit a term's fields in a fixed key order so serialization is insertion-independent. */
function orderTermFields(t: LocalizedTerm): LocalizedTerm {
  const out: LocalizedTerm = {
    id: t.id,
    domain: t.domain,
    canonicalEn: t.canonicalEn,
    ko: t.ko,
    aliasesEn: t.aliasesEn,
    aliasesKo: t.aliasesKo,
    upstreamIds: t.upstreamIds,
    confidence: t.confidence,
    source: t.source,
    updatedAt: t.updatedAt,
  };
  if (t.slug !== undefined) out.slug = t.slug;
  if (t.poe2dbUrl !== undefined) out.poe2dbUrl = t.poe2dbUrl;
  return out;
}

export { loadUpstreamSnapshot };
