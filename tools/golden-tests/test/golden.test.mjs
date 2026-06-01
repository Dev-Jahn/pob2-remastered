// Golden fixture corpus regression suite (task golden-fixtures; DESIGN §7.4, §16).
//
// This is the parity-anchor test: the deterministic golden fixtures under
// fixtures/ are loaded through the REAL vendored core (luajit overlays/lua/
// runner.lua, the same provenance path as the existing sample-build.xml), their
// curated §7.4 core stats are recorded, and asserted to be byte-identical to the
// committed baselines under baselines/. A divergence here means this fork's calc
// output drifted from the recorded anchor — exactly what the golden gate must
// catch (DESIGN §7.4 "fork와 upstream의 계산 차이 감지").
//
// The recorder is the deliverable script itself (record-baselines.mjs); the test
// exercises its public surface (the corpus manifest + the record/compare core) so
// `node record-baselines.mjs --check` and this suite share one implementation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import {
  FIXTURES,
  fixturePath,
  baselinePath,
  recordFixture,
  compareStats,
  CORE_STAT_IDS,
  openCore,
} from '../record-baselines.mjs';

describe('golden fixture corpus (DESIGN §7.4)', () => {
  it('declares 10–20 fixtures covering the §7.4 case matrix', () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
    expect(FIXTURES.length).toBeLessThanOrEqual(20);
    // Every §7.4 self-generated case is represented at least once via `cases` tags.
    const required = [
      'unarmed',
      'single-skill',
      'aura-reservation',
      'minion',
      'dot',
      'crit',
      'ailment',
      'item-set-swap',
      'passive-delta',
      'jewel-radius-conversion',
      'party-support',
    ];
    const covered = new Set(FIXTURES.flatMap((f) => f.cases));
    for (const c of required) expect(covered, `case "${c}" must be covered`).toContain(c);
  });

  it('every fixture has an authored XML file and a recorded baseline JSON', () => {
    for (const f of FIXTURES) {
      expect(existsSync(fixturePath(f)), `${f.id} fixture xml exists`).toBe(true);
      expect(existsSync(baselinePath(f)), `${f.id} baseline json exists`).toBe(true);
    }
  });

  it('every fixture documents its intent and the gamedata IDs it uses', () => {
    // The task deliverable: each fixture must document its intent and gamedata IDs
    // (in the manifest) and carry that provenance note in its XML header — proving
    // the build was authored from upstream data, not live-scraped (humanGate=gamedata).
    for (const f of FIXTURES) {
      expect(typeof f.intent, `${f.id} has an intent`).toBe('string');
      expect(f.intent.length, `${f.id} intent non-empty`).toBeGreaterThan(0);
      expect(Array.isArray(f.gamedata), `${f.id} lists gamedata ids`).toBe(true);
      expect(f.gamedata.length, `${f.id} gamedata non-empty`).toBeGreaterThan(0);

      const xml = readFileSync(fixturePath(f), 'utf8');
      expect(xml, `${f.id} xml documents provenance`).toMatch(
        /humanGate=gamedata|upstream save formats/,
      );
      expect(xml, `${f.id} xml declares no live scraping`).toMatch(
        /NO live[\s-]*\n?\s*scrap|NOT live-scraped/,
      );
    }
  });

  it('every baseline records only curated §7.4 core stat ids and finite numbers', () => {
    for (const f of FIXTURES) {
      const baseline = JSON.parse(readFileSync(baselinePath(f), 'utf8'));
      expect(baseline.id).toBe(f.id);
      expect(typeof baseline.stats).toBe('object');
      const ids = Object.keys(baseline.stats);
      expect(ids.length, `${f.id} has at least one core stat`).toBeGreaterThan(0);
      for (const id of ids) {
        expect(CORE_STAT_IDS, `${f.id}: ${id} is a §7.4 core stat`).toContain(id);
        expect(Number.isFinite(baseline.stats[id]), `${f.id}.${id} finite`).toBe(true);
      }
    }
  });
});

describe('golden parity against the vendored core', () => {
  let core;

  beforeAll(async () => {
    core = await openCore();
  });

  afterAll(async () => {
    await core?.dispose();
  });

  it('re-recording every fixture reproduces its committed baseline exactly', async () => {
    for (const f of FIXTURES) {
      const xml = readFileSync(fixturePath(f), 'utf8');
      const fresh = await recordFixture(core, f, xml);
      const baseline = JSON.parse(readFileSync(baselinePath(f), 'utf8'));
      const diff = compareStats(baseline.stats, fresh.stats);
      expect(diff, `${f.id} (${f.cases.join(', ')}) diverged from baseline`).toEqual([]);
    }
  });
});
