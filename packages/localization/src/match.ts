/**
 * Match imported terms to upstream Data ids (DESIGN §8.4 step F, §8.5 Matching 전략).
 *
 * Step F of the import pipeline (§8.4): the offline importer produces PoE2DB terms
 * with bilingual names + an anchor slug but an EMPTY `upstreamIds`. This module
 * resolves each term against a snapshot of the vendored upstream `src/Data`
 * identifiers and tags the result with a confidence per the §8.5 table:
 *
 *   | 대상     | Primary key                         | Fallback                       |
 *   | keyword  | PoE2DB anchor slug, English keyword | Korean label fuzzy             |
 *   | skill    | internal skill id, English gem name | icon/name/stat text            |
 *   | support  | gem id, English name                | support tag combination        |
 *   | base     | base type id, English name          | item class + requirements      |
 *   | unique   | unique name, base type              | explicit mods                  |
 *   | mod/stat | stat id                             | normalized description pattern |
 *
 * NO-FALLBACK (DESIGN §15, golden rule 3): a guess is NEVER silently promoted to an
 * `exact` match. Resolution is conservative — only a UNIQUE primary-key/name hit
 * auto-applies an upstream id (`exact`/`slug`); anything ambiguous (a normalized name
 * shared by multiple upstream ids) is tagged `fuzzy`, and anything unmatched keeps its
 * empty `upstreamIds`. Both fuzzy and unmatched terms are parked in the review queue
 * for human confirmation rather than force-assigned.
 *
 * The core {@link matchTerms} is PURE over an in-memory {@link UpstreamSnapshot}.
 * {@link loadUpstreamSnapshot} is the production path that READS (never writes) the
 * vendored `src/Data` Lua to build that snapshot — vendor/ stays untouched.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalizedTerm, TermConfidence, TermDomain } from './term.js';

/** One upstream identifier: its stable Data id, English name, and optional anchor slug. */
export interface UpstreamId {
  /** The upstream `src/Data` id — metadata key, base type id, stat id, etc. */
  id: string;
  /** Canonical English name as it appears in upstream Data. */
  name: string;
  /** PoE2DB-style anchor slug, when the upstream key is itself slug-shaped (keywords). */
  slug?: string;
}

/**
 * A snapshot of upstream identifiers, grouped by the §8.5 matching domains. Built once
 * (from the vendored Data, or inline in tests) and handed to {@link matchTerms}.
 */
export interface UpstreamSnapshot {
  keyword: UpstreamId[];
  skill: UpstreamId[];
  support_gem: UpstreamId[];
  base: UpstreamId[];
  unique: UpstreamId[];
  mod: UpstreamId[];
  stat: UpstreamId[];
}

/** Result of resolving a batch of terms: auto-applied matches vs. the human review queue. */
export interface MatchResult {
  /** Terms whose upstream id was resolved unambiguously (`exact` or `slug`). */
  matched: LocalizedTerm[];
  /** Terms needing human confirmation: `fuzzy` guesses + unmatched terms (empty ids). */
  reviewQueue: LocalizedTerm[];
}

/** The snapshot bucket a term domain resolves against (§8.5 rows). */
const DOMAIN_BUCKET: Partial<Record<TermDomain, keyof UpstreamSnapshot>> = {
  keyword: 'keyword',
  skill: 'skill',
  support_gem: 'support_gem',
  base: 'base',
  unique: 'unique',
  mod: 'mod',
  stat: 'stat',
};

/**
 * Normalize a name/slug for comparison: lowercase, collapse whitespace, and treat the
 * slug `_` separator as a space so a PoE2DB anchor (`Whirling_Assault`) and an upstream
 * name (`Whirling Assault`) compare equal. Used only for fallback/equality keys — the
 * resolved `upstreamIds` always carries the ORIGINAL upstream id, never the normalized form.
 */
function normKey(value: string): string {
  return value.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Build a name -> ids index for one snapshot bucket (a name may map to MANY ids -> ambiguous). */
function indexByName(entries: UpstreamId[]): Map<string, UpstreamId[]> {
  const map = new Map<string, UpstreamId[]>();
  for (const entry of entries) {
    const key = normKey(entry.name);
    (map.get(key) ?? map.set(key, []).get(key)!).push(entry);
  }
  return map;
}

/** Build a slug -> id index for buckets whose upstream entries carry an anchor slug. */
function indexBySlug(entries: UpstreamId[]): Map<string, UpstreamId> {
  const map = new Map<string, UpstreamId>();
  for (const entry of entries) {
    if (entry.slug !== undefined) map.set(normKey(entry.slug), entry);
  }
  return map;
}

/** A resolution decision for one term: the ids to apply (if any) and the confidence tag. */
interface Resolution {
  upstreamIds: string[];
  confidence: TermConfidence;
}

/**
 * Resolve one term against its snapshot bucket, per §8.5 (NO-FALLBACK):
 *   1. exact English-name hit, unique  -> `exact`
 *   2. anchor-slug hit (keywords)      -> `slug`
 *   3. name hit but AMBIGUOUS (>1 id)  -> `fuzzy`, ids withheld (queued for review)
 *   4. no hit                          -> unmatched, ids withheld (queued)
 * A `manual` confidence already on the term is honored as-is (human override wins).
 */
function resolve(
  term: LocalizedTerm,
  byName: Map<string, UpstreamId[]>,
  bySlug: Map<string, UpstreamId>,
): Resolution {
  // 1. Exact English-name match against the upstream primary name.
  const nameHits = byName.get(normKey(term.canonicalEn)) ?? [];
  if (nameHits.length === 1) {
    return { upstreamIds: [nameHits[0]!.id], confidence: 'exact' };
  }

  // 2. Anchor-slug match (PoE2DB keyword anchor). Only when the name was not a clean
  //    single hit — a slug hit is still an unambiguous primary-key match (§8.5).
  if (nameHits.length === 0 && term.slug !== undefined) {
    const slugHit = bySlug.get(normKey(term.slug));
    if (slugHit !== undefined) {
      return { upstreamIds: [slugHit.id], confidence: 'slug' };
    }
  }

  // 3. Name matched MULTIPLE upstream ids -> ambiguous guess. NO-FALLBACK: do not pick
  //    one; tag `fuzzy` and withhold ids so a human disambiguates from the review queue.
  if (nameHits.length > 1) {
    return { upstreamIds: [], confidence: 'fuzzy' };
  }

  // 4. No upstream counterpart found. Keep ids empty; queued unmatched (never guessed).
  return { upstreamIds: [], confidence: term.confidence };
}

/**
 * Resolve every imported term to upstream Data ids with a confidence tag (DESIGN §8.5).
 *
 * Pure over `snapshot`. Returns the auto-applied {@link MatchResult.matched} set
 * (`exact`/`slug`) and the {@link MatchResult.reviewQueue} (`fuzzy` guesses + unmatched
 * terms). A term appears in EXACTLY ONE of the two lists. Input terms are never mutated;
 * resolved copies carry the new `upstreamIds` + `confidence` and a refreshed `updatedAt`.
 */
export function matchTerms(
  terms: readonly LocalizedTerm[],
  snapshot: UpstreamSnapshot,
): MatchResult {
  const updatedAt = new Date().toISOString();
  const matched: LocalizedTerm[] = [];
  const reviewQueue: LocalizedTerm[] = [];

  // Build per-bucket name/slug indexes once.
  const nameIndex = new Map<keyof UpstreamSnapshot, Map<string, UpstreamId[]>>();
  const slugIndex = new Map<keyof UpstreamSnapshot, Map<string, UpstreamId>>();
  for (const key of Object.keys(snapshot) as (keyof UpstreamSnapshot)[]) {
    nameIndex.set(key, indexByName(snapshot[key]));
    slugIndex.set(key, indexBySlug(snapshot[key]));
  }

  for (const term of terms) {
    const bucketKey = DOMAIN_BUCKET[term.domain];
    const byName = (bucketKey && nameIndex.get(bucketKey)) || new Map();
    const bySlug = (bucketKey && slugIndex.get(bucketKey)) || new Map();

    const { upstreamIds, confidence } = resolve(term, byName, bySlug);
    const resolved: LocalizedTerm = { ...term, upstreamIds, confidence, updatedAt };

    // Auto-apply only unambiguous primary-key hits; everything else needs review.
    if ((confidence === 'exact' || confidence === 'slug') && upstreamIds.length === 1) {
      matched.push(resolved);
    } else {
      reviewQueue.push(resolved);
    }
  }

  return { matched, reviewQueue };
}

// ── Upstream snapshot loader (reads vendored src/Data; never writes) ────────────────

/** Pull the `["<key>"] = { name = "<name>", ... gemType = "<type>" }` rows out of Gems.lua. */
function parseGems(lua: string): { skill: UpstreamId[]; support_gem: UpstreamId[] } {
  const skill: UpstreamId[] = [];
  const support_gem: UpstreamId[] = [];
  // Each gem block opens with its metadata key, then declares name + gemType somewhere inside.
  const block = /\["(Metadata\/Items\/Gems\/[^"]+)"\]\s*=\s*\{([\s\S]*?)\n\t\},/g;
  let m: RegExpExecArray | null;
  while ((m = block.exec(lua)) !== null) {
    const id = m[1]!;
    const body = m[2]!;
    const name = /\bname\s*=\s*"([^"]+)"/.exec(body)?.[1];
    if (name === undefined) continue;
    const gemType = /\bgemType\s*=\s*"([^"]+)"/.exec(body)?.[1];
    (gemType === 'Support' ? support_gem : skill).push({ id, name });
  }
  return { skill, support_gem };
}

/** Pull `itemBases["<name>"] = {` keys (the base type id) out of one Bases/<class>.lua file. */
function parseBases(lua: string): UpstreamId[] {
  const bases: UpstreamId[] = [];
  const row = /itemBases\["([^"]+)"\]\s*=\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = row.exec(lua)) !== null) {
    const id = m[1]!;
    bases.push({ id, name: id });
  }
  return bases;
}

/** The Bases/<class>.lua files; their `itemBases[...]` keys are the upstream base type ids. */
const BASE_FILES = [
  'amulet',
  'axe',
  'belt',
  'body',
  'boots',
  'bow',
  'claw',
  'crossbow',
  'dagger',
  'flail',
  'flask',
  'focus',
  'gloves',
  'helmet',
  'jewel',
  'mace',
  'quiver',
  'ring',
  'sceptre',
  'shield',
  'spear',
  'staff',
  'sword',
  'talisman',
  'traptool',
  'wand',
] as const;

/**
 * Read the vendored upstream `src/Data` (DESIGN §8.5) into an {@link UpstreamSnapshot}.
 *
 * READ-ONLY: opens vendored Lua and extracts the identifier columns the §8.5 table
 * matches on (skill/support gem ids from Gems.lua, item base type ids from Bases/*.lua).
 * Domains without a discrete upstream identifier file (keyword anchors, which live in
 * PoE2DB, and unique/mod/stat — pending later Phase 6 tasks) come back empty here and
 * are supplied by their own sources; this loader never invents ids. vendor/ is NEVER
 * written.
 */
export function loadUpstreamSnapshot(dataDir: string): UpstreamSnapshot {
  const gems = parseGems(readFileSync(join(dataDir, 'Gems.lua'), 'utf8'));

  const base: UpstreamId[] = [];
  for (const file of BASE_FILES) {
    base.push(...parseBases(readFileSync(join(dataDir, 'Bases', `${file}.lua`), 'utf8')));
  }

  return {
    keyword: [],
    skill: gems.skill,
    support_gem: gems.support_gem,
    base,
    unique: [],
    mod: [],
    stat: [],
  };
}
