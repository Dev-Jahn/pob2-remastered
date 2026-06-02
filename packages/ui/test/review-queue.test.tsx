// Manual review UI test (DESIGN §8.6 step 5 "사용자가 직접 mod mapping을 제안할 수 있는
// review UI", §8.6 step 6 manual_ko_mod_overrides.json, §18 "manual review UI";
// §8.5 fuzzy/unmatched review queue; §6.4 / golden rule 3 NO-FALLBACK).
//
// The manual review UI surfaces the loc-match review queue — the fuzzy + unmatched
// terms matchTerms() parks for human confirmation (§8.5) — alongside the §8.6
// unsupported clipboard mod lines the Korean item-paste parser could not recognise,
// lets the user propose a Korean→internal-id mapping, and shows the proposal as a
// PENDING override record destined for manual_ko_mod_overrides.json (§8.6 step 6).
// Persistence is a callback prop (onProposeOverride) — pure UI/view-model, no FS.
//
// The task's three named unit pins:
//   1. a QUEUED FUZZY term renders with its candidate matches (the upstream ids the
//      ambiguous name resolved to are offered as pickable candidates, not hidden);
//   2. SUBMITTING a mapping emits the expected ManualOverride record (id + ko +
//      chosen upstreamIds + a reviewer note marking provenance), destined for
//      manual_ko_mod_overrides.json;
//   3. an UNSUPPORTED clipboard line is offered for mapping and is NEVER silently
//      auto-accepted — it carries no candidate ids and no preselected mapping, so it
//      cannot be committed without the human typing an internal id (NO-FALLBACK).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import {
  buildReviewQueueModel,
  proposeOverrideFromEntry,
  ManualReviewPanel,
  t,
} from '../src/index.js';
import type { ReviewQueueInput, ManualOverrideProposal } from '../src/index.js';
import type { LocalizedTerm } from '@pob2/localization';

afterEach(cleanup);

// ── Fixtures ────────────────────────────────────────────────────────────────────

// A FUZZY mod term: its English name matched MULTIPLE upstream stat ids, so
// matchTerms withheld the ids and tagged it `fuzzy` (§8.5 step 3). The candidate
// ids it COULD map to are carried alongside for the reviewer to pick from.
const FUZZY_TERM: LocalizedTerm = {
  id: 'mod/increased-fire-damage',
  domain: 'mod',
  canonicalEn: 'Increased Fire Damage',
  ko: '증가한 화염 피해',
  aliasesEn: ['Increased Fire Damage'],
  aliasesKo: [],
  upstreamIds: [], // withheld — ambiguous, queued for review
  confidence: 'fuzzy',
  source: 'poe2db',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

// The candidate upstream ids the fuzzy name resolved to (the ambiguity that made it
// fuzzy). The reviewer disambiguates by choosing one of these.
const FUZZY_CANDIDATES = ['LocalIncreasedFireDamagePercent', 'GlobalIncreasedFireDamagePercent'];

// An UNMATCHED term: no upstream counterpart at all (empty candidate list).
const UNMATCHED_TERM: LocalizedTerm = {
  id: 'mod/unknown-suffix',
  domain: 'mod',
  canonicalEn: 'of the Newt',
  ko: '영원의',
  aliasesEn: ['of the Newt'],
  aliasesKo: [],
  upstreamIds: [],
  confidence: 'fuzzy',
  source: 'poe2db',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

// A §8.6 UNSUPPORTED clipboard mod line: a raw Korean affix line the item-paste
// parser preserved but could not recognise (§8.6 step 4). It has NO internal id.
const UNSUPPORTED_LINE = '적에게 주는 피해 25% 증가';

const INPUT: ReviewQueueInput = {
  terms: [
    { term: FUZZY_TERM, candidateUpstreamIds: FUZZY_CANDIDATES },
    { term: UNMATCHED_TERM, candidateUpstreamIds: [] },
  ],
  unsupportedClipboardLines: [UNSUPPORTED_LINE],
};

// ── View-model ──────────────────────────────────────────────────────────────────

describe('buildReviewQueueModel (DESIGN §8.6 step 5, §8.5 review queue)', () => {
  const model = buildReviewQueueModel(INPUT);

  it('surfaces every fuzzy/unmatched term AND every unsupported clipboard line', () => {
    // 2 queued terms + 1 unsupported clipboard line = 3 review entries.
    expect(model.entries).toHaveLength(3);
    expect(model.entries.map((e) => e.kind).sort()).toEqual([
      'clipboard-line',
      'fuzzy-term',
      'fuzzy-term',
    ]);
  });

  it('carries the candidate matches for a queued fuzzy term (PIN: candidates offered)', () => {
    const entry = model.entries.find((e) => e.id === FUZZY_TERM.id);
    expect(entry).toBeDefined();
    expect(entry!.kind).toBe('fuzzy-term');
    expect(entry!.ko).toBe(FUZZY_TERM.ko);
    // The two ambiguous upstream ids are offered as pickable candidates.
    expect(entry!.candidateUpstreamIds).toEqual(FUZZY_CANDIDATES);
  });

  it('marks an unsupported clipboard line with no candidates (PIN: never auto-accepted)', () => {
    const entry = model.entries.find((e) => e.kind === 'clipboard-line');
    expect(entry).toBeDefined();
    // The raw §8.6 line is preserved verbatim and carries NO candidate ids — the
    // reviewer must supply an internal id; it cannot be committed by picking a
    // candidate (NO-FALLBACK: no silent auto-accept).
    expect(entry!.rawLine).toBe(UNSUPPORTED_LINE);
    expect(entry!.candidateUpstreamIds).toEqual([]);
    expect(entry!.domain).toBe('mod');
  });
});

describe('proposeOverrideFromEntry (DESIGN §8.6 step 6 manual_ko_mod_overrides.json)', () => {
  const model = buildReviewQueueModel(INPUT);

  it('emits the expected ManualOverride record for a fuzzy term mapping (PIN)', () => {
    const entry = model.entries.find((e) => e.id === FUZZY_TERM.id)!;
    const proposal = proposeOverrideFromEntry(entry, {
      ko: '증가한 화염 피해',
      upstreamIds: ['LocalIncreasedFireDamagePercent'],
    });
    // The pending record destined for manual_ko_mod_overrides.json.
    expect(proposal.override.id).toBe(FUZZY_TERM.id);
    expect(proposal.override.ko).toBe('증가한 화염 피해');
    expect(proposal.override.domain).toBe('mod');
    expect(proposal.override.upstreamIds).toEqual(['LocalIncreasedFireDamagePercent']);
    // It is destined for the §8.6 step-6 override store, marked as a pending
    // human-review proposal (not an auto-applied generated entry).
    expect(proposal.targetFile).toBe('manual_ko_mod_overrides.json');
    expect(proposal.status).toBe('pending');
  });

  it('requires the human to supply an internal id for an unsupported line (PIN)', () => {
    const entry = model.entries.find((e) => e.kind === 'clipboard-line')!;
    // With no upstream id chosen/typed, the proposal cannot be formed — NO-FALLBACK:
    // the raw line is never silently mapped to a guessed id.
    expect(() => proposeOverrideFromEntry(entry, { ko: '...', upstreamIds: [] })).toThrow();
    // With a human-typed id, it forms a normal override destined for the same store.
    const proposal = proposeOverrideFromEntry(entry, {
      ko: '적에게 주는 피해 증가',
      upstreamIds: ['DamageTakenPercent'],
    });
    expect(proposal.override.upstreamIds).toEqual(['DamageTakenPercent']);
    expect(proposal.targetFile).toBe('manual_ko_mod_overrides.json');
  });
});

// ── Component ─────────────────────────────────────────────────────────────────

describe('ManualReviewPanel component (DESIGN §8.6 step 5, §18 manual review UI)', () => {
  it('renders a queued fuzzy term with its candidate matches (PIN)', () => {
    render(<ManualReviewPanel locale="ko-KR" input={INPUT} onProposeOverride={vi.fn()} />);
    const row = screen.getByTestId(`review-entry-${FUZZY_TERM.id}`);
    // The Korean term text is shown.
    expect(within(row).getByText(FUZZY_TERM.ko)).toBeTruthy();
    // Both ambiguous candidate ids are rendered as pickable options.
    for (const candidate of FUZZY_CANDIDATES) {
      expect(within(row).getByText(candidate)).toBeTruthy();
    }
  });

  it('emits the expected override record when a mapping is submitted (PIN)', () => {
    const onProposeOverride = vi.fn();
    render(
      <ManualReviewPanel locale="ko-KR" input={INPUT} onProposeOverride={onProposeOverride} />,
    );
    const row = screen.getByTestId(`review-entry-${FUZZY_TERM.id}`);
    // Pick the first candidate id, then submit the mapping.
    fireEvent.click(within(row).getByText(FUZZY_CANDIDATES[0]!));
    fireEvent.click(within(row).getByRole('button', { name: t('ko-KR', 'review.submit') }));

    expect(onProposeOverride).toHaveBeenCalledTimes(1);
    const proposal = onProposeOverride.mock.calls[0]![0] as ManualOverrideProposal;
    expect(proposal.override.id).toBe(FUZZY_TERM.id);
    expect(proposal.override.upstreamIds).toEqual([FUZZY_CANDIDATES[0]]);
    expect(proposal.targetFile).toBe('manual_ko_mod_overrides.json');
    expect(proposal.status).toBe('pending');
  });

  it('offers an unsupported clipboard line for mapping but never auto-accepts it (PIN)', () => {
    const onProposeOverride = vi.fn();
    render(
      <ManualReviewPanel locale="ko-KR" input={INPUT} onProposeOverride={onProposeOverride} />,
    );
    const row = screen.getByTestId('review-entry-clipboard-0');
    // The raw line is shown and offered for mapping.
    expect(within(row).getByText(UNSUPPORTED_LINE)).toBeTruthy();
    // Submitting WITHOUT typing an internal id does NOT emit an override — the line is
    // never silently auto-accepted (NO-FALLBACK).
    fireEvent.click(within(row).getByRole('button', { name: t('ko-KR', 'review.submit') }));
    expect(onProposeOverride).not.toHaveBeenCalled();

    // After the human types an internal id, submitting emits a pending override.
    const idInput = within(row).getByLabelText(t('ko-KR', 'review.internalIdLabel'));
    fireEvent.change(idInput, { target: { value: 'DamageTakenPercent' } });
    fireEvent.click(within(row).getByRole('button', { name: t('ko-KR', 'review.submit') }));
    expect(onProposeOverride).toHaveBeenCalledTimes(1);
    const proposal = onProposeOverride.mock.calls[0]![0] as ManualOverrideProposal;
    expect(proposal.override.upstreamIds).toEqual(['DamageTakenPercent']);
    expect(proposal.targetFile).toBe('manual_ko_mod_overrides.json');
  });

  it('renders the localized panel title (ko-KR)', () => {
    render(<ManualReviewPanel locale="ko-KR" input={INPUT} onProposeOverride={vi.fn()} />);
    expect(screen.getByText(t('ko-KR', 'review.title'))).toBeTruthy();
  });
});
