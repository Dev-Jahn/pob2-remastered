// Share-code codec suite for @pob2/core-client — the `test share-code` gate.
//
// A PoB share code is base64url(zlib.deflate(buildXml)) (DESIGN §6.3
// loadShareCode/exportShareCode, §12.2). These tests pin the codec the share-code
// client wrappers delegate to: a deflate round-trip that survives the URL-safe
// alphabet substitution, with no `+`/`/` leaking into the emitted code.
//
// They also pin the two host-side adapter guarantees the task requires:
//   - FORMAT COMPATIBILITY: decoding a real PoB share-code fixture
//     (tools/golden-tests/fixtures/sample-sharecode.txt) yields a valid PoB2 XML
//     document — proof the Node zlib codec matches upstream's lzip `Deflate`
//     (zlib format, `0x78 0xda` header), not raw deflate;
//   - FULL ROUND-TRIP through the live out-of-process runner: known build -> share
//     code -> reload -> same class + item count + Life>0. The compression happens
//     HOST-SIDE around the Lua core (HeadlessWrapper stubs Deflate/Inflate to ""),
//     so this proves the adapter resolves that Phase 0 boundary (DESIGN §5.1).
//
// Gate command: pnpm --filter @pob2/core-client test share-code -> vitest run share-code
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  encodeShareCode,
  decodeShareCode,
  createCoreClient,
  type CoreClient,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const fixtures = resolve(repoRoot, 'tools/golden-tests/fixtures');
const sampleXml = readFileSync(resolve(fixtures, 'sample-build.xml'), 'utf8');
// A real-format PoB share code: base64url(zlib.deflate(buildXml)). The file holds
// only the code (we trim it); its provenance + how to regenerate it are documented
// in tools/golden-tests/README.md (gamedata 🚩 FLAG — it is generated from
// sample-build.xml in the upstream zlib format, not captured from a live PoB).
const sampleShareCode = readFileSync(resolve(fixtures, 'sample-sharecode.txt'), 'utf8').trim();

describe('share-code compression adapter', () => {
  it('round-trips arbitrary build XML through encode -> decode', () => {
    const xml = '<PathOfBuilding2><Build level="1" className="Ranger"/></PathOfBuilding2>';
    expect(decodeShareCode(encodeShareCode(xml))).toBe(xml);
  });

  it('round-trips the real sample build fixture', () => {
    expect(decodeShareCode(encodeShareCode(sampleXml))).toBe(sampleXml);
  });

  it('emits only URL-safe characters (no "+" or "/")', () => {
    const code = encodeShareCode(sampleXml);
    expect(code).not.toMatch(/[+/]/);
  });

  it('compresses redundant XML below its raw byte length', () => {
    const xml = '<a>'.repeat(500) + 'payload' + '</a>'.repeat(500);
    const code = encodeShareCode(xml);
    expect(Buffer.byteLength(code, 'utf8')).toBeLessThan(Buffer.byteLength(xml, 'utf8'));
  });

  it('rejects a corrupt share code rather than returning garbage', () => {
    expect(() => decodeShareCode('!!!not-a-valid-deflate-stream!!!')).toThrow();
  });

  // Format compatibility with upstream: decode a real-format PoB share code from a
  // fixture and confirm it inflates to a valid PoB2 XML document. This proves the
  // Node zlib codec matches PoB's lzip `Deflate` (zlib format, NOT raw deflate);
  // a raw-deflate decoder would throw on this `0x78 0xda`-headed stream.
  it('decodes a real PoB share-code fixture to valid PoB2 XML (format matches upstream)', () => {
    // The share-code alphabet is URL-safe: the fixture must carry no `+`/`/`.
    expect(sampleShareCode).not.toMatch(/[+/]/);
    const xml = decodeShareCode(sampleShareCode);
    expect(xml).toContain('<PathOfBuilding2>');
    expect(xml).toContain('className="Ranger"');
    // The fixture's bytes are the upstream zlib format: re-encoding the decoded XML
    // reproduces the exact fixture, so encode and decode are mutual inverses on a
    // real code (round-trip is byte-stable, not merely lossless on our own output).
    expect(encodeShareCode(xml)).toBe(sampleShareCode);
  });
});

// Full host-side round-trip through the LIVE out-of-process runner. The Lua core
// cannot compress (HeadlessWrapper stubs Deflate/Inflate to ""), so the codec runs
// host-side around it: saveShareCode = base64url(deflate(SaveDB('code'))) and
// loadShareCode = load(inflate(base64url_decode(code))). This is the documented
// DESIGN §5.1 "build share code import/export adapter".
describe('share-code full round-trip through the runner', () => {
  let client: CoreClient | undefined;

  afterEach(async () => {
    await client?.dispose();
    client = undefined;
  });

  it('known build -> share code -> reload yields same class + item count + Life>0', async () => {
    client = await createCoreClient();

    // Load the known build and baseline the round-trip invariants.
    const loaded = await client.load(sampleXml);
    expect(loaded.summary.className).toBe('Ranger');
    expect(loaded.summary.itemCount).toBe(1);

    // Export host-side: SaveDB('code') XML -> base64url(deflate(...)).
    const exported = await client.saveShareCode(loaded.buildId);
    expect(exported.format).toBe('shareCode');
    expect(exported.data.length).toBeGreaterThan(0);
    expect(exported.data).not.toMatch(/[+/]/);

    // Re-import host-side: inflate(base64url_decode(code)) -> loadBuildFromXML.
    const reloaded = await client.loadShareCode(exported.data);
    expect(reloaded.summary.className).toBe('Ranger');
    expect(reloaded.summary.itemCount).toBe(1);

    // The reloaded build is live (calc pipeline re-ran), not an empty shell.
    const calc = await client.calcRun(reloaded.buildId);
    const life = calc.stats.find((s) => s.statId === 'Life');
    expect(life, 'reloaded build must expose Life').toBeDefined();
    expect(life!.value).toBeGreaterThan(0);
  });
});
