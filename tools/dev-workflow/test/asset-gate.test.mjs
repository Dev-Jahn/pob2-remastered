import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { validateManifest } from '../asset-gate.mjs';

const asset = (over = {}) => ({
  id: 'skill.Enfeeble',
  domain: 'skill',
  source: 'poe2db',
  remoteUrl: 'https://cdn.poe2db.tw/image/Art/2DArt/SkillIcons/4K/enfeeble.webp',
  localPath: 'icons/skill/enfeeble.webp',
  sha256: 'a'.repeat(64),
  licenseStatus: 'allowed',
  attribution: 'Path of Exile 2 © GGG; icon via PoE2DB',
  ...over,
});

describe('validateManifest', () => {
  it('accepts a complete, allowed, well-formed manifest', () => {
    expect(validateManifest({ assets: [asset()] })).toEqual({ ok: true, errors: [] });
  });

  it('rejects a non-array assets', () => {
    expect(validateManifest({}).ok).toBe(false);
  });

  it('rejects a missing required field', () => {
    const r = validateManifest({ assets: [asset({ attribution: '' })] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/missing attribution/);
  });

  it("rejects a non-'allowed' licenseStatus (no do_not_bundle in a release)", () => {
    const r = validateManifest({ assets: [asset({ licenseStatus: 'do_not_bundle' })] });
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/only 'allowed' may ship/);
  });

  it('rejects a malformed sha256 digest', () => {
    expect(validateManifest({ assets: [asset({ sha256: 'nothex' })] }).ok).toBe(false);
  });
});

describe('validateManifest --integrity', () => {
  const dir = mkdtempSync(join(tmpdir(), 'asset-gate-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('passes when the cached bytes hash to the recorded sha256, fails on mismatch', () => {
    const bytes = Buffer.from('fake-icon-bytes');
    const sha = createHash('sha256').update(bytes).digest('hex');
    mkdirSync(join(dir, 'icons', 'skill'), { recursive: true });
    writeFileSync(join(dir, 'icons', 'skill', 'enfeeble.webp'), bytes);

    expect(validateManifest({ assets: [asset({ sha256: sha })] }, { assetRoot: dir }).ok).toBe(
      true,
    );
    const bad = validateManifest(
      { assets: [asset({ sha256: 'b'.repeat(64) })] },
      { assetRoot: dir },
    );
    expect(bad.ok).toBe(false);
    expect(bad.errors.join()).toMatch(/integrity mismatch/);
  });
});
