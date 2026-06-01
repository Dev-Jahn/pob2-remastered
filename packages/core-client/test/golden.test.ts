// Golden parity gate for @pob2/core-client — the Phase 1 `golden-parity` gate
// (DESIGN §7.4 golden test). This is the test that proves done-criterion 1
// (기존 PoB와 주요 stat 일치): every golden fixture is loaded THROUGH the
// core-client (createCoreClient -> load -> calcRun, the same schema-validated
// JSON-RPC path the Rust host uses), its curated §7.4 core stats are compared to
// the recorded baseline under tools/golden-tests/baselines, and any divergence
// fails with a readable per-stat diff (fixture, statId, expected, actual, delta).
//
// DESIGN §7.4 tolerances: integer stats exact; float stats within 1e-6 (or
// display precision). That tolerance logic + the readable diff live in
// ../src/golden-diff.ts so they are unit-testable without booting the core; this
// suite pins both that pure logic AND the live parity loop.
//
// Gate command: pnpm --filter @pob2/core-client test golden -> vitest run golden
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, basename } from 'node:path';
import { createCoreClient, type CoreClient } from '../src/index.js';
import { diffStats, formatFixtureDiff, type StatMap } from '../src/golden-diff.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/core-client/test -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const goldenRoot = resolve(repoRoot, 'tools/golden-tests');
const fixturesDir = resolve(goldenRoot, 'fixtures');
const baselinesDir = resolve(goldenRoot, 'baselines');

interface Baseline {
  id: string;
  cases: string[];
  intent: string;
  stats: Record<string, number>;
}

/** Discover the recorded golden corpus from the committed baseline JSON files. */
function loadCorpus(): Baseline[] {
  return readdirSync(baselinesDir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(resolve(baselinesDir, f), 'utf8')) as Baseline);
}

const corpus = loadCorpus();

// ---------------------------------------------------------------------------
// Pure tolerance/diff logic (§7.4) — booted-core-free, so the gate's verdict is
// itself test-covered.
// ---------------------------------------------------------------------------
describe('golden-diff §7.4 tolerances', () => {
  it('reports no diff when actual equals baseline exactly', () => {
    const base: StatMap = { Life: 100, TotalDPS: 2.8933100625 };
    expect(diffStats(base, { ...base })).toEqual([]);
  });

  it('treats an integer-baseline stat as EXACT (any drift is a diff)', () => {
    const diffs = diffStats({ Life: 100 }, { Life: 101 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ statId: 'Life', expected: 100, actual: 101, delta: 1 });
  });

  it('does not flag an integer stat when it is byte-identical', () => {
    expect(diffStats({ Evasion: 7 }, { Evasion: 7 })).toEqual([]);
  });

  it('tolerates a float-baseline drift within 1e-6', () => {
    const base = { TotalEHP: 60.248810219587 };
    expect(diffStats(base, { TotalEHP: 60.248810219587 + 9e-7 })).toEqual([]);
  });

  it('flags a float-baseline drift beyond 1e-6, recording the delta', () => {
    const base = { TotalEHP: 60.248810219587 };
    const diffs = diffStats(base, { TotalEHP: 60.248810219587 + 1e-3 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].statId).toBe('TotalEHP');
    expect(diffs[0].delta).toBeGreaterThan(1e-6);
  });

  it('flags a stat that appeared (in actual, not baseline)', () => {
    const diffs = diffStats({}, { Armour: 12 });
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ statId: 'Armour', expected: undefined, actual: 12 });
  });

  it('flags a stat that disappeared (in baseline, not actual)', () => {
    const diffs = diffStats({ Armour: 12 }, {});
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toMatchObject({ statId: 'Armour', expected: 12, actual: undefined });
  });

  it('renders a readable per-stat report naming fixture/statId/expected/actual/delta', () => {
    const diffs = diffStats({ Life: 100, TotalEHP: 60.25 }, { Life: 101, TotalEHP: 61.0 });
    const report = formatFixtureDiff('single-skill-mace', diffs);
    expect(report).toContain('single-skill-mace');
    expect(report).toContain('Life');
    expect(report).toContain('100');
    expect(report).toContain('101');
    expect(report).toContain('TotalEHP');
    // A reviewer reads the delta to size an upstream-driven change.
    expect(report).toMatch(/delta|Δ/);
  });
});

// ---------------------------------------------------------------------------
// The corpus must be discoverable and well-formed before we boot the core.
// ---------------------------------------------------------------------------
describe('golden corpus', () => {
  it('exposes a matching fixture XML for every recorded baseline', () => {
    const fixtureIds = new Set(
      readdirSync(fixturesDir)
        .filter((f) => f.endsWith('.xml'))
        .map((f) => basename(f, '.xml')),
    );
    expect(corpus.length).toBeGreaterThanOrEqual(10);
    for (const b of corpus) {
      expect(fixtureIds, `${b.id} has a fixture xml`).toContain(b.id);
      expect(Object.keys(b.stats).length, `${b.id} records core stats`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Live parity: drive each fixture THROUGH the core-client and diff calc.run
// against its recorded baseline under §7.4 tolerances.
// ---------------------------------------------------------------------------
describe('golden parity (calc.run vs recorded baselines, DESIGN §7.4)', () => {
  let client: CoreClient | undefined;

  beforeAll(async () => {
    client = await createCoreClient();
  });

  afterAll(async () => {
    await client?.dispose();
    client = undefined;
  });

  for (const baseline of corpus) {
    it(`${baseline.id} (${baseline.cases.join(', ')}) matches its baseline`, async () => {
      const xml = readFileSync(resolve(fixturesDir, `${baseline.id}.xml`), 'utf8');
      const loaded = await client!.load(xml);
      const calc = await client!.calcRun(loaded.buildId);

      // Project calc.run's stat list down to the curated baseline's stat ids — the
      // baseline is the authoritative §7.4 core-stat set for this fixture.
      const tracked = new Set(Object.keys(baseline.stats));
      const actual: StatMap = {};
      for (const s of calc.stats) {
        if (tracked.has(s.statId)) actual[s.statId] = s.value;
      }

      const diffs = diffStats(baseline.stats, actual);
      expect(diffs, formatFixtureDiff(baseline.id, diffs)).toEqual([]);
    });
  }
});
