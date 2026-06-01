/**
 * @pob2/schema — the Core API IPC + BuildState contract.
 *
 * Single source of truth for:
 *   - TS types for the Core API request/response map (DESIGN §6.3),
 *   - the CoreError envelope (DESIGN §6.4),
 *   - BuildState and its sub-structures (DESIGN §12.1),
 *   - compiled JSON Schemas + a runtime `schemaRegistry` for the four MVP
 *     methods named in `tools/dev-workflow/phases.mjs` (build.load, build.save,
 *     calc.run, items.parseClipboard).
 *
 * Both the host validator and the contract tests import `schemaRegistry` so they
 * share one definition.
 */
export type {
  BuildId,
  Locale,
  BuildState,
  BuildMetadata,
  ItemSet,
  SkillSet,
  SkillGroup,
  GemInput,
  PassiveSpec,
  ConfigSet,
} from './build-state.js';

export { CORE_ERROR_CODES } from './errors.js';
export type { CoreError, CoreErrorCode } from './errors.js';

export type {
  CalcOptions,
  StatResult,
  ItemModInput,
  ItemLineStatus,
  ParsedItemMod,
  BuildPatch,
  BuildLoadRequest,
  BuildLoadResponse,
  BuildSaveRequest,
  BuildSaveResponse,
  CalcRunRequest,
  CalcRunResponse,
  ItemsParseClipboardRequest,
  ItemsParseClipboardResponse,
  CoreRequestMap,
  CoreResponseMap,
  CoreMethod,
  MvpMethod,
} from './core-api.js';

export { schemaRegistry, MVP_METHODS, coreErrorSchema } from './schemas/index.js';
export type { JSONSchema, SchemaEntry } from './schemas/index.js';
