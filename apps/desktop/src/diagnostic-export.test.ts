/**
 * diagnostic-export test (p7-diagnostic-export-builder) — the pure builder that
 * assembles the DiagnosticExport bundle the §10.9 Import/Export "diagnostic
 * export" action produces, validating it against the @pob2/schema
 * `diagnosticExportSchema` before returning (DESIGN §10.9, backed by the §12
 * state/metadata model).
 *
 * The builder is PURE: it takes a {@link DiagnosticSource} snapshot pulled from a
 * live build session (the open build state, the localization misses + unsupported
 * mods collected while the session ran, the Lua core bundle version from the
 * runner handshake, and the upstream PoB commit the core was built from) and
 * assembles the standalone bundle. It NEVER spawns a runner, so these tests drive
 * it with a plain snapshot — exactly the data the desktop session surfaces.
 *
 * Coverage:
 *   - the assembled bundle passes `diagnosticExportSchema` validation, carries
 *     `schemaVersion: 1`, and copies every §10.9 field through verbatim.
 *   - the produced object carries REAL (non-empty) coreVersion + upstreamCommit —
 *     a report that cannot name the core/upstream it was produced against is not
 *     actionable (NO-FALLBACK, DESIGN §10.9).
 *   - an empty coreVersion / upstreamCommit is REJECTED at the builder boundary
 *     (the builder never defaults or ships an unactionable report).
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { diagnosticExportSchema } from '@pob2/schema';
import type { BuildState, DiagnosticExport } from '@pob2/schema';
import { buildDiagnosticExport, type DiagnosticSource } from './diagnostic-export.js';

// strict:false matches the schema contract test + runner-client validator
// (allows the unconstrained `{}` build-state ref subschema).
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateDiagnostic = ajv.compile(diagnosticExportSchema as object);

/** The open build the diagnostic is about (DESIGN §10.9 "build state"). */
const SAMPLE_BUILD: BuildState = {
  schemaVersion: 1,
  id: 'build-1',
  name: 'Diag Build',
  classId: 'Witch',
  level: 90,
  itemSets: [],
  skillSets: [],
  passiveSpecs: [],
  configSets: [],
  activeItemSetId: 'is-1',
  activeSkillSetId: 'ss-1',
  activePassiveSpecId: 'ps-1',
  activeConfigSetId: 'cs-1',
  metadata: {
    upstreamCommit: 'a1b2c3d4',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    locale: 'ko-KR',
  },
};

/** A live-session snapshot with everything a §10.9 bug report needs. */
const SAMPLE_SOURCE: DiagnosticSource = {
  build: SAMPLE_BUILD,
  localizationMisses: [{ key: 'stat.fire_damage', locale: 'ko-KR' }],
  unsupportedMods: ['Grants Level 20 Some Unknown Skill'],
  coreVersion: '0.5.3',
  upstreamCommit: 'a1b2c3d4',
};

describe('buildDiagnosticExport (DESIGN §10.9)', () => {
  it('assembles a schema-valid DiagnosticExport from a live-session snapshot', () => {
    const diagnostic = buildDiagnosticExport(SAMPLE_SOURCE);
    expect(validateDiagnostic(diagnostic), JSON.stringify(validateDiagnostic.errors)).toBe(true);
  });

  it('pins schemaVersion to 1 and copies every §10.9 field through verbatim', () => {
    const diagnostic = buildDiagnosticExport(SAMPLE_SOURCE);
    expect(diagnostic).toEqual<DiagnosticExport>({
      schemaVersion: 1,
      build: SAMPLE_BUILD,
      localizationMisses: [{ key: 'stat.fire_damage', locale: 'ko-KR' }],
      unsupportedMods: ['Grants Level 20 Some Unknown Skill'],
      coreVersion: '0.5.3',
      upstreamCommit: 'a1b2c3d4',
    });
  });

  it('carries REAL (non-empty) coreVersion + upstreamCommit (NO-FALLBACK)', () => {
    const diagnostic = buildDiagnosticExport(SAMPLE_SOURCE);
    expect(diagnostic.coreVersion).toBe('0.5.3');
    expect(diagnostic.coreVersion.length).toBeGreaterThan(0);
    expect(diagnostic.upstreamCommit).toBe('a1b2c3d4');
    expect(diagnostic.upstreamCommit.length).toBeGreaterThan(0);
  });

  it('rejects an empty coreVersion — an unactionable report is never built', () => {
    expect(() => buildDiagnosticExport({ ...SAMPLE_SOURCE, coreVersion: '' })).toThrow(
      /coreVersion/i,
    );
  });

  it('rejects an empty upstreamCommit — an unactionable report is never built', () => {
    expect(() => buildDiagnosticExport({ ...SAMPLE_SOURCE, upstreamCommit: '' })).toThrow(
      /upstreamCommit/i,
    );
  });

  it('does not alias the source build (the bundle owns its own field references)', () => {
    const diagnostic = buildDiagnosticExport(SAMPLE_SOURCE);
    // The build state is the same reference the session held (a snapshot, not a
    // copy) — the builder routes it through, it does not fabricate a BuildState.
    expect(diagnostic.build).toBe(SAMPLE_BUILD);
  });
});
