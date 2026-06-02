/**
 * SkillsPanel — the §10.5 Skills tab 2-region layout (DESIGN §10.5):
 *
 *   ┌──────────────────────────┬──────────────────────────────┐
 *   │ Skill Groups             │ Inspector                    │
 *   │ (skill-group card list)  │ (selected main skill)        │
 *   │                          │  · damage breakdown          │
 *   │  ┌ Fireball ──────────┐  │  · support gem contribution  │
 *   │  │ [chips + toggles]  │  │  · gem level/quality delta   │
 *   │  └────────────────────┘  │                              │
 *   └──────────────────────────┴──────────────────────────────┘
 *
 * The two regions carry `data-region="groups|inspector"` so the layout is
 * machine-checkable. The panel owns only the *selected main-skill* state: clicking
 * a {@link SkillGroupCard} marks it selected and fires `onSelectGroup` so the host
 * can fetch and supply the §10.5 inspector model (damage breakdown / support gem
 * contribution / gem level·quality delta). Everything else — the card models, the
 * inspector model, the gem-category metadata — is supplied by the host (this panel
 * stays free of app/IO coupling, like the Items / Overview panels). All chrome text
 * resolves through `t` (§8.1).
 *
 * NO-FALLBACK (§6.4): the inspector renders only what the host hands it. With no
 * selection (or no inspector model yet) it shows a localized empty-state hint, not
 * a fabricated breakdown; the gem-delta rows show real level/quality values.
 */
import { useState } from 'react';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { SkillGroupCard } from './SkillGroupCard.js';
import type { SkillsViewModel } from './skills-model.js';

/** One row of the §10.5 inspector damage breakdown (label → formatted value). */
export interface DamageBreakdownRow {
  label: string;
  value: string;
}

/** One support gem's contribution to the selected skill (DESIGN §10.5). */
export interface SupportContributionRow {
  gemId: string;
  name: string;
  /** Pre-formatted contribution, e.g. "+18.4% DPS" (NO-FALLBACK: host-supplied). */
  contribution: string;
}

/** One gem's level/quality and the delta a +1/+1 step would yield (DESIGN §10.5). */
export interface GemDeltaRow {
  gemId: string;
  name: string;
  level: number;
  quality: number;
  /** Delta a +1 gem-level step would produce (host-supplied, may be 0). */
  levelDelta: number;
  /** Delta a +1 quality step would produce (host-supplied, may be 0). */
  qualityDelta: number;
}

/**
 * The §10.5 main-skill inspector model: everything the inspector shows for the
 * selected skill group. Supplied by the host (no app/IO coupling); absent until a
 * group is selected and its breakdown is available (§6.4 NO-FALLBACK).
 */
export interface SkillInspectorModel {
  groupId: string;
  skillName: string;
  damageBreakdown: DamageBreakdownRow[];
  supportContributions: SupportContributionRow[];
  gemDeltas: GemDeltaRow[];
}

export interface SkillsPanelProps {
  /** Active locale, drives every label across the two regions. */
  locale: Locale;
  /** The §10.5 skill-group card models (p4-skills-vm). */
  model: SkillsViewModel;
  /**
   * The inspector model for the selected main skill, supplied by the host once a
   * group is selected (DESIGN §10.5). Absent → the inspector empty state (§6.4).
   */
  inspector?: SkillInspectorModel;
  /** Called with the group id when a card is selected (host fetches its breakdown). */
  onSelectGroup?: (groupId: string) => void;
  /** Called with the group id when a group's enabled toggle is pressed. */
  onToggleGroup?: (groupId: string) => void;
  /** Called with (groupId, gemId) when a gem's enabled toggle is pressed. */
  onToggleGem?: (groupId: string, gemId: string) => void;
}

/** Render a signed delta magnitude, e.g. `+12.4` / `-3`. A 0 reads `0`. */
function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

function SkillInspector({
  locale,
  inspector,
}: {
  locale: Locale;
  inspector: SkillInspectorModel | undefined;
}) {
  if (inspector === undefined) {
    return (
      <section className="pob-skill-inspector" aria-label={t(locale, 'skills.inspector')}>
        <p className="pob-skill-inspector__empty" data-inspector-empty>
          {t(locale, 'skills.inspector.empty')}
        </p>
      </section>
    );
  }

  return (
    <section className="pob-skill-inspector" aria-label={t(locale, 'skills.inspector')}>
      <header className="pob-skill-inspector__header">
        <span className="pob-skill-inspector__name">{inspector.skillName}</span>
      </header>

      <section className="pob-skill-inspector__section" data-section="damage">
        <h4 className="pob-skill-inspector__section-title">
          {t(locale, 'skills.inspector.damageBreakdown')}
        </h4>
        <ul className="pob-skill-inspector__rows" role="list">
          {inspector.damageBreakdown.map((row, i) => (
            <li key={i} className="pob-skill-inspector__row" role="listitem">
              <span className="pob-skill-inspector__row-label">{row.label}</span>
              <span className="pob-skill-inspector__row-value">{row.value}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pob-skill-inspector__section" data-section="support">
        <h4 className="pob-skill-inspector__section-title">
          {t(locale, 'skills.inspector.supportContribution')}
        </h4>
        <ul className="pob-skill-inspector__rows" role="list">
          {inspector.supportContributions.map((row) => (
            <li
              key={row.gemId}
              className="pob-skill-inspector__row"
              role="listitem"
              data-support={row.gemId}
            >
              <span className="pob-skill-inspector__row-label">{row.name}</span>
              <span className="pob-skill-inspector__row-value">{row.contribution}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="pob-skill-inspector__section" data-section="gem-delta">
        <h4 className="pob-skill-inspector__section-title">
          {t(locale, 'skills.inspector.gemDelta')}
        </h4>
        <ul className="pob-skill-inspector__rows" role="list">
          {inspector.gemDeltas.map((row) => (
            <li
              key={row.gemId}
              className="pob-skill-inspector__row"
              role="listitem"
              data-gem-delta={row.gemId}
            >
              <span className="pob-skill-inspector__row-label">{row.name}</span>
              <span className="pob-skill-inspector__row-value">
                {t(locale, 'skills.gem.level')} {row.level} ({signed(row.levelDelta)}) ·{' '}
                {t(locale, 'skills.gem.quality')} {row.quality} ({signed(row.qualityDelta)})
              </span>
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}

export function SkillsPanel(props: SkillsPanelProps) {
  const { locale, model, inspector } = props;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const handleSelect = (groupId: string) => {
    setSelectedId(groupId);
    props.onSelectGroup?.(groupId);
  };

  return (
    <div className="pob-skills">
      <div className="pob-skills__regions">
        <section className="pob-skills__region pob-skills__groups" data-region="groups">
          <h3 className="pob-skills__region-title">{t(locale, 'skills.groups')}</h3>
          <div className="pob-skills__group-list">
            {model.cards.map((card) => (
              <SkillGroupCard
                key={card.groupId}
                locale={locale}
                card={card}
                selected={card.groupId === selectedId}
                onSelectGroup={handleSelect}
                onToggleGroup={props.onToggleGroup}
                onToggleGem={props.onToggleGem}
              />
            ))}
          </div>
        </section>

        <section className="pob-skills__region pob-skills__inspector" data-region="inspector">
          <h3 className="pob-skills__region-title">{t(locale, 'skills.inspector')}</h3>
          <SkillInspector locale={locale} inspector={inspector} />
        </section>
      </div>
    </div>
  );
}
