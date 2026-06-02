// Upstream-sync dry-run suite (task p7-sync-dryrun; DESIGN §7.2).
//
// The dry-run is the OFFLINE rehearsal of the §7.2 sync bot: against a COMMITTED
// fixture changed-files list (no live `git fetch`, no remote) it runs the §7.3
// classifier, prints the routed-verification report, and synthesizes the PR body
// the bot WOULD open — a submodule-pointer bump plus a per-route test report.
// The two genuinely networked steps (fetch upstream/dev, open the PR) are gated
// (humanGate: network) and replaced with explicit stubs here, so the whole thing
// is deterministic and exits 0 with zero side effects.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyDiff } from '../src/classify.mjs';
import { loadFixture, buildReport, buildPrBody, runDryRun } from '../src/dry-run.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../fixtures/changed-files.json');
const cliPath = resolve(here, '../src/dry-run.mjs');

const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const classification = classifyDiff(fixture.files);

// --- the fixture is a frozen, offline input -----------------------------------

describe('changed-files fixture', () => {
  it('is a committed changed-files list with submodule pointer SHAs and files', () => {
    expect(fixture.submodule).toBe('vendor/PathOfBuilding-PoE2');
    expect(typeof fixture.from).toBe('string');
    expect(typeof fixture.to).toBe('string');
    expect(fixture.from).not.toBe(fixture.to); // a pointer bump must actually move
    expect(Array.isArray(fixture.files)).toBe(true);
    expect(fixture.files.length).toBeGreaterThan(0);
  });

  it('exercises every §7.3 route plus an unknown so the report is non-trivial', () => {
    // The fixture must trigger all seven routes (so "contains every classified
    // route" is a meaningful assertion) and at least one unknown (so the manual-
    // triage path is rehearsed too).
    expect(classification.routesTriggered).toEqual([
      'schema-i18n-coverage',
      'golden-regression',
      'parser-fixtures',
      'tree-snapshot',
      'exporter-dry-run',
      'packaging',
      'ui-parity-checklist',
    ]);
    expect(classification.hasUnknown).toBe(true);
  });
});

// --- the routed-verification report ------------------------------------------

describe('buildReport renders the routed-verification report', () => {
  const report = buildReport(classification);

  it('contains every classified route id with the paths that triggered it', () => {
    for (const route of classification.routesTriggered) {
      expect(report).toContain(route);
      for (const path of classification.routes[route]) {
        expect(report).toContain(path);
      }
    }
  });

  it('surfaces unknown paths for manual triage rather than hiding them', () => {
    for (const path of classification.unknown) {
      expect(report).toContain(path);
    }
  });
});

// --- the synthetic PR body (DESIGN §7.2: pointer bump + per-route report) -----

describe('buildPrBody synthesizes the §7.2 PR body', () => {
  const prBody = buildPrBody(fixture, classification);

  it('has a submodule pointer-bump section naming the from/to SHAs', () => {
    expect(prBody).toMatch(/submodule pointer/i);
    expect(prBody).toContain(fixture.submodule);
    expect(prBody).toContain(fixture.from);
    expect(prBody).toContain(fixture.to);
  });

  it('has a per-route test report listing every classified route', () => {
    expect(prBody).toMatch(/test report/i);
    for (const route of classification.routesTriggered) {
      expect(prBody).toContain(route);
    }
  });

  it('flags that the open-PR + live-fetch steps are network-gated stubs', () => {
    // The two real network actions must be visibly stubbed, not silently faked.
    expect(prBody).toMatch(/dry-run|stub|gated/i);
  });
});

// --- the programmatic dry-run result -----------------------------------------

describe('runDryRun is offline and deterministic', () => {
  it('returns the report, PR body, classification and a zero exit code', () => {
    const r = runDryRun(loadFixture(fixturePath));
    expect(r.exitCode).toBe(0);
    expect(r.report).toContain('schema-i18n-coverage');
    expect(r.prBody).toContain(fixture.to);
    expect(r.classification.routesTriggered).toEqual(classification.routesTriggered);
    // network steps are declared as stubbed, never executed.
    expect(r.network.fetched).toBe(false);
    expect(r.network.prOpened).toBe(false);
  });
});

// --- the CLI: `pnpm run dry-run` prints both sections and exits 0 -------------

describe('dry-run CLI', () => {
  const proc = spawnSync('node', [cliPath], { encoding: 'utf8' });

  it('exits 0', () => {
    expect(proc.status).toBe(0);
  });

  it('prints every classified route and both PR-body sections', () => {
    const out = proc.stdout;
    for (const route of classification.routesTriggered) {
      expect(out).toContain(route);
    }
    expect(out).toMatch(/submodule pointer/i);
    expect(out).toMatch(/test report/i);
    expect(out).toContain(fixture.from);
    expect(out).toContain(fixture.to);
  });

  it('does not perform any live network action (gated stub only)', () => {
    expect(proc.stdout).toMatch(/dry-run|stub|gated|network/i);
  });
});
