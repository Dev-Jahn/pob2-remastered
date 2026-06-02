// Calcs breakdown view-model test (DESIGN §10.7 Calcs tab, §6.3 calc.run /
// calc.explain, §6.4 NO-FALLBACK).
//
// Per §10.7 the Calcs tab's value is the *breakdown* — "결과가 어떻게 계산됐는지".
// `buildCalcsModel(run, explains, prevRun?)` is a pure, framework-free transform
// that turns a `calc.run` result (final values) + a set of `calc.explain` traces
// (sources / formula / upstream raw stat id) into the §10.7 breakdown tree:
//
//   Calcs
//     ├─ Summary
//     ├─ Offence  { Hit / Crit / Ailments / DoT }
//     ├─ Defence  { Life·ES·Mana / Resistances / Armour·Evasion / EHP }
//     ├─ Resource
//     └─ Raw trace
//
// Each breakdown stat exposes (§10.7):
//   - 최종값 (finalValue, from calc.run),
//   - 변경 전후 delta (before/after/delta vs the optional prior run),
//   - 기여 source list classified item/passive/skillGem/supportGem/config/buff,
//   - formula trace string,
//   - upstream raw stat id,
//   - 한국어/영어 label.
//
// NO-FALLBACK (§6.4, §10.7): a stat the core never emitted in calc.run is an
// explicit `present:false` missing marker — never `0` (0 is a real value, e.g.
// EnergyShield 0). A stat WITH a calc.run value but NO calc.explain trace carries
// an explicit `trace:{ explained:false }` "trace 없음" marker — sources/formula
// are never fabricated. A delta with no prior run is `undefined`, not `0`.
import { describe, it, expect } from 'vitest';
import type { CalcRunResponse, CalcExplainResponse, StatResult, ExplainSource } from '@pob2/schema';
import { buildCalcsModel, CALCS_BREAKDOWN_SPEC } from '../src/index.js';
import type {
  CalcsViewModel,
  CalcsSection,
  CalcsGroup,
  BreakdownStat,
  BreakdownTrace,
  CalcsBreakdownSpec,
} from '../src/index.js';

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

// A run with offence + defence + resource stats. EnergyShield is a real 0.
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

// Explains for two of the offence stats only (the rest get "trace 없음").
const EXPLAINS: CalcExplainResponse[] = [
  explain('TotalDPS', 125000, { label: 'Total DPS', upstreamStatId: 'Output.TotalDPS' }),
  explain('CritChance', 62, { sources: [{ kind: 'passive', label: 'Assassin', value: 30 }] }),
];

// A prior run for delta: TotalDPS was lower, Life unchanged, EHP not present before.
const PREV_RUN: CalcRunResponse = {
  buildId: 'b1',
  stats: [stat('TotalDPS', 100000), stat('Life', 4200), stat('FireResist', 70)],
};

// ---------------------------------------------------------------------------
// Tree shape (DESIGN §10.7)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — §10.7 breakdown tree shape', () => {
  it('produces the Summary / Offence / Defence / Resource / Raw-trace sections in order', () => {
    const vm: CalcsViewModel = buildCalcsModel(RUN, EXPLAINS);
    expect(vm.sections.map((s: CalcsSection) => s.id)).toEqual([
      'summary',
      'offence',
      'defence',
      'resource',
      'rawTrace',
    ]);
  });

  it('nests Offence sub-groups Hit / Crit / Ailments / DoT (§10.7)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const offence = vm.sections.find((s) => s.id === 'offence')!;
    expect(offence.groups.map((g: CalcsGroup) => g.id)).toEqual(['hit', 'crit', 'ailments', 'dot']);
  });

  it('nests Defence sub-groups Life·ES·Mana / Resistances / Armour·Evasion / EHP (§10.7)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const defence = vm.sections.find((s) => s.id === 'defence')!;
    expect(defence.groups.map((g) => g.id)).toEqual(['pools', 'resistances', 'mitigation', 'ehp']);
  });

  it('exposes the breakdown spec as a shared constant', () => {
    const spec: CalcsBreakdownSpec = CALCS_BREAKDOWN_SPEC;
    expect(spec.sections.find((s) => s.id === 'offence')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Per-stat breakdown: final value, ko/en label, upstream id (DESIGN §10.7)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — per-stat breakdown fields', () => {
  function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
    for (const section of vm.sections) {
      for (const group of section.groups) {
        const hit = group.stats.find((st) => st.statId === statId);
        if (hit) return hit;
      }
    }
    throw new Error(`stat ${statId} not in model`);
  }

  it('carries the calc.run final value on a present stat', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.present).toBe(true);
    expect(dps.finalValue).toBe(125000);
  });

  it('keeps a real 0 (EnergyShield) present, never coerced to missing (NO-FALLBACK)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const es = findStat(vm, 'EnergyShield');
    expect(es.present).toBe(true);
    expect(es.finalValue).toBe(0);
  });

  it('exposes BOTH 한국어 and 영어 labels on every breakdown stat (§10.7)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.labelEn).toBe('Total DPS');
    expect(dps.labelKo).toBe('전체 DPS');
  });

  it('exposes the upstream raw stat id from the explain trace (§10.7)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.trace.explained).toBe(true);
    if (dps.trace.explained) {
      expect(dps.trace.upstreamStatId).toBe('Output.TotalDPS');
    }
  });
});

// ---------------------------------------------------------------------------
// NO-FALLBACK: missing stat vs. present-but-unexplained stat (DESIGN §6.4)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — NO-FALLBACK markers', () => {
  function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
    for (const section of vm.sections) {
      for (const group of section.groups) {
        const hit = group.stats.find((st) => st.statId === statId);
        if (hit) return hit;
      }
    }
    throw new Error(`stat ${statId} not in model`);
  }

  it('marks a stat absent from calc.run as present:false missing, not 0', () => {
    // CritMultiplier IS present here; use a spec stat the run omits.
    const runWithoutEHP: CalcRunResponse = {
      buildId: 'b1',
      stats: RUN.stats.filter((s) => s.statId !== 'TotalEHP'),
    };
    const vm = buildCalcsModel(runWithoutEHP, EXPLAINS);
    const ehp = findStat(vm, 'TotalEHP');
    expect(ehp.present).toBe(false);
    expect(ehp.finalValue).toBeUndefined();
  });

  it("marks a present-but-unexplained stat with an explicit 'trace 없음' marker", () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    // AverageDamage has a calc.run value but no calc.explain entry.
    const avg = findStat(vm, 'AverageDamage');
    expect(avg.present).toBe(true);
    expect(avg.finalValue).toBe(8200);
    expect(avg.trace.explained).toBe(false);
    const unexplained = avg.trace as Extract<BreakdownTrace, { explained: false }>;
    expect(unexplained.reason).toBe('noTrace');
  });

  it('never fabricates sources/formula on an unexplained stat', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const avg = findStat(vm, 'AverageDamage');
    expect('sources' in avg.trace).toBe(false);
    expect('formula' in avg.trace).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Source list, classified by origin (DESIGN §10.7 기여 source list)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — contribution source list', () => {
  function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
    for (const section of vm.sections) {
      for (const group of section.groups) {
        const hit = group.stats.find((st) => st.statId === statId);
        if (hit) return hit;
      }
    }
    throw new Error(`stat ${statId} not in model`);
  }

  it('passes through every source kind (item/passive/skillGem/supportGem/config/buff)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.trace.explained).toBe(true);
    if (dps.trace.explained) {
      expect(dps.trace.sources.map((s) => s.kind)).toEqual([
        'item',
        'passive',
        'skillGem',
        'supportGem',
        'config',
        'buff',
      ]);
      expect(dps.trace.formula).toBe('base * (1 + inc) = 125000');
    }
  });
});

// ---------------------------------------------------------------------------
// Before/after delta vs. a prior run (DESIGN §10.7 변경 전후 delta)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — before/after delta', () => {
  function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
    for (const section of vm.sections) {
      for (const group of section.groups) {
        const hit = group.stats.find((st) => st.statId === statId);
        if (hit) return hit;
      }
    }
    throw new Error(`stat ${statId} not in model`);
  }

  it('computes delta = after - before when a prior run is given', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS, PREV_RUN);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.delta).toEqual({ before: 100000, after: 125000, delta: 25000 });
  });

  it('reports a 0 delta (Life unchanged) as a real delta, not absence', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS, PREV_RUN);
    const life = findStat(vm, 'Life');
    expect(life.delta).toEqual({ before: 4200, after: 4200, delta: 0 });
  });

  it('leaves delta undefined when the stat had no prior value (NO-FALLBACK, no 0)', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS, PREV_RUN);
    const ehp = findStat(vm, 'TotalEHP'); // present now, absent in PREV_RUN
    expect(ehp.delta).toBeUndefined();
  });

  it('leaves delta undefined entirely when no prior run is passed', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const dps = findStat(vm, 'TotalDPS');
    expect(dps.delta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Raw trace section: flat passthrough of every explain (DESIGN §10.7 Raw trace)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — Raw trace section', () => {
  it('lists every calc.explain trace, in input order, under the rawTrace section', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const raw = vm.sections.find((s) => s.id === 'rawTrace')!;
    const rawStats = raw.groups.flatMap((g) => g.stats);
    expect(rawStats.map((s) => s.statId)).toEqual(['TotalDPS', 'CritChance']);
    const dps = rawStats.find((s) => s.statId === 'TotalDPS')!;
    expect(dps.trace.explained).toBe(true);
  });

  it('is empty (no fabricated rows) when no explains are supplied', () => {
    const vm = buildCalcsModel(RUN, []);
    const raw = vm.sections.find((s) => s.id === 'rawTrace')!;
    expect(raw.groups.flatMap((g) => g.stats)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Summary section (DESIGN §10.7 Summary)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — Summary section', () => {
  it('surfaces the headline TotalDPS / TotalEHP stats under Summary', () => {
    const vm = buildCalcsModel(RUN, EXPLAINS);
    const summary = vm.sections.find((s) => s.id === 'summary')!;
    const ids = summary.groups.flatMap((g) => g.stats).map((s) => s.statId);
    expect(ids).toContain('TotalDPS');
    expect(ids).toContain('TotalEHP');
  });
});

// ---------------------------------------------------------------------------
// Purity (DESIGN §5.1 pure view-model)
// ---------------------------------------------------------------------------

describe('buildCalcsModel — purity', () => {
  it('does not mutate its inputs', () => {
    const run = structuredClone(RUN);
    const explains = structuredClone(EXPLAINS);
    const prev = structuredClone(PREV_RUN);
    buildCalcsModel(run, explains, prev);
    expect(run).toEqual(RUN);
    expect(explains).toEqual(EXPLAINS);
    expect(prev).toEqual(PREV_RUN);
  });
});
