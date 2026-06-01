/**
 * BuildState and its sub-structures — DESIGN.md §12.1.
 *
 * This is the modern-JSON representation of a build that the UI holds and that
 * round-trips with upstream PoB XML / share codes (DESIGN §12.2-§12.3). Only the
 * top-level shape is fixed here; the nested set/spec payloads are intentionally
 * loose for the MVP and are tightened as the Items/Skills/Tree/Config tabs land
 * (DESIGN §18 phases 3-5).
 */

/** Locale tags the core and UI speak (DESIGN §6.3, §8.1). */
export type Locale = 'ko-KR' | 'en-US';

/** Opaque, stable identifier for an in-memory build (DESIGN §6.3). */
export type BuildId = string;

/** An equipment set: equipped items + the shared item library scope (DESIGN §10.4). */
export interface ItemSet {
  id: string;
  name: string;
  /** slot id (e.g. "Weapon 1", "Body Armour") → item id. */
  slots: Record<string, string>;
}

/** A set of skill gem groups (DESIGN §10.5). */
export interface SkillSet {
  id: string;
  name: string;
  groups: SkillGroup[];
}

export interface SkillGroup {
  id: string;
  label?: string;
  enabled: boolean;
  gems: GemInput[];
}

/** A gem slotted into a group (DESIGN §6.3 GemInput). */
export interface GemInput {
  gemId: string;
  level: number;
  quality: number;
  enabled: boolean;
}

/** A passive tree specification: tree version + allocated nodes (DESIGN §10.6). */
export interface PassiveSpec {
  id: string;
  name: string;
  /** upstream TreeData version, e.g. "0_5". */
  treeVersion: string;
  allocatedNodeIds: string[];
}

/** A named scenario of config options (DESIGN §10.8). */
export interface ConfigSet {
  id: string;
  name: string;
  options: Record<string, unknown>;
}

/**
 * The canonical modern build document (DESIGN §12.1).
 *
 * `schemaVersion` is pinned to `1` for the MVP; bumping it triggers a migration
 * (DESIGN §12.2 "Modern JSON … migration").
 */
export interface BuildState {
  schemaVersion: 1;
  id: BuildId;
  name: string;
  classId: string;
  ascendancyId?: string;
  level: number;
  banditOrQuestState?: Record<string, unknown>;

  itemSets: ItemSet[];
  skillSets: SkillSet[];
  passiveSpecs: PassiveSpec[];
  configSets: ConfigSet[];

  activeItemSetId: string;
  activeSkillSetId: string;
  activePassiveSpecId: string;
  activeConfigSetId: string;

  notes?: string;
  metadata: BuildMetadata;
}

export interface BuildMetadata {
  upstreamCommit: string;
  createdAt: string;
  updatedAt: string;
  locale: string;
}
