// Phase 7 carryover-triage guard (task p7-carryover-triage).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It is pure ledger bookkeeping: it guards a triage note appended
// to tools/dev-workflow/PROGRESS.md so a still-open prior-phase flag carried into
// Phase 7 cannot silently DROP off the ledger.
//
// The triage records, as an explicit Phase 7 decision, that every prior-phase open
// flag has been examined against the Phase 7 doneCriteria (phases.mjs / DESIGN §18):
//   'upstream update PR 자동 생성 (dry-run)'
//   'release artifact reproducible (dry-run)'
//   'rollback 가능한 updater (unit)'
// …and that none of them BLOCKS any of those criteria — they are shipped-UI / data
// feature gaps, not release-automation blockers — and where each is deferred to.
//
// The carried flags that must stay on the ledger (the task's explicit list):
//   - p4/skills-tab-read-only
//   - p1/build-load-response-schema (BuildState gap)
//   - CARRYOVER Import/Export WebView share-code codec
//   - p3-client-items items.createCustom
//   - p6/official-ko-terminology
//   - gemini-vision-unavailable
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PHASES } from '../phases.mjs';
import { GATES } from '../gates.mjs';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function readProgress() {
  return readFileSync(join(REPO_ROOT, 'tools/dev-workflow/PROGRESS.md'), 'utf8');
}

// Isolate the Phase 7 carryover-triage section so the rulings are checked against
// THAT note, not against an unrelated mention elsewhere in the ledger.
function triageSection(doc) {
  const startMatch = doc.match(/^#+.*Phase 7 carryover triage.*$/im);
  assert.ok(startMatch, 'PROGRESS.md must contain a "Phase 7 carryover triage" section heading');
  const start = startMatch.index;
  // The section runs until the next top-or-equal-level heading, or EOF.
  const rest = doc.slice(start + startMatch[0].length);
  const nextHeading = rest.match(/^#+ /m);
  const end = nextHeading ? start + startMatch[0].length + nextHeading.index : doc.length;
  return doc.slice(start, end);
}

// The carried flags that must NOT silently drop from the ledger (task's explicit list).
const CARRIED_FLAGS = [
  { label: 'p4/skills-tab-read-only', re: /skills-tab-read-only/ },
  { label: 'p1/build-load-response-schema BuildState gap', re: /build-load-response-schema/ },
  { label: 'CARRYOVER Import/Export WebView share-code codec', re: /share-code codec/ },
  { label: 'p3-client-items items.createCustom', re: /items\.createCustom/ },
  { label: 'p6/official-ko-terminology', re: /official-ko-terminology/ },
  { label: 'gemini-vision-unavailable', re: /gemini-vision-unavailable/ },
];

test('PROGRESS.md has a Phase 7 carryover-triage section', () => {
  // Constructing the section asserts the heading exists.
  const section = triageSection(readProgress());
  assert.ok(section.length > 0, 'the Phase 7 carryover-triage section must be non-empty');
});

test('the triage lists every still-open carried flag (none silently dropped)', () => {
  const section = triageSection(readProgress());
  for (const flag of CARRIED_FLAGS) {
    assert.match(
      section,
      flag.re,
      `the Phase 7 carryover triage must list the ${flag.label} flag (it cannot silently drop)`,
    );
  }
});

test('the triage cites the Phase 7 doneCriteria the flags are ruled against', () => {
  const section = triageSection(readProgress());
  // The ruling "does not block any Phase 7 doneCriteria" is anchored to the three
  // verbatim DESIGN §18 Phase 7 doneCriteria strings (derived from phases.mjs so the
  // guard cannot drift from the source of truth).
  const doneCriteria = PHASES['7'].doneCriteria;
  assert.equal(doneCriteria.length, 3, 'Phase 7 must define exactly 3 doneCriteria');
  for (const criterion of doneCriteria) {
    assert.ok(
      section.includes(criterion),
      `the triage must cite the Phase 7 doneCriteria "${criterion}" the flags are ruled against`,
    );
  }
});

test('the triage rules that no carried flag blocks a Phase 7 doneCriteria', () => {
  const section = triageSection(readProgress());
  // The explicit Phase 7 decision: these are shipped-UI / data feature gaps, NOT
  // release-automation blockers — so they do not block any Phase 7 doneCriteria.
  assert.match(
    section,
    /does not block|블록(하지|되지) 않|blocks? no Phase 7|non-?blocking|not a .* blocker/i,
    'the triage must rule that the carried flags do NOT block any Phase 7 doneCriteria',
  );
  assert.match(
    section,
    /release-?automation|release automation/i,
    'the triage must characterise Phase 7 as release-automation (the flags are not its blockers)',
  );
});

test('every carried flag carries a one-line ruling + a deferral target', () => {
  const section = triageSection(readProgress());
  // The note must record, per flag, a one-line bullet that BOTH gives the
  // non-blocking ruling and states where the flag is deferred to. We check, per
  // flag bullet, that the same bullet line carries a deferral marker so a flag
  // cannot be listed without a disposition.
  const bullets = section.split('\n').filter((l) => /^\s*[-*]/.test(l));
  for (const flag of CARRIED_FLAGS) {
    const bullet = bullets.find((b) => flag.re.test(b));
    assert.ok(bullet, `the ${flag.label} flag must appear as its own one-line triage bullet`);
    assert.match(
      bullet,
      /defer|deferred|carr(y|ied)|wire when|resolve when|when .* lands|configure |후속|이월|연기/i,
      `the ${flag.label} bullet must state where the flag is deferred to`,
    );
  }
});

// ---------------------------------------------------------------------------
// Phase 7 sign-off guard (task p7-gate-green — the phase freeze).
//
// Same shape as test/progress-phase{4,5,6}.test.mjs: a pure verification test
// (touches nothing under vendor/, runs no production code) guarding the Phase 7
// sign-off recorded in tools/dev-workflow/PROGRESS.md so the recorded evidence
// cannot silently regress:
//   - The Phase ledger row for Phase 7 must be marked `done` (not "in progress").
//   - That row must carry run-gate evidence: all required Phase 7 gate names
//     (the BASE set + sync-dryrun + updater-rollback + diagnostic-schema) with
//     their passing exit codes (exit=0), because run-gate.mjs classifies a
//     required gate as a blocker unless it exits 0.
//   - The sign-off must consume the gates exactly as defined in gates.mjs without
//     editing them, so this test derives the required gate names FROM gates.mjs.
//
// Phase 7 doneCriteria (phases.mjs / DESIGN §18) → evidence mapping the sign-off
// rests on (the task's explicit mapping):
//   'upstream update PR 자동 생성 (dry-run)'   ← the sync-dryrun gate
//   'release artifact reproducible (dry-run)'  ← the packaging-dryrun tooling
//   'rollback 가능한 updater (unit)'            ← the updater-rollback gate
// ---------------------------------------------------------------------------

// The Phase ledger is a markdown table; extract the row whose first cell is the phase.
function phaseRow(doc, phase) {
  const row = doc
    .split('\n')
    .map((l) => l.trim())
    .find((l) => new RegExp(`^\\|\\s*${phase}\\s*\\|`).test(l));
  assert.ok(row, `Phase ${phase} ledger row must exist in PROGRESS.md`);
  return row;
}

test('Phase 7 ledger row is marked done', () => {
  const row = phaseRow(readProgress(), 7);
  assert.match(row, /\bdone\b/, 'Phase 7 status cell must read "done"');
  assert.doesNotMatch(row, /in progress/, 'Phase 7 must no longer be "in progress"');
});

test('PROGRESS.md records every required Phase 7 gate name with exit=0 evidence', () => {
  const doc = readProgress();
  // Derive the required gate names straight from gates.mjs — the sign-off must
  // consume the gate set exactly as defined, so the guard cannot drift from it.
  const required = GATES['7'].filter((g) => g.required).map((g) => g.name);
  assert.ok(
    required.length >= 7,
    'Phase 7 must define the BASE + sync-dryrun + updater-rollback + diagnostic-schema gates as required',
  );
  // The three Phase 7-specific required gates must be present.
  assert.ok(required.includes('sync-dryrun'), 'Phase 7 must require the sync-dryrun gate');
  assert.ok(
    required.includes('updater-rollback'),
    'Phase 7 must require the updater-rollback gate',
  );
  assert.ok(
    required.includes('diagnostic-schema'),
    'Phase 7 must require the diagnostic-schema gate',
  );
  for (const gate of required) {
    assert.match(doc, new RegExp(gate), `must record run-gate evidence for the ${gate} gate`);
  }
  // The recorded evidence must show the gates actually passed (run-gate exit codes).
  assert.match(doc, /exit=0|exit 0|exit:\s*0/i, 'must record the passing exit code from run-gate');
});

test('PROGRESS.md cites the Phase 7 doneCriteria checkpoint with its evidence mapping', () => {
  const doc = readProgress();
  // The three DESIGN §18 Phase 7 doneCriteria strings (verbatim, the checkpoint) —
  // derived from phases.mjs so the guard cannot drift from the source of truth.
  const doneCriteria = PHASES['7'].doneCriteria;
  assert.equal(doneCriteria.length, 3, 'Phase 7 must define exactly 3 doneCriteria');
  for (const criterion of doneCriteria) {
    assert.ok(doc.includes(criterion), `must cite the "${criterion}" Phase 7 doneCriteria`);
  }
  // The doneCriteria → evidence mapping must name the concrete mechanisms (the
  // task's explicit mapping):
  // (1) 'upstream update PR 자동 생성 (dry-run)' ← the sync-dryrun gate.
  assert.match(
    doc,
    /sync-dryrun/,
    'must map the upstream-PR-auto-dry-run doneCriteria to the sync-dryrun gate',
  );
  // (2) 'release artifact reproducible (dry-run)' ← the packaging-dryrun tooling.
  assert.match(
    doc,
    /packaging-dryrun/,
    'must map the reproducible-artifact-dry-run doneCriteria to the packaging-dryrun tooling',
  );
  // (3) 'rollback 가능한 updater (unit)' ← the updater-rollback gate.
  assert.match(
    doc,
    /updater-rollback/,
    'must map the rollback-updater-unit doneCriteria to the updater-rollback gate',
  );
});

test('PROGRESS.md records that the gate set was consumed unedited (gates.mjs/phases.mjs untouched)', () => {
  const doc = readProgress();
  assert.match(
    doc,
    /gates\.mjs/,
    'must record that the Phase 7 sign-off consumed gates.mjs without editing it',
  );
  assert.match(
    doc,
    /phases\.mjs/,
    'must record that the Phase 7 sign-off consumed phases.mjs without editing it',
  );
});

test('PROGRESS.md carries forward the still-open Phase 7 flags at the freeze', () => {
  const doc = readProgress();
  // The same still-open flags triaged above must still be carried at the freeze,
  // not dropped — the sign-off cannot silently lose a flag.
  for (const flag of CARRIED_FLAGS) {
    assert.match(doc, flag.re, `the Phase 7 sign-off must carry forward the ${flag.label} flag`);
  }
});
