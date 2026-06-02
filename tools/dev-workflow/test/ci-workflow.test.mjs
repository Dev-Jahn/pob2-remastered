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
const sync = readFileSync(join(REPO_ROOT, '.github/workflows/upstream-sync.yml'), 'utf8');

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

// --- Phase 7: the upstream-sync workflow is wired to the real sync tooling ----
//
// The Classify-diff and Open-PR steps must invoke the p7-sync-classifier /
// dry-run tooling (tools/upstream-sync) instead of the Phase 7 TODO placeholders,
// so the scheduled sync rehearses the §7.2/§7.3 flow offline. The live fetch +
// PR open stay network-gated (humanGate: network).

// The Phase 7 TODO placeholder notices must be gone once the steps are wired.
test('upstream-sync workflow no longer ships the Phase 7 TODO placeholders', () => {
  assert.doesNotMatch(
    sync,
    /TODO Phase 7/,
    'the Classify-diff / Open-PR steps still have their Phase 7 placeholder notices instead of invoking the real sync tooling',
  );
});

// The Classify-diff and Open-PR steps run the real upstream-sync dry-run tooling
// (tools/upstream-sync), which classifies the fetched diff and synthesizes the
// submodule-bump PR body with its routed test report.
test('upstream-sync workflow invokes the @pob2/upstream-sync dry-run tooling', () => {
  assert.match(
    sync,
    /@pob2\/upstream-sync/,
    'the sync workflow must drive the @pob2/upstream-sync package (classifier + dry-run)',
  );
  assert.match(
    sync,
    /dry-run/,
    'the sync workflow must invoke the upstream-sync dry-run to classify the diff and build the PR report',
  );
});

// --- Phase 7: the CI package job is wired to the real packaging dry-run ---------
//
// The `package` job's "Build installers" step must invoke the offline packaging
// dry-run (tools/dev-workflow/packaging-dryrun.mjs) instead of the Phase 7 TODO
// placeholder, so every CI run rehearses the §17.2 release-artifact manifest. The
// native `tauri build` + code-signing matrix stays secret-gated (humanGate:
// secret) — it only runs when the signing secrets are present.

// The Phase 7 TODO placeholder notice in the package job must be gone once wired.
test('package job no longer ships the Phase 7 TODO placeholder', () => {
  assert.doesNotMatch(
    ci,
    /TODO Phase 7/,
    'the package step still has its Phase 7 placeholder notice instead of the real packaging dry-run',
  );
});

// The package job runs the offline §17.2 packaging dry-run (manifest + checksums),
// reproducible from the committed tree without a native build or signing.
test('package job invokes the packaging dry-run (DESIGN §17.2)', () => {
  assert.match(
    ci,
    /packaging-dryrun\.mjs/,
    'the package job must invoke tools/dev-workflow/packaging-dryrun.mjs to emit the §17.2 manifest',
  );
});

// The native installer build + code signature stay secret-gated: the `tauri build`
// + signing matrix is guarded by the signing secrets and never forges a binary or
// signature when they are absent (spec §2 — secret human gate, DESIGN §17.2).
test('package job keeps the native tauri build + signing secret-gated', () => {
  assert.match(ci, /tauri build/, 'the package job must wire the native tauri build');
  assert.match(
    ci,
    /secrets\./,
    'the native build/signing matrix must be gated on signing secrets, not forged',
  );
});

// The Phase 7 test jobs run the real phase-7 gate commands (sync-dryrun,
// updater-rollback, diagnostic-schema) verbatim, so CI and the local gate runner
// stay in lockstep on the new Phase 7 required gates.
test('CI runs the phase-7 sync-dryrun / updater-rollback / diagnostic-schema gates', () => {
  const gate = (name) => GATES[7].find((g) => g.name === name).cmd;
  for (const name of ['sync-dryrun', 'updater-rollback', 'diagnostic-schema']) {
    assert.ok(
      ci.includes(gate(name)),
      `ci.yml must run the phase-7 "${name}" gate command: ${gate(name)}`,
    );
  }
});
