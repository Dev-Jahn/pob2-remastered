/**
 * CalcsPanel — the §10.7 Calcs tab breakdown explorer (DESIGN §10.7 + gates.mjs
 * VISUAL[4] '/calcs'):
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │ 계산 (Calcs)                                                   │
 *   │ ▼ 요약 (Summary)        …                                      │
 *   │ ▼ 공격 (Offence)        Hit / Crit / Ailments / DoT           │
 *   │ ▼ 방어 (Defence)        Life·ES·Mana / Res / Armour·Ev / EHP  │
 *   │ ▼ 자원 (Resource)       …                                      │
 *   │ ▼ 원시 trace (Raw trace) …                                     │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Renders the p4-calcs-vm {@link CalcsViewModel} as the §10.7 breakdown tree —
 * Summary / Offence / Defence / Resource (+ Raw trace) — one collapsible
 * {@link BreakdownSection} each, in model order. Each breakdown stat row carries
 * its 최종값 + before/after delta + 기여 source list + formula trace + upstream raw
 * stat id + 한/영 label; expanding a row reveals its {@link FormulaTrace}.
 *
 * Lazy calc.explain (DESIGN §10.7 "stat 행 클릭 시 calc.explain을 호출(debounce)"):
 * when a stat row WITHOUT an already-loaded trace is expanded, the panel dispatches
 * `onExplain(statId)` so the host can fetch that stat's calc.explain and re-render
 * with the trace filled in. The dispatch is debounced (`explainDebounceMs`, default
 * 250ms) and coalesces a burst of expand/collapse toggles on the same stat into a
 * single request. A stat whose trace is already present in the model is never
 * re-requested (NO-FALLBACK §6.4: the panel only asks for what it is missing).
 *
 * The panel owns only the debounce timer; the per-stat/section expand state lives
 * in the child sections. All chrome text resolves through `t` (§8.1).
 */
import { useEffect, useMemo, useRef } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { BreakdownSection } from './BreakdownSection.js';
import type { CalcsViewModel } from './calcs-model.js';

/** Default calc.explain debounce window (ms) for a burst of row expands. */
const DEFAULT_DEBOUNCE_MS = 250;

export interface CalcsPanelProps {
  /** Active locale, drives every label across the breakdown tree. */
  locale: Locale;
  /** The §10.7 Calcs breakdown view-model (p4-calcs-vm). */
  model: CalcsViewModel;
  /**
   * Called (debounced) with the stat id when a stat row WITHOUT a loaded trace is
   * expanded, so the host can fetch its calc.explain (DESIGN §10.7). A stat whose
   * trace is already in the model is never re-requested.
   */
  onExplain?: (statId: string) => void;
  /** Debounce window for the calc.explain dispatch (ms). Defaults to 250ms. */
  explainDebounceMs?: number;
}

export function CalcsPanel({ locale, model, onExplain, explainDebounceMs }: CalcsPanelProps) {
  const debounceMs = explainDebounceMs ?? DEFAULT_DEBOUNCE_MS;

  // The set of stat ids whose calc.explain trace is already loaded in the model:
  // expanding one of these must NOT re-request its trace (NO-FALLBACK §6.4).
  const explainedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const section of model.sections) {
      for (const group of section.groups) {
        for (const stat of group.stats) {
          if (stat.trace.explained) ids.add(stat.statId);
        }
      }
    }
    return ids;
  }, [model]);

  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Keep the latest callback / debounce window reachable from the timer without
  // re-arming it: the debounce only re-arms when a new stat is expanded.
  const onExplainRef = useRef(onExplain);
  onExplainRef.current = onExplain;

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleExpandStat = (statId: string) => {
    if (onExplainRef.current === undefined) return;
    // Already-loaded traces never refetch.
    if (explainedIds.has(statId)) return;
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      onExplainRef.current?.(statId);
    }, debounceMs);
  };

  return (
    <div className="pob-calcs">
      <header className="pob-calcs__header">
        <h2 className="pob-calcs__title">{t(locale, 'calcs.title')}</h2>
      </header>
      <div className="pob-calcs__tree">
        {model.sections.map((section) => (
          <BreakdownSection
            key={section.id}
            locale={locale}
            section={section}
            onExpandStat={handleExpandStat}
          />
        ))}
      </div>
    </div>
  );
}
