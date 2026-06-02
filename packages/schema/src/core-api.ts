/**
 * Core API request/response contract — DESIGN.md §6.3 (request map) and §6.4
 * (serialization / error principles).
 *
 * Scope: the MVP methods named in `tools/dev-workflow/phases.mjs` — `build.load`,
 * `build.save`, `calc.run`, `items.parseClipboard` (+ the items.* expansion) —
 * plus the Phase 4 read methods `skills.getGroups`, `config.getOptions`, and
 * `calc.explain` are fully typed (request + response) and backed by a JSON Schema
 * in `./schemas`. The remaining §6.3 methods (incl. the `skills.setGemGroup` /
 * `config.setOption` write companions) are present as request-only TYPE STUBS so
 * the surface is documented and `CoreRequestMap` is complete; their responses and
 * schemas are deferred to later phases.
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

/** Attribute/level requirements of an item card (mirrors the Lua serializer). */
export interface ItemRequirements {
  level: number;
  str: number;
  dex: number;
  int: number;
}

/**
 * A serialized equipped-item card (DESIGN §6.3 items.*, §6.4). This is the PLAIN
 * shape `modern_api items.getEquipped` produces per occupied slot — no live core
 * table leaks. `summaryMods` holds the recognised mod lines; `unsupportedMods`
 * holds lines the parser could not recognise, kept separate (DESIGN §8.6).
 */
export interface EquippedItem {
  /** Equipment slot name, e.g. "Weapon 1", "Body Armour". */
  slot: string;
  /** Build-local item id. */
  itemId: string;
  name: string;
  rarity: string;
  baseName: string;
  requirements: ItemRequirements;
  /** Recognised mod lines, human-readable. */
  summaryMods: string[];
  /** Lines the mod parser could not recognise (DESIGN §8.6). */
  unsupportedMods: string[];
}

/**
 * One stat's before/after change from an equip comparison (DESIGN §6.3
 * items.compare, §16.3 "item equip delta"). `delta === after - before`.
 */
export interface EquipDelta {
  /** Machine-readable upstream stat id (DESIGN §6.4). */
  statId: string;
  before: number;
  after: number;
  delta: number;
}

/**
 * One gem slotted into a socket group, serialized for the Skills tab card
 * (DESIGN §6.3 skills.getGroups, §10.5). Mirrors the core's `gemInstance`
 * (gemId / nameSpec / level / quality / enabled) flattened to scalars — no live
 * core gem table leaks (DESIGN §6.4).
 */
export interface SkillGemRef {
  /** Internal gem id (core `gemInstance.gemId`). */
  gemId: string;
  /** Display name (core `gemInstance.nameSpec`). */
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
}

/**
 * One socket group serialized for the Skills tab (DESIGN §6.3 skills.getGroups,
 * §10.5). Built from the core's `skillsTab.socketGroupList`: `enabled` is the
 * group toggle; `spirit`/`reservation` surface the §10.5 "reservation과 spirit
 * cost를 즉시 표시" values; active vs support gems are split into two lists.
 */
export interface SkillGroupCard {
  /** Build-local socket-group id. */
  groupId: string;
  /** Display label (group/active-gem name). */
  label: string;
  enabled: boolean;
  /** Spirit cost reserved by this group (DESIGN §10.5). */
  spirit: number;
  /** Mana/life reservation of this group (DESIGN §10.5). */
  reservation: number;
  /** Active (skill) gems in the group. */
  activeGems: SkillGemRef[];
  /** Support gems in the group. */
  supportGems: SkillGemRef[];
}

/**
 * One config option serialized for the Config tab (DESIGN §6.3
 * config.getOptions, §10.8). Built from the core's `ConfigOptions` list:
 * `optionId` is the option `var`, `type` is the control type (check/list/count/
 * ...), `value` is the current setting, and `dependentModifiers` lists the mods
 * the option's `apply` wires up (DESIGN §10.8 "각 config option은 dependent
 * modifier와 연결").
 */
export interface ConfigOptionCard {
  /** Option id (core option `var`). */
  optionId: string;
  /** Control type, e.g. "check" | "list" | "count". */
  type: string;
  /** Display label, localized for the requested locale (DESIGN §6.4). */
  label: string;
  /** Current value (boolean for check, string/number for list/count). */
  value: unknown;
  /** Modifier ids this option feeds when set (DESIGN §10.8). */
  dependentModifiers: string[];
}

/** Origin of one contribution in a calc.explain trace (DESIGN §10.7 source list). */
export type ExplainSourceKind = 'item' | 'passive' | 'skillGem' | 'supportGem' | 'config' | 'buff';

/**
 * One contribution to a stat's final value (DESIGN §10.7 "기여 source list").
 * `kind` classifies the origin; `value` is that source's signed contribution.
 */
export interface ExplainSource {
  kind: ExplainSourceKind;
  /** Display label of the contributing source (item/passive/gem/config/buff). */
  label: string;
  value: number;
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

export interface ItemsGetEquippedRequest {
  buildId: BuildId;
}

export interface ItemsCreateCustomRequest {
  baseId: string;
  mods: ItemModInput[];
}

export interface ItemsCompareRequest {
  buildId: BuildId;
  itemId: string;
  slot: string;
}

export interface SkillsGetGroupsRequest {
  buildId: BuildId;
}

export interface ConfigGetOptionsRequest {
  buildId: BuildId;
}

export interface CalcExplainRequest {
  buildId: BuildId;
  /** Machine-readable stat id to explain (DESIGN §10.7 "upstream raw stat id"). */
  statId: string;
  /** Restrict the explanation to one active skill, by its build-local id. */
  activeSkillId?: string;
}

/** Replace a socket group's gem list (DESIGN §6.3 skills.setGemGroup, §10.5). */
export interface SkillsSetGemGroupRequest {
  buildId: BuildId;
  groupId: string;
  gems: GemInput[];
}

/** Set a single config option's value (DESIGN §6.3 config.setOption, §10.8). */
export interface ConfigSetOptionRequest {
  buildId: BuildId;
  optionId: string;
  value: unknown;
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

/** One item card per occupied equipped slot (DESIGN §6.3 items.getEquipped). */
export interface ItemsGetEquippedResponse {
  equipped: EquippedItem[];
}

/** The created custom item plus its serialized card (DESIGN §6.3 items.createCustom). */
export interface ItemsCreateCustomResponse {
  itemId: string;
  item: EquippedItem;
}

/** Per-stat equip deltas for one slot (DESIGN §6.3 items.compare, §16.3). */
export interface ItemsCompareResponse {
  slot: string;
  deltas: EquipDelta[];
}

/** The build's socket-group cards (DESIGN §6.3 skills.getGroups, §10.5). */
export interface SkillsGetGroupsResponse {
  groups: SkillGroupCard[];
}

/** The build's config-option cards (DESIGN §6.3 config.getOptions, §10.8). */
export interface ConfigGetOptionsResponse {
  options: ConfigOptionCard[];
}

/**
 * The formula trace for one stat (DESIGN §6.3 calc.explain, §10.7 Calcs tab).
 * `finalValue` is the computed value; `sources` is the contribution list;
 * `formula` is the human-readable formula trace string; `upstreamStatId` is the
 * raw stat id the trace feeds from (DESIGN §10.7 "upstream raw stat id").
 */
export interface CalcExplainResponse {
  /** Machine-readable stat id this trace explains (DESIGN §6.4). */
  statId: string;
  finalValue: number;
  /** Display label, localized for the requested locale (DESIGN §6.4). */
  label: string;
  /** Per-source contributions (DESIGN §10.7 "기여 source list"). */
  sources: ExplainSource[];
  /** Human-readable formula trace string (DESIGN §10.7 "formula trace"). */
  formula: string;
  /** Upstream raw stat id this value derives from (DESIGN §10.7). */
  upstreamStatId: string;
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

  // --- calc (MVP: run, explain) ---
  'calc.run': CalcRunRequest;
  'calc.explain': CalcExplainRequest;

  // --- items (MVP: parseClipboard, getEquipped, createCustom, compare) ---
  'items.parseClipboard': ItemsParseClipboardRequest;
  'items.getEquipped': ItemsGetEquippedRequest;
  'items.createCustom': ItemsCreateCustomRequest;
  'items.compare': ItemsCompareRequest;

  // --- tree (deferred) ---
  'tree.previewAllocate': { buildId: BuildId; nodeIds: string[] };
  'tree.applyAllocate': { buildId: BuildId; nodeIds: string[] };

  // --- skills (MVP read: getGroups; setGemGroup is the write companion) ---
  'skills.getGroups': SkillsGetGroupsRequest;
  'skills.setGemGroup': SkillsSetGemGroupRequest;

  // --- config (MVP read: getOptions; setOption is the write companion) ---
  'config.getOptions': ConfigGetOptionsRequest;
  'config.setOption': ConfigSetOptionRequest;
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
  'calc.explain': CalcExplainResponse;
  'items.parseClipboard': ItemsParseClipboardResponse;
  'items.getEquipped': ItemsGetEquippedResponse;
  'items.createCustom': ItemsCreateCustomResponse;
  'items.compare': ItemsCompareResponse;
  'skills.getGroups': SkillsGetGroupsResponse;
  'config.getOptions': ConfigGetOptionsResponse;
}

/** The MVP method names, as a literal union. */
export type MvpMethod = keyof CoreResponseMap;

/** Any method name in the §6.3 request map. */
export type CoreMethod = keyof CoreRequestMap;
