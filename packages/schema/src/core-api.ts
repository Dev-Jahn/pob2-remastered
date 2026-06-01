/**
 * Core API request/response contract — DESIGN.md §6.3 (request map) and §6.4
 * (serialization / error principles).
 *
 * Scope (per task `schema-types`): the four MVP methods named in
 * `tools/dev-workflow/phases.mjs` — `build.load`, `build.save`, `calc.run`,
 * `items.parseClipboard` — are fully typed (request + response) and backed by a
 * JSON Schema in `./schemas`. The remaining §6.3 methods are present as
 * request-only TYPE STUBS so the surface is documented and `CoreRequestMap` is
 * complete; their responses and schemas are deferred to later phases.
 */
import type { BuildId, BuildState, GemInput, Locale } from './build-state.js';

// ----------------------------------------------------------------------------
// Shared payload fragments
// ----------------------------------------------------------------------------

/** Options passed to a calculation pass (DESIGN §6.3 CalcOptions). */
export interface CalcOptions {
  /** Restrict the pass to a single active skill, by its build-local id. */
  activeSkillId?: string;
  /** Config set to evaluate under; defaults to the build's active config set. */
  configSetId?: string;
}

/** A single computed stat result (DESIGN §6.4: localized label vs machine id). */
export interface StatResult {
  /** Machine-readable upstream stat id (DESIGN §6.4 "기계 판독용 stat id"). */
  statId: string;
  value: number;
  /** Display label, localized for the requested locale (DESIGN §6.4). */
  label: string;
}

/** A parsed-but-typed item mod input (DESIGN §6.3 ItemModInput). */
export interface ItemModInput {
  text: string;
  statId?: string;
}

/** Parse outcome for a single clipboard line (DESIGN §8.6, §10.4). */
export type ItemLineStatus = 'parsed' | 'unsupported' | 'unknown';

export interface ParsedItemMod {
  /** Original source line, always preserved (DESIGN §8.6 step 4). */
  raw: string;
  status: ItemLineStatus;
  /** Internal mod/stat id when the line was matched. */
  statId?: string;
}

// ----------------------------------------------------------------------------
// MVP request payloads
// ----------------------------------------------------------------------------

export interface BuildLoadRequest {
  /** Source build document: upstream PoB XML or a share code (DESIGN §12.2). */
  source: string;
  format: 'xml' | 'shareCode';
}

export interface BuildSaveRequest {
  buildId: BuildId;
  format: 'xml' | 'shareCode';
}

export interface CalcRunRequest {
  buildId: BuildId;
  options?: CalcOptions;
}

export interface ItemsParseClipboardRequest {
  text: string;
  localeHint?: Locale;
}

// ----------------------------------------------------------------------------
// MVP response payloads
// ----------------------------------------------------------------------------

export interface BuildLoadResponse {
  buildId: BuildId;
  state: BuildState;
}

export interface BuildSaveResponse {
  format: 'xml' | 'shareCode';
  data: string;
}

export interface CalcRunResponse {
  buildId: BuildId;
  /** Map of stat id → computed result (DESIGN §6.4, §10.7). */
  stats: StatResult[];
}

export interface ItemsParseClipboardResponse {
  /** Detected (or hinted) source locale (DESIGN §8.6 step 1). */
  locale: Locale;
  /** Resolved item base id, when recognised. */
  baseId?: string;
  rarity?: string;
  name?: string;
  mods: ParsedItemMod[];
  /** Lines that could not be parsed (DESIGN §8.6 step 4). */
  unsupported: string[];
}

// ----------------------------------------------------------------------------
// Full §6.3 request map (MVP methods typed; rest are type-only stubs)
// ----------------------------------------------------------------------------

/** Type-only stub payloads for non-MVP §6.3 methods (deferred). */
export interface BuildPatch {
  op: string;
  path: string;
  value?: unknown;
}

export interface CoreRequestMap {
  // --- core ---
  'core.version': Record<string, never>;

  // --- build (MVP: load/save) ---
  'build.new': { classId?: string; ascendancyId?: string };
  'build.load': BuildLoadRequest;
  'build.save': BuildSaveRequest;
  'build.loadXml': { xml: string };
  'build.loadShareCode': { code: string };
  'build.exportXml': { buildId: BuildId };
  'build.exportShareCode': { buildId: BuildId };
  'build.getState': { buildId: BuildId };
  'build.applyPatch': { buildId: BuildId; patch: BuildPatch[] };

  // --- calc (MVP: run) ---
  'calc.run': CalcRunRequest;
  'calc.explain': { buildId: BuildId; statId: string; activeSkillId?: string };

  // --- items (MVP: parseClipboard) ---
  'items.parseClipboard': ItemsParseClipboardRequest;
  'items.createCustom': { baseId: string; mods: ItemModInput[] };
  'items.compare': { buildId: BuildId; itemId: string; slot: string };

  // --- tree (deferred) ---
  'tree.previewAllocate': { buildId: BuildId; nodeIds: string[] };
  'tree.applyAllocate': { buildId: BuildId; nodeIds: string[] };

  // --- skills / config (deferred) ---
  'skills.setGemGroup': { buildId: BuildId; groupId: string; gems: GemInput[] };
  'config.setOption': { buildId: BuildId; optionId: string; value: unknown };
}

/**
 * Response map for the MVP methods (DESIGN §6.4: every response is fixed by both
 * a TS type and a JSON Schema). Non-MVP methods are deliberately absent until
 * their schemas land.
 */
export interface CoreResponseMap {
  'build.load': BuildLoadResponse;
  'build.save': BuildSaveResponse;
  'calc.run': CalcRunResponse;
  'items.parseClipboard': ItemsParseClipboardResponse;
}

/** The MVP method names, as a literal union. */
export type MvpMethod = keyof CoreResponseMap;

/** Any method name in the §6.3 request map. */
export type CoreMethod = keyof CoreRequestMap;
