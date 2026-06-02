// Contract test for the DiagnosticExport schema — DESIGN §10.9 ("diagnostic
// export") backed by the §12 state/metadata model. The diagnostic bundle the
// Import/Export tab produces carries the build-state reference plus the
// environment fingerprint a bug report needs: localization misses, unsupported
// mods, the Lua core version, and the upstream commit hash.
//
// Tests import from ../src so they exercise the authored source, not built dist.
//
// NO-FALLBACK (DESIGN §10.9): a diagnostic with a missing coreVersion or
// upstreamCommit MUST fail validation. The schema never defaults these — a
// report that cannot name the core/upstream it was produced against is useless,
// so it is rejected, not silently filled in.
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { diagnosticExportSchema, documentSchemaRegistry } from '../src/index.js';
import type { JSONSchema, DiagnosticExport } from '../src/index.js';

// strict:false matches the rest of the suite (allows unconstrained `{}` subschemas
// such as the build-state ref); allErrors gives a deterministic full error set.
const ajv = new Ajv2020({ allErrors: true, strict: false });

function compile(schema: JSONSchema): ValidateFunction {
  return ajv.compile(schema as object);
}

function errorKeywords(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => e.keyword);
}

function missingProps(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? [])
    .filter((e) => e.keyword === 'required')
    .map((e) => (e.params as { missingProperty: string }).missingProperty);
}

// A representative, well-formed diagnostic export (DESIGN §10.9). Typed against
// the exported TS type so the schema and type stay in lockstep.
const validDiagnostic: DiagnosticExport = {
  schemaVersion: 1,
  build: {
    schemaVersion: 1,
    id: 'b-1',
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
      upstreamCommit: 'deadbeef',
      createdAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-06-01T00:00:00Z',
      locale: 'ko-KR',
    },
  },
  localizationMisses: [{ key: 'stat.fire_damage', locale: 'ko-KR' }],
  unsupportedMods: ['Grants Level 20 Some Unknown Skill'],
  coreVersion: '0.5.3',
  upstreamCommit: 'a1b2c3d4',
};

describe('diagnosticExportSchema (DESIGN §10.9)', () => {
  it('is a closed object schema with a stable $id', () => {
    expect(diagnosticExportSchema.type).toBe('object');
    expect(diagnosticExportSchema.additionalProperties).toBe(false);
    expect(diagnosticExportSchema.$id).toBe('pob2:diagnostic.export');
  });

  it('accepts a well-formed diagnostic payload', () => {
    const validate = compile(diagnosticExportSchema);
    expect(validate(validDiagnostic), JSON.stringify(validate.errors)).toBe(true);
  });

  it('requires every DESIGN §10.9 field', () => {
    expect(diagnosticExportSchema.required).toEqual(
      expect.arrayContaining([
        'schemaVersion',
        'build',
        'localizationMisses',
        'unsupportedMods',
        'coreVersion',
        'upstreamCommit',
      ]),
    );
  });

  it('rejects a missing coreVersion (NO-FALLBACK — never defaults)', () => {
    const validate = compile(diagnosticExportSchema);
    const { coreVersion, ...withoutCore } = validDiagnostic;
    void coreVersion;
    expect(validate(withoutCore)).toBe(false);
    expect(missingProps(validate.errors)).toContain('coreVersion');
  });

  it('rejects a missing upstreamCommit (NO-FALLBACK — never defaults)', () => {
    const validate = compile(diagnosticExportSchema);
    const { upstreamCommit, ...withoutUpstream } = validDiagnostic;
    void upstreamCommit;
    expect(validate(withoutUpstream)).toBe(false);
    expect(missingProps(validate.errors)).toContain('upstreamCommit');
  });

  it('rejects a missing build state reference', () => {
    const validate = compile(diagnosticExportSchema);
    const { build, ...withoutBuild } = validDiagnostic;
    void build;
    expect(validate(withoutBuild)).toBe(false);
    expect(missingProps(validate.errors)).toContain('build');
  });

  it('rejects a wrong-typed coreVersion (must be a string)', () => {
    const validate = compile(diagnosticExportSchema);
    const bad = { ...validDiagnostic, coreVersion: 503 };
    expect(validate(bad)).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('type');
  });

  it('rejects a wrong-typed unsupportedMods (must be a string array)', () => {
    const validate = compile(diagnosticExportSchema);
    const bad = { ...validDiagnostic, unsupportedMods: 'not-an-array' };
    expect(validate(bad)).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('type');
  });

  it('rejects a localization miss without its required key/locale', () => {
    const validate = compile(diagnosticExportSchema);
    const bad = { ...validDiagnostic, localizationMisses: [{ key: 'x' }] };
    expect(validate(bad)).toBe(false);
    expect(missingProps(validate.errors)).toContain('locale');
  });

  it('forbids unknown top-level keys (closed contract)', () => {
    const validate = compile(diagnosticExportSchema);
    const bad = { ...validDiagnostic, extra: true };
    expect(validate(bad)).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('additionalProperties');
  });
});

describe('diagnostic export registration', () => {
  it('is registered on the document schema registry, alongside schemaRegistry', () => {
    expect(documentSchemaRegistry['pob2:diagnostic.export']).toBeDefined();
    expect(documentSchemaRegistry['pob2:diagnostic.export']).toBe(diagnosticExportSchema);
  });
});
