/**
 * golden-diff — the §7.4 parity verdict for the golden gate (DESIGN §7.4 golden
 * test, "허용 오차: 정수 stat exact / float stat 1e-6 또는 표시 precision").
 *
 * Given a fixture's recorded baseline stat map and the stat map calc.run produced
 * for it through the core-client, {@link diffStats} returns a per-stat divergence
 * list under the §7.4 tolerance rule:
 *   - a stat whose BASELINE value is an integer must match EXACTLY (any drift is a
 *     divergence) — integer stats carry no rounding, so they are the parity anchor;
 *   - a stat whose baseline value is a float tolerates an absolute drift up to
 *     {@link FLOAT_TOLERANCE} (1e-6);
 *   - a stat present on exactly one side (appeared / disappeared) is a divergence:
 *     the curated core-stat set itself changed.
 *
 * {@link formatFixtureDiff} renders that list as a readable per-stat report
 * (fixture, statId, expected, actual, delta) so an upstream-driven calc change is
 * reviewable straight from the failing assertion.
 *
 * This module is pure and core-free on purpose: the gate's own verdict is unit
 * test-covered without booting the Lua runner.
 */

/** A flat {statId -> numeric value} stat map, as both baselines and calc.run carry. */
export type StatMap = Record<string, number>;

/** DESIGN §7.4 float tolerance: absolute drift allowed for a non-integer stat. */
export const FLOAT_TOLERANCE = 1e-6;

/** One per-stat divergence between a baseline and a fresh calc.run result. */
export interface StatDiff {
  statId: string;
  /** Baseline value, or undefined when the stat only appeared in the actual. */
  expected: number | undefined;
  /** Actual value, or undefined when the stat disappeared from the actual. */
  actual: number | undefined;
  /** Absolute |actual - expected| when both are present; undefined otherwise. */
  delta: number | undefined;
  /** Why this counts as a divergence (drives the readable report). */
  kind: 'value' | 'appeared' | 'disappeared';
}

/**
 * Diff a freshly computed stat map against a recorded baseline under §7.4
 * tolerances. Returns an EMPTY array on parity; otherwise one {@link StatDiff} per
 * diverging stat, in stable (sorted-by-id) order so the report is deterministic.
 */
export function diffStats(baseline: StatMap, actual: StatMap): StatDiff[] {
  const diffs: StatDiff[] = [];
  const ids = new Set([...Object.keys(baseline), ...Object.keys(actual)]);
  for (const statId of [...ids].sort()) {
    const expected = baseline[statId];
    const got = actual[statId];

    if (expected === undefined) {
      diffs.push({ statId, expected: undefined, actual: got, delta: undefined, kind: 'appeared' });
      continue;
    }
    if (got === undefined) {
      diffs.push({
        statId,
        expected,
        actual: undefined,
        delta: undefined,
        kind: 'disappeared',
      });
      continue;
    }

    const delta = Math.abs(got - expected);
    // §7.4: an integer baseline is exact; a float baseline tolerates 1e-6.
    const tolerance = Number.isInteger(expected) ? 0 : FLOAT_TOLERANCE;
    if (delta > tolerance) {
      diffs.push({ statId, expected, actual: got, delta, kind: 'value' });
    }
  }
  return diffs;
}

/** Render one stat number compactly without lossy rounding. */
function fmt(value: number | undefined): string {
  return value === undefined ? '—' : String(value);
}

/**
 * Render a divergence list as a readable per-stat report headed by the fixture id,
 * one aligned line per stat: `statId  expected -> actual  (delta=…)`. Returned even
 * for an empty list (a short "no diff" line) so it is safe to pass straight as a
 * vitest assertion message.
 */
export function formatFixtureDiff(fixtureId: string, diffs: StatDiff[]): string {
  if (diffs.length === 0) return `${fixtureId}: no stat diff`;
  const lines = diffs.map((d) => {
    const head = `  ${d.statId}: expected ${fmt(d.expected)} actual ${fmt(d.actual)}`;
    if (d.kind === 'appeared') return `${head} (appeared)`;
    if (d.kind === 'disappeared') return `${head} (disappeared)`;
    return `${head} (delta=${d.delta!.toExponential(3)})`;
  });
  return `${fixtureId}: ${diffs.length} stat(s) diverged from baseline (DESIGN §7.4)\n${lines.join('\n')}`;
}
