// Calcs tab component test (DESIGN §10.7 Calcs tab; gates.mjs VISUAL[4] '/calcs';
// §8.1 ko/en alias; §6.4 NO-FALLBACK).
//
// These are the React components that render the §10.7 Calcs breakdown
// view-model (p4-calcs-vm):
//
//   - CalcsPanel      — the §10.7 breakdown explorer. Renders the breakdown tree
//     Summary / Offence / Defence / Resource (+ Raw trace) as collapsible sections.
//     Owns the per-stat expand state and the debounced calc.explain dispatch:
//     clicking a stat row whose trace is not yet loaded fires `onExplain(statId)`
//     (debounced) so the host can fetch its calc.explain and re-render with the
//     trace expanded.
//   - BreakdownSection — one collapsible top-level section: its ko/en heading, a
//     collapse/expand toggle, and its sub-groups of breakdown stat rows. Each stat
//     row shows the 최종값 + before/after delta + 한/영 label; clicking it expands
//     the FormulaTrace.
//   - FormulaTrace     — one stat's calc.explain trace: the contribution source
//     list classified item/passive/skillGem/supportGem/config/buff, the formula
//     trace string, and the upstream raw stat id. A present-but-unexplained stat
//     shows the localized "trace 없음" marker instead, never a fabricated source.
//
// The fixtures reuse the p4-calcs-vm shape: a calc.run with offence/defence/
// resource stats (EnergyShield a real 0), calc.explain traces for two stats only
// (the rest get the "trace 없음" marker), and a prior run for before/after delta.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react';
import type { CalcRunResponse, CalcExplainResponse, StatResult, ExplainSource } from '@pob2/schema';
import { buildCalcsModel, CalcsPanel, BreakdownSection, FormulaTrace, t } from '../src/index.js';
import type { CalcsSection, BreakdownStat, CalcsViewModel } from '../src/index.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stat(statId: string, value: number, label = statId): StatResult {
  return { statId, value, label };
}

const SOURCES: ExplainSource[] = [
  { kind: 'item', label: 'Doryani Catalyst', value: 40 },
  { kind: 'passive', label: 'Heart of Flame', value: 12 },
  { kind: 'skillGem', label: 'Fireball', value: 100 },
  { kind: 'supportGem', label: 'Increased Critical Damage', value: 20 },
  { kind: 'config', label: 'Enemy is Shocked', value: 15 },
  { kind: 'buff', label: 'Power Charge', value: 8 },
];

function explain(
  statId: string,
  finalValue: number,
  opts: Partial<CalcExplainResponse> = {},
): CalcExplainResponse {
  return {
    statId,
    finalValue,
    label: opts.label ?? statId,
    sources: opts.sources ?? SOURCES,
    formula: opts.formula ?? `base * (1 + inc) = ${finalValue}`,
    upstreamStatId: opts.upstreamStatId ?? `Output.${statId}`,
  };
}

const RUN: CalcRunResponse = {
  buildId: 'b1',
  stats: [
    stat('TotalDPS', 125000),
    stat('AverageDamage', 8200),
    stat('CritChance', 62),
    stat('CritMultiplier', 350),
    stat('TotalDotDPS', 4400),
    stat('IgniteDPS', 3100),
    stat('Life', 4200),
    stat('EnergyShield', 0),
    stat('Mana', 1100),
    stat('FireResist', 75),
    stat('ColdResist', 75),
    stat('LightningResist', 60),
    stat('ChaosResist', -30),
    stat('Armour', 12000),
    stat('Evasion', 8000),
    stat('TotalEHP', 31000),
    stat('Spirit', 100),
  ],
};

// Explains for two offence stats only (TotalDPS has the full source list;
// AverageDamage intentionally has none → its row shows the "trace 없음" marker).
const EXPLAINS: CalcExplainResponse[] = [
  explain('TotalDPS', 125000, { label: 'Total DPS', upstreamStatId: 'Output.TotalDPS' }),
  explain('CritChance', 62, { sources: [{ kind: 'passive', label: 'Assassin', value: 30 }] }),
];

const PREV_RUN: CalcRunResponse = {
  buildId: 'b1',
  stats: [stat('TotalDPS', 100000), stat('Life', 4200)],
};

const MODEL: CalcsViewModel = buildCalcsModel(RUN, EXPLAINS, PREV_RUN);

function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
  for (const section of vm.sections) {
    for (const group of section.groups) {
      const hit = group.stats.find((st) => st.statId === statId);
      if (hit) return hit;
    }
  }
  throw new Error(`stat ${statId} not in model`);
}

const TOTAL_DPS = findStat(MODEL, 'TotalDPS'); // explained
const AVG_DAMAGE = findStat(MODEL, 'AverageDamage'); // present, no trace

// ---------------------------------------------------------------------------
// FormulaTrace (DESIGN §10.7 source list + formula trace + upstream raw stat id)
// ---------------------------------------------------------------------------

describe('FormulaTrace (DESIGN §10.7 trace)', () => {
  it('lists every contribution source classified by origin kind', () => {
    const { container } = render(<FormulaTrace locale="ko-KR" trace={TOTAL_DPS.trace} />);
    const sources = container.querySelectorAll('[data-source]');
    expect(Array.from(sources).map((s) => s.getAttribute('data-source-kind'))).toEqual([
      'item',
      'passive',
      'skillGem',
      'supportGem',
      'config',
      'buff',
    ]);
  });

  it('shows each source label and its signed contribution value', () => {
    const { container } = render(<FormulaTrace locale="ko-KR" trace={TOTAL_DPS.trace} />);
    const item = container.querySelector('[data-source-kind="item"]') as HTMLElement;
    expect(item.textContent).toContain('Doryani Catalyst');
    expect(item.textContent).toContain('40');
  });

  it('renders the human-readable formula trace string', () => {
    const { container } = render(<FormulaTrace locale="ko-KR" trace={TOTAL_DPS.trace} />);
    const formula = container.querySelector('[data-formula]') as HTMLElement;
    expect(formula.textContent).toContain('base * (1 + inc) = 125000');
  });

  it('surfaces the upstream raw stat id (§10.7)', () => {
    const { container } = render(<FormulaTrace locale="ko-KR" trace={TOTAL_DPS.trace} />);
    const upstream = container.querySelector('[data-upstream-stat-id]') as HTMLElement;
    expect(upstream.textContent).toContain('Output.TotalDPS');
  });

  it("shows the localized 'trace 없음' marker for a present-but-unexplained stat (§6.4)", () => {
    const { container } = render(<FormulaTrace locale="ko-KR" trace={AVG_DAMAGE.trace} />);
    expect(within(container as HTMLElement).getByText(t('ko-KR', 'calcs.noTrace'))).toBeTruthy();
    // Never fabricates a source list / formula for an unexplained stat.
    expect(container.querySelector('[data-source]')).toBeNull();
    expect(container.querySelector('[data-formula]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BreakdownSection (DESIGN §10.7 collapsible breakdown section)
// ---------------------------------------------------------------------------

describe('BreakdownSection (DESIGN §10.7 section)', () => {
  const offence: CalcsSection = MODEL.sections.find((s) => s.id === 'offence')!;

  it('renders the section ko/en heading and its sub-group headings', () => {
    const { container } = render(<BreakdownSection locale="ko-KR" section={offence} />);
    const section = container.querySelector('[data-section="offence"]') as HTMLElement;
    expect(section.textContent).toContain('공격');
    expect(within(section).getByText('타격 피해')).toBeTruthy(); // hit group ko label
  });

  it('renders one stat row per breakdown stat with its final value and ko/en label', () => {
    const { container } = render(<BreakdownSection locale="ko-KR" section={offence} />);
    const row = container.querySelector('[data-stat-row="TotalDPS"]') as HTMLElement;
    expect(row.textContent).toContain('전체 DPS'); // ko label
    expect(row.textContent).toContain('Total DPS'); // en label
    expect(row.textContent).toContain('125000'); // final value
  });

  it('shows the before/after delta on a stat that changed vs. the prior run', () => {
    const { container } = render(<BreakdownSection locale="ko-KR" section={offence} />);
    const row = container.querySelector('[data-stat-row="TotalDPS"]') as HTMLElement;
    const delta = row.querySelector('[data-delta]') as HTMLElement;
    expect(delta).toBeTruthy();
    expect(delta.textContent).toContain('25000'); // 125000 - 100000
  });

  it('collapses and expands the section body via its toggle (§10.7 접힘·펼침)', () => {
    const { container } = render(<BreakdownSection locale="ko-KR" section={offence} />);
    const section = container.querySelector('[data-section="offence"]') as HTMLElement;
    expect(section.getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(section.querySelector('[data-section-toggle]') as HTMLElement);
    expect(section.getAttribute('data-collapsed')).toBe('true');
    // Collapsed → its stat rows are not rendered.
    expect(section.querySelector('[data-stat-row]')).toBeNull();
  });

  it('expands a stat row to reveal its FormulaTrace when the row is clicked', () => {
    const { container } = render(<BreakdownSection locale="ko-KR" section={offence} />);
    const row = container.querySelector('[data-stat-row="TotalDPS"]') as HTMLElement;
    expect(row.querySelector('[data-formula]')).toBeNull(); // collapsed initially
    fireEvent.click(row.querySelector('[data-stat-toggle]') as HTMLElement);
    expect(row.querySelector('[data-formula]')).toBeTruthy();
  });

  it('fires onExpandStat with the stat id when an unexplained row is expanded (§10.7 calc.explain)', () => {
    const onExpandStat = vi.fn();
    const { container } = render(
      <BreakdownSection locale="ko-KR" section={offence} onExpandStat={onExpandStat} />,
    );
    const row = container.querySelector('[data-stat-row="AverageDamage"]') as HTMLElement;
    fireEvent.click(row.querySelector('[data-stat-toggle]') as HTMLElement);
    expect(onExpandStat).toHaveBeenCalledWith('AverageDamage');
  });

  it('marks a present:false missing stat distinctly, never as a 0 value (§6.4)', () => {
    const runWithoutEHP: CalcRunResponse = {
      buildId: 'b1',
      stats: RUN.stats.filter((s) => s.statId !== 'TotalEHP'),
    };
    const vm = buildCalcsModel(runWithoutEHP, EXPLAINS);
    const defence = vm.sections.find((s) => s.id === 'defence')!;
    const { container } = render(<BreakdownSection locale="ko-KR" section={defence} />);
    const row = container.querySelector('[data-stat-row="TotalEHP"]') as HTMLElement;
    expect(row.getAttribute('data-present')).toBe('false');
    expect(row.textContent).not.toContain('0');
  });
});

// ---------------------------------------------------------------------------
// CalcsPanel (DESIGN §10.7 breakdown explorer + gates VISUAL[4] '/calcs')
// ---------------------------------------------------------------------------

describe('CalcsPanel (DESIGN §10.7 + gates VISUAL[4] /calcs)', () => {
  it('renders the breakdown tree Summary / Offence / Defence / Resource (+ Raw trace)', () => {
    const { container } = render(<CalcsPanel locale="ko-KR" model={MODEL} />);
    for (const id of ['summary', 'offence', 'defence', 'resource', 'rawTrace']) {
      expect(container.querySelector(`[data-section="${id}"]`)).toBeTruthy();
    }
  });

  it('renders the sections in §10.7 order', () => {
    const { container } = render(<CalcsPanel locale="ko-KR" model={MODEL} />);
    const ids = Array.from(container.querySelectorAll('[data-section]')).map((el) =>
      el.getAttribute('data-section'),
    );
    expect(ids).toEqual(['summary', 'offence', 'defence', 'resource', 'rawTrace']);
  });

  it('renders the localized panel title (§8.1)', () => {
    render(<CalcsPanel locale="ko-KR" model={MODEL} />);
    expect(screen.getByText(t('ko-KR', 'calcs.title'))).toBeTruthy();
  });

  it('renders the contribution source list + formula trace once a stat row is expanded (VISUAL[4])', () => {
    const { container } = render(<CalcsPanel locale="ko-KR" model={MODEL} />);
    const offence = container.querySelector('[data-section="offence"]') as HTMLElement;
    const row = offence.querySelector('[data-stat-row="TotalDPS"]') as HTMLElement;
    fireEvent.click(row.querySelector('[data-stat-toggle]') as HTMLElement);
    // Source list (classified) + formula trace are now visible.
    expect(row.querySelectorAll('[data-source]').length).toBe(6);
    expect(row.querySelector('[data-formula]')).toBeTruthy();
  });

  it('debounces calc.explain: a burst of expands on the same stat dispatches onExplain once', () => {
    vi.useFakeTimers();
    try {
      const onExplain = vi.fn();
      const { container } = render(
        <CalcsPanel locale="ko-KR" model={MODEL} onExplain={onExplain} explainDebounceMs={200} />,
      );
      const offence = container.querySelector('[data-section="offence"]') as HTMLElement;
      const row = offence.querySelector('[data-stat-row="AverageDamage"]') as HTMLElement;
      const toggle = row.querySelector('[data-stat-toggle]') as HTMLElement;
      // Burst: expand → collapse → expand within the debounce window.
      act(() => {
        fireEvent.click(toggle);
        fireEvent.click(toggle);
        fireEvent.click(toggle);
      });
      expect(onExplain).not.toHaveBeenCalled(); // debounced, not yet fired
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(onExplain).toHaveBeenCalledTimes(1);
      expect(onExplain).toHaveBeenCalledWith('AverageDamage');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not re-request calc.explain for a stat whose trace is already loaded', () => {
    vi.useFakeTimers();
    try {
      const onExplain = vi.fn();
      const { container } = render(
        <CalcsPanel locale="ko-KR" model={MODEL} onExplain={onExplain} explainDebounceMs={200} />,
      );
      const offence = container.querySelector('[data-section="offence"]') as HTMLElement;
      // TotalDPS already has its trace in the model → expanding it must not refetch.
      const row = offence.querySelector('[data-stat-row="TotalDPS"]') as HTMLElement;
      act(() => {
        fireEvent.click(row.querySelector('[data-stat-toggle]') as HTMLElement);
        vi.advanceTimersByTime(200);
      });
      expect(onExplain).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lists every supplied calc.explain under the Raw trace section', () => {
    const { container } = render(<CalcsPanel locale="ko-KR" model={MODEL} />);
    const raw = container.querySelector('[data-section="rawTrace"]') as HTMLElement;
    expect(raw.querySelector('[data-stat-row="TotalDPS"]')).toBeTruthy();
    expect(raw.querySelector('[data-stat-row="CritChance"]')).toBeTruthy();
  });
});
