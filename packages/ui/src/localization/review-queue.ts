/**
 * Manual review UI view-model (DESIGN §8.6 step 5 "사용자가 직접 mod mapping을 제안할
 * 수 있는 review UI", §8.6 step 6 manual_ko_mod_overrides.json, §18 "manual review
 * UI"; §8.5 fuzzy/unmatched review queue; §6.4 / golden rule 3 NO-FALLBACK).
 *
 * A pure, framework-free transform that turns the loc-match review queue — the
 * `fuzzy` + unmatched {@link LocalizedTerm}s {@link matchTerms} parks for human
 * confirmation (§8.5) — together with the §8.6 unsupported clipboard mod lines the
 * Korean item-paste parser preserved but could not recognise (§8.6 step 4), into a
 * flat list of review entries the {@link ManualReviewPanel} renders. Each entry
 * surfaces the candidate upstream ids a fuzzy term resolved to (so the reviewer can
 * disambiguate) and lets the reviewer propose a Korean→internal-id mapping.
 *
 * A submitted mapping is reduced to a PENDING {@link ManualOverrideProposal} — a
 * {@link ManualOverride} record destined for `manual_ko_mod_overrides.json` (§8.6
 * step 6). This module never persists: the panel takes an `onProposeOverride`
 * callback and the host writes the file (DESIGN §5.1 UI layer holds view-models,
 * §14.2 no direct FS).
 *
 * NO-FALLBACK (DESIGN §8.6 step 4, golden rule 3): an unsupported clipboard line has
 * NO candidate ids and NO preselected mapping; it cannot be committed unless the
 * human supplies an internal id. {@link proposeOverrideFromEntry} THROWS on an empty
 * `upstreamIds` rather than silently mapping the raw line to a guessed id — a line is
 * never auto-accepted.
 */
import type { LocalizedTerm, ManualOverride, TermDomain } from '@pob2/localization';
import type { StringKey } from '../i18n/index.js';

/** The §8.6 step-6 override store a proposal is destined for. */
export const REVIEW_OVERRIDE_FILE = 'manual_ko_mod_overrides.json';

/**
 * One queued term plus the candidate upstream ids it resolved to. The §8.5 matcher
 * tags an ambiguous term `fuzzy` and WITHHOLDS its ids; the candidates the
 * normalized name matched are carried here so the reviewer can pick one (an unmatched
 * term simply carries an empty candidate list).
 */
export interface QueuedTerm {
  /** The fuzzy/unmatched term (its `upstreamIds` is empty — withheld for review). */
  term: LocalizedTerm;
  /** The upstream ids the ambiguous name matched — the reviewer disambiguates from these. */
  candidateUpstreamIds: string[];
}

/** The review queue the panel renders: queued terms + unsupported clipboard lines. */
export interface ReviewQueueInput {
  /** Fuzzy/unmatched terms from {@link matchTerms}'s reviewQueue, each with its candidates. */
  terms: QueuedTerm[];
  /** §8.6 unsupported clipboard mod lines: raw Korean affix lines the parser kept (step 4). */
  unsupportedClipboardLines: string[];
}

/** Which source a review entry came from: a queued fuzzy/unmatched term, or a clipboard line. */
export type ReviewEntryKind = 'fuzzy-term' | 'clipboard-line';

/**
 * One review entry the panel renders — a row the reviewer maps to an internal id.
 *
 * For a `fuzzy-term` entry, `candidateUpstreamIds` carries the ids to disambiguate
 * between and `ko` is the term's Korean text. For a `clipboard-line` entry,
 * `rawLine` is the verbatim §8.6 line, `candidateUpstreamIds` is EMPTY (NO-FALLBACK:
 * the reviewer must supply an id), and `domain` defaults to `mod` (a clipboard affix
 * line is a mod by §8.6).
 */
export interface ReviewEntry {
  /** Stable key for the entry (the term id, or a synthetic `clipboard-<n>` for a line). */
  id: string;
  kind: ReviewEntryKind;
  /** Localization domain this entry's override targets (a clipboard affix line is a `mod`). */
  domain: TermDomain;
  /** Korean text shown for the entry: the term's `ko`, or the raw clipboard line. */
  ko: string;
  /** The verbatim §8.6 clipboard line, for a `clipboard-line` entry only. */
  rawLine?: string;
  /** Candidate upstream ids to pick from — empty for a clipboard line (NO-FALLBACK). */
  candidateUpstreamIds: string[];
}

/** The full review-queue model: an i18n title key plus one entry per review item. */
export interface ReviewQueueModel {
  /** i18n key for the panel title (Settings/About → localization → manual review). */
  titleKey: StringKey;
  entries: ReviewEntry[];
}

/** The reviewer's proposed mapping for one entry: the Korean string + the chosen id(s). */
export interface ProposedMapping {
  /** The Korean display string for the mapped term (defaults to the entry's `ko`). */
  ko: string;
  /** The internal upstream id(s) the reviewer chose/typed (must be non-empty to commit). */
  upstreamIds: string[];
}

/**
 * A pending override proposal: the {@link ManualOverride} record plus where it is
 * destined and its review status. The host persists `override` into `targetFile`
 * (§8.6 step 6); the UI never writes it.
 */
export interface ManualOverrideProposal {
  /** The override record to append to the §8.6 step-6 store. */
  override: ManualOverride;
  /** The store this override is destined for (`manual_ko_mod_overrides.json`). */
  targetFile: typeof REVIEW_OVERRIDE_FILE;
  /** Always `pending`: a human-review proposal, not an auto-applied generated entry. */
  status: 'pending';
}

/**
 * Build the §8.6 step-5 review-queue model from the loc-match review queue and the
 * unsupported clipboard lines. Pure: every fuzzy/unmatched term becomes a
 * `fuzzy-term` entry carrying its candidate ids, and every unsupported clipboard line
 * becomes a `clipboard-line` entry with NO candidates (NO-FALLBACK — never
 * pre-mapped). Term entries come first, then clipboard entries.
 */
export function buildReviewQueueModel(input: ReviewQueueInput): ReviewQueueModel {
  const termEntries: ReviewEntry[] = input.terms.map(({ term, candidateUpstreamIds }) => ({
    id: term.id,
    kind: 'fuzzy-term',
    domain: term.domain,
    ko: term.ko,
    candidateUpstreamIds: [...candidateUpstreamIds],
  }));

  const lineEntries: ReviewEntry[] = input.unsupportedClipboardLines.map((rawLine, index) => ({
    id: `clipboard-${index}`,
    kind: 'clipboard-line',
    // A §8.6 clipboard affix line is a mod (it parses as an item modifier line).
    domain: 'mod',
    ko: rawLine,
    rawLine,
    // NO-FALLBACK: an unsupported line is never pre-mapped — no candidate ids.
    candidateUpstreamIds: [],
  }));

  return { titleKey: 'review.title', entries: [...termEntries, ...lineEntries] };
}

/**
 * Reduce a review entry + the reviewer's chosen mapping to a pending
 * {@link ManualOverrideProposal} destined for `manual_ko_mod_overrides.json` (§8.6
 * step 6).
 *
 * NO-FALLBACK (DESIGN §8.6 step 4, golden rule 3): throws when the mapping carries no
 * `upstreamIds` — an entry (especially an unsupported clipboard line) is NEVER
 * silently auto-accepted with a guessed/empty id. The reviewer must supply at least
 * one internal id. The emitted override is tagged for the override store via
 * `assembleDictionary`'s `manual` merge (it picks up `confidence: 'manual'`,
 * `source: 'manual'` at assembly).
 */
export function proposeOverrideFromEntry(
  entry: ReviewEntry,
  mapping: ProposedMapping,
): ManualOverrideProposal {
  if (mapping.upstreamIds.length === 0) {
    throw new Error(
      `Cannot propose an override for "${entry.id}" without an internal upstream id ` +
        '(NO-FALLBACK: an unsupported line is never auto-accepted).',
    );
  }

  const override: ManualOverride = {
    id: entry.id,
    domain: entry.domain,
    ko: mapping.ko,
    upstreamIds: [...mapping.upstreamIds],
    // Provenance: a human review of a §8.6 fuzzy/unsupported entry.
    note: `manual review: ${entry.kind}`,
  };

  return { override, targetFile: REVIEW_OVERRIDE_FILE, status: 'pending' };
}
