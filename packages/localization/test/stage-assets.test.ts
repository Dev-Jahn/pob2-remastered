// stage-assets.test.ts — TDD gate for the Tauri asset-staging pipeline (DESIGN §9.2).
// Tests import stageAssets() directly with fixture data; no real .cache/icons/ needed.
// Each scenario uses a temp dir with known sha256 bytes to validate staging logic.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageAssets } from '../scripts/stage-assets.mjs';

const sha256 = (buf: Buffer): string => createHash('sha256').update(buf).digest('hex');

/** Build a minimal valid AssetRef matching the manifest schema. */
const asset = (over: Record<string, string> = {}) =>
  ({
    id: 'skill.TestSkill',
    domain: 'skill',
    source: 'poe2db',
    remoteUrl: 'https://cdn.poe2db.tw/image/art/2dart/skillicons/4k/testskill.webp',
    localPath: 'icons/skill/testskill.webp',
    sha256: 'a'.repeat(64), // placeholder, overridden in tests that do integrity
    licenseStatus: 'allowed',
    attribution: 'Path of Exile 2 © GGG; icon via PoE2DB',
    ...over,
  }) as const;

/** Write a fixture icon at assetRoot/localPath, return its real sha256. */
function writeFixtureIcon(assetRoot: string, localPath: string, bytes: Buffer): string {
  const abs = join(assetRoot, localPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, bytes);
  return sha256(bytes);
}

const tmpDirs: string[] = [];
function makeTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'stage-assets-'));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()!;
    rmSync(d, { recursive: true, force: true });
  }
});

describe('stageAssets — happy path', () => {
  it('copies every asset to destDir and writes a correct asset-index.json', async () => {
    const assetRoot = makeTmp();
    const destDir = makeTmp();

    const bytes1 = Buffer.from('fake-icon-skill');
    const bytes2 = Buffer.from('fake-icon-passive');
    const hash1 = writeFixtureIcon(assetRoot, 'icons/skill/testskill.webp', bytes1);
    const hash2 = writeFixtureIcon(assetRoot, 'icons/passive/testpassive.webp', bytes2);

    const assets = [
      asset({ id: 'skill.TestSkill', localPath: 'icons/skill/testskill.webp', sha256: hash1 }),
      asset({
        id: 'passive.TestPassive',
        domain: 'passive',
        localPath: 'icons/passive/testpassive.webp',
        sha256: hash2,
      }),
    ];
    const manifest = { assets };

    const result = await stageAssets(manifest, { assetRoot, destDir });

    // Both assets staged
    expect(result.staged).toBe(2);
    expect(result.errors).toEqual([]);

    // Files copied to correct destinations
    expect(existsSync(join(destDir, 'icons/skill/testskill.webp'))).toBe(true);
    expect(existsSync(join(destDir, 'icons/passive/testpassive.webp'))).toBe(true);

    // Copied bytes match originals
    expect(readFileSync(join(destDir, 'icons/skill/testskill.webp'))).toEqual(bytes1);
    expect(readFileSync(join(destDir, 'icons/passive/testpassive.webp'))).toEqual(bytes2);

    // asset-index.json has correct shape and sorted keys
    expect(result.indexPath).toBe(join(destDir, 'asset-index.json'));
    const index = JSON.parse(readFileSync(result.indexPath, 'utf8')) as Record<string, string>;
    const keys = Object.keys(index);
    expect(keys).toEqual(['passive.TestPassive', 'skill.TestSkill']); // sorted
    expect(index['skill.TestSkill']).toBe('icons/skill/testskill.webp');
    expect(index['passive.TestPassive']).toBe('icons/passive/testpassive.webp');
  });
});

describe('stageAssets — integrity mismatch aborts', () => {
  it('returns errors and copies NO files when sha256 in manifest is wrong', async () => {
    const assetRoot = makeTmp();
    const destDir = makeTmp();

    const bytes = Buffer.from('real-icon-bytes');
    writeFixtureIcon(assetRoot, 'icons/skill/testskill.webp', bytes);
    // deliberately wrong hash in manifest
    const badHash = 'b'.repeat(64);

    const manifest = { assets: [asset({ sha256: badHash })] };
    const result = await stageAssets(manifest, { assetRoot, destDir });

    expect(result.staged).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join()).toMatch(/integrity mismatch/);
    // No files should have been copied
    expect(existsSync(join(destDir, 'icons/skill/testskill.webp'))).toBe(false);
    // No index written
    expect(existsSync(join(destDir, 'asset-index.json'))).toBe(false);
  });
});

describe('stageAssets — missing cached file aborts', () => {
  it('returns errors and copies NO files when a cached file is absent', async () => {
    const assetRoot = makeTmp();
    const destDir = makeTmp();

    // Do NOT write any icon file — simulate missing cache
    const manifest = { assets: [asset({ sha256: 'a'.repeat(64) })] };
    const result = await stageAssets(manifest, { assetRoot, destDir });

    expect(result.staged).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join()).toMatch(/missing/);
    expect(existsSync(join(destDir, 'icons/skill/testskill.webp'))).toBe(false);
    expect(existsSync(join(destDir, 'asset-index.json'))).toBe(false);
  });
});
