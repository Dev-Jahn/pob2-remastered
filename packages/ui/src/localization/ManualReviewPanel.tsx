/**
 * ManualReviewPanel — the §8.6 step-5 manual review UI (DESIGN §8.6 step 5 "사용자가
 * 직접 mod mapping을 제안할 수 있는 review UI", §18 "manual review UI").
 *
 * A renderer over {@link buildReviewQueueModel}: a titled list whose rows are the
 * loc-match review queue (the `fuzzy` + unmatched terms §8.5 parks) plus the §8.6
 * unsupported clipboard mod lines. Each row lets the reviewer propose a Korean→
 * internal-id mapping; submitting emits a pending {@link ManualOverrideProposal}
 * destined for `manual_ko_mod_overrides.json` (§8.6 step 6) through `onProposeOverride`.
 *
 * Persistence is the callback prop — pure UI (DESIGN §5.1, §14.2 no direct FS). The
 * host writes the file.
 *
 * NO-FALLBACK (DESIGN §8.6 step 4, golden rule 3): an unsupported clipboard line is
 * offered for mapping but is NEVER silently auto-accepted — its row has no candidate
 * ids, only a free-text internal-id input, and {@link proposeOverrideFromEntry}
 * throws on an empty id, so submitting without typing one emits nothing. A fuzzy
 * term's candidate ids are pickable; the chosen one (or a typed override) is what is
 * committed. All chrome resolves through the i18n resolver `t` (§8.1).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { buildReviewQueueModel, proposeOverrideFromEntry } from './review-queue.js';
import type { ReviewEntry, ReviewQueueInput, ManualOverrideProposal } from './review-queue.js';

export interface ManualReviewPanelProps {
  /** Active locale, drives the title, candidate labels, and the submit/id-input chrome. */
  locale: Locale;
  /** The review queue to render (fuzzy/unmatched terms + unsupported clipboard lines). */
  input: ReviewQueueInput;
  /**
   * Called with the pending override when a row's mapping is submitted. The host
   * persists it into `manual_ko_mod_overrides.json` (§8.6 step 6) — the UI never writes.
   */
  onProposeOverride: (proposal: ManualOverrideProposal) => void;
}

/**
 * One review row. Owns the reviewer's local choice: the selected candidate id (for a
 * fuzzy term) and/or a free-text internal id (for an unsupported clipboard line). On
 * submit it forms the proposal — the typed id wins over the picked candidate; if
 * neither is present, {@link proposeOverrideFromEntry} throws and nothing is emitted
 * (NO-FALLBACK: an unsupported line is never auto-accepted).
 */
function ReviewRow({
  entry,
  locale,
  onProposeOverride,
}: {
  entry: ReviewEntry;
  locale: Locale;
  onProposeOverride: (proposal: ManualOverrideProposal) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [typedId, setTypedId] = useState('');

  function submit() {
    const chosenId = typedId.trim() !== '' ? typedId.trim() : picked;
    const upstreamIds = chosenId !== null ? [chosenId] : [];
    let proposal: ManualOverrideProposal;
    try {
      // NO-FALLBACK: throws when no id was chosen/typed — the line is not auto-accepted.
      proposal = proposeOverrideFromEntry(entry, { ko: entry.ko, upstreamIds });
    } catch {
      return;
    }
    onProposeOverride(proposal);
  }

  return (
    <li className="pob-review__row" data-testid={`review-entry-${entry.id}`} data-kind={entry.kind}>
      <span className="pob-review__ko">{entry.ko}</span>

      {entry.candidateUpstreamIds.length > 0 ? (
        <ul className="pob-review__candidates" aria-label={t(locale, 'review.candidates')}>
          {entry.candidateUpstreamIds.map((candidate) => (
            <li key={candidate}>
              <button
                type="button"
                className="pob-review__candidate"
                data-selected={picked === candidate}
                onClick={() => setPicked(candidate)}
              >
                {candidate}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <label className="pob-review__id-field">
        <span className="pob-review__id-label">{t(locale, 'review.internalIdLabel')}</span>
        <input
          className="pob-review__id-input"
          aria-label={t(locale, 'review.internalIdLabel')}
          value={typedId}
          onChange={(event) => setTypedId(event.target.value)}
        />
      </label>

      <button type="button" className="pob-review__submit" onClick={submit}>
        {t(locale, 'review.submit')}
      </button>
    </li>
  );
}

export function ManualReviewPanel({ locale, input, onProposeOverride }: ManualReviewPanelProps) {
  const model = buildReviewQueueModel(input);
  return (
    <section className="pob-review" aria-label={t(locale, model.titleKey)}>
      <h3 className="pob-review__title">{t(locale, model.titleKey)}</h3>
      {model.entries.length === 0 ? (
        <p className="pob-review__empty" data-review-empty>
          {t(locale, 'review.empty')}
        </p>
      ) : (
        <ul className="pob-review__list">
          {model.entries.map((entry) => (
            <ReviewRow
              key={entry.id}
              entry={entry}
              locale={locale}
              onProposeOverride={onProposeOverride}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
