// Calcs mutation→delta test (DESIGN §10.7 Calcs tab "변경 전후 delta"; §6.3
// skills.setGemGroup / config.setOption + calc.run / calc.explain; §6.4
// NO-FALLBACK). This is the gate `calc-mutation` core contract #2 (gates.mjs
// GATES[4]): a build modification (skill / config) followed by a re-run must be
// reflected in the Calcs breakdown view-model as a before/after delta.
//
// The §10.7 view-model is pure (`buildCalcsModel(run, explains, prevRun?)`), so it
// has no knowledge of *how* the build changed — it only re-shapes what the core
// returned. The mutation→delta contract therefore lives in the host *flow* that
// the Calcs tab drives:
//
//   1. run₀ = calc.run(build)                 → model₀ = buildCalcsModel(run₀, …)
//   2. edit  = a skill toggle / config option → setGemGroup / setOption payload
//   3. run₁ = calc.run(build')                → recomputed stats after the edit
//   4. model₁ = buildCalcsModel(run₁, explains₁, /* prevRun = */ run₀)
//      → every stat the edit moved now carries delta { before, after, delta }.
//
// `recomputeCalcs` below is the framework-free harness that models exactly this
// flow: it takes the pre-edit run (the previous view-model's source run) and the
// post-edit run + explains, and returns the next view-model with the prior run
// wired in as the delta baseline. The edit itself is expressed with the real
// package mutation builders (`toggleGemEnabled`/`groupToGemInputs` for a skill
// edit, `setOptionValue` for a config edit) so the test exercises the genuine
// §6.3 write payloads, not fabricated ones.
import { describe, it, expect } from 'vitest';
import type {
  CalcRunResponse,
  CalcExplainResponse,
  StatResult,
  ExplainSource,
  SkillGroupCard,
  GemInput,
} from '@pob2/schema';
import {
  buildCalcsModel,
  toggleGemEnabled,
  groupToGemInputs,
  setOptionValue,
} from '../src/index.js';
import type {
  CalcsViewModel,
  BreakdownStat,
  BreakdownDelta,
  ConfigOptionValue,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

function stat(statId: string, value: number, label = statId): StatResult {
  return { statId, value, label };
}

function run(stats: StatResult[]): CalcRunResponse {
  return { buildId: 'b1', stats };
}

const SOURCES: ExplainSource[] = [
  { kind: 'item', label: 'Doryani Catalyst', value: 40 },
  { kind: 'skillGem', label: 'Fireball', value: 100 },
  { kind: 'supportGem', label: 'Increased Critical Damage', value: 20 },
  { kind: 'config', label: 'Enemy is Shocked', value: 15 },
];

function explain(
  statId: string,
  finalValue: number,
  sources: ExplainSource[] = SOURCES,
): CalcExplainResponse {
  return {
    statId,
    finalValue,
    label: statId,
    sources,
    formula: `base * (1 + inc) = ${finalValue}`,
    upstreamStatId: `Output.${statId}`,
  };
}

function findStat(vm: CalcsViewModel, statId: string): BreakdownStat {
  for (const section of vm.sections) {
    for (const group of section.groups) {
      const hit = group.stats.find((st) => st.statId === statId);
      if (hit) return hit;
    }
  }
  throw new Error(`stat ${statId} not in model`);
}

/**
 * The host recompute flow (steps 1→4 above): given the run that produced the
 * *current* view-model (`prevRun`) and the recomputed post-edit run + explains,
 * derive the next §10.7 view-model with `prevRun` wired in as the delta baseline.
 * Pure passthrough to `buildCalcsModel` — the contract it asserts is that a
 * re-run after a build edit surfaces as a before/after delta.
 */
function recomputeCalcs(
  prevRun: CalcRunResponse,
  nextRun: CalcRunResponse,
  nextExplains: CalcExplainResponse[],
): CalcsViewModel {
  return buildCalcsModel(nextRun, nextExplains, prevRun);
}

// Baseline build calc.run: a Fireball build before any edit.
const RUN_0: CalcRunResponse = run([
  stat('TotalDPS', 100000),
  stat('AverageDamage', 6000),
  stat('CritChance', 50),
  stat('IgniteDPS', 2000),
  stat('Life', 4200),
  stat('EnergyShield', 0),
  stat('FireResist', 75),
  stat('TotalEHP', 28000),
  stat('Spirit', 100),
]);

// ---------------------------------------------------------------------------
// Skill edit → recompute → delta (DESIGN §10.5 support gem toggle, §10.7 delta)
// ---------------------------------------------------------------------------

describe('calc-mutation — skill edit reflected as a before/after delta', () => {
  // A socket group whose support gem we will toggle off, then on.
  const GROUP: SkillGroupCard = {
    groupId: 'g1',
    label: 'Fireball',
    enabled: true,
    spirit: 0,
    reservation: 0,
    activeGems: [{ gemId: 'Fireball', name: 'Fireball', level: 20, quality: 20, enabled: true }],
    supportGems: [
      {
        gemId: 'IncreasedCriticalDamage',
        name: 'Increased Critical Damage',
        level: 20,
        quality: 0,
        enabled: true,
      },
    ],
  };

  it('produces a real §6.3 setGemGroup payload from the skill edit (no fabricated gems)', () => {
    // The edit: disable the support gem. Builders are the genuine §6.3 write path.
    const gems: GemInput[] = groupToGemInputs(GROUP);
    const edited = toggleGemEnabled(gems, 'IncreasedCriticalDamage');
    const support = edited.find((g) => g.gemId === 'IncreasedCriticalDamage')!;
    expect(support.enabled).toBe(false);
    // Active gem untouched — only the toggled gem flipped.
    expect(edited.find((g) => g.gemId === 'Fireball')!.enabled).toBe(true);
  });

  it('reflects the recomputed DPS drop as delta { before, after, delta } after the support toggle', () => {
    // Disabling the crit-damage support drops DPS: the host re-runs calc.run.
    const RUN_1 = run([
      stat('TotalDPS', 82000), // ↓ from 100000
      stat('AverageDamage', 5100), // ↓ from 6000
      stat('CritChance', 50), // unchanged
      stat('IgniteDPS', 2000),
      stat('Life', 4200),
      stat('EnergyShield', 0),
      stat('FireResist', 75),
      stat('TotalEHP', 28000),
      stat('Spirit', 100),
    ]);
    const explains = [explain('TotalDPS', 82000)];

    const vm = recomputeCalcs(RUN_0, RUN_1, explains);

    const dps = findStat(vm, 'TotalDPS');
    expect(dps.present).toBe(true);
    expect(dps.finalValue).toBe(82000); // after = the recomputed value
    const delta: BreakdownDelta = dps.delta!;
    expect(delta).toEqual({ before: 100000, after: 82000, delta: -18000 });
  });

  it('carries a negative delta sign through unchanged (a drop is -, never abs())', () => {
    const RUN_1 = run([stat('TotalDPS', 82000), stat('AverageDamage', 5100)]);
    const vm = recomputeCalcs(RUN_0, RUN_1, []);
    expect(findStat(vm, 'AverageDamage').delta).toEqual({
      before: 6000,
      after: 5100,
      delta: -900,
    });
  });

  it('reports a 0 delta for a stat the edit did not move (NOT absence)', () => {
    const RUN_1 = run([stat('TotalDPS', 82000), stat('CritChance', 50)]);
    const vm = recomputeCalcs(RUN_0, RUN_1, []);
    // CritChance is unchanged by the support toggle → an explicit 0 delta.
    expect(findStat(vm, 'CritChance').delta).toEqual({ before: 50, after: 50, delta: 0 });
  });
});

// ---------------------------------------------------------------------------
// Config edit → recompute → delta (DESIGN §10.8 config option, §10.7 delta)
// ---------------------------------------------------------------------------

describe('calc-mutation — config edit reflected as a before/after delta', () => {
  it('produces a real §6.3 setOption payload from the config edit (false stored as-is)', () => {
    // The edit: turn "Enemy is Shocked" off. setOptionValue is the genuine write path.
    let values: ConfigOptionValue[] = [{ optionId: 'enemyIsShocked', value: true }];
    values = setOptionValue(values, 'enemyIsShocked', false);
    const shocked = values.find((v) => v.optionId === 'enemyIsShocked')!;
    expect(shocked.value).toBe(false); // a real false, never coerced away
  });

  it('reflects the recomputed DPS change as a delta after a config option flip', () => {
    // Turning shock off lowers DPS; the host re-runs calc.run under the new config.
    const RUN_1 = run([
      stat('TotalDPS', 91000), // ↓ from 100000 (no shock magnitude)
      stat('IgniteDPS', 2000),
      stat('Life', 4200),
    ]);
    const explains = [
      // The new explain no longer carries a 'config' (shock) contribution.
      explain('TotalDPS', 91000, [
        { kind: 'item', label: 'Doryani Catalyst', value: 40 },
        { kind: 'skillGem', label: 'Fireball', value: 100 },
      ]),
    ];

    const vm = recomputeCalcs(RUN_0, RUN_1, explains);

    const dps = findStat(vm, 'TotalDPS');
    expect(dps.delta).toEqual({ before: 100000, after: 91000, delta: -9000 });
    // The recomputed trace is the NEW one (no shock config source) — not the old.
    expect(dps.trace.explained).toBe(true);
    if (dps.trace.explained) {
      expect(dps.trace.sources.map((s) => s.kind)).toEqual(['item', 'skillGem']);
    }
  });

  it('reflects a config edit that RAISES a defensive stat (positive delta)', () => {
    // Enabling an aura raises Life; delta is positive and signed.
    const RUN_1 = run([stat('TotalDPS', 100000), stat('Life', 4700), stat('TotalEHP', 31000)]);
    const vm = recomputeCalcs(RUN_0, RUN_1, []);
    expect(findStat(vm, 'Life').delta).toEqual({ before: 4200, after: 4700, delta: 500 });
    expect(findStat(vm, 'TotalEHP').delta).toEqual({ before: 28000, after: 31000, delta: 3000 });
  });
});

// ---------------------------------------------------------------------------
// NO-FALLBACK under mutation (DESIGN §6.4): newly-present / newly-absent stats
// ---------------------------------------------------------------------------

describe('calc-mutation — NO-FALLBACK across a recompute', () => {
  it('leaves delta undefined for a stat that only EXISTS after the edit (no fabricated 0 baseline)', () => {
    // EnergyShield was a real 0 before; an edit grants ES → it now has a prior value,
    // so it DOES get a delta. But a stat the prior run never emitted gets none.
    const RUN_1 = run([
      stat('TotalDPS', 100000),
      stat('EnergyShield', 1500), // was 0 before → real delta
      stat('ChaosResist', -20), // ABSENT in RUN_0 → no prior value → no delta
    ]);
    const vm = recomputeCalcs(RUN_0, RUN_1, []);

    // ES had a real 0 baseline → a genuine +1500 delta, not "absence treated as 0".
    expect(findStat(vm, 'EnergyShield').delta).toEqual({ before: 0, after: 1500, delta: 1500 });
    // ChaosResist had NO prior value → delta stays undefined (never a fabricated 0).
    const chaos = findStat(vm, 'ChaosResist');
    expect(chaos.present).toBe(true);
    expect(chaos.finalValue).toBe(-20);
    expect(chaos.delta).toBeUndefined();
  });

  it('marks a stat that DISAPPEARS after the edit as present:false missing, not 0', () => {
    // The recompute no longer emits IgniteDPS (e.g. ignite removed by the edit).
    const RUN_1 = run([stat('TotalDPS', 100000), stat('Life', 4200)]);
    const vm = recomputeCalcs(RUN_0, RUN_1, []);
    const ignite = findStat(vm, 'IgniteDPS');
    expect(ignite.present).toBe(false);
    expect(ignite.finalValue).toBeUndefined();
    expect(ignite.delta).toBeUndefined();
  });

  it("keeps the 'trace 없음' marker for a moved stat whose explain was not re-fetched (§6.4)", () => {
    // AverageDamage moved (6000 → 5100) but the host did not re-request its explain.
    const RUN_1 = run([stat('TotalDPS', 82000), stat('AverageDamage', 5100)]);
    const vm = recomputeCalcs(RUN_0, RUN_1, [explain('TotalDPS', 82000)]);
    const avg = findStat(vm, 'AverageDamage');
    // The delta is still surfaced even with no trace…
    expect(avg.delta).toEqual({ before: 6000, after: 5100, delta: -900 });
    // …but the trace is the explicit "trace 없음" marker, never fabricated.
    expect(avg.trace.explained).toBe(false);
    if (!avg.trace.explained) expect(avg.trace.reason).toBe('noTrace');
  });
});

// ---------------------------------------------------------------------------
// Sequential mutations chain (DESIGN §10.7: delta is vs. the IMMEDIATELY prior run)
// ---------------------------------------------------------------------------

describe('calc-mutation — sequential edits chain delta against the prior run', () => {
  it('rebases the delta on each successive recompute (edit₁ then edit₂)', () => {
    // edit₁: 100000 → 82000 (support off). Delta vs RUN_0.
    const RUN_1 = run([stat('TotalDPS', 82000)]);
    const vm1 = recomputeCalcs(RUN_0, RUN_1, []);
    expect(findStat(vm1, 'TotalDPS').delta).toEqual({
      before: 100000,
      after: 82000,
      delta: -18000,
    });

    // edit₂: 82000 → 95000 (different support on). Delta vs RUN_1, NOT RUN_0.
    const RUN_2 = run([stat('TotalDPS', 95000)]);
    const vm2 = recomputeCalcs(RUN_1, RUN_2, []);
    expect(findStat(vm2, 'TotalDPS').delta).toEqual({ before: 82000, after: 95000, delta: 13000 });
  });

  it('does not mutate the prior run while recomputing (purity across the chain)', () => {
    const prev = structuredClone(RUN_0);
    const next = run([stat('TotalDPS', 82000)]);
    recomputeCalcs(prev, next, []);
    expect(prev).toEqual(RUN_0);
  });
});
