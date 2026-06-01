// Overview component test (DESIGN §10.3 Overview tab; §10.1 layering; §11.3
// warning policy; §8.1 ko/en alias).
//
// These are the React components that render the Overview view-models:
//   - StatCard renders a localized card title + labeled stat rows. Per §10.1
//     "수정값과 계산 결과 구분" + §6.4 (localized label vs machine stat id) each row
//     exposes its machine `statId` alongside the value; a *missing* stat is
//     rendered with a distinct marker (NOT "0").
//   - OffenceCard / DefenceCard / ResourceCard are thin wrappers binding a card
//     of the OverviewModel to a StatCard, and OverviewPanel renders all three.
//   - WarningPanel lists each warning with an icon + a text label (§11.3: never
//     color-only), localized through the same `t` resolver the view-model keys.
//
// The fixtures mirror the single-skill-mace baseline already used by the
// view-model suites: it emits TotalDPS/AverageDamage but NO crit/speed, so the
// crit row must show the missing marker rather than a fabricated "0".
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { CalcRunResponse, StatResult } from '@pob2/schema';
import {
  buildOverviewModel,
  buildWarningModel,
  OverviewPanel,
  OffenceCard,
  WarningPanel,
  t,
} from '../src/index.js';
import type { BuildSummary } from '../src/index.js';

afterEach(cleanup);

const MACE_STATS: StatResult[] = [
  { statId: 'Life', value: 82, label: 'Life' },
  { statId: 'Mana', value: 50, label: 'Mana' },
  { statId: 'EnergyShield', value: 0, label: 'Energy Shield' },
  { statId: 'Spirit', value: 100, label: 'Spirit' },
  { statId: 'TotalDPS', value: 2.89, label: 'Total DPS' },
  { statId: 'AverageDamage', value: 1.99, label: 'Average Damage' },
  { statId: 'Armour', value: 0, label: 'Armour' },
  { statId: 'Evasion', value: 7, label: 'Evasion' },
  { statId: 'TotalEHP', value: 60.25, label: 'Effective Hit Pool' },
  { statId: 'FireResist', value: -50, label: 'Fire Resistance' },
  { statId: 'ColdResist', value: -50, label: 'Cold Resistance' },
  { statId: 'LightningResist', value: -50, label: 'Lightning Resistance' },
  { statId: 'ChaosResist', value: 0, label: 'Chaos Resistance' },
];

const CALC_RUN: CalcRunResponse = { buildId: 'single-skill-mace', stats: MACE_STATS };
const SUMMARY: BuildSummary = { className: 'Warrior', level: 1, itemCount: 1 };

const model = buildOverviewModel(CALC_RUN, SUMMARY);

describe('OffenceCard (DESIGN §10.3, §10.1)', () => {
  it('renders the localized offence card title (ko-KR)', () => {
    render(<OffenceCard locale="ko-KR" card={model.offence} />);
    expect(screen.getByText(t('ko-KR', 'overview.card.offence'))).toBeTruthy();
  });

  it('renders a present stat with its mapped value and machine stat id (§6.4)', () => {
    const { container } = render(<OffenceCard locale="ko-KR" card={model.offence} />);
    const row = container.querySelector('[data-stat-id="TotalDPS"]');
    expect(row).toBeTruthy();
    // The mapped numeric value is shown verbatim.
    expect(within(row as HTMLElement).getByText('2.89')).toBeTruthy();
    // A present stat is NOT marked missing.
    expect((row as HTMLElement).getAttribute('data-missing')).toBeNull();
  });

  it('renders a missing stat with the missing marker — never "0" (§10.1 NO-FALLBACK)', () => {
    const { container } = render(<OffenceCard locale="ko-KR" card={model.offence} />);
    // single-skill-mace emits no crit stat, so CritChance must be missing.
    const row = container.querySelector('[data-stat-id="CritChance"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-missing')).toBe('true');
    // The distinct missing marker is shown, and the row text never reads "0".
    expect(within(row).getByText('—')).toBeTruthy();
    expect(row.textContent).not.toMatch(/\b0\b/);
  });
});

describe('OverviewPanel (DESIGN §10.3)', () => {
  it('renders the offence, defence, and resource cards together', () => {
    render(<OverviewPanel locale="ko-KR" model={model} />);
    expect(screen.getByText(t('ko-KR', 'overview.card.offence'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'overview.card.defence'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'overview.card.resources'))).toBeTruthy();
  });

  it('keeps a real 0 (EnergyShield) present — shows "0", not the missing marker', () => {
    const { container } = render(<OverviewPanel locale="ko-KR" model={model} />);
    const row = container.querySelector('[data-stat-id="EnergyShield"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-missing')).toBeNull();
    expect(within(row).getByText('0')).toBeTruthy();
  });
});

describe('WarningPanel (DESIGN §10.3 warning card, §11.3)', () => {
  const warningModel = buildWarningModel({
    calc: CALC_RUN,
    unsupported: ['+5 to Unsupported Mystery Stat'],
  });

  it('lists each warning with its localized text label (§8.1, §11.3)', () => {
    render(<WarningPanel locale="ko-KR" model={warningModel} />);
    const items = screen.getAllByRole('listitem');
    // 3 resist-below-cap (Fire/Cold/Lightning) + 1 unsupported line.
    expect(items).toHaveLength(4);
    // Each warning shows its localized label, resolved via the same `t` resolver.
    expect(screen.getAllByText(t('ko-KR', 'warning.resistanceLow')).length).toBe(3);
    expect(screen.getByText(t('ko-KR', 'warning.unsupportedModifier'))).toBeTruthy();
  });

  it('renders an icon AND a text label per warning — never color-only (§11.3)', () => {
    const { container } = render(<WarningPanel locale="ko-KR" model={warningModel} />);
    const items = container.querySelectorAll('[role="listitem"]');
    for (const item of Array.from(items)) {
      // Every row carries a non-color icon marker...
      const icon = item.querySelector('[data-warning-icon]');
      expect(icon).toBeTruthy();
      expect((icon as HTMLElement).textContent?.trim().length).toBeGreaterThan(0);
      // ...and a text label sibling, so meaning never rides on color alone.
      expect(item.querySelector('[data-warning-label]')).toBeTruthy();
    }
  });

  it('echoes the verbatim unsupported source line as detail (§8.6 step 4)', () => {
    render(<WarningPanel locale="ko-KR" model={warningModel} />);
    expect(screen.getByText('+5 to Unsupported Mystery Stat')).toBeTruthy();
  });

  it('renders nothing distracting when there are no warnings', () => {
    const empty = buildWarningModel({
      calc: {
        buildId: 'b',
        stats: [{ statId: 'FireResist', value: 75, label: 'Fire Resistance' }],
      },
      unsupported: [],
    });
    const { container } = render(<WarningPanel locale="ko-KR" model={empty} />);
    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(0);
  });
});
