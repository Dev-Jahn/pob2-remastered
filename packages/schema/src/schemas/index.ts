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
import { diagnosticExportSchema } from '../diagnostic.js';

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

export const buildStateSchema = {
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

/** Item attribute/level requirements card block (mirrors the Lua serializer). */
const itemRequirementsSchema = {
  type: 'object',
  required: ['level', 'str', 'dex', 'int'],
  properties: {
    level: { type: 'number' },
    str: { type: 'number' },
    dex: { type: 'number' },
    int: { type: 'number' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * EquippedItem — the serialized item card produced per occupied slot
 * (DESIGN §6.3 items.*, §6.4). `summaryMods` are recognised lines;
 * `unsupportedMods` are the lines the parser could not recognise (DESIGN §8.6).
 */
const equippedItemSchema = {
  type: 'object',
  required: [
    'slot',
    'itemId',
    'name',
    'rarity',
    'baseName',
    'requirements',
    'summaryMods',
    'unsupportedMods',
  ],
  properties: {
    slot: { type: 'string' },
    itemId: { type: 'string' },
    name: { type: 'string' },
    rarity: { type: 'string' },
    baseName: { type: 'string' },
    requirements: itemRequirementsSchema,
    summaryMods: { type: 'array', items: { type: 'string' } },
    unsupportedMods: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * EquipDelta — one stat's before/after change from an equip comparison
 * (DESIGN §6.3 items.compare, §16.3 "item equip delta").
 */
const equipDeltaSchema = {
  type: 'object',
  required: ['statId', 'before', 'after', 'delta'],
  properties: {
    statId: { type: 'string' },
    before: { type: 'number' },
    after: { type: 'number' },
    delta: { type: 'number' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * SkillGemRef — one gem slotted into a socket group (DESIGN §6.3
 * skills.getGroups, §10.5). The core `gemInstance` flattened to scalars.
 */
const skillGemRefSchema = {
  type: 'object',
  required: ['gemId', 'name', 'level', 'quality', 'enabled'],
  properties: {
    gemId: { type: 'string' },
    name: { type: 'string' },
    level: { type: 'number' },
    quality: { type: 'number' },
    enabled: { type: 'boolean' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * SkillGroupCard — one socket group serialized for the Skills tab (DESIGN §6.3
 * skills.getGroups, §10.5). `spirit`/`reservation` surface the §10.5
 * "reservation과 spirit cost를 즉시 표시" values; active vs support gems split.
 */
const skillGroupCardSchema = {
  type: 'object',
  required: [
    'groupId',
    'label',
    'enabled',
    'spirit',
    'reservation',
    'gems',
    'activeGems',
    'supportGems',
  ],
  properties: {
    groupId: { type: 'string' },
    label: { type: 'string' },
    enabled: { type: 'boolean' },
    spirit: { type: 'number' },
    reservation: { type: 'number' },
    // Order-preserving full gem list (skills.setGemGroup source).
    gems: { type: 'array', items: skillGemRefSchema },
    activeGems: { type: 'array', items: skillGemRefSchema },
    supportGems: { type: 'array', items: skillGemRefSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * ConfigOptionCard — one config option serialized for the Config tab (DESIGN
 * §6.3 config.getOptions, §10.8). `value` is intentionally unconstrained (a
 * check is boolean, a list/count is string/number); `dependentModifiers` lists
 * the mods the option's `apply` wires up (DESIGN §10.8).
 */
const configOptionCardSchema = {
  type: 'object',
  required: ['optionId', 'type', 'label', 'value', 'dependentModifiers'],
  properties: {
    optionId: { type: 'string' },
    type: { type: 'string' },
    label: { type: 'string' },
    value: {},
    dependentModifiers: { type: 'array', items: { type: 'string' } },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** Origin kinds of a calc.explain contribution (DESIGN §10.7 source list). */
const explainSourceKinds = ['item', 'passive', 'skillGem', 'supportGem', 'config', 'buff'] as const;

/**
 * ExplainSource — one contribution to a stat's final value (DESIGN §10.7 "기여
 * source list"). `kind` classifies the origin; `value` is the signed amount.
 */
const explainSourceSchema = {
  type: 'object',
  required: ['kind', 'label', 'value'],
  properties: {
    kind: { type: 'string', enum: explainSourceKinds },
    label: { type: 'string' },
    value: { type: 'number' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * TreeNode — one serialized passive-tree node card (DESIGN §6.3 tree.getData,
 * §10.6). Mirrors the runner's `serializeNode`: `nodeId`/`group` are numeric core
 * ids; `name`/`type` are display strings; `x`/`y`/`orbit`/`orbitIndex` are the
 * orbit-derived layout numbers; `isAscendancy` flags ascendancy-tree nodes;
 * `connections` is the node's edge graph (core `node.linkedId`) the §10.6 renderer
 * derives the connecting edges from.
 */
const treeNodeSchema = {
  type: 'object',
  required: [
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
  ],
  properties: {
    nodeId: { type: 'number' },
    name: { type: 'string' },
    type: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    orbit: { type: 'number' },
    orbitIndex: { type: 'number' },
    group: { type: 'number' },
    isAscendancy: { type: 'boolean' },
    connections: { type: 'array', items: { type: 'number' } },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * TreeGroup — one serialized passive-tree group card (DESIGN §6.3 tree.getData).
 * Mirrors the runner's `serializeTreeGroup`: the numeric group id plus its layout
 * coordinates.
 */
const treeGroupSchema = {
  type: 'object',
  required: ['groupId', 'x', 'y'],
  properties: {
    groupId: { type: 'number' },
    x: { type: 'number' },
    y: { type: 'number' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * TreeConstants — the passive-tree layout constants (DESIGN §6.3 tree.getData,
 * §6.4). Mirrors the runner's `serializeConstants`: `classes` is a {name → numeric
 * class id} map; `orbitAnglesByOrbit`/`orbitRadii`/`skillsPerOrbit` are the pure
 * layout tables, left unconstrained (nested per-orbit lists) but required to be
 * present. Open (`additionalProperties` unset) — the constants block is a faithful
 * deep copy of the tree-data constants and may carry future layout fields.
 */
const treeConstantsSchema = {
  type: 'object',
  required: ['classes', 'orbitAnglesByOrbit', 'orbitRadii', 'skillsPerOrbit'],
  properties: {
    classes: { type: 'object' },
    orbitAnglesByOrbit: {},
    orbitRadii: {},
    skillsPerOrbit: {},
  },
} as const satisfies JSONSchema;

/**
 * TreeStatDelta — one stat's before/after change from a tree allocation preview
 * (DESIGN §6.3 tree.previewAllocate, §7.4 "passive allocation delta"). Same flat
 * shape as EquipDelta.
 */
const treeStatDeltaSchema = {
  type: 'object',
  required: ['statId', 'before', 'after', 'delta'],
  properties: {
    statId: { type: 'string' },
    before: { type: 'number' },
    after: { type: 'number' },
    delta: { type: 'number' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/** A numeric passive-tree node id list (request `nodeIds`, response allocated set). */
const nodeIdListSchema = { type: 'array', items: { type: 'number' } } as const satisfies JSONSchema;

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

// build.load returns the runner's lightweight build SUMMARY (Overview header
// fields), not a full BuildState — so the response is validated against this summary
// shape (code-review fix: align the contract to reality + re-enable response
// validation instead of a `validateResponse:false` bypass). Fields optional + typed;
// the runner may carry extras (no additionalProperties:false). The full
// `buildStateSchema` stays exported for a future `build.getState`.
const buildSummarySchema = {
  type: 'object',
  properties: {
    className: { type: 'string' },
    ascendancyName: { type: 'string' },
    level: { type: 'number' },
    itemCount: { type: 'number' },
  },
} as const satisfies JSONSchema;

const buildLoadResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:build.load:response',
  title: 'BuildLoadResponse',
  type: 'object',
  // Only buildId is guaranteed; summary is the best-effort Overview header (the
  // clients treat an absent summary as {}), so it is validated-when-present, not required.
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
    summary: buildSummarySchema,
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
// items.getEquipped
// ----------------------------------------------------------------------------

const itemsGetEquippedRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.getEquipped:request',
  title: 'ItemsGetEquippedRequest',
  type: 'object',
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const itemsGetEquippedResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.getEquipped:response',
  title: 'ItemsGetEquippedResponse',
  type: 'object',
  required: ['equipped'],
  properties: {
    equipped: { type: 'array', items: equippedItemSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// items.createCustom
// ----------------------------------------------------------------------------

const itemsCreateCustomRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.createCustom:request',
  title: 'ItemsCreateCustomRequest',
  type: 'object',
  required: ['baseId', 'mods'],
  properties: {
    baseId: { type: 'string' },
    mods: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text'],
        properties: {
          text: { type: 'string' },
          statId: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const itemsCreateCustomResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.createCustom:response',
  title: 'ItemsCreateCustomResponse',
  type: 'object',
  required: ['itemId', 'item'],
  properties: {
    itemId: { type: 'string' },
    item: equippedItemSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// items.compare
// ----------------------------------------------------------------------------

const itemsCompareRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.compare:request',
  title: 'ItemsCompareRequest',
  type: 'object',
  required: ['buildId', 'itemId', 'slot'],
  properties: {
    buildId: { type: 'string' },
    itemId: { type: 'string' },
    slot: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const itemsCompareResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:items.compare:response',
  title: 'ItemsCompareResponse',
  type: 'object',
  required: ['slot', 'deltas'],
  properties: {
    slot: { type: 'string' },
    deltas: { type: 'array', items: equipDeltaSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// skills.getGroups
// ----------------------------------------------------------------------------

const skillsGetGroupsRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:skills.getGroups:request',
  title: 'SkillsGetGroupsRequest',
  type: 'object',
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const skillsGetGroupsResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:skills.getGroups:response',
  title: 'SkillsGetGroupsResponse',
  type: 'object',
  required: ['groups'],
  properties: {
    groups: { type: 'array', items: skillGroupCardSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// config.getOptions
// ----------------------------------------------------------------------------

const configGetOptionsRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:config.getOptions:request',
  title: 'ConfigGetOptionsRequest',
  type: 'object',
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const configGetOptionsResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:config.getOptions:response',
  title: 'ConfigGetOptionsResponse',
  type: 'object',
  required: ['options'],
  properties: {
    options: { type: 'array', items: configOptionCardSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// calc.explain
// ----------------------------------------------------------------------------

const calcExplainRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:calc.explain:request',
  title: 'CalcExplainRequest',
  type: 'object',
  required: ['buildId', 'statId'],
  properties: {
    buildId: { type: 'string' },
    statId: { type: 'string' },
    activeSkillId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const calcExplainResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:calc.explain:response',
  title: 'CalcExplainResponse',
  type: 'object',
  required: ['statId', 'finalValue', 'label', 'sources', 'formula', 'upstreamStatId'],
  properties: {
    statId: { type: 'string' },
    finalValue: { type: 'number' },
    label: { type: 'string' },
    sources: { type: 'array', items: explainSourceSchema },
    formula: { type: 'string' },
    upstreamStatId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// tree.getData
// ----------------------------------------------------------------------------

const treeGetDataRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.getData:request',
  title: 'TreeGetDataRequest',
  type: 'object',
  required: ['buildId'],
  properties: {
    buildId: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const treeGetDataResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.getData:response',
  title: 'TreeGetDataResponse',
  type: 'object',
  required: ['treeVersion', 'nodes', 'groups', 'constants', 'allocatedNodeIds'],
  properties: {
    treeVersion: { type: 'string' },
    nodes: { type: 'array', items: treeNodeSchema },
    groups: { type: 'array', items: treeGroupSchema },
    constants: treeConstantsSchema,
    allocatedNodeIds: nodeIdListSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// tree.previewAllocate
// ----------------------------------------------------------------------------

const treePreviewAllocateRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.previewAllocate:request',
  title: 'TreePreviewAllocateRequest',
  type: 'object',
  required: ['buildId', 'nodeIds'],
  properties: {
    buildId: { type: 'string' },
    nodeIds: nodeIdListSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const treePreviewAllocateResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.previewAllocate:response',
  title: 'TreePreviewAllocateResponse',
  type: 'object',
  required: ['deltas'],
  properties: {
    deltas: { type: 'array', items: treeStatDeltaSchema },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

// ----------------------------------------------------------------------------
// tree.applyAllocate
// ----------------------------------------------------------------------------

const treeApplyAllocateRequestSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.applyAllocate:request',
  title: 'TreeApplyAllocateRequest',
  type: 'object',
  required: ['buildId', 'nodeIds'],
  properties: {
    buildId: { type: 'string' },
    nodeIds: nodeIdListSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

const treeApplyAllocateResponseSchema = {
  $schema: DRAFT,
  $id: 'pob2:tree.applyAllocate:response',
  title: 'TreeApplyAllocateResponse',
  type: 'object',
  required: ['allocatedNodeIds'],
  properties: {
    allocatedNodeIds: nodeIdListSchema,
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

/**
 * The MVP methods named in `tools/dev-workflow/phases.mjs`, plus the items.*
 * expansion (DESIGN §6.3 items.getEquipped/createCustom/compare), the Phase 4
 * read methods (DESIGN §6.3 skills.getGroups/config.getOptions/calc.explain), and
 * the Phase 5 tree methods (DESIGN §6.3 tree.getData/previewAllocate/applyAllocate).
 */
export const MVP_METHODS = [
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
  'calc.explain': {
    requestSchema: calcExplainRequestSchema,
    responseSchema: calcExplainResponseSchema,
  },
  'items.parseClipboard': {
    requestSchema: itemsParseClipboardRequestSchema,
    responseSchema: itemsParseClipboardResponseSchema,
  },
  'items.getEquipped': {
    requestSchema: itemsGetEquippedRequestSchema,
    responseSchema: itemsGetEquippedResponseSchema,
  },
  'items.createCustom': {
    requestSchema: itemsCreateCustomRequestSchema,
    responseSchema: itemsCreateCustomResponseSchema,
  },
  'items.compare': {
    requestSchema: itemsCompareRequestSchema,
    responseSchema: itemsCompareResponseSchema,
  },
  'skills.getGroups': {
    requestSchema: skillsGetGroupsRequestSchema,
    responseSchema: skillsGetGroupsResponseSchema,
  },
  'config.getOptions': {
    requestSchema: configGetOptionsRequestSchema,
    responseSchema: configGetOptionsResponseSchema,
  },
  'tree.getData': {
    requestSchema: treeGetDataRequestSchema,
    responseSchema: treeGetDataResponseSchema,
  },
  'tree.previewAllocate': {
    requestSchema: treePreviewAllocateRequestSchema,
    responseSchema: treePreviewAllocateResponseSchema,
  },
  'tree.applyAllocate': {
    requestSchema: treeApplyAllocateRequestSchema,
    responseSchema: treeApplyAllocateResponseSchema,
  },
};

// ----------------------------------------------------------------------------
// Document schemas — standalone documents (not request/response method pairs)
// that travel as whole files. Registered alongside `schemaRegistry`, keyed by
// each schema's `$id`, so the host validator and tools can resolve them the
// same way they resolve method schemas.
// ----------------------------------------------------------------------------

/**
 * The diagnostic export bundle (DESIGN §10.9) lives here rather than in
 * `schemaRegistry` because it is a standalone document, not a Core API method.
 */
export const documentSchemaRegistry: Record<string, JSONSchema> = {
  [diagnosticExportSchema.$id]: diagnosticExportSchema,
};
