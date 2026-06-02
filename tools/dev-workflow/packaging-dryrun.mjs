// Reproducible packaging dry-run — the OFFLINE rehearsal of the §17 release step.
//
// DESIGN §17.2 fixes the release-artifact set a tagged release must ship:
//   installer · portable zip · NOTICE.md · LICENSES/ · DATA_SOURCES.md ·
//   core-version.json · localization-version.json · checksums · signature.
//
// This dry-run emits that manifest WITHOUT a native tauri build or code signing.
// Two of those artifacts genuinely need a native toolchain + a signing key /
// notarization credentials: the platform installer (and its portable zip) and the
// code signature. Per spec §2 those are a human "secret" gate — we do NOT fake a
// signed binary. Instead they are emitted as DETERMINISTIC, explicitly-labelled
// PLACEHOLDERS whose checksums are stable, so the manifest is complete and the
// real build/sign can drop into those slots behind the gate.
//
// The load-bearing property is REPRODUCIBILITY. Every checksum is derived purely
// from the committed tree — real file bytes, the committed vendored-submodule
// pointer (read from the tree object, never the working checkout), and the
// committed generated localization dictionary — with no wall clock, no randomness
// and no absolute paths. So running this twice over the same tree yields a
// byte-identical manifest and checksum output.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/** Repo root, resolved via git so the dry-run is location-independent. */
const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

/** SHA-256 of a string/Buffer, as lowercase hex (the manifest's checksum form). */
function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * The DESIGN §17.2 release-artifact set, in a stable order. `kind`:
 *   'placeholder' — needs the native build/sign toolchain (gated, secret).
 *   'file'        — a real committed file, checksummed from its bytes.
 *   'dir'         — a release-staging directory aggregated from committed files.
 *   'generated'   — generated content derived deterministically from the tree.
 *   'checksums'   — the checksum file over all the other artifacts.
 *   'signature'   — the detached code signature (gated, secret).
 * `gated: true` marks the artifacts that need the humanGate `secret` (native
 * build / signing key) and are emitted as placeholders here.
 */
export const RELEASE_ARTIFACTS = [
  { name: 'installer', kind: 'placeholder', gated: true },
  { name: 'portable.zip', kind: 'placeholder', gated: true },
  { name: 'NOTICE.md', kind: 'file', gated: false },
  { name: 'LICENSES/', kind: 'dir', gated: false },
  { name: 'DATA_SOURCES.md', kind: 'file', gated: false },
  { name: 'core-version.json', kind: 'generated', gated: false },
  { name: 'localization-version.json', kind: 'generated', gated: false },
  { name: 'checksums.txt', kind: 'checksums', gated: false },
  { name: 'signature', kind: 'signature', gated: true },
];

/** The human gate that blocks the native build + signing (spec §2 / DESIGN §17.2). */
export const HUMAN_GATE = 'secret';

/** Canonical JSON: sorted keys + trailing newline → a stable, diffable string. */
function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n';
}

/**
 * The committed vendored-upstream pointer — read from the tree object (`git
 * rev-parse HEAD:<submodule>`), NOT the working submodule checkout, so it reflects
 * exactly what this commit pins and is identical on every run.
 */
function pinnedCorePointer() {
  const submodule = 'vendor/PathOfBuilding-PoE2';
  const commit = execFileSync('git', ['rev-parse', `HEAD:${submodule}`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  return { submodule, commit };
}

/**
 * core-version.json content — pins the calc/data core to the committed upstream
 * submodule commit (DESIGN §17.2). Deterministic: the pointer comes from the
 * committed tree; no timestamp.
 */
function coreVersionContent() {
  const { submodule, commit } = pinnedCorePointer();
  return canonicalJson({ component: 'pob2-core', source: submodule, upstreamCommit: commit });
}

/**
 * localization-version.json content — pins the shipped ko-KR dictionary to the
 * SHA-256 of its committed generated file plus its term count (DESIGN §12.2 owns
 * the dictionary layout, so its bytes are a stable fingerprint). Deterministic.
 */
function localizationVersionContent() {
  const rel = 'packages/localization/generated/dictionary.json';
  const bytes = readFileSync(join(REPO_ROOT, rel));
  const terms = Object.keys(JSON.parse(bytes.toString('utf8'))).length;
  return canonicalJson({
    component: 'pob2-localization',
    source: rel,
    dictionarySha256: sha256(bytes),
    terms,
  });
}

/**
 * Deterministic placeholder bytes for a gated native artifact. The real artifact
 * is produced behind the `secret` human gate (native build + signing key); here
 * we emit a stable, self-describing placeholder so the manifest is complete and
 * the checksum is reproducible — without ever faking a real binary/signature.
 */
function placeholderContent(name) {
  return (
    `PLACEHOLDER:${name}\n` +
    `gated: native build + code signing require the "${HUMAN_GATE}" human gate\n` +
    `(DESIGN §17.2 — no native tauri build or signature produced in the dry-run)\n`
  );
}

/**
 * The committed contents aggregated into the release `LICENSES/` directory. Today
 * that is the project MIT license; vendored third-party notices are retained
 * inside the submodule (NOTICE.md points to them) and bundled at native-build
 * time. The dir's checksum is over its sorted member name→sha256 listing, so it
 * is stable and changes iff a member's bytes change.
 */
function licensesDirMembers() {
  return ['LICENSE'];
}

/**
 * @typedef {object} ArtifactEntry
 * @property {string} name
 * @property {string} kind
 * @property {boolean} gated
 * @property {boolean} placeholder - true iff emitted as a gated placeholder.
 * @property {string} sha256       - lowercase-hex checksum of the artifact bytes.
 * @property {number} bytes        - byte length the checksum was taken over.
 * @property {string} [content]    - the generated text, for 'generated' artifacts.
 */

/**
 * Compute every artifact's bytes + checksum, EXCEPT the `checksums.txt` artifact
 * (which is a function of all the others and is filled in afterwards).
 *
 * @returns {ArtifactEntry[]}
 */
function materializeArtifacts() {
  return RELEASE_ARTIFACTS.map((spec) => {
    const base = { name: spec.name, kind: spec.kind, gated: spec.gated, placeholder: false };

    switch (spec.kind) {
      case 'file': {
        const bytes = readFileSync(join(REPO_ROOT, spec.name));
        return { ...base, sha256: sha256(bytes), bytes: bytes.length };
      }
      case 'dir': {
        // Checksum over the sorted "<member> <sha256>" listing of committed members.
        const members = licensesDirMembers()
          .slice()
          .sort()
          .map((m) => `${m} ${sha256(readFileSync(join(REPO_ROOT, m)))}`)
          .join('\n');
        const listing = members + '\n';
        return { ...base, sha256: sha256(listing), bytes: Buffer.byteLength(listing) };
      }
      case 'generated': {
        const content =
          spec.name === 'core-version.json' ? coreVersionContent() : localizationVersionContent();
        return {
          ...base,
          content,
          sha256: sha256(content),
          bytes: Buffer.byteLength(content),
        };
      }
      case 'placeholder':
      case 'signature': {
        const content = placeholderContent(spec.name);
        return {
          ...base,
          placeholder: true,
          content,
          sha256: sha256(content),
          bytes: Buffer.byteLength(content),
        };
      }
      case 'checksums': {
        // Filled in after the other artifacts are known (it checksums them).
        return { ...base, sha256: null, bytes: 0 };
      }
      default:
        throw new Error(`unknown artifact kind: ${spec.kind}`);
    }
  });
}

/**
 * The `checksums.txt` body: one `<sha256>  <name>` line (sha256sum format) per
 * NON-checksum artifact, in §17.2 order. The checksum file does not list itself
 * (it cannot checksum its own output), so its own manifest checksum is the
 * SHA-256 of this body.
 *
 * @param {ArtifactEntry[]} artifacts
 * @returns {string}
 */
function checksumsBody(artifacts) {
  return (
    artifacts
      .filter((a) => a.kind !== 'checksums')
      .map((a) => `${a.sha256}  ${a.name}`)
      .join('\n') + '\n'
  );
}

/**
 * @typedef {object} Manifest
 * @property {ArtifactEntry[]} artifacts - every §17.2 artifact, in order.
 * @property {{ submodule: string, commit: string }} core - the pinned core pointer.
 * @property {string} humanGate - the gate blocking the native build + signing.
 */

/**
 * Build the full §17.2 release-artifact manifest from the committed tree. Pure and
 * deterministic: no network, no writes, no clock.
 *
 * @returns {Manifest}
 */
export function buildManifest() {
  const artifacts = materializeArtifacts();
  // Resolve the self-referential checksums.txt entry now that the rest are known.
  const checksumEntry = artifacts.find((a) => a.kind === 'checksums');
  const body = checksumsBody(artifacts);
  checksumEntry.sha256 = sha256(body);
  checksumEntry.bytes = Buffer.byteLength(body);

  return { artifacts, core: pinnedCorePointer(), humanGate: HUMAN_GATE };
}

/**
 * Serialize the manifest to the canonical, byte-stable text the dry-run prints and
 * compares. One `<sha256>  <name>  (<kind>[, gated placeholder])` line per
 * artifact, in §17.2 order, plus the pinned core pointer header.
 *
 * @param {Manifest} manifest
 * @returns {string}
 */
export function serializeManifest(manifest) {
  const lines = [
    '# DESIGN §17.2 release-artifact manifest (packaging dry-run)',
    `core: ${manifest.core.submodule}@${manifest.core.commit}`,
    `humanGate: ${manifest.humanGate} (native build + signing not run in dry-run)`,
    '',
  ];
  for (const a of manifest.artifacts) {
    const tag = a.placeholder ? `${a.kind}, gated placeholder` : a.kind;
    lines.push(`${a.sha256}  ${a.name}  (${tag})`);
  }
  return lines.join('\n') + '\n';
}

/**
 * The standalone `checksums.txt` artifact body (sha256sum format). Exported so the
 * dry-run and its tests can assert it is byte-stable across runs.
 *
 * @param {Manifest} manifest
 * @returns {string}
 */
export function buildChecksums(manifest) {
  return checksumsBody(manifest.artifacts);
}

/**
 * @typedef {object} DryRunResult
 * @property {Manifest} manifest
 * @property {string} manifestText  - serializeManifest(manifest).
 * @property {string} checksumsText - buildChecksums(manifest).
 * @property {string} humanGate     - the gate blocking the native build + signing.
 * @property {{ installerBuilt: boolean, signed: boolean }} native - both false in
 *   the dry-run; the native build + signature are gated and emitted as
 *   placeholders, never produced.
 * @property {number} exitCode      - always 0 (the dry-run is informational).
 */

/**
 * Run the packaging dry-run end to end. Pure: no native build, no signing, no
 * writes, no network. Deterministic — two runs over the same tree return
 * byte-identical `manifestText` + `checksumsText`.
 *
 * @returns {DryRunResult}
 */
export function runDryRun() {
  const manifest = buildManifest();
  return {
    manifest,
    manifestText: serializeManifest(manifest),
    checksumsText: buildChecksums(manifest),
    humanGate: HUMAN_GATE,
    native: { installerBuilt: false, signed: false },
    exitCode: 0,
  };
}

// CLI: `node packaging-dryrun.mjs`. Prints the manifest + checksum file and exits 0.
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = runDryRun();
  console.log('=== packaging dry-run (offline; DESIGN §17.2) ===');
  console.log(
    `native: installer=${r.native.installerBuilt ? 'built' : 'stubbed'} ` +
      `signature=${r.native.signed ? 'signed' : 'stubbed'} (humanGate: ${r.humanGate})`,
  );
  console.log('');
  console.log(r.manifestText.trimEnd());
  console.log('');
  console.log('=== checksums.txt ===');
  console.log('');
  console.log(r.checksumsText.trimEnd());
  process.exit(r.exitCode);
}
