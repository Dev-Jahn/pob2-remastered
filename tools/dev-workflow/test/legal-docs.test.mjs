// Legal / data-source policy docs-presence gate (Phase 0).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It is a guard so the legal/asset policy required by DESIGN.md
// §9 (asset distribution policy) and §15 (legal/licensing) cannot silently
// regress: the policy files must exist and DATA_SOURCES.md must keep documenting
// every source class the project depends on.
//
// Covered source classes (DESIGN §15.3 "release artifact에는 NOTICE.md와
// DATA_SOURCES.md 포함"):
//   1. Vendored MIT PoB2 core           (DESIGN §15.1)
//   2. PoE2DB mapping-only policy        (DESIGN §15.3 "generated mapping과 source reference 분리")
//   3. GGG do_not_bundle asset policy    (DESIGN §9.3, §15.2/§15.3)
//
// Phase 0 added a third-party *runtime* dependency: the headless boot path now
// requires the native `lua-utf8` C module (from p0-native-deps —
// tools/dev-workflow/ensure-lua-deps.sh / overlays/lua/README.md). Per DESIGN
// §15.1 ("fork는 MIT license notice와 third-party notices를 유지해야 한다") that
// runtime dependency and its license must be recorded in DATA_SOURCES.md.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function readDoc(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// (1) The three release-artifact policy docs exist as real files.
test('legal/policy docs exist (DATA_SOURCES.md, NOTICE.md, LICENSE)', () => {
  for (const rel of ['DATA_SOURCES.md', 'NOTICE.md', 'LICENSE']) {
    const abs = join(REPO_ROOT, rel);
    assert.ok(existsSync(abs) && statSync(abs).isFile(), `missing required policy doc: ${rel}`);
  }
});

// (2) DATA_SOURCES.md documents all three required source classes per DESIGN §9/§15.
test('DATA_SOURCES.md documents the three required source classes', () => {
  const doc = readDoc('DATA_SOURCES.md');

  // Class 1 — vendored MIT PoB2 core.
  assert.match(
    doc,
    /PathOfBuilding-PoE2/,
    'must name the vendored upstream PathOfBuilding-PoE2 source',
  );
  assert.match(doc, /vendor\/PathOfBuilding-PoE2/, 'must record the vendored core location');
  assert.match(doc, /MIT/, 'vendored PoB2 core must be documented as MIT-licensed');

  // Class 2 — PoE2DB mapping-only policy.
  assert.match(doc, /PoE2DB/i, 'must name the PoE2DB source');
  assert.match(
    doc,
    /mapping[\s-]*only/i,
    'PoE2DB must be documented as reference/mapping-only (not bundled wholesale)',
  );

  // Class 3 — GGG do_not_bundle asset policy.
  assert.match(doc, /Grinding Gear Games|GGG/, 'must name GGG as the asset owner');
  assert.match(doc, /do_not_bundle/, 'GGG assets must be documented as default do_not_bundle');
});

// (3) The Phase 0 native runtime dependency (lua-utf8, from p0-native-deps) and
//     its license are recorded in DATA_SOURCES.md so the third-party-notice
//     obligation (DESIGN §15.1) cannot silently regress.
test('DATA_SOURCES.md records the lua-utf8 native runtime dependency and its license', () => {
  const doc = readDoc('DATA_SOURCES.md');

  assert.match(
    doc,
    /lua-utf8/,
    'must record the lua-utf8 native runtime dependency the headless boot now requires',
  );
  assert.match(
    doc,
    /luarocks/i,
    'must record how lua-utf8 is provisioned (luarocks, not vendored as a binary blob)',
  );
  assert.match(doc, /MIT/, 'must record the lua-utf8 license (MIT)');

  // The lua-utf8 reference must appear in its own documented section, not merely
  // as an aside under one of the three pre-existing source classes.
  assert.match(
    doc,
    /^#{1,3} .*lua-utf8/im,
    'lua-utf8 must have its own DATA_SOURCES.md section heading',
  );
});
