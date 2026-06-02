/**
 * FormulaTrace — one breakdown stat's calc.explain trace (DESIGN §10.7 "기여
 * source list + formula trace + upstream raw stat id"):
 *
 *   ┌────────────────────────────────────────────────────────────┐
 *   │ 기여도                                                       │
 *   │   · [item]       Doryani Catalyst            +40            │
 *   │   · [passive]    Heart of Flame              +12            │
 *   │   …                                                         │
 *   │ 공식        base * (1 + inc) = 125000                       │
 *   │ 원본 스탯 ID  Output.TotalDPS                               │
 *   └────────────────────────────────────────────────────────────┘
 *
 * Renders a {@link BreakdownTrace} from the p4-calcs-vm. A trace backed by a
 * calc.explain response (`explained:true`) shows the classified contribution
 * source list (item / passive / skillGem / supportGem / config / buff), the
 * human-readable formula trace string, and the upstream raw stat id. Each source
 * carries `data-source-kind` so the origin classification is machine-checkable
 * (never colour-only, §11.3).
 *
 * §6.4 (NO-FALLBACK): a present-but-unexplained stat (`explained:false`) shows the
 * localized "trace 없음" marker instead — its source list and formula are never
 * fabricated. The component is pure props: it owns no state and performs no IO.
 * All chrome text resolves through `t` (§8.1).
 */
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import type { BreakdownTrace } from './calcs-model.js';

/** Render a signed contribution magnitude, e.g. `+40` / `-12`. A 0 reads `0`. */
function signed(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

export interface FormulaTraceProps {
  /** Active locale, drives the trace labels and the "trace 없음" marker. */
  locale: Locale;
  /** The §10.7 formula trace to render (explained, or the "trace 없음" marker). */
  trace: BreakdownTrace;
}

export function FormulaTrace({ locale, trace }: FormulaTraceProps) {
  if (!trace.explained) {
    return (
      <div className="pob-calc-trace pob-calc-trace--no-trace" data-no-trace>
        <span className="pob-calc-trace__no-trace">{t(locale, 'calcs.noTrace')}</span>
      </div>
    );
  }

  return (
    <div className="pob-calc-trace" data-trace>
      <section className="pob-calc-trace__sources" data-sources>
        <h5 className="pob-calc-trace__heading">{t(locale, 'calcs.sources')}</h5>
        <ul className="pob-calc-trace__source-list" role="list">
          {trace.sources.map((source, i) => (
            <li
              key={i}
              className="pob-calc-trace__source"
              role="listitem"
              data-source
              data-source-kind={source.kind}
            >
              <span className="pob-calc-trace__source-kind">{source.kind}</span>
              <span className="pob-calc-trace__source-label">{source.label}</span>
              <span className="pob-calc-trace__source-value">{signed(source.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="pob-calc-trace__formula" data-formula>
        <span className="pob-calc-trace__formula-label">{t(locale, 'calcs.formula')}</span>
        <code className="pob-calc-trace__formula-text">{trace.formula}</code>
      </div>

      <div className="pob-calc-trace__upstream" data-upstream-stat-id>
        <span className="pob-calc-trace__upstream-label">{t(locale, 'calcs.upstreamStatId')}</span>
        <code className="pob-calc-trace__upstream-id">{trace.upstreamStatId}</code>
      </div>
    </div>
  );
}
