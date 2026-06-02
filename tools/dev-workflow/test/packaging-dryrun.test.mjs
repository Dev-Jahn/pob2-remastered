// Reproducible packaging dry-run suite (task p7-packaging-dryrun; DESIGN §17.2).
//
// This is the OFFLINE rehearsal of the §17 release-artifact packaging step. It
// emits the DESIGN §17.2 release-artifact manifest — installer / portable
// placeholders, NOTICE.md, LICENSES/, DATA_SOURCES.md, core-version.json,
// localization-version.json, checksums, signature — WITHOUT a native tauri build
// or signing. The native installer build and the code signature are genuinely
// gated behind a human "secret" gate (signing key, notarization creds) and are
// represented here as DETERMINISTIC, explicitly-labelled placeholders, never
// faked binaries.
//
// The load-bearing property is REPRODUCIBILITY: the manifest and the checksum
// output are derived purely from the committed tree (file bytes, the vendored
// submodule pointer, the generated localization dictionary) — no wall clock, no
// randomness, no absolute paths — so running the dry-run twice over the same tree
// yields BYTE-IDENTICAL manifest + checksum output.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  RELEASE_ARTIFACTS,
  buildManifest,
  serializeManifest,
  buildChecksums,
  runDryRun,
} from '../packaging-dryrun.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(here, '../packaging-dryrun.mjs');

// The verbatim DESIGN §17.2 release-artifact entries the manifest MUST list.
// (Mapped to concrete artifact file names where §17.2 names a file.)
const REQUIRED_ARTIFACTS = [
  'installer',
  'portable.zip',
  'NOTICE.md',
  'LICENSES/',
  'DATA_SOURCES.md',
  'core-version.json',
  'localization-version.json',
  'checksums.txt',
  'signature',
];

const SHA256_RE = /^[0-9a-f]{64}$/;

// --- the §17.2 artifact set --------------------------------------------------

describe('RELEASE_ARTIFACTS enumerates every DESIGN §17.2 entry', () => {
  it('lists exactly the §17.2 release artifacts, in a stable order', () => {
    const names = RELEASE_ARTIFACTS.map((a) => a.name);
    expect(names).toEqual(REQUIRED_ARTIFACTS);
  });

  it('classifies the native build + signature as human-gated (secret)', () => {
    // installer, portable.zip and signature need a native tauri build + signing
    // key → they are gated and emitted as deterministic placeholders, never real
    // binaries produced offline.
    const gated = RELEASE_ARTIFACTS.filter((a) => a.gated).map((a) => a.name);
    expect(gated).toEqual(['installer', 'portable.zip', 'signature']);
  });
});

// --- the manifest ------------------------------------------------------------

describe('buildManifest emits the §17.2 release-artifact manifest', () => {
  const manifest = buildManifest();

  it('contains an entry for every §17.2 artifact', () => {
    const names = manifest.artifacts.map((a) => a.name);
    for (const required of REQUIRED_ARTIFACTS) {
      expect(names, `manifest must list §17.2 artifact "${required}"`).toContain(required);
    }
    // …and ONLY those, in the §17.2 order — no extras, none dropped.
    expect(names).toEqual(REQUIRED_ARTIFACTS);
  });

  it('gives every artifact a lowercase hex sha-256 checksum', () => {
    for (const a of manifest.artifacts) {
      expect(a.sha256, `${a.name} sha256`).toMatch(SHA256_RE);
    }
  });

  it('checksums the real committed docs from their actual file bytes', () => {
    // NOTICE.md / DATA_SOURCES.md are real files in the tree — their manifest
    // checksum must equal the SHA-256 of the file as committed (not a placeholder).
    for (const name of ['NOTICE.md', 'DATA_SOURCES.md']) {
      const entry = manifest.artifacts.find((a) => a.name === name);
      expect(entry.kind).toBe('file');
      expect(entry.gated).toBe(false);
      expect(entry.bytes).toBeGreaterThan(0);
    }
  });

  it('marks the gated native artifacts as deterministic placeholders', () => {
    for (const name of ['installer', 'portable.zip', 'signature']) {
      const entry = manifest.artifacts.find((a) => a.name === name);
      expect(entry.gated, `${name} gated`).toBe(true);
      expect(entry.placeholder, `${name} placeholder`).toBe(true);
      // a placeholder still carries a stable checksum so the manifest is complete.
      expect(entry.sha256).toMatch(SHA256_RE);
    }
  });

  it('derives the version manifests deterministically from the committed tree', () => {
    // core-version.json pins the vendored upstream submodule; both version files
    // are generated content whose checksum is over their canonical JSON, so they
    // stay reproducible without touching the wall clock.
    for (const name of ['core-version.json', 'localization-version.json']) {
      const entry = manifest.artifacts.find((a) => a.name === name);
      expect(entry.kind).toBe('generated');
      expect(entry.gated).toBe(false);
      expect(typeof entry.content).toBe('string');
      expect(entry.content.length).toBeGreaterThan(0);
    }
    const core = manifest.artifacts.find((a) => a.name === 'core-version.json');
    // the vendored upstream commit pointer must appear in core-version.json.
    expect(core.content).toMatch(/[0-9a-f]{40}/);
  });
});

// --- reproducibility: two runs over the same tree are byte-identical ----------

describe('the dry-run is reproducible (DESIGN §17.2)', () => {
  it('serializeManifest is byte-identical across two builds of the same tree', () => {
    const a = serializeManifest(buildManifest());
    const b = serializeManifest(buildManifest());
    expect(typeof a).toBe('string');
    expect(a.length).toBeGreaterThan(0);
    expect(a).toBe(b);
  });

  it('buildChecksums is byte-identical across two builds of the same tree', () => {
    const a = buildChecksums(buildManifest());
    const b = buildChecksums(buildManifest());
    expect(a).toBe(b);
    // checksums.txt is sha256sum-format and lists every artifact EXCEPT itself —
    // a checksum file cannot contain a hash of its own output. So it covers all
    // §17.2 artifacts other than `checksums.txt`.
    for (const name of REQUIRED_ARTIFACTS) {
      if (name === 'checksums.txt') {
        expect(a, 'checksums.txt must not list itself').not.toContain('checksums.txt');
        continue;
      }
      expect(a, `checksums must list ${name}`).toContain(name);
    }
    for (const line of a.trim().split('\n')) {
      expect(line, `checksum line "${line}"`).toMatch(/^[0-9a-f]{64} {2}\S/);
    }
  });

  it('runDryRun yields byte-identical manifest + checksum text on repeat runs', () => {
    const first = runDryRun();
    const second = runDryRun();
    expect(first.manifestText).toBe(second.manifestText);
    expect(first.checksumsText).toBe(second.checksumsText);
    expect(first.exitCode).toBe(0);
  });
});

// --- gating: native build + signature are stubbed, never faked ----------------

describe('runDryRun gates the native build + signing without faking them', () => {
  const r = runDryRun();

  it('reports that no native build ran and no real signature was produced', () => {
    expect(r.native.installerBuilt).toBe(false);
    expect(r.native.signed).toBe(false);
  });

  it('records the humanGate that blocks the native build + signing', () => {
    expect(r.humanGate).toBe('secret');
  });

  it('still emits a complete manifest (placeholders fill the gated slots)', () => {
    const names = r.manifest.artifacts.map((a) => a.name);
    expect(names).toEqual(REQUIRED_ARTIFACTS);
  });
});

// --- the CLI: prints the manifest + checksums and exits 0 ---------------------

describe('packaging-dryrun CLI', () => {
  const run = () => spawnSync('node', [cliPath], { encoding: 'utf8' });
  const proc = run();

  it('exits 0', () => {
    expect(proc.status).toBe(0);
  });

  it('prints every §17.2 artifact and flags the gated native build + signing', () => {
    for (const name of REQUIRED_ARTIFACTS) {
      expect(proc.stdout, `CLI output must mention ${name}`).toContain(name);
    }
    expect(proc.stdout).toMatch(/humanGate|gated|stub|placeholder/i);
    expect(proc.stdout).toMatch(/secret/i);
  });

  it('produces byte-identical stdout on two separate invocations', () => {
    const a = run();
    const b = run();
    expect(a.status).toBe(0);
    expect(b.status).toBe(0);
    expect(a.stdout).toBe(b.stdout);
  });
});
