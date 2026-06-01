// Vendor submodule integrity gate (Phase 0 "vendor-clean").
//
// This is a pure verification test — it touches nothing under vendor/ and runs
// no production code. It fails loudly if the upstream submodule drifts, is
// edited in place, or loses any file the headless boot path depends on.
//
// It formalizes the existing Phase 0 "vendor-clean" gate and documents the
// boot-dependency file list discovered during the Phase 0 audit.
//
// Audit note on sha1: the headless boot (src/Modules/Common.lua, src/UpdateCheck.lua)
// loads it via `require("sha1")`. In this upstream revision that does NOT resolve
// to runtime/lua/sha1.lua — sha1 ships as a Lua *package directory*
// runtime/lua/sha1/ with an init.lua entry point. This test asserts the real,
// audited artifact so the gate matches what actually boots.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const SUBMODULE_PATH = 'vendor/PathOfBuilding-PoE2';
const VENDOR = join(REPO_ROOT, SUBMODULE_PATH);

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// (1) vendor/PathOfBuilding-PoE2 is a registered submodule pinned to branch dev.
test('vendor is a registered submodule at branch dev per .gitmodules', () => {
  const gitmodules = readFileSync(join(REPO_ROOT, '.gitmodules'), 'utf8');
  assert.match(
    gitmodules,
    /\[submodule "vendor\/PathOfBuilding-PoE2"\]/,
    '.gitmodules must declare the vendor/PathOfBuilding-PoE2 submodule',
  );

  const declaredPath = git([
    'config',
    '--file',
    '.gitmodules',
    '--get',
    'submodule.vendor/PathOfBuilding-PoE2.path',
  ]).trim();
  assert.equal(declaredPath, SUBMODULE_PATH, 'submodule path in .gitmodules');

  const declaredBranch = git([
    'config',
    '--file',
    '.gitmodules',
    '--get',
    'submodule.vendor/PathOfBuilding-PoE2.branch',
  ]).trim();
  assert.equal(declaredBranch, 'dev', 'submodule must be pinned to branch dev');

  // The superproject must track it as a gitlink (mode 160000), not a plain dir.
  const stage = git(['ls-files', '--stage', '--', SUBMODULE_PATH]).trim();
  assert.match(stage, /^160000 /, 'vendor must be tracked as a submodule gitlink');
});

// (2) The headless boot-dependency files discovered during the Phase 0 audit
//     all exist inside the vendored upstream tree.
test('boot-dependency files all exist in the vendored upstream', () => {
  // Plain source files required to boot the headless wrapper.
  const requiredFiles = [
    'src/HeadlessWrapper.lua',
    'src/Launch.lua',
    'src/Modules/Common.lua',
    'runtime/lua/xml.lua',
    'runtime/lua/base64.lua',
    'runtime/lua/dkjson.lua',
  ];
  for (const rel of requiredFiles) {
    const abs = join(VENDOR, rel);
    assert.ok(existsSync(abs) && statSync(abs).isFile(), `missing boot file: ${rel}`);
  }

  // sha1 is loaded via require("sha1"); in this upstream it is a package
  // directory, not a flat sha1.lua. Assert the directory + its init.lua entry.
  const sha1Dir = join(VENDOR, 'runtime/lua/sha1');
  assert.ok(
    existsSync(sha1Dir) && statSync(sha1Dir).isDirectory(),
    'sha1 must be a Lua package directory: runtime/lua/sha1/',
  );
  const sha1Init = join(sha1Dir, 'init.lua');
  assert.ok(
    existsSync(sha1Init) && statSync(sha1Init).isFile(),
    'sha1 package must have an init.lua entry point',
  );
});

// (3) The vendored submodule is clean — no in-place edits to vendor/.
test('git diff --quiet vendor/PathOfBuilding-PoE2 reports clean', () => {
  // Throws (non-zero exit) iff there is any uncommitted change to the submodule,
  // including a moved gitlink pointer or dirty working tree inside vendor/.
  assert.doesNotThrow(() => {
    execFileSync('git', ['diff', '--quiet', SUBMODULE_PATH], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  }, 'vendor/PathOfBuilding-PoE2 has uncommitted drift or in-place edits');
});
