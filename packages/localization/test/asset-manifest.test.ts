import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// The bundling gate (tools/dev-workflow/asset-gate.mjs) is the prerequisite for shipping the
// AssetRef manifest. This guards the COMMITTED manifest in CI: schema-complete, licenseStatus
// 'allowed' only, 64-hex sha256, attribution present. (sha256 INTEGRITY against the cached bytes
// is a dev/release check — the icon cache is gitignored, so it is not run here.)
import { validateManifest } from '../../../tools/dev-workflow/asset-gate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(here, '..', 'assets', 'asset-manifest.json'), 'utf8'),
);

describe('committed AssetRef manifest passes the bundling gate', () => {
  it('every AssetRef is schema-complete, allowed, with sha256 + attribution', () => {
    const { ok, errors } = validateManifest(manifest);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
  });

  it('has a non-trivial set of allowed, attributed assets', () => {
    expect(manifest.assets.length).toBeGreaterThan(100);
    expect(
      manifest.assets.every((a: { licenseStatus: string }) => a.licenseStatus === 'allowed'),
    ).toBe(true);
  });
});
