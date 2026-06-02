/**
 * Skills tab view-model — DESIGN §10.5 Skills tab. A pure, framework-free
 * transform that turns the `skills.getGroups` response into card-unit skill-group
 * models, plus the pure builders that construct the `GemInput[]` payload for
 * `skills.setGemGroup` (toggle / add / remove).
 *
 * Per §10.5 each socket group is one card: a group `enabled` toggle, the §10.5
 * spirit / reservation values, and a flat list of classified gem chips (active /
 * support / buff / aura / minion). The core's `skills.getGroups` already splits
 * active vs support gems, but the finer active-gem categories (buff / aura /
 * minion) are not on the wire `SkillGemRef`, so the view-model resolves them from
 * a supplied gem-category metadata map.
 *
 * NO-FALLBACK (DESIGN §6.4): a support gem is `support` by its group position; an
 * active gem is classified by its metadata entry, and an active gem with NO entry
 * becomes an explicit `unsupported` chip — never a guessed `active` (or any other)
 * default, never a blank. A real `0` (level / quality / spirit / reservation) is
 * preserved as a value, never coerced to missing.
 */
import type { GemInput, SkillGemRef, SkillGroupCard, SkillsGetGroupsResponse } from '@pob2/schema';

/**
 * The category of a gem chip on a §10.5 skill-group card. Support gems are
 * `support` by position; active gems resolve to one of the active categories via
 * metadata, or to `unsupported` when no metadata entry exists (NO-FALLBACK).
 */
export type GemChipCategory = 'active' | 'support' | 'buff' | 'aura' | 'minion' | 'unsupported';

/**
 * The active-gem categories a metadata entry may declare. Support is not here:
 * a support gem's chip is fixed by its group position, never looked up. An active
 * gem absent from the map is `unsupported`, never one of these by default.
 */
export type GemMetaCategory = 'active' | 'buff' | 'aura' | 'minion';

/** Gem-category metadata: active gem id → its declared category (DESIGN §8.3 skill). */
export type GemCategoryMeta = Readonly<Record<string, GemMetaCategory>>;

/** One classified gem chip on a §10.5 skill-group card. */
export interface SkillGemChip {
  gemId: string;
  name: string;
  level: number;
  quality: number;
  enabled: boolean;
  category: GemChipCategory;
}

/** One §10.5 skill-group card. */
export interface SkillGroupCardModel {
  groupId: string;
  label: string;
  /** The group toggle (DESIGN §10.5 enabled). */
  enabled: boolean;
  /** Spirit cost reserved by this group (DESIGN §10.5). */
  spirit: number;
  /** Mana/life reservation of this group (DESIGN §10.5). */
  reservation: number;
  /** Active chips first, then support chips, in group order. */
  chips: SkillGemChip[];
}

/** The Skills tab view-model: the §10.5 group cards, in response order. */
export interface SkillsViewModel {
  cards: SkillGroupCardModel[];
}

/** Resolve an active gem's chip category from metadata, or `unsupported`. */
function activeCategory(gemId: string, meta: GemCategoryMeta): GemChipCategory {
  return meta[gemId] ?? 'unsupported';
}

/** Build a classified chip for one gem at a known group position. */
function toChip(gem: SkillGemRef, category: GemChipCategory): SkillGemChip {
  return {
    gemId: gem.gemId,
    name: gem.name,
    level: gem.level,
    quality: gem.quality,
    enabled: gem.enabled,
    category,
  };
}

/** Build one §10.5 card from a socket group, classifying its gems into chips. */
function toCard(group: SkillGroupCard, meta: GemCategoryMeta): SkillGroupCardModel {
  const activeChips = group.activeGems.map((gem) => toChip(gem, activeCategory(gem.gemId, meta)));
  const supportChips = group.supportGems.map((gem) => toChip(gem, 'support'));
  return {
    groupId: group.groupId,
    label: group.label,
    enabled: group.enabled,
    spirit: group.spirit,
    reservation: group.reservation,
    chips: [...activeChips, ...supportChips],
  };
}

/**
 * Build the §10.5 skill-group cards from a `skills.getGroups` response.
 *
 * Each group yields one card, in response order. Support gems are classified
 * `support` by position; active gems are classified via `gemMeta`, and an active
 * gem with no metadata entry yields an explicit `unsupported` chip (NO-FALLBACK).
 */
export function buildSkillGroupsModel(
  response: SkillsGetGroupsResponse,
  gemMeta: GemCategoryMeta = {},
): SkillsViewModel {
  return { cards: response.groups.map((group) => toCard(group, gemMeta)) };
}

// ---------------------------------------------------------------------------
// GemInput builders — the skills.setGemGroup payload (DESIGN §6.3, §10.5)
// ---------------------------------------------------------------------------

/** Flatten a gem ref to the wire `GemInput` shape. */
function toGemInput(gem: SkillGemRef): GemInput {
  return { gemId: gem.gemId, level: gem.level, quality: gem.quality, enabled: gem.enabled };
}

/**
 * Build the `GemInput[]` payload for a group: active gems first, then support
 * gems, in group order — the starting point for toggle / add / remove edits.
 */
export function groupToGemInputs(group: SkillGroupCard): GemInput[] {
  return [...group.activeGems.map(toGemInput), ...group.supportGems.map(toGemInput)];
}

/**
 * Flip the `enabled` flag of one gem in a `GemInput[]` (DESIGN §10.5 enabled
 * toggle). Returns a new list; the input is never mutated. A gem id not in the
 * list is a no-op (the list is returned as a fresh copy).
 */
export function toggleGemEnabled(gems: GemInput[], gemId: string): GemInput[] {
  return gems.map((gem) => (gem.gemId === gemId ? { ...gem, enabled: !gem.enabled } : gem));
}

/**
 * Append a gem to a `GemInput[]` (DESIGN §10.5 add gem). Returns a new list; the
 * input is never mutated. A duplicate gem id is rejected — the list is returned
 * unchanged (a fresh copy), never appended twice.
 */
export function addGem(gems: GemInput[], gem: GemInput): GemInput[] {
  if (gems.some((g) => g.gemId === gem.gemId)) return [...gems];
  return [...gems, gem];
}

/**
 * Drop a gem from a `GemInput[]` by id (DESIGN §10.5 remove gem), preserving the
 * order of the rest. Returns a new list; the input is never mutated. A gem id not
 * in the list is a no-op (a fresh copy is returned).
 */
export function removeGem(gems: GemInput[], gemId: string): GemInput[] {
  return gems.filter((gem) => gem.gemId !== gemId);
}
