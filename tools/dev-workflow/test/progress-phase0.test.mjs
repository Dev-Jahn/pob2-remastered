// Phase 0 gate-evidence guard (task p0-gate-green).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It guards the Phase 0 "doneCriteria checkpoint" recorded in
// tools/dev-workflow/PROGRESS.md so the recorded evidence cannot silently regress:
//
//   - The Phase ledger row for Phase 0 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: both required gate names
//     ('vendor-clean', 'core-runner-boot') with their passing exit codes (exit=0),
//     because run-gate.mjs classifies a required gate as a blocker unless it exits 0.
//
// Phase 0 doneCriteria (phases.mjs / DESIGN §18):
//   'CLI에서 sample build 로드 후 주요 stat을 JSON으로 출력'
//   'vendor/ 무수정, overlays/lua 만으로 동작'
// Both are exactly what those two required gates assert, so recording their
// gate-name + exit-code evidence in PROGRESS.md is the Phase 0 sign-off.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function readProgress() {
  return readFileSync(join(REPO_ROOT, 'tools/dev-workflow/PROGRESS.md'), 'utf8');
}

// The Phase ledger is a markdown table; extract the row whose first cell is `0`.
function phaseRow(doc, phase) {
  const row = doc
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^\|\s*0\s*\|/.test(l) && new RegExp(`^\\|\\s*${phase}\\s*\\|`).test(l));
  assert.ok(row, `Phase ${phase} ledger row must exist in PROGRESS.md`);
  return row;
}

test('Phase 0 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 0);
  assert.match(row, /\bdone\b/, 'Phase 0 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 0 must no longer be "in progress"');
});

test('PROGRESS.md records both required Phase 0 gate names with exit=0 evidence', () => {
  const doc = readProgress();
  for (const gate of ['vendor-clean', 'core-runner-boot']) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 0 doneCriteria checkpoint', () => {
  const doc = readProgress();
  // The two DESIGN §18 Phase 0 doneCriteria strings (verbatim, the checkpoint).
  assert.match(
    doc,
    /sample build 로드 후 주요 stat을 JSON으로 출력/,
    'must cite the "sample build → JSON stat" doneCriteria',
  );
  assert.match(
    doc,
    /vendor\/ 무수정, overlays\/lua 만으로 동작/,
    'must cite the "vendor 무수정, overlays/lua 만으로 동작" doneCriteria',
  );
});

test('PROGRESS.md records the luacheck-on-overlays evidence', () => {
  const doc = readProgress();
  assert.match(doc, /luacheck/i, 'must record that luacheck was run on overlays');
});
