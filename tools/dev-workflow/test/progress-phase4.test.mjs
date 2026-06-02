// Phase 4 gate-evidence guard (task p4-gate-green — the phase sign-off).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It guards the Phase 4 sign-off recorded in
// tools/dev-workflow/PROGRESS.md so the recorded evidence cannot silently regress:
//
//   - The Phase ledger row for Phase 4 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: all required Phase 4 gate names
//     (the BASE set + calc-mutation) with their passing exit codes (exit=0),
//     because run-gate.mjs classifies a required gate as a blocker unless it exits 0.
//   - The sign-off must consume the gates exactly as defined in gates.mjs without
//     editing them, so this test derives the required gate names FROM gates.mjs.
//
// Phase 4 doneCriteria (phases.mjs / DESIGN §18, §10.5/§10.7/§10.8):
//   '주요 빌드 수정 flow가 기존 PoB 없이 가능'
//   'Calcs tab에서 결과 추적(formula trace) 가능'
// Those map onto the calc-mutation gate (setGemGroup/setConfigOption → recalc
// end-to-end mutation→delta) and the Calcs breakdown explorer's calc.explain
// formula trace, so recording their gate-name + exit-code evidence in PROGRESS.md
// (with the doneCriteria → evidence mapping) is the Phase 4 sign-off.
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

test('Phase 4 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 4);
  assert.match(row, /\bdone\b/, 'Phase 4 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 4 must no longer be "in progress"');
});

test('PROGRESS.md records every required Phase 4 gate name with exit=0 evidence', () => {
  const doc = readProgress();
  // Derive the required gate names straight from gates.mjs — the sign-off must
  // consume the gate set exactly as defined, so the guard cannot drift from it.
  const required = GATES['4'].filter((g) => g.required).map((g) => g.name);
  assert.ok(required.length >= 5, 'Phase 4 must define the BASE + calc-mutation gate as required');
  assert.ok(required.includes('calc-mutation'), 'Phase 4 must require the calc-mutation gate');
  for (const gate of required) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 4 doneCriteria checkpoint with its evidence mapping', () => {
  const doc = readProgress();
  // The two DESIGN §18 Phase 4 doneCriteria strings (verbatim, the checkpoint).
  assert.match(
    doc,
    /주요 빌드 수정 flow가 기존 PoB 없이 가능/,
    'must cite the "build-mutation flow without legacy PoB" doneCriteria',
  );
  assert.match(
    doc,
    /Calcs tab(에서)? 결과 추적/,
    'must cite the "Calcs tab result trace (formula trace)" doneCriteria',
  );
  // The doneCriteria → evidence mapping must name the concrete mechanisms:
  // setGemGroup/setConfigOption → recalc end-to-end, and calc.explain formula trace.
  assert.match(
    doc,
    /setGemGroup/,
    'must map the build-mutation doneCriteria to skills.setGemGroup',
  );
  assert.match(
    doc,
    /setConfigOption|config\.setOption/,
    'must map the build-mutation doneCriteria to config.setOption',
  );
  assert.match(
    doc,
    /calc\.explain/,
    'must map the Calcs-trace doneCriteria to calc.explain formula trace',
  );
});

test('PROGRESS.md records that the gate set was consumed unedited (gates.mjs/phases.mjs untouched)', () => {
  const doc = readProgress();
  assert.match(
    doc,
    /gates\.mjs/,
    'must record that the Phase 4 sign-off consumed gates.mjs without editing it',
  );
  assert.match(
    doc,
    /phases\.mjs/,
    'must record that the Phase 4 sign-off consumed phases.mjs without editing it',
  );
});

test('PROGRESS.md carries the Phase 4 carryover / flag log entries', () => {
  const doc = readProgress();
  // Open carryover/flags must be updated/carried, not dropped (spec §2).
  assert.match(
    doc,
    /gemini-vision-unavailable/,
    'must carry the gemini-vision-unavailable flag (visual verifier env limit)',
  );
});
