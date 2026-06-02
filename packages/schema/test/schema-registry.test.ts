// Lockstep contract test for the items.* method expansion (task p3-schema-items,
// DESIGN.md §6.3 items.*). It asserts the runtime registry, the typed method set
// (MvpMethod / CoreResponseMap), and the JSON Schemas stay in lockstep once the
// three new methods land:
//
//   items.getEquipped  — equipped-slot item cards (EquippedItem shape)
//   items.createCustom — build a custom item, returns its card
//   items.compare      — equip delta list ({ statId, before, after, delta })
//
// The fixed shapes the task pins (DESIGN §6.4 "every response is a TS type AND a
// JSON Schema"):
//   EquippedItem = { slot, itemId, name, rarity, baseName, requirements,
//                    summaryMods[], unsupportedMods[] }
//   EquipDelta   = { statId, before, after, delta }
//
// Tests import from ../src so they exercise the authored source, not built dist.
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaRegistry, MVP_METHODS, coreErrorSchema } from '../src/index.js';
import type { JSONSchema, SchemaEntry } from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });

const NEW_ITEMS_METHODS = ['items.getEquipped', 'items.createCustom', 'items.compare'] as const;

/** Drill into a nested JSON Schema by property names, asserting each hop exists. */
function prop(schema: JSONSchema, ...path: string[]): JSONSchema {
  let current = schema;
  for (const key of path) {
    const props = current.properties as Record<string, JSONSchema> | undefined;
    expect(props, `missing properties on the way to ${path.join('.')}`).toBeDefined();
    const next = props![key];
    expect(next, `missing property ${key} (path ${path.join('.')})`).toBeDefined();
    current = next;
  }
  return current;
}

describe('items.* registry expansion (lockstep)', () => {
  it('MVP_METHODS now includes the three new items.* methods', () => {
    for (const method of NEW_ITEMS_METHODS) {
      expect([...MVP_METHODS], `MVP_METHODS contains ${method}`).toContain(method);
    }
  });

  it('MVP_METHODS stays in lockstep with the registry keys', () => {
    expect([...MVP_METHODS].sort()).toEqual(Object.keys(schemaRegistry).sort());
  });

  it('each new method has request + response schema with a unique $id and a closed object type', () => {
    const ids = new Set<string>();
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      for (const schema of [requestSchema, responseSchema]) {
        expect(typeof schema.$id).toBe('string');
        expect(ids.has(schema.$id as string), `duplicate $id ${schema.$id}`).toBe(false);
        ids.add(schema.$id as string);
      }
    }
    for (const method of NEW_ITEMS_METHODS) {
      const entry: SchemaEntry = schemaRegistry[method];
      expect(entry.requestSchema.type).toBe('object');
      expect(entry.responseSchema.type).toBe('object');
      expect(entry.requestSchema.additionalProperties, `${method} request closed`).toBe(false);
      expect(entry.responseSchema.additionalProperties, `${method} response closed`).toBe(false);
    }
  });

  it('every registered schema (incl. new methods) compiles under AJV Draft 2020-12', () => {
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      expect(() => ajv.compile(requestSchema as object), `${method} request`).not.toThrow();
      expect(() => ajv.compile(responseSchema as object), `${method} response`).not.toThrow();
    }
    expect(() => ajv.compile(coreErrorSchema as object)).not.toThrow();
  });
});

describe('EquippedItem shape is pinned by schema (DESIGN §6.4)', () => {
  // getEquipped and createCustom both surface an EquippedItem card; assert the
  // shape on getEquipped's response array items.
  const equippedItem = prop(schemaRegistry['items.getEquipped'].responseSchema, 'equipped')
    .items as JSONSchema;

  it('EquippedItem requires every fixed field and forbids extras', () => {
    expect(equippedItem.type).toBe('object');
    expect(equippedItem.additionalProperties).toBe(false);
    expect(equippedItem.required).toEqual(
      expect.arrayContaining([
        'slot',
        'itemId',
        'name',
        'rarity',
        'baseName',
        'requirements',
        'summaryMods',
        'unsupportedMods',
      ]),
    );
  });

  it('requirements pins level/str/dex/int as numbers; mod lists are string arrays', () => {
    const req = prop(equippedItem, 'requirements');
    expect(req.additionalProperties).toBe(false);
    for (const attr of ['level', 'str', 'dex', 'int']) {
      expect(prop(req, attr).type).toBe('number');
    }
    expect((equippedItem.properties as Record<string, JSONSchema>).summaryMods.type).toBe('array');
    expect(
      ((equippedItem.properties as Record<string, JSONSchema>).summaryMods.items as JSONSchema)
        .type,
    ).toBe('string');
    expect((equippedItem.properties as Record<string, JSONSchema>).unsupportedMods.type).toBe(
      'array',
    );
  });
});

describe('equip delta shape is pinned by schema (DESIGN §6.3 items.compare)', () => {
  const delta = prop(schemaRegistry['items.compare'].responseSchema, 'deltas').items as JSONSchema;

  it('EquipDelta requires statId/before/after/delta with the right scalar types', () => {
    expect(delta.type).toBe('object');
    expect(delta.additionalProperties).toBe(false);
    expect(delta.required).toEqual(expect.arrayContaining(['statId', 'before', 'after', 'delta']));
    expect(prop(delta, 'statId').type).toBe('string');
    for (const field of ['before', 'after', 'delta']) {
      expect(prop(delta, field).type).toBe('number');
    }
  });
});

describe('new items.* methods validate sample payloads (AJV behaviour)', () => {
  const sampleEquippedItem = {
    slot: 'Weapon 1',
    itemId: '17',
    name: 'Runeforged Warpick',
    rarity: 'NORMAL',
    baseName: 'Runeforged Warpick',
    requirements: { level: 1, str: 12, dex: 0, int: 0 },
    summaryMods: ['Adds 1 to 3 Physical Damage'],
    unsupportedMods: [],
  };

  const valid: Record<string, { request: unknown; response: unknown }> = {
    'items.getEquipped': {
      request: { buildId: 'b-1' },
      response: { equipped: [sampleEquippedItem] },
    },
    'items.createCustom': {
      request: { baseId: 'Runeforged Warpick', mods: [{ text: '+50 to maximum Life' }] },
      response: { itemId: '42', item: sampleEquippedItem },
    },
    'items.compare': {
      request: { buildId: 'b-1', itemId: '42', slot: 'Weapon 1' },
      response: {
        slot: 'Weapon 1',
        deltas: [{ statId: 'TotalDPS', before: 1000, after: 1500, delta: 500 }],
      },
    },
  };

  for (const method of NEW_ITEMS_METHODS) {
    it(`${method} request: valid sample validates`, () => {
      const validate = ajv.compile(schemaRegistry[method].requestSchema as object);
      const ok = validate(valid[method]!.request);
      expect(validate.errors, `${method} request errors`).toBeNull();
      expect(ok).toBe(true);
    });

    it(`${method} response: valid sample validates`, () => {
      const validate = ajv.compile(schemaRegistry[method].responseSchema as object);
      const ok = validate(valid[method]!.response);
      expect(validate.errors, `${method} response errors`).toBeNull();
      expect(ok).toBe(true);
    });
  }

  it('items.compare delta with a non-number before is rejected at the indexed path', () => {
    const validate = ajv.compile(schemaRegistry['items.compare'].responseSchema as object);
    const ok = validate({
      slot: 'Weapon 1',
      deltas: [{ statId: 'TotalDPS', before: 'oops', after: 1500, delta: 500 }],
    });
    expect(ok).toBe(false);
    expect(validate.errors![0]!.instancePath).toBe('/deltas/0/before');
    expect(validate.errors!.map((e) => e.keyword)).toContain('type');
  });

  it('items.getEquipped item with an extra field is rejected (closed card)', () => {
    const validate = ajv.compile(schemaRegistry['items.getEquipped'].responseSchema as object);
    const ok = validate({ equipped: [{ ...sampleEquippedItem, bogus: true }] });
    expect(ok).toBe(false);
    expect(validate.errors!.map((e) => e.keyword)).toContain('additionalProperties');
  });
});

// ---------------------------------------------------------------------------
// skills.getGroups / config.getOptions / calc.explain expansion (task
// p4-schema-skills-config-calc, DESIGN §6.3/§6.4, §10.5/§10.7/§10.8).
//
// The fixed flat shapes the task pins (NO-FALLBACK: the response schema must
// match the runner's flat serialization, never an arbitrary BuildState — the
// p1/build-load-response-schema lesson):
//
//   skills.getGroups (socketGroupList based, §10.5):
//     { groups: SkillGroupCard[] }
//     SkillGroupCard = { groupId, label, enabled, spirit, reservation,
//                        activeGems: SkillGemRef[], supportGems: SkillGemRef[] }
//     SkillGemRef    = { gemId, name, level, quality, enabled }
//
//   config.getOptions (ConfigOptions based, §10.8):
//     { options: ConfigOptionCard[] }
//     ConfigOptionCard = { optionId, type, label, value, dependentModifiers[] }
//
//   calc.explain (§10.7 formula trace model):
//     { statId, finalValue, label, sources: ExplainSource[], formula,
//       upstreamStatId }
//     ExplainSource = { kind: item|passive|skillGem|supportGem|config|buff,
//                       label, value }
// ---------------------------------------------------------------------------

const NEW_SCC_METHODS = ['skills.getGroups', 'config.getOptions', 'calc.explain'] as const;

const EXPLAIN_SOURCE_KINDS = [
  'item',
  'passive',
  'skillGem',
  'supportGem',
  'config',
  'buff',
] as const;

describe('skills/config/calc registry expansion (lockstep)', () => {
  it('MVP_METHODS now includes the three new skills/config/calc methods', () => {
    for (const method of NEW_SCC_METHODS) {
      expect([...MVP_METHODS], `MVP_METHODS contains ${method}`).toContain(method);
    }
  });

  it('MVP_METHODS stays in lockstep with the registry keys', () => {
    expect([...MVP_METHODS].sort()).toEqual(Object.keys(schemaRegistry).sort());
  });

  it('each new method has request + response schema with a unique $id and a closed object type', () => {
    const ids = new Set<string>();
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      for (const schema of [requestSchema, responseSchema]) {
        expect(typeof schema.$id).toBe('string');
        expect(ids.has(schema.$id as string), `duplicate $id ${schema.$id}`).toBe(false);
        ids.add(schema.$id as string);
      }
    }
    for (const method of NEW_SCC_METHODS) {
      const entry: SchemaEntry = schemaRegistry[method];
      expect(entry.requestSchema.type).toBe('object');
      expect(entry.responseSchema.type).toBe('object');
      expect(entry.requestSchema.additionalProperties, `${method} request closed`).toBe(false);
      expect(entry.responseSchema.additionalProperties, `${method} response closed`).toBe(false);
    }
  });

  it('every registered schema (incl. new methods) compiles under AJV Draft 2020-12', () => {
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      expect(() => ajv.compile(requestSchema as object), `${method} request`).not.toThrow();
      expect(() => ajv.compile(responseSchema as object), `${method} response`).not.toThrow();
    }
  });
});

describe('skills.getGroups SkillGroupCard shape is pinned by schema (DESIGN §10.5)', () => {
  const card = prop(schemaRegistry['skills.getGroups'].responseSchema, 'groups')
    .items as JSONSchema;

  it('SkillGroupCard requires every fixed field and forbids extras', () => {
    expect(card.type).toBe('object');
    expect(card.additionalProperties).toBe(false);
    expect(card.required).toEqual(
      expect.arrayContaining([
        'groupId',
        'label',
        'enabled',
        'spirit',
        'reservation',
        'activeGems',
        'supportGems',
      ]),
    );
  });

  it('enabled is boolean; spirit/reservation are numbers; gem lists are arrays', () => {
    expect(prop(card, 'enabled').type).toBe('boolean');
    expect(prop(card, 'spirit').type).toBe('number');
    expect(prop(card, 'reservation').type).toBe('number');
    expect(prop(card, 'activeGems').type).toBe('array');
    expect(prop(card, 'supportGems').type).toBe('array');
  });

  it('SkillGemRef pins gemId/name/level/quality/enabled and forbids extras', () => {
    const gem = prop(card, 'activeGems').items as JSONSchema;
    expect(gem.type).toBe('object');
    expect(gem.additionalProperties).toBe(false);
    expect(gem.required).toEqual(
      expect.arrayContaining(['gemId', 'name', 'level', 'quality', 'enabled']),
    );
    expect(prop(gem, 'gemId').type).toBe('string');
    expect(prop(gem, 'name').type).toBe('string');
    expect(prop(gem, 'level').type).toBe('number');
    expect(prop(gem, 'quality').type).toBe('number');
    expect(prop(gem, 'enabled').type).toBe('boolean');
  });
});

describe('config.getOptions ConfigOptionCard shape is pinned by schema (DESIGN §10.8)', () => {
  const card = prop(schemaRegistry['config.getOptions'].responseSchema, 'options')
    .items as JSONSchema;

  it('ConfigOptionCard requires every fixed field and forbids extras', () => {
    expect(card.type).toBe('object');
    expect(card.additionalProperties).toBe(false);
    expect(card.required).toEqual(
      expect.arrayContaining(['optionId', 'type', 'label', 'value', 'dependentModifiers']),
    );
  });

  it('optionId/type/label are strings; dependentModifiers is a string array', () => {
    expect(prop(card, 'optionId').type).toBe('string');
    expect(prop(card, 'type').type).toBe('string');
    expect(prop(card, 'label').type).toBe('string');
    const deps = prop(card, 'dependentModifiers');
    expect(deps.type).toBe('array');
    expect((deps.items as JSONSchema).type).toBe('string');
  });
});

describe('calc.explain formula-trace shape is pinned by schema (DESIGN §10.7)', () => {
  const resp = schemaRegistry['calc.explain'].responseSchema;

  it('response requires the §10.7 trace fields and forbids extras', () => {
    expect(resp.type).toBe('object');
    expect(resp.additionalProperties).toBe(false);
    expect(resp.required).toEqual(
      expect.arrayContaining([
        'statId',
        'finalValue',
        'label',
        'sources',
        'formula',
        'upstreamStatId',
      ]),
    );
    expect(prop(resp, 'statId').type).toBe('string');
    expect(prop(resp, 'finalValue').type).toBe('number');
    expect(prop(resp, 'label').type).toBe('string');
    expect(prop(resp, 'formula').type).toBe('string');
    expect(prop(resp, 'upstreamStatId').type).toBe('string');
    expect(prop(resp, 'sources').type).toBe('array');
  });

  it('ExplainSource pins kind/label/value, kind constrained to the §10.7 enum', () => {
    const source = prop(resp, 'sources').items as JSONSchema;
    expect(source.type).toBe('object');
    expect(source.additionalProperties).toBe(false);
    expect(source.required).toEqual(expect.arrayContaining(['kind', 'label', 'value']));
    expect(prop(source, 'kind').enum).toEqual([...EXPLAIN_SOURCE_KINDS]);
    expect(prop(source, 'label').type).toBe('string');
    expect(prop(source, 'value').type).toBe('number');
  });

  it('calc.explain request requires buildId + statId, activeSkillId optional', () => {
    const req = schemaRegistry['calc.explain'].requestSchema;
    expect(req.required).toEqual(expect.arrayContaining(['buildId', 'statId']));
    expect(prop(req, 'buildId').type).toBe('string');
    expect(prop(req, 'statId').type).toBe('string');
    expect(prop(req, 'activeSkillId').type).toBe('string');
    expect(req.additionalProperties).toBe(false);
  });
});

describe('new skills/config/calc methods validate sample payloads (AJV behaviour)', () => {
  const sampleGem = {
    gemId: 'MeleeMaceMacePlayer',
    name: 'Mace Strike',
    level: 1,
    quality: 0,
    enabled: true,
  };
  const sampleGroup = {
    groupId: '1',
    label: 'Mace Strike',
    enabled: true,
    spirit: 0,
    reservation: 0,
    activeGems: [sampleGem],
    supportGems: [],
  };
  const sampleOption = {
    optionId: 'enemyIsBoss',
    type: 'list',
    label: 'Is the enemy a Boss?',
    value: 'None',
    dependentModifiers: ['Multiplier:BossDamage'],
  };
  const sampleExplain = {
    statId: 'TotalDPS',
    finalValue: 8.16,
    label: '총 DPS',
    formula: 'Base 5 * (1 + 0.63 increased)',
    upstreamStatId: 'TotalDPS',
    sources: [{ kind: 'skillGem', label: 'Mace Strike', value: 5 }],
  };

  const valid: Record<string, { request: unknown; response: unknown }> = {
    'skills.getGroups': {
      request: { buildId: 'b-1' },
      response: { groups: [sampleGroup] },
    },
    'config.getOptions': {
      request: { buildId: 'b-1' },
      response: { options: [sampleOption] },
    },
    'calc.explain': {
      request: { buildId: 'b-1', statId: 'TotalDPS', activeSkillId: 'sk-1' },
      response: sampleExplain,
    },
  };

  for (const method of NEW_SCC_METHODS) {
    it(`${method} request: valid sample validates`, () => {
      const validate = ajv.compile(schemaRegistry[method].requestSchema as object);
      const ok = validate(valid[method]!.request);
      expect(validate.errors, `${method} request errors`).toBeNull();
      expect(ok).toBe(true);
    });

    it(`${method} response: valid sample validates`, () => {
      const validate = ajv.compile(schemaRegistry[method].responseSchema as object);
      const ok = validate(valid[method]!.response);
      expect(validate.errors, `${method} response errors`).toBeNull();
      expect(ok).toBe(true);
    });
  }

  it('calc.explain source with an unknown kind is rejected at the indexed path', () => {
    const validate = ajv.compile(schemaRegistry['calc.explain'].responseSchema as object);
    const ok = validate({
      ...sampleExplain,
      sources: [{ kind: 'nonsense', label: 'x', value: 1 }],
    });
    expect(ok).toBe(false);
    expect(validate.errors![0]!.instancePath).toBe('/sources/0/kind');
    expect(validate.errors!.map((e) => e.keyword)).toContain('enum');
  });

  it('skills.getGroups gem with an extra field is rejected (closed card)', () => {
    const validate = ajv.compile(schemaRegistry['skills.getGroups'].responseSchema as object);
    const ok = validate({
      groups: [{ ...sampleGroup, activeGems: [{ ...sampleGem, bogus: true }] }],
    });
    expect(ok).toBe(false);
    expect(validate.errors!.map((e) => e.keyword)).toContain('additionalProperties');
  });
});
