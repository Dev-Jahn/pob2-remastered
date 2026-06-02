// Phase 5 gate-evidence guard (task p5-gate-green — the phase sign-off).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It guards the Phase 5 sign-off recorded in
// tools/dev-workflow/PROGRESS.md so the recorded evidence cannot silently regress:
//
//   - The Phase ledger row for Phase 5 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: all required Phase 5 gate names
//     (the BASE set + tree-transform) with their passing exit codes (exit=0),
//     because run-gate.mjs classifies a required gate as a blocker unless it exits 0.
//   - The sign-off must consume the gates exactly as defined in gates.mjs without
//     editing them, so this test derives the required gate names FROM gates.mjs.
//
// Phase 5 doneCriteria (phases.mjs / DESIGN §18, §10.6 / §16.3):
//   '기존 트리 기능 parity'                          (existing tree feature parity)
//   '대규모 zoom/pan 성능 기준 충족 (DESIGN §16.3)'   (large-scale zoom/pan perf budget)
// Those map onto the tree-transform gate: the §10.6 tree features (node search /
// path preview / allocation delta / canvas render) and the §16.3 performance
// budget (the p5-tree-perf benchmark — search ≤50ms, frame ≤16.6ms with viewport
// culling), so recording their gate-name + exit-code evidence in PROGRESS.md
// (with the doneCriteria → evidence mapping) is the Phase 5 sign-off.
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

test('Phase 5 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 5);
  assert.match(row, /\bdone\b/, 'Phase 5 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 5 must no longer be "in progress"');
});

test('PROGRESS.md records every required Phase 5 gate name with exit=0 evidence', () => {
  const doc = readProgress();
  // Derive the required gate names straight from gates.mjs — the sign-off must
  // consume the gate set exactly as defined, so the guard cannot drift from it.
  const required = GATES['5'].filter((g) => g.required).map((g) => g.name);
  assert.ok(required.length >= 5, 'Phase 5 must define the BASE + tree-transform gate as required');
  assert.ok(required.includes('tree-transform'), 'Phase 5 must require the tree-transform gate');
  for (const gate of required) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 5 doneCriteria checkpoint with its evidence mapping', () => {
  const doc = readProgress();
  // The two DESIGN §18 Phase 5 doneCriteria strings (verbatim, the checkpoint).
  assert.match(
    doc,
    /기존 트리 기능 parity/,
    'must cite the "existing tree feature parity" doneCriteria',
  );
  assert.match(
    doc,
    /대규모\s*zoom\/pan 성능/,
    'must cite the "large-scale zoom/pan performance budget (§16.3)" doneCriteria',
  );
  // The doneCriteria → evidence mapping must name the concrete §10.6 tree features
  // that prove parity: node search, path preview, allocation delta, and the render.
  assert.match(doc, /검색|search/, 'must map the parity doneCriteria to node search');
  assert.match(
    doc,
    /path preview|경로|previewPath/,
    'must map the parity doneCriteria to path preview',
  );
  assert.match(
    doc,
    /allocation delta|allocationDelta|할당 (델타|변화)/,
    'must map the parity doneCriteria to allocation delta',
  );
  assert.match(doc, /렌더|render/, 'must map the parity doneCriteria to the canvas render');
  // The perf doneCriteria must map to the p5-tree-perf §16.3 benchmark assertion.
  assert.match(
    doc,
    /p5-tree-perf/,
    'must map the perf doneCriteria to the p5-tree-perf §16.3 benchmark',
  );
});

test('PROGRESS.md records that the gate set was consumed unedited (gates.mjs/phases.mjs untouched)', () => {
  const doc = readProgress();
  assert.match(
    doc,
    /gates\.mjs/,
    'must record that the Phase 5 sign-off consumed gates.mjs without editing it',
  );
  assert.match(
    doc,
    /phases\.mjs/,
    'must record that the Phase 5 sign-off consumed phases.mjs without editing it',
  );
});

test('PROGRESS.md records the VISUAL[5] /tree best-effort visual verify result', () => {
  const doc = readProgress();
  // The §10.6 /tree screen is verified best-effort (spec §6) — record the result.
  assert.match(doc, /VISUAL\[5\]|\/tree/, 'must record the VISUAL[5] /tree best-effort verify');
});

test('PROGRESS.md carries the Phase 5 carryover / flag log entries', () => {
  const doc = readProgress();
  // Open carryover/flags must be updated/carried, not dropped (spec §2).
  assert.match(
    doc,
    /gemini-vision-unavailable/,
    'must carry the gemini-vision-unavailable flag (visual verifier env limit)',
  );
});
