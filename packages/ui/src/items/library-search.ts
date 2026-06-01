/**
 * Item-library search / filter / sort — DESIGN §10.4 (item library search box +
 * slot/type/req filters), §10.1 + §11.2 (ko↔en parallel search: "회피 / evasion"
 * both resolve). A pure, framework-free transform: it takes the full library
 * (`LibraryItem[]`) and a filter query, and returns the matching subset, sorted.
 *
 * NO-FALLBACK (DESIGN §6.4): an empty query returns ALL items (the natural "no
 * filter" result), but a query that matches nothing returns `[]` — never a
 * silent fallback to the full list. The transform never mutates its input.
 */
import type { ItemRequirements } from '@pob2/schema';

/**
 * A library row. Carries the parallel ko/en name + base-type tokens the §10.1
 * bilingual search needs, plus the slot/type/requirements the §10.4 filters key
 * off. Structurally a superset of `EquippedItem`'s identity fields, declared
 * here because the library scope (build + shared stash) is a UI concept.
 */
export interface LibraryItem {
  itemId: string;
  name: string;
  /** Korean name, for ko↔en parallel search (DESIGN §10.1). */
  nameKo: string;
  baseType: string;
  /** Korean base type, for ko↔en parallel search. */
  baseTypeKo: string;
  /** Canonical equip-slot name (e.g. "Boots", "Weapon 1"). */
  slot: string;
  /** Item class / type (e.g. "Two Hand Sword", "Helmet"). */
  type: string;
  rarity: string;
  requirements: ItemRequirements;
}

/** The §10.4 library filter query. Every supplied field must hold (AND). */
export interface ItemFilterQuery {
  /** Free-text token, matched (case-insensitive substring) against ko+en
   *  name and base type (DESIGN §10.1 parallel search). */
  text?: string;
  /** Restrict to a single equip slot. */
  slot?: string;
  /** Restrict to a single item type. */
  type?: string;
  /** Keep only items whose level requirement is ≤ this (character can equip). */
  maxLevel?: number;
}

/** Sort order for the result list. `name` is the default. */
export type ItemSort = 'name' | 'level';

/** True when `needle` (already lowercased) is a substring of any haystack token. */
function textMatches(item: LibraryItem, needle: string): boolean {
  const haystacks = [item.name, item.nameKo, item.baseType, item.baseTypeKo];
  return haystacks.some((h) => h.toLowerCase().includes(needle));
}

/** Does one item satisfy every supplied filter field? */
function matches(item: LibraryItem, query: ItemFilterQuery): boolean {
  if (query.text !== undefined && query.text.length > 0) {
    if (!textMatches(item, query.text.toLowerCase())) return false;
  }
  if (query.slot !== undefined && item.slot !== query.slot) return false;
  if (query.type !== undefined && item.type !== query.type) return false;
  if (query.maxLevel !== undefined && item.requirements.level > query.maxLevel) return false;
  return true;
}

/** Comparator for the chosen sort, with a stable English-name tiebreak. */
function comparator(sort: ItemSort): (a: LibraryItem, b: LibraryItem) => number {
  const byName = (a: LibraryItem, b: LibraryItem) => a.name.localeCompare(b.name);
  if (sort === 'level') {
    return (a, b) => a.requirements.level - b.requirements.level || byName(a, b);
  }
  return byName;
}

/**
 * Filter the library by `query`, then sort by `sort` (default `name`). Pure:
 * the input array is not mutated; the result is a fresh array. An empty query
 * keeps every item; a query that matches nothing returns `[]` (no fallback).
 */
export function filterItems(
  items: LibraryItem[],
  query: ItemFilterQuery,
  sort: ItemSort = 'name',
): LibraryItem[] {
  return items.filter((item) => matches(item, query)).sort(comparator(sort));
}
