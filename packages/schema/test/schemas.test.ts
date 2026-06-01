// Schema validation suite for @pob2/schema — the rpc-schema gate (Phase 1).
//
// Unlike registry.test.ts (which asserts the registry's STRUCTURE), this suite
// compiles every MVP schema with AJV (Draft 2020-12) and asserts runtime
// BEHAVIOUR: valid sample payloads validate, representative invalid payloads are
// rejected with a stable error path, and the CoreError envelope validates.
//
// Tests import from ../src so they exercise the authored source, not built dist.
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ErrorObject, ValidateFunction } from 'ajv';
import { schemaRegistry, MVP_METHODS, coreErrorSchema } from '../src/index.js';
import type { JSONSchema } from '../src/index.js';

// One AJV instance for the whole suite. `strict:false` keeps AJV from rejecting
// the unconstrained `details: {}` schema in CoreError as a "no validation"
// warning; `allErrors` lets us assert on the full error set deterministically.
const ajv = new Ajv2020({ allErrors: true, strict: false });

/** Compile a JSONSchema, surfacing AJV compile errors as a readable failure. */
function compile(schema: JSONSchema): ValidateFunction {
  return ajv.compile(schema as object);
}

/** instancePath of the first error (the "stable error path"), e.g. "/format". */
function firstErrorPath(errors: ErrorObject[] | null | undefined): string {
  expect(errors, 'expected validation errors').toBeTruthy();
  return (errors as ErrorObject[])[0]!.instancePath;
}

/** keywords present across the reported errors (e.g. "required", "type"). */
function errorKeywords(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((e) => e.keyword);
}

// ---------------------------------------------------------------------------
// Sample payloads
// ---------------------------------------------------------------------------

const validBuildState = {
  schemaVersion: 1,
  id: 'b-1',
  name: 'Test Build',
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
    upstreamCommit: 'abc123',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    locale: 'ko-KR',
  },
};

const validEquippedItem = {
  slot: 'Weapon 1',
  itemId: '17',
  name: 'Runeforged Warpick',
  rarity: 'NORMAL',
  baseName: 'Runeforged Warpick',
  requirements: { level: 1, str: 12, dex: 0, int: 0 },
  summaryMods: ['Adds 1 to 3 Physical Damage'],
  unsupportedMods: [],
};

const validRequests: Record<string, unknown> = {
  'build.load': { source: '<PathOfBuilding/>', format: 'xml' },
  'build.save': { buildId: 'b-1', format: 'shareCode' },
  'calc.run': { buildId: 'b-1', options: { activeSkillId: 'sk-1' } },
  'items.parseClipboard': { text: '아이템 텍스트', localeHint: 'ko-KR' },
  'items.getEquipped': { buildId: 'b-1' },
  'items.createCustom': { baseId: 'Runeforged Warpick', mods: [{ text: '+50 to maximum Life' }] },
  'items.compare': { buildId: 'b-1', itemId: '42', slot: 'Weapon 1' },
};

const validResponses: Record<string, unknown> = {
  'build.load': { buildId: 'b-1', state: validBuildState },
  'build.save': { format: 'xml', data: '<PathOfBuilding/>' },
  'calc.run': {
    buildId: 'b-1',
    stats: [{ statId: 'TotalDPS', value: 123456, label: '총 DPS' }],
  },
  'items.parseClipboard': {
    locale: 'ko-KR',
    mods: [{ raw: '생명력 +50', status: 'parsed', statId: 'life' }],
    unsupported: [],
  },
  'items.getEquipped': { equipped: [validEquippedItem] },
  'items.createCustom': { itemId: '42', item: validEquippedItem },
  'items.compare': {
    slot: 'Weapon 1',
    deltas: [{ statId: 'TotalDPS', before: 1000, after: 1500, delta: 500 }],
  },
};

// ---------------------------------------------------------------------------
// Coverage: every MVP method has a request AND response schema
// ---------------------------------------------------------------------------

describe('schema coverage', () => {
  it('every MVP RPC method has both a request and response schema that AJV compiles', () => {
    for (const method of MVP_METHODS) {
      const entry = schemaRegistry[method];
      expect(entry, `registry[${method}]`).toBeDefined();
      expect(() => compile(entry.requestSchema), `${method} request compiles`).not.toThrow();
      expect(() => compile(entry.responseSchema), `${method} response compiles`).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Valid sample payloads validate
// ---------------------------------------------------------------------------

describe('valid sample payloads', () => {
  for (const method of MVP_METHODS) {
    it(`${method} request: valid sample validates`, () => {
      const validate = compile(schemaRegistry[method].requestSchema);
      const ok = validate(validRequests[method]);
      expect(validate.errors, `${method} request errors`).toBeNull();
      expect(ok).toBe(true);
    });

    it(`${method} response: valid sample validates`, () => {
      const validate = compile(schemaRegistry[method].responseSchema);
      const ok = validate(validResponses[method]);
      expect(validate.errors, `${method} response errors`).toBeNull();
      expect(ok).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Invalid payloads are rejected with a stable error path
// ---------------------------------------------------------------------------

describe('invalid payloads are rejected', () => {
  it('missing required field → rejected at root with "required" keyword', () => {
    const validate = compile(schemaRegistry['build.load'].requestSchema);
    // `format` omitted.
    expect(validate({ source: '<x/>' })).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('required');
    // Stable path: a missing top-level required prop is reported at the root "".
    expect(firstErrorPath(validate.errors)).toBe('');
    expect(
      validate.errors!.some(
        (e) => e.params && (e.params as { missingProperty?: string }).missingProperty === 'format',
      ),
    ).toBe(true);
  });

  it('wrong type → rejected at the offending property path with "type"/"enum"', () => {
    const validate = compile(schemaRegistry['build.save'].requestSchema);
    // `format` should be a string from an enum; pass a number.
    expect(validate({ buildId: 'b-1', format: 123 })).toBe(false);
    expect(errorKeywords(validate.errors)).toEqual(expect.arrayContaining(['type']));
    expect(firstErrorPath(validate.errors)).toBe('/format');
  });

  it('wrong type in a nested array item → rejected at the indexed path', () => {
    const validate = compile(schemaRegistry['calc.run'].responseSchema);
    const payload = {
      buildId: 'b-1',
      stats: [{ statId: 'TotalDPS', value: 'not-a-number', label: '총 DPS' }],
    };
    expect(validate(payload)).toBe(false);
    // Stable, indexed instancePath into the array.
    expect(firstErrorPath(validate.errors)).toBe('/stats/0/value');
    expect(errorKeywords(validate.errors)).toContain('type');
  });

  it('extra unknown field (additionalProperties:false) → rejected at root with "additionalProperties"', () => {
    const validate = compile(schemaRegistry['build.load'].requestSchema);
    expect(validate({ source: '<x/>', format: 'xml', bogus: true })).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('additionalProperties');
    expect(firstErrorPath(validate.errors)).toBe('');
    expect(
      validate.errors!.some(
        (e) => (e.params as { additionalProperty?: string }).additionalProperty === 'bogus',
      ),
    ).toBe(true);
  });

  it('bad enum value in a nested response field → rejected at the property path with "enum"', () => {
    const validate = compile(schemaRegistry['items.parseClipboard'].responseSchema);
    const payload = {
      locale: 'ko-KR',
      mods: [{ raw: 'x', status: 'not-a-status' }],
      unsupported: [],
    };
    expect(validate(payload)).toBe(false);
    expect(firstErrorPath(validate.errors)).toBe('/mods/0/status');
    expect(errorKeywords(validate.errors)).toContain('enum');
  });
});

// ---------------------------------------------------------------------------
// CoreError envelope
// ---------------------------------------------------------------------------

describe('CoreError envelope (DESIGN §6.4)', () => {
  it('valid CoreError validates', () => {
    const validate = compile(coreErrorSchema);
    const ok = validate({
      code: 'BUILD_PARSE_FAILED',
      message: 'could not parse build',
      details: { line: 12 },
      upstreamStack: 'lua stack...',
    });
    expect(validate.errors).toBeNull();
    expect(ok).toBe(true);
  });

  it('unknown error code is rejected at /code with "enum"', () => {
    const validate = compile(coreErrorSchema);
    expect(validate({ code: 'NOPE', message: 'x' })).toBe(false);
    expect(firstErrorPath(validate.errors)).toBe('/code');
    expect(errorKeywords(validate.errors)).toContain('enum');
  });

  it('missing message is rejected with "required"', () => {
    const validate = compile(coreErrorSchema);
    expect(validate({ code: 'CALC_FAILED' })).toBe(false);
    expect(errorKeywords(validate.errors)).toContain('required');
  });
});
