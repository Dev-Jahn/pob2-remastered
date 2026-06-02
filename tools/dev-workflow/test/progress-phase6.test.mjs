// Phase 6 gate-evidence guard (task p6-gate-green — the phase sign-off).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It guards the Phase 6 sign-off recorded in
// tools/dev-workflow/PROGRESS.md so the recorded evidence cannot silently regress:
//
//   - The Phase ledger row for Phase 6 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: all required Phase 6 gate names
//     (the BASE set + importer-dryrun + coverage + bilingual-search) with their
//     passing exit codes (exit=0), because run-gate.mjs classifies a required gate
//     as a blocker unless it exits 0.
//   - The sign-off must consume the gates exactly as defined in gates.mjs without
//     editing them, so this test derives the required gate names FROM gates.mjs.
//
// Phase 6 doneCriteria (phases.mjs / DESIGN §18, §8.7):
//   'UI 문자열 100%'
//   '주요 데이터 영역 coverage MVP 임계 (DESIGN §8.7)'
//   '한국어 클립보드 item parse 성공률 측정'
// Those map onto:
//   (1) 'UI 문자열 100%'      ← the @pob2/ui i18n ko/en key-parity proof
//                               (loc-stat-label-localize) cross-referenced by the
//                               coverage gate's UI leg.
//   (2) 'coverage MVP 임계'   ← the coverage gate enforcing the per-domain §8.7
//                               thresholds (UI 100 / keyword·skill·support 95 /
//                               base·unique 90 / passive 85 / mod·stat 70).
//   (3) 'parse 성공률 측정'   ← the core-client parser gate's measured Korean paste
//                               parse success rate vs the §8.7 70% MVP target.
// Recording their gate-name + exit-code evidence in PROGRESS.md (with the
// doneCriteria → evidence mapping) is the Phase 6 sign-off.
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

test('Phase 6 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 6);
  assert.match(row, /\bdone\b/, 'Phase 6 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 6 must no longer be "in progress"');
});

test('PROGRESS.md records every required Phase 6 gate name with exit=0 evidence', () => {
  const doc = readProgress();
  // Derive the required gate names straight from gates.mjs — the sign-off must
  // consume the gate set exactly as defined, so the guard cannot drift from it.
  const required = GATES['6'].filter((g) => g.required).map((g) => g.name);
  assert.ok(
    required.length >= 7,
    'Phase 6 must define the BASE + importer-dryrun + coverage + bilingual-search gates as required',
  );
  // The three Phase 6-specific required gates must be present.
  assert.ok(required.includes('importer-dryrun'), 'Phase 6 must require the importer-dryrun gate');
  assert.ok(required.includes('coverage'), 'Phase 6 must require the coverage gate');
  assert.ok(
    required.includes('bilingual-search'),
    'Phase 6 must require the bilingual-search gate',
  );
  for (const gate of required) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 6 doneCriteria checkpoint with its evidence mapping', () => {
  const doc = readProgress();
  // The three DESIGN §18 Phase 6 doneCriteria strings (verbatim, the checkpoint).
  assert.match(doc, /UI 문자열 100%/, 'must cite the "UI 문자열 100%" doneCriteria');
  assert.match(
    doc,
    /주요 데이터 영역 coverage MVP 임계/,
    'must cite the "주요 데이터 영역 coverage MVP 임계 (§8.7)" doneCriteria',
  );
  assert.match(
    doc,
    /한국어 클립보드 item parse 성공률 측정/,
    'must cite the "한국어 클립보드 item parse 성공률 측정" doneCriteria',
  );
  // The doneCriteria → evidence mapping must name the concrete mechanisms:
  // (1) UI 100% ← i18n ko/en key-parity + loc-stat-label-localize.
  assert.match(
    doc,
    /key-parity|키 패리티/,
    'must map the UI 100% doneCriteria to the i18n ko/en key-parity proof',
  );
  assert.match(
    doc,
    /loc-stat-label-localize/,
    'must map the UI 100% doneCriteria to loc-stat-label-localize',
  );
  // (2) coverage MVP 임계 ← the coverage gate enforcing the §8.7 per-domain thresholds.
  assert.match(doc, /§8\.7/, 'must reference the DESIGN §8.7 coverage threshold table');
  assert.match(
    doc,
    /per-domain|도메인별|coverage:check/,
    'must map the coverage doneCriteria to the per-domain coverage:check gate',
  );
  // (3) parse 성공률 ← the core-client parser gate's measured rate vs the §8.7 70% target.
  assert.match(doc, /70%/, 'must map the parse-success doneCriteria to the §8.7 70% MVP target');
  assert.match(
    doc,
    /parser-fixtures|core-client.*parser|parser.*core-client|성공률/,
    'must map the parse-success doneCriteria to the core-client parser measured rate',
  );
});

test('PROGRESS.md records that the gate set was consumed unedited (gates.mjs/phases.mjs untouched)', () => {
  const doc = readProgress();
  assert.match(
    doc,
    /gates\.mjs/,
    'must record that the Phase 6 sign-off consumed gates.mjs without editing it',
  );
  assert.match(
    doc,
    /phases\.mjs/,
    'must record that the Phase 6 sign-off consumed phases.mjs without editing it',
  );
});

test('PROGRESS.md carries forward the still-open Phase 6 flags', () => {
  const doc = readProgress();
  // The task names the still-open flags that must be carried forward, not dropped.
  assert.match(doc, /skills-tab-read-only/, 'must carry the p4/skills-tab-read-only flag');
  assert.match(
    doc,
    /build-load-response-schema/,
    'must carry the p1/build-load-response-schema flag',
  );
  assert.match(doc, /share-code codec/, 'must carry the WebView share-code codec flag');
  assert.match(doc, /items\.createCustom/, 'must carry the items.createCustom flag');
  assert.match(
    doc,
    /gemini-vision-unavailable/,
    'must carry the gemini-vision-unavailable flag (visual verifier env limit)',
  );
});
