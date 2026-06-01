/**
 * Compiled JSON Schemas for the MVP Core API — the SINGLE canonical runtime
 * source of truth shared by the Rust/host validator (DESIGN §5.1 "JSON-RPC
 * schema validation") and the package's contract tests.
 *
 * These are hand-written Draft 2020-12 schemas authored to mirror the TS types
 * in `../core-api.ts` and `../errors.ts`. Keeping them as plain data (no codegen
 * step, no runtime dependency) matches the repo convention of dependency-free
 * `packages/*` and lets any JSON Schema validator (e.g. AJV on the host) consume
 * them directly. The contract tests in `../test` assert the registry stays in
 * lockstep with the typed method set.
 */
import { CORE_ERROR_CODES } from '../errors.js';
import type { MvpMethod } from '../core-api.js';

/**
 * Minimal structural JSON Schema type. Intentionally narrow: it covers exactly
 * the keywords used by the MVP schemas so authoring stays type-checked without
 * pulling in a full JSON Schema type package.
 */
export interface JSONSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  enum?: readonly unknown[];
  const?: unknown;
  properties?: Record<string, JSONSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JSONSchema;
  items?: JSONSchema;
  oneOf?: readonly JSONSchema[];
  anyOf?: readonly JSONSchema[];
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

// ----------------------------------------------------------------------------
// Shared fragments
// ----------------------------------------------------------------------------

const buildStateSchema = {
  type: 'object',
  description: 'BuildState (DESIGN §12.1). MVP keeps nested set payloads loose.',
  required: [
    'schemaVersion',
    'id',
    'name',
    'classId',
    'level',
    'itemSets',
    'skillSets',
    'passiveSpecs',
    'configSets',
    'activeItemSetId',
    'activeSkillSetId',
    'activePassiveSpecId',
    'activeConfigSetId',
    'metadata',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    id: { type: 'string' },
    name: { type: 'string' },
    classId: { type: 'string' },
    ascendancyId: { type: 'string' },
    level: { type: 'integer' },
    banditOrQuestState: { type: 'object' },
    itemSets: { type: 'array', items: { type: 'object' } },
    skillSets: { type: 'array', items: { type: 'object' } },
    passiveSpecs: { type: 'array', items: { type: 'object' } },
    configSets: { type: 'array', items: { type: 'object' } },
    activeItemSetId: { type: 'string' },
    activeSkillSetId: { type: 'string' },
    activePassiveSpecId: { type: 'string' },
    activeConfigSetId: { type: 'string' },
    notes: { type: 'string' },
    metadata: {
      type: 'object',
      required: ['upstreamCommit', 'createdAt', 'updatedAt', 'locale'],
      properties: {
        upstreamCommit: { type: 'string' },
        createdAt: { type: 'string' },
        updatedAt: { type: 'string' },
        locale: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const localeSchema = { type: 'string', enum: ['ko-KR', 'en-US'] } as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// CoreError envelope (DESIGN §6.4)
// ----------------------------------------------------------------------------

export const coreErrorSchema = {
  $schema: DRAFT,
  $id: 'pob2:core-error',
  title: 'CoreError',
  type: 'object',
  required: ['code', 'message'],
  properties: {
    code: { type: 'string', enum: CORE_ERROR_CODES },
    message: { type: 'string' },
    details: {},
    upstreamStack: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// build.load
// ----------------------------------------------------------------------------

const buildLoadRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:build.load:request',
  title: 'BuildLoadRequest',
  type: 'object',
  required: ['source', 'format'],
  properties: {
    source: { type: 'string' },
    format: { type: 'string', enum: ['xml', 'shareCode'] },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const buildLoadResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:build.load:response',
  title: 'BuildLoadResponse',
  type: 'object',
  required: ['buildId', 'state'],
  properties: {
    buildId: { type: 'string' },
    state: buildStateSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// build.save
// ----------------------------------------------------------------------------

const buildSaveRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:build.save:request',
  title: 'BuildSaveRequest',
  type: 'object',
  required: ['buildId', 'format'],
  properties: {
    buildId: { type: 'string' },
    format: { type: 'string', enum: ['xml', 'shareCode'] },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const buildSaveResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:build.save:response',
  title: 'BuildSaveResponse',
  type: 'object',
  required: ['format', 'data'],
  properties: {
    format: { type: 'string', enum: ['xml', 'shareCode'] },
    data: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// calc.run
// ----------------------------------------------------------------------------

const calcRunRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:calc.run:request',
  title: 'CalcRunRequest',
  type: 'object',
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
    options: {
      type: 'object',
      properties: {
        activeSkillId: { type: 'string' },
        configSetId: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const calcRunResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:calc.run:response',
  title: 'CalcRunResponse',
  type: 'object',
  required: ['buildId', 'stats'],
  properties: {
    buildId: { type: 'string' },
    stats: {
      type: 'array',
      items: {
        type: 'object',
        required: ['statId', 'value', 'label'],
        properties: {
          statId: { type: 'string' },
          value: { type: 'number' },
          label: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// items.parseClipboard
// ----------------------------------------------------------------------------

const itemsParseClipboardRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.parseClipboard:request',
  title: 'ItemsParseClipboardRequest',
  type: 'object',
  required: ['text'],
  properties: {
    text: { type: 'string' },
    localeHint: localeSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const itemsParseClipboardResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.parseClipboard:response',
  title: 'ItemsParseClipboardResponse',
  type: 'object',
  required: ['locale', 'mods', 'unsupported'],
  properties: {
    locale: localeSchema,
    baseId: { type: 'string' },
    rarity: { type: 'string' },
    name: { type: 'string' },
    mods: {
      type: 'array',
      items: {
        type: 'object',
        required: ['raw', 'status'],
        properties: {
          raw: { type: 'string' },
          status: { type: 'string', enum: ['parsed', 'unsupported', 'unknown'] },
          statId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    unsupported: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// Registry — the shared source of truth (method → request/response schema)
// ----------------------------------------------------------------------------

export interface SchemaEntry {
  requestSchema: JSONSchema;
  responseSchema: JSONSchema;
}

/** The MVP methods named in `tools/dev-workflow/phases.mjs`. */
export const MVP_METHODS = [
  'build.load',
  'build.save',
  'calc.run',
  'items.parseClipboard',
] as const satisfies readonly MvpMethod[];

/**
 * Runtime registry consumed by the host validator and the contract tests.
 * `Record<MvpMethod, …>` makes the registry exhaustive over the MVP method set
 * at compile time, so adding a method to the type map without a schema fails the
 * typecheck.
 */
export const schemaRegistry: Record<MvpMethod, SchemaEntry> = {
  'build.load': {
    requestSchema: buildLoadRequestSchema,
    responseSchema: buildLoadResponseSchema,
  },
  'build.save': {
    requestSchema: buildSaveRequestSchema,
    responseSchema: buildSaveResponseSchema,
  },
  'calc.run': {
    requestSchema: calcRunRequestSchema,
    responseSchema: calcRunResponseSchema,
  },
  'items.parseClipboard': {
    requestSchema: itemsParseClipboardRequestSchema,
    responseSchema: itemsParseClipboardResponseSchema,
  },
};
