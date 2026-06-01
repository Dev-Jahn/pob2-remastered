// Tests for tools/dev-workflow/ensure-lua-deps.sh — the boot-prerequisite probe.
//
// AUDIT FINDING (Phase 0): booting upstream fails at
//   vendor/PathOfBuilding-PoE2/src/Modules/Common.lua:29  require('lua-utf8')
// because lua-utf8 is a *native* .so the PUC `lua` 5.1 interpreter must load, and
// the vendored runtime/ only ships a Windows lua-utf8.dll. This script is the
// reproducible env-prerequisite check: it probes the module and, when missing,
// exits non-zero with luarocks install guidance (no binary blob is vendored).
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = join(HERE, '..', 'ensure-lua-deps.sh');

// Run the script with an overridden LUA so we can deterministically simulate the
// "module present" and "module missing" cases without touching the real env.
function runScript(luaStub) {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      encoding: 'utf8',
      env: { ...process.env, LUA: luaStub },
    });
    return { code: 0, out: stdout };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('ensure-lua-deps.sh', () => {
  it('is a checked-in executable shell script', () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const mode = statSync(SCRIPT).mode;
    expect(mode & 0o111).not.toBe(0); // owner/group/other execute bit set
  });

  it('exits 0 when require("lua-utf8") succeeds', () => {
    // A fake "lua" that always succeeds (ignores the -e program).
    const r = runScript('true');
    expect(r.code).toBe(0);
  });

  it('exits non-zero with luarocks guidance when lua-utf8 is missing', () => {
    // A fake "lua" that always fails — emulates the missing native module.
    const r = runScript('false');
    expect(r.code).not.toBe(0);
    // Guidance must name the canonical fix and the produced artifact, and must
    // NOT instruct vendoring a binary blob.
    expect(r.out).toMatch(/luarocks install --local luautf8/);
    expect(r.out).toMatch(/lua-utf8\.so/);
    expect(r.out).toMatch(/lua-utf8/);
  });

  it('does not vendor any lua-utf8 .so binary into the repo', () => {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
    }).trim();
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(tracked).not.toMatch(/lua-utf8\.so/);
  });
});
