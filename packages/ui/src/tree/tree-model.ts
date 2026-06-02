/**
 * Passive Tree view-model — DESIGN §10.6 Passive Tree tab ("node search / path
 * preview / allocation delta preview"), §11.2 Search index, §16.3 ("search
 * response 50ms 이하"), §7.4 ("passive allocation delta"), §6.4 serialization +
 * NO-FALLBACK. Pure, framework-free logic the §10.6 canvas/WebGL renderer drives;
 * separated from the renderer so it is unit-tested in isolation. Three concerns:
 *
 *   (1) {@link buildNodeSearchIndex} — the bilingual (한/영) node search index.
 *   (2) {@link previewPath} — the shortest new-node path to a hovered node.
 *   (3) {@link buildAllocationDeltaModel} — the signed allocation-delta chips.
 */
import type { TreeStatDelta } from '@pob2/schema';
import type { TreeGraph, TreeGraphNode } from './tree-transform.js';

// ===========================================================================
// (1) Bilingual node search index (DESIGN §10.6 한/영 검색, §11.2, §16.3 <50ms)
// ===========================================================================

/**
 * One searchable node document (DESIGN §11.2 SearchDocument, scoped to the tree).
 * `titleKo`/`titleEn` are the localized + English display names; `aliasesKo`/
 * `aliasesEn` are the bilingual synonym + short-form tokens (§10.1 "회피 / evasion
 * / ev" parity). Every field feeds the same token index.
 */
export interface NodeSearchDoc {
  /** Numeric tree-node id (matches `TreeGraphNode.nodeId`). */
  nodeId: number;
  /** Korean display title (§11.2 titleKo). */
  titleKo: string;
  /** English display title (§11.2 titleEn). */
  titleEn: string;
  /** Korean synonym tokens (§11.2 aliasesKo). */
  aliasesKo: string[];
  /** English synonym / short-form tokens (§11.2 aliasesEn). */
  aliasesEn: string[];
}

/**
 * A queryable bilingual node search index (DESIGN §11.2). `search(query)` returns
 * every node doc one of whose tokens the (folded) query is a PREFIX of, each doc
 * at most once, in ascending `nodeId` order. A whitespace-only/empty query returns
 * `[]` (no full-tree dump). Backed by an inverted prefix index, so a query touches
 * only the buckets it actually hits — the §16.3 <50ms search-response budget.
 */
export interface NodeSearchIndex {
  search(query: string): NodeSearchDoc[];
}

/** Case-fold for comparison. Korean is unaffected by `toLowerCase`. */
function fold(s: string): string {
  return s.toLowerCase();
}

/**
 * Split one field value into folded word tokens (whitespace-delimited, punctuation
 * stripped to spaces). Empty tokens are dropped.
 */
function tokenize(value: string): string[] {
  return fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

/** Every searchable token of a doc: both titles + every alias, tokenized. */
function docTokens(doc: NodeSearchDoc): string[] {
  const out: string[] = [];
  for (const field of [doc.titleKo, doc.titleEn, ...doc.aliasesKo, ...doc.aliasesEn]) {
    out.push(...tokenize(field));
  }
  return out;
}

/**
 * Build the bilingual node search index (DESIGN §11.2, §16.3). For each token of
 * each doc, register every prefix of that token → the doc's index, so a query
 * resolves by a single map lookup (the §16.3 <50ms budget) instead of an O(nodes)
 * scan. A doc is deduplicated per query via a seen-set, then results are returned
 * in ascending `nodeId` order.
 */
export function buildNodeSearchIndex(docs: NodeSearchDoc[]): NodeSearchIndex {
  // prefix (folded) → set of doc indices whose token has that prefix.
  const prefixIndex = new Map<string, Set<number>>();

  docs.forEach((doc, docIdx) => {
    for (const token of docTokens(doc)) {
      for (let end = 1; end <= token.length; end += 1) {
        const prefix = token.slice(0, end);
        let bucket = prefixIndex.get(prefix);
        if (!bucket) {
          bucket = new Set<number>();
          prefixIndex.set(prefix, bucket);
        }
        bucket.add(docIdx);
      }
    }
  });

  function search(query: string): NodeSearchDoc[] {
    const q = fold(query.trim());
    if (q === '') return [];
    const bucket = prefixIndex.get(q);
    if (!bucket) return [];
    return [...bucket].map((i) => docs[i]!).sort((a, b) => a.nodeId - b.nodeId);
  }

  return { search };
}

// ===========================================================================
// (2) Path preview over the allocated set (DESIGN §10.6 "path preview")
// ===========================================================================

/** Build a nodeId → neighbour-ids adjacency map from the graph's edge list. */
function adjacency(graph: TreeGraph): Map<number, number[]> {
  const adj = new Map<number, number[]>();
  const push = (from: number, to: number): void => {
    let list = adj.get(from);
    if (!list) {
      list = [];
      adj.set(from, list);
    }
    list.push(to);
  };
  for (const edge of graph.edges) {
    push(edge.a, edge.b);
    push(edge.b, edge.a);
  }
  return adj;
}

/**
 * Compute the shortest sequence of NEWLY-allocated nodes that reaches a hovered
 * unallocated `targetId` (DESIGN §10.6 "path preview"). A breadth-first walk over
 * the undirected edge graph starting from the whole already-`allocated` frontier;
 * the returned path lists only the new nodes (the already-allocated start nodes
 * excluded, the `target` last). Returns `null` when there is nothing to preview —
 * an unknown / already-allocated / unreachable target, or an empty `allocated`
 * frontier (NO-FALLBACK: never a fabricated partial path).
 */
export function previewPath(
  graph: TreeGraph,
  allocated: Set<number>,
  targetId: number,
): TreeGraphNode[] | null {
  if (!graph.nodeIndex[targetId]) return null; // unknown target
  if (allocated.has(targetId)) return null; // nothing to preview
  if (allocated.size === 0) return null; // no frontier to grow from

  const adj = adjacency(graph);
  // Multi-source BFS from every allocated node; `prev` reconstructs the path.
  const prev = new Map<number, number>();
  const visited = new Set<number>(allocated);
  let frontier = [...allocated];

  while (frontier.length > 0) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const neighbour of adj.get(id) ?? []) {
        if (visited.has(neighbour)) continue;
        visited.add(neighbour);
        prev.set(neighbour, id);
        if (neighbour === targetId) {
          // Reconstruct, dropping the allocated start node.
          const path: TreeGraphNode[] = [];
          let cur: number | undefined = targetId;
          while (cur !== undefined && !allocated.has(cur)) {
            path.push(graph.nodeIndex[cur]!);
            cur = prev.get(cur);
          }
          path.reverse();
          return path;
        }
        next.push(neighbour);
      }
    }
    frontier = next;
  }

  return null; // unreachable
}

// ===========================================================================
// (3) Allocation delta view-model (DESIGN §10.6 allocation delta preview, §7.4)
// ===========================================================================

/** Which way a stat moved when allocating the previewed node set (DESIGN §7.4). */
export type AllocationDeltaDirection = 'gain' | 'loss' | 'neutral' | 'missing';

/**
 * One allocation-delta chip. Either the core returned this stat's before/after
 * (`missing` absent, all three numbers present) or it did not (`missing: true`,
 * `direction: 'missing'`, numbers undefined). Discriminated on `missing` so an
 * absent stat can never be read as a `0` delta (DESIGN §6.4 NO-FALLBACK). A loss
 * is a signed negative `delta`, never an absolute value.
 */
export interface AllocationDeltaChip {
  /** Machine-readable upstream stat id (DESIGN §6.4). */
  statId: string;
  direction: AllocationDeltaDirection;
  before?: number;
  after?: number;
  delta?: number;
  missing?: true;
}

/** The allocation-delta model: the §10.6 chips, returned-then-missing in order. */
export interface AllocationDeltaModel {
  chips: AllocationDeltaChip[];
}

/** Classify a real (present) signed delta. A `0` delta is `neutral`, not absent. */
function directionOf(delta: number): AllocationDeltaDirection {
  if (delta > 0) return 'gain';
  if (delta < 0) return 'loss';
  return 'neutral';
}

/**
 * Build the §10.6 allocation-delta chips from a `tree.previewAllocate`
 * `TreeStatDelta[]` (DESIGN §7.4). Each returned delta becomes a signed chip — a
 * loss stays a negative `delta` (direction 'loss'), a real `0` stays a value
 * (direction 'neutral'). `requestedStatIds`, when given, names the stats a panel
 * wants to show: any of those the core did NOT return is appended as an explicit
 * `missing` chip AFTER the returned ones, so the UI shows a missing marker rather
 * than a fabricated `0` (DESIGN §6.4 NO-FALLBACK).
 */
export function buildAllocationDeltaModel(
  deltas: TreeStatDelta[],
  requestedStatIds: string[] | undefined,
): AllocationDeltaModel {
  const returned = new Set(deltas.map((d) => d.statId));

  const chips: AllocationDeltaChip[] = deltas.map((d) => ({
    statId: d.statId,
    direction: directionOf(d.delta),
    before: d.before,
    after: d.after,
    delta: d.delta,
  }));

  for (const statId of requestedStatIds ?? []) {
    if (returned.has(statId)) continue;
    chips.push({ statId, direction: 'missing', missing: true });
  }

  return { chips };
}
