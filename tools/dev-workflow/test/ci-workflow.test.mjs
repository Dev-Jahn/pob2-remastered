// CI ↔ gate parity guard (Phase 2 wiring, DESIGN §17.1).
//
// Pure verification test: it reads .github/workflows/ci.yml as text and asserts the
// per-phase gate commands defined in gates.mjs are actually invoked by CI, so the
// workflow cannot silently drift back to a placeholder echo while the local gate
// suite stays green. It touches nothing under vendor/ and runs no production code.
//
// Phase 2 wires the `test-ui` job to the three phase-2 UI/build gates and lets the
// existing Rust fmt/clippy step auto-detect the new apps/desktop/src-tauri crate.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GATES } from '../gates.mjs';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8');

// The placeholder echo for the UI job must be gone once Phase 2 lands.
test('test-ui job no longer ships the Phase 2 placeholder echo', () => {
  assert.doesNotMatch(
    ci,
    /TODO Phase 2\+/,
    'the test-ui job still has its placeholder echo instead of the real Phase 2 commands',
  );
});

// The test-ui job runs the real phase-2 UI/build gate commands (web-build,
// ui-unit, i18n-toggle) verbatim, so CI and the local gate runner stay in lockstep.
test('test-ui job invokes the phase-2 web-build / ui-unit / i18n-toggle gates', () => {
  const gate = (name) => GATES[2].find((g) => g.name === name).cmd;
  for (const name of ['web-build', 'ui-unit', 'i18n-toggle']) {
    assert.ok(
      ci.includes(gate(name)),
      `ci.yml must run the phase-2 "${name}" gate command: ${gate(name)}`,
    );
  }
});

// The Rust fmt/clippy step auto-detects Cargo.toml outside vendor/, so the new
// apps/desktop/src-tauri crate is linted without a workflow edit.
test('lint job runs cargo fmt/clippy and skips vendor/ Cargo.toml', () => {
  assert.match(ci, /cargo fmt --all -- --check/, 'lint job must run cargo fmt --check');
  assert.match(ci, /cargo clippy .*-D warnings/, 'lint job must run cargo clippy with -D warnings');
  assert.match(
    ci,
    /-name Cargo\.toml -not -path '\.\/vendor\/\*'/,
    'cargo step must auto-detect Cargo.toml while excluding vendor/',
  );
});
