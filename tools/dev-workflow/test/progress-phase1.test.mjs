// Phase 1 gate-evidence guard (task phase1-gate — the phase sign-off).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It guards the Phase 1 sign-off recorded in
// tools/dev-workflow/PROGRESS.md so the recorded evidence cannot silently regress:
//
//   - The Phase ledger row for Phase 1 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: all required Phase 1 gate names
//     (the BASE set + golden-parity + rpc-schema + crash-isolation) with their
//     passing exit codes (exit=0), because run-gate.mjs classifies a required gate
//     as a blocker unless it exits 0.
//   - The sign-off must consume the gates exactly as defined in gates.mjs without
//     editing them, so this test derives the required gate names FROM gates.mjs.
//
// Phase 1 doneCriteria (phases.mjs / DESIGN §18, §7.4):
//   '기존 PoB와 주요 stat 일치 (golden diff, 허용오차 DESIGN §7.4)'
//   'malformed input에서도 runner/UI process 유지'
// Those map onto the golden-parity gate (§7.4: integer exact, float within 1e-6)
// and the crash-isolation gate (malformed input keeps the runner alive), so
// recording their gate-name + exit-code evidence in PROGRESS.md is the sign-off.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GATES } from '../gates.mjs';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function readProgress() {
  return readFileSync(join(REPO_ROOT, 'tools/dev-workflow/PROGRESS.md'), 'utf8');
}

// The Phase ledger is a markdown table; extract the row whose first cell is the phase.
function phaseRow(doc, phase) {
  const row = doc
    .split('\n')
    .map((l) => l.trim())
    .find((l) => new RegExp(`^\\|\\s*${phase}\\s*\\|`).test(l));
  assert.ok(row, `Phase ${phase} ledger row must exist in PROGRESS.md`);
  return row;
}

test('Phase 1 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 1);
  assert.match(row, /\bdone\b/, 'Phase 1 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 1 must no longer be "in progress"');
});

test('PROGRESS.md records every required Phase 1 gate name with exit=0 evidence', () => {
  const doc = readProgress();
  // Derive the required gate names straight from gates.mjs — the sign-off must
  // consume the gate set exactly as defined, so the guard cannot drift from it.
  const required = GATES['1'].filter((g) => g.required).map((g) => g.name);
  assert.ok(required.length >= 4, 'Phase 1 must define the BASE + 3 phase gates as required');
  for (const gate of required) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 1 doneCriteria checkpoint', () => {
  const doc = readProgress();
  // The two DESIGN §18 Phase 1 doneCriteria strings (verbatim, the checkpoint).
  assert.match(
    doc,
    /기존 PoB와 주요 stat 일치/,
    'must cite the "golden stat parity (§7.4)" doneCriteria',
  );
  assert.match(
    doc,
    /malformed input에서도 runner\/UI process 유지/,
    'must cite the "malformed input keeps runner/UI alive" doneCriteria',
  );
  // §7.4 tolerance contract: integer exact, float within 1e-6.
  assert.match(doc, /§7\.4/, 'must reference the DESIGN §7.4 tolerance contract');
});

test('PROGRESS.md records that the gate set was consumed unedited (gates.mjs untouched)', () => {
  const doc = readProgress();
  assert.match(
    doc,
    /gates\.mjs/,
    'must record that the Phase 1 sign-off consumed gates.mjs without editing it',
  );
});
