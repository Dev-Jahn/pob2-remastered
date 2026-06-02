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
  'calc.explain': { buildId: 'b-1', statId: 'TotalDPS', activeSkillId: 'sk-1' },
  'items.parseClipboard': { text: '아이템 텍스트', localeHint: 'ko-KR' },
  'items.getEquipped': { buildId: 'b-1' },
  'items.createCustom': { baseId: 'Runeforged Warpick', mods: [{ text: '+50 to maximum Life' }] },
  'items.compare': { buildId: 'b-1', itemId: '42', slot: 'Weapon 1' },
  'skills.getGroups': { buildId: 'b-1' },
  'config.getOptions': { buildId: 'b-1' },
  'tree.getData': { buildId: 'b-1' },
  'tree.previewAllocate': { buildId: 'b-1', nodeIds: [13828] },
  'tree.applyAllocate': { buildId: 'b-1', nodeIds: [13828] },
};

const validResponses: Record<string, unknown> = {
  'build.load': { buildId: 'b-1', summary: { className: 'Ranger', level: 1 } },
  'build.save': { format: 'xml', data: '<PathOfBuilding/>' },
  'calc.run': {
    buildId: 'b-1',
    stats: [{ statId: 'TotalDPS', value: 123456, label: '총 DPS' }],
  },
  'calc.explain': {
    statId: 'TotalDPS',
    finalValue: 8.16,
    label: '총 DPS',
    formula: 'Base 5 * (1 + 0.63 increased)',
    upstreamStatId: 'TotalDPS',
    sources: [{ kind: 'skillGem', label: 'Mace Strike', value: 5 }],
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
  'skills.getGroups': {
    groups: [
      {
        groupId: '1',
        label: 'Mace Strike',
        enabled: true,
        spirit: 0,
        reservation: 0,
        gems: [
          {
            gemId: 'MeleeMaceMacePlayer',
            name: 'Mace Strike',
            level: 1,
            quality: 0,
            enabled: true,
          },
        ],
        activeGems: [
          {
            gemId: 'MeleeMaceMacePlayer',
            name: 'Mace Strike',
            level: 1,
            quality: 0,
            enabled: true,
          },
        ],
        supportGems: [],
      },
    ],
  },
  'config.getOptions': {
    options: [
      {
        optionId: 'enemyIsBoss',
        type: 'list',
        label: 'Is the enemy a Boss?',
        value: 'None',
        dependentModifiers: ['Multiplier:BossDamage'],
      },
    ],
  },
  'tree.getData': {
    treeVersion: '0_5',
    nodes: [
      {
        nodeId: 50459,
        name: 'RANGER',
        type: 'ClassStart',
        x: -10.5,
        y: 20,
        orbit: 0,
        orbitIndex: 0,
        group: 1,
        isAscendancy: false,
        connections: [13828],
      },
    ],
    groups: [{ groupId: 1, x: -100, y: 200 }],
    constants: {
      classes: { DexClass: 2 },
      orbitAnglesByOrbit: [[0]],
      orbitRadii: [0, 82],
      skillsPerOrbit: [1, 6],
    },
    allocatedNodeIds: [50459],
  },
  'tree.previewAllocate': {
    deltas: [{ statId: 'Evasion', before: 7, after: 23, delta: 16 }],
  },
  'tree.applyAllocate': { allocatedNodeIds: [50459, 13828] },
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
