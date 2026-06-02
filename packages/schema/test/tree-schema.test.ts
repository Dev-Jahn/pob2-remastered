// Lockstep contract test for the tree.* method expansion (task p5-tree-schema,
// DESIGN.md §6.3 tree.previewAllocate / tree.applyAllocate, §10.6 Passive Tree
// tab). It asserts the runtime registry, the typed method set (MvpMethod /
// CoreResponseMap), and the JSON Schemas stay in lockstep once the three tree.*
// methods land:
//
//   tree.getData         — the serialized passive TreeGraph
//   tree.previewAllocate — per-stat allocation delta ({ before, after, delta })
//   tree.applyAllocate   — commits the allocation, returns the new allocated set
//
// NO-FALLBACK (the p1/build-load-response-schema lesson, repeated in the items.*
// and skills/config/calc tasks): the response schemas MUST match the runner's
// actual serialization in overlays/lua/modern_api.lua (task p5-tree-runner-api),
// never an aspirational shape. The fixed shapes that task pins are:
//
//   tree.getData (build.spec serialization, §6.4):
//     { treeVersion, nodes: TreeNode[], groups: TreeGroup[],
//       constants: TreeConstants, allocatedNodeIds: number[] }
//     TreeNode      = { nodeId, name, type, x, y, orbit, orbitIndex, group,
//                       isAscendancy }
//     TreeGroup     = { groupId, x, y }
//     TreeConstants = { classes: {<name>:<id>}, orbitAnglesByOrbit,
//                       orbitRadii, skillsPerOrbit }
//
//   tree.previewAllocate (GetMiscCalculator addNodes override, §7.4 delta):
//     request  { buildId, nodeIds: number[] }
//     response { deltas: TreeStatDelta[] }
//     TreeStatDelta = { statId, before, after, delta }  (matches EquipDelta)
//
//   tree.applyAllocate (PassiveSpec:AllocNode commit):
//     request  { buildId, nodeIds: number[] }
//     response { allocatedNodeIds: number[] }
//
// Tests import from ../src so they exercise the authored source, not built dist.
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaRegistry, MVP_METHODS } from '../src/index.js';
import type { JSONSchema, SchemaEntry } from '../src/index.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });

const NEW_TREE_METHODS = ['tree.getData', 'tree.previewAllocate', 'tree.applyAllocate'] as const;

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

// ---------------------------------------------------------------------------
// Registry lockstep
// ---------------------------------------------------------------------------

describe('tree.* registry expansion (lockstep)', () => {
  it('MVP_METHODS now includes the three new tree.* methods', () => {
    for (const method of NEW_TREE_METHODS) {
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
    for (const method of NEW_TREE_METHODS) {
      const entry: SchemaEntry = schemaRegistry[method];
      expect(entry.requestSchema.type).toBe('object');
      expect(entry.responseSchema.type).toBe('object');
      expect(entry.requestSchema.additionalProperties, `${method} request closed`).toBe(false);
      expect(entry.responseSchema.additionalProperties, `${method} response closed`).toBe(false);
    }
  });

  it('every registered schema (incl. new tree methods) compiles under AJV Draft 2020-12', () => {
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      expect(() => ajv.compile(requestSchema as object), `${method} request`).not.toThrow();
      expect(() => ajv.compile(responseSchema as object), `${method} response`).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// tree.getData TreeGraph shape is pinned by schema (DESIGN §6.4, §10.6)
// ---------------------------------------------------------------------------

describe('tree.getData TreeGraph shape is pinned by schema (DESIGN §6.4)', () => {
  const resp = schemaRegistry['tree.getData'].responseSchema;

  it('request requires only buildId and forbids extras', () => {
    const req = schemaRegistry['tree.getData'].requestSchema;
    expect(req.required).toEqual(expect.arrayContaining(['buildId']));
    expect(prop(req, 'buildId').type).toBe('string');
    expect(req.additionalProperties).toBe(false);
  });

  it('response requires treeVersion/nodes/groups/constants/allocatedNodeIds and forbids extras', () => {
    expect(resp.type).toBe('object');
    expect(resp.additionalProperties).toBe(false);
    expect(resp.required).toEqual(
      expect.arrayContaining(['treeVersion', 'nodes', 'groups', 'constants', 'allocatedNodeIds']),
    );
    expect(prop(resp, 'treeVersion').type).toBe('string');
    expect(prop(resp, 'nodes').type).toBe('array');
    expect(prop(resp, 'groups').type).toBe('array');
    expect(prop(resp, 'constants').type).toBe('object');
    expect(prop(resp, 'allocatedNodeIds').type).toBe('array');
    // allocatedNodeIds is a number list (scalar(node.id) is numeric).
    expect((prop(resp, 'allocatedNodeIds').items as JSONSchema).type).toBe('number');
  });

  it('TreeNode pins nodeId/name/type/x/y/orbit/orbitIndex/group/isAscendancy/connections and forbids extras', () => {
    const node = prop(resp, 'nodes').items as JSONSchema;
    expect(node.type).toBe('object');
    expect(node.additionalProperties).toBe(false);
    expect(node.required).toEqual(
      expect.arrayContaining([
        'nodeId',
        'name',
        'type',
        'x',
        'y',
        'orbit',
        'orbitIndex',
        'group',
        'isAscendancy',
        'connections',
      ]),
    );
    expect(prop(node, 'nodeId').type).toBe('number');
    expect(prop(node, 'name').type).toBe('string');
    expect(prop(node, 'type').type).toBe('string');
    for (const field of ['x', 'y', 'orbit', 'orbitIndex', 'group']) {
      expect(prop(node, field).type).toBe('number');
    }
    expect(prop(node, 'isAscendancy').type).toBe('boolean');
    // connections is the node's edge graph (core node.linkedId) — a numeric id list.
    const connections = prop(node, 'connections');
    expect(connections.type).toBe('array');
    expect((connections.items as JSONSchema).type).toBe('number');
  });

  it('TreeGroup pins groupId/x/y and forbids extras', () => {
    const group = prop(resp, 'groups').items as JSONSchema;
    expect(group.type).toBe('object');
    expect(group.additionalProperties).toBe(false);
    expect(group.required).toEqual(expect.arrayContaining(['groupId', 'x', 'y']));
    expect(prop(group, 'groupId').type).toBe('number');
    expect(prop(group, 'x').type).toBe('number');
    expect(prop(group, 'y').type).toBe('number');
  });

  it('TreeConstants pins classes/orbitAnglesByOrbit/orbitRadii/skillsPerOrbit', () => {
    const constants = prop(resp, 'constants');
    expect(constants.type).toBe('object');
    expect(constants.required).toEqual(
      expect.arrayContaining(['classes', 'orbitAnglesByOrbit', 'orbitRadii', 'skillsPerOrbit']),
    );
    // classes is a {<className>: <classId number>} object map.
    expect(prop(constants, 'classes').type).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// tree.previewAllocate / tree.applyAllocate shapes (DESIGN §6.3, §7.4)
// ---------------------------------------------------------------------------

describe('tree.previewAllocate shape is pinned by schema (DESIGN §6.3, §7.4)', () => {
  const req = schemaRegistry['tree.previewAllocate'].requestSchema;
  const resp = schemaRegistry['tree.previewAllocate'].responseSchema;

  it('request requires buildId + nodeIds (number list) and forbids extras', () => {
    expect(req.required).toEqual(expect.arrayContaining(['buildId', 'nodeIds']));
    expect(prop(req, 'buildId').type).toBe('string');
    expect(prop(req, 'nodeIds').type).toBe('array');
    expect((prop(req, 'nodeIds').items as JSONSchema).type).toBe('number');
    expect(req.additionalProperties).toBe(false);
  });

  it('response carries a deltas list of {statId, before, after, delta}', () => {
    expect(resp.required).toEqual(expect.arrayContaining(['deltas']));
    const delta = prop(resp, 'deltas').items as JSONSchema;
    expect(delta.type).toBe('object');
    expect(delta.additionalProperties).toBe(false);
    expect(delta.required).toEqual(expect.arrayContaining(['statId', 'before', 'after', 'delta']));
    expect(prop(delta, 'statId').type).toBe('string');
    for (const field of ['before', 'after', 'delta']) {
      expect(prop(delta, field).type).toBe('number');
    }
    expect(resp.additionalProperties).toBe(false);
  });
});

describe('tree.applyAllocate shape is pinned by schema (DESIGN §6.3)', () => {
  const req = schemaRegistry['tree.applyAllocate'].requestSchema;
  const resp = schemaRegistry['tree.applyAllocate'].responseSchema;

  it('request requires buildId + nodeIds (number list) and forbids extras', () => {
    expect(req.required).toEqual(expect.arrayContaining(['buildId', 'nodeIds']));
    expect(prop(req, 'buildId').type).toBe('string');
    expect(prop(req, 'nodeIds').type).toBe('array');
    expect((prop(req, 'nodeIds').items as JSONSchema).type).toBe('number');
    expect(req.additionalProperties).toBe(false);
  });

  it('response carries allocatedNodeIds (number list) and forbids extras', () => {
    expect(resp.required).toEqual(expect.arrayContaining(['allocatedNodeIds']));
    expect(prop(resp, 'allocatedNodeIds').type).toBe('array');
    expect((prop(resp, 'allocatedNodeIds').items as JSONSchema).type).toBe('number');
    expect(resp.additionalProperties).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AJV behaviour: valid sample payloads validate; invalid ones rejected
// ---------------------------------------------------------------------------

describe('new tree.* methods validate sample payloads (AJV behaviour)', () => {
  const sampleNode = {
    nodeId: 50459,
    name: 'RANGER',
    type: 'ClassStart',
    x: -10.5,
    y: 20.0,
    orbit: 0,
    orbitIndex: 0,
    group: 1,
    isAscendancy: false,
    connections: [13828],
  };
  const sampleGroup = { groupId: 1, x: -100.0, y: 200.0 };
  const sampleConstants = {
    classes: { DexClass: 2 },
    orbitAnglesByOrbit: [[0]],
    orbitRadii: [0, 82],
    skillsPerOrbit: [1, 6],
  };

  const valid: Record<string, { request: unknown; response: unknown }> = {
    'tree.getData': {
      request: { buildId: 'b-1' },
      response: {
        treeVersion: '0_5',
        nodes: [sampleNode],
        groups: [sampleGroup],
        constants: sampleConstants,
        allocatedNodeIds: [50459],
      },
    },
    'tree.previewAllocate': {
      request: { buildId: 'b-1', nodeIds: [13828] },
      response: {
        deltas: [{ statId: 'Evasion', before: 7, after: 23, delta: 16 }],
      },
    },
    'tree.applyAllocate': {
      request: { buildId: 'b-1', nodeIds: [13828] },
      response: { allocatedNodeIds: [50459, 13828] },
    },
  };

  for (const method of NEW_TREE_METHODS) {
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

  it('tree.getData node with an extra field is rejected (closed card)', () => {
    const validate = ajv.compile(schemaRegistry['tree.getData'].responseSchema as object);
    const ok = validate({
      treeVersion: '0_5',
      nodes: [{ ...sampleNode, bogus: true }],
      groups: [sampleGroup],
      constants: sampleConstants,
      allocatedNodeIds: [50459],
    });
    expect(ok).toBe(false);
    expect(validate.errors!.map((e) => e.keyword)).toContain('additionalProperties');
  });

  it('tree.previewAllocate delta with a non-number before is rejected at the indexed path', () => {
    const validate = ajv.compile(schemaRegistry['tree.previewAllocate'].responseSchema as object);
    const ok = validate({
      deltas: [{ statId: 'Evasion', before: 'oops', after: 23, delta: 16 }],
    });
    expect(ok).toBe(false);
    expect(validate.errors![0]!.instancePath).toBe('/deltas/0/before');
    expect(validate.errors!.map((e) => e.keyword)).toContain('type');
  });

  it('tree.previewAllocate request with a string nodeId is rejected at the indexed path', () => {
    const validate = ajv.compile(schemaRegistry['tree.previewAllocate'].requestSchema as object);
    const ok = validate({ buildId: 'b-1', nodeIds: ['13828'] });
    expect(ok).toBe(false);
    expect(validate.errors![0]!.instancePath).toBe('/nodeIds/0');
    expect(validate.errors!.map((e) => e.keyword)).toContain('type');
  });

  it('tree.applyAllocate request missing nodeIds is rejected with "required"', () => {
    const validate = ajv.compile(schemaRegistry['tree.applyAllocate'].requestSchema as object);
    const ok = validate({ buildId: 'b-1' });
    expect(ok).toBe(false);
    expect(validate.errors!.map((e) => e.keyword)).toContain('required');
  });
});
