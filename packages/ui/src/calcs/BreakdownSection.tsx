/**
 * BreakdownSection — one collapsible §10.7 Calcs breakdown section (DESIGN §10.7
 * "Summary/Offence/Defence/Resource 접힘·펼침 breakdown 트리"):
 *
 *   ▼ 공격 (Offence)
 *     타격 피해 (Hit Damage)
 *       ▸ 전체 DPS  Total DPS         125000   (+25000)
 *       ▸ 평균 피해  Average Damage     8200
 *     치명타 (Crit)
 *       ▸ …
 *
 * Renders one {@link CalcsSection} from the p4-calcs-vm: its ko/en heading with a
 * collapse/expand toggle (the section body — its sub-groups of breakdown stat
 * rows — hides when collapsed), and one row per breakdown stat. Each stat row
 * shows the 최종값 + before/after delta + 한/영 label, and is itself expandable:
 * clicking the row toggle reveals its {@link FormulaTrace} (source list / formula /
 * upstream raw stat id) and reports `onExpandStat(statId)` upward so the host can
 * lazily fetch a missing calc.explain trace (DESIGN §10.7).
 *
 * §6.4 (NO-FALLBACK): a `present:false` missing stat carries `data-present="false"`
 * and shows the localized "값 없음" marker, never a fabricated 0. The delta region
 * is rendered only when the model carries a real before/after delta (never a
 * fabricated 0-delta). The component owns only the local expand state; all chrome
 * text resolves through `t` (§8.1).
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { FormulaTrace } from './FormulaTrace.js';
import type { BreakdownStat, CalcsSection } from './calcs-model.js';

/** Render a signed delta magnitude, e.g. `+25000` / `-30`. A 0 reads `0`. */
function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function StatRow({
  locale,
  stat,
  onExpandStat,
}: {
  locale: Locale;
  stat: BreakdownStat;
  onExpandStat?: (statId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) onExpandStat?.(stat.statId);
  };

  return (
    <li
      className="pob-calc-stat"
      role="listitem"
      data-stat-row={stat.statId}
      data-present={stat.present ? 'true' : 'false'}
      data-expanded={expanded ? 'true' : 'false'}
    >
      <button
        type="button"
        className="pob-calc-stat__head"
        data-stat-toggle
        aria-expanded={expanded}
        onClick={handleToggle}
      >
        <span className="pob-calc-stat__label-ko">{stat.labelKo}</span>
        <span className="pob-calc-stat__label-en">{stat.labelEn}</span>
        {stat.present ? (
          <span className="pob-calc-stat__value" data-final-value>
            {stat.finalValue}
          </span>
        ) : (
          <span className="pob-calc-stat__missing" data-missing>
            {t(locale, 'calcs.missing')}
          </span>
        )}
        {stat.present && stat.delta ? (
          <span className="pob-calc-stat__delta" data-delta>
            {signed(stat.delta.delta)}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <div className="pob-calc-stat__trace">
          <FormulaTrace locale={locale} trace={stat.trace} />
        </div>
      ) : null}
    </li>
  );
}

export interface BreakdownSectionProps {
  /** Active locale, drives every label across the section. */
  locale: Locale;
  /** The §10.7 breakdown section to render (one of Summary/Offence/…/Raw trace). */
  section: CalcsSection;
  /**
   * Called with the stat id when a stat row is expanded (DESIGN §10.7). Lets the
   * host lazily fetch that stat's calc.explain trace; the CalcsPanel debounces it.
   */
  onExpandStat?: (statId: string) => void;
}

export function BreakdownSection({ locale, section, onExpandStat }: BreakdownSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const labelKo = section.labelKo;
  const labelEn = section.labelEn;

  return (
    <section
      className="pob-calc-section"
      data-section={section.id}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <button
        type="button"
        className="pob-calc-section__head"
        data-section-toggle
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="pob-calc-section__label-ko">{labelKo}</span>
        <span className="pob-calc-section__label-en">{labelEn}</span>
      </button>

      {collapsed ? null : (
        <div className="pob-calc-section__body">
          {section.groups.map((group) => (
            <div className="pob-calc-group" key={group.id} data-group={group.id}>
              <h4 className="pob-calc-group__title">
                <span className="pob-calc-group__label-ko">{group.labelKo}</span>
                <span className="pob-calc-group__label-en">{group.labelEn}</span>
              </h4>
              <ul className="pob-calc-group__stats" role="list">
                {group.stats.map((stat) => (
                  <StatRow
                    key={stat.statId}
                    locale={locale}
                    stat={stat}
                    onExpandStat={onExpandStat}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
