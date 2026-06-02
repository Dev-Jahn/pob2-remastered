// Contract test for @pob2/schema — the runtime registry is the single source of
// truth shared by the host validator and these tests (DESIGN §6.3-§6.4, §12.1).
//
// Tests import from ../src so they exercise the authored source, not the built dist.
import { describe, it, expect } from 'vitest';
import { schemaRegistry, MVP_METHODS, CORE_ERROR_CODES, coreErrorSchema } from '../src/index.js';
import type { JSONSchema } from '../src/index.js';

describe('schemaRegistry', () => {
  it('covers the four phases.mjs MVP methods plus the items.*, skills/config/calc, and tree.* expansions', () => {
    expect(Object.keys(schemaRegistry).sort()).toEqual(
      [
        'build.load',
        'build.save',
        'calc.run',
        'calc.explain',
        'items.parseClipboard',
        'items.getEquipped',
        'items.createCustom',
        'items.compare',
        'skills.getGroups',
        'config.getOptions',
        'tree.getData',
        'tree.previewAllocate',
        'tree.applyAllocate',
      ].sort(),
    );
  });

  it('MVP_METHODS matches the registry keys', () => {
    expect([...MVP_METHODS].sort()).toEqual(Object.keys(schemaRegistry).sort());
  });

  it('every entry exposes a request schema and a response schema', () => {
    for (const method of MVP_METHODS) {
      const entry = schemaRegistry[method];
      expect(entry, `registry[${method}]`).toBeDefined();
      expect(entry.requestSchema, `${method} requestSchema`).toBeTypeOf('object');
      expect(entry.responseSchema, `${method} responseSchema`).toBeTypeOf('object');
    }
  });

  it('every schema declares a unique $id and an object type', () => {
    const ids = new Set<string>();
    const all: JSONSchema[] = [];
    for (const method of MVP_METHODS) {
      all.push(schemaRegistry[method].requestSchema, schemaRegistry[method].responseSchema);
    }
    all.push(coreErrorSchema);
    for (const schema of all) {
      expect(typeof schema.$id, `schema $id of ${JSON.stringify(schema.title)}`).toBe('string');
      expect(ids.has(schema.$id as string), `duplicate $id ${schema.$id}`).toBe(false);
      ids.add(schema.$id as string);
      expect(schema.type).toBe('object');
    }
  });

  it('request/response schemas forbid extra properties (closed contract)', () => {
    for (const method of MVP_METHODS) {
      const { requestSchema, responseSchema } = schemaRegistry[method];
      expect(requestSchema.additionalProperties, `${method} request closed`).toBe(false);
      expect(responseSchema.additionalProperties, `${method} response closed`).toBe(false);
    }
  });
});

describe('CoreError envelope (DESIGN §6.4)', () => {
  it('enumerates exactly the six DESIGN §6.4 error codes', () => {
    expect([...CORE_ERROR_CODES].sort()).toEqual(
      [
        'CORE_INIT_FAILED',
        'BUILD_PARSE_FAILED',
        'UNKNOWN_MOD',
        'CALC_FAILED',
        'LOCALIZATION_MISSING',
        'UPSTREAM_INCOMPATIBLE',
      ].sort(),
    );
  });

  it('coreErrorSchema constrains code to the enum and requires code+message', () => {
    const codeProp = (coreErrorSchema.properties as Record<string, JSONSchema>).code;
    expect(codeProp.enum).toEqual([...CORE_ERROR_CODES]);
    expect(coreErrorSchema.required).toEqual(expect.arrayContaining(['code', 'message']));
  });
});
