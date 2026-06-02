// Passive Tree view-model test (task p5-tree-model; DESIGN §10.6 Passive Tree tab
// "node search / path preview / allocation delta preview", §11.2 Search index
// "titleKo/titleEn/aliasesKo/aliasesEn 토큰", §16.3 "search response 50ms 이하",
// §6.4 serialization "표시용 localized label" / "기계 판독용 stat id" 분리 +
// NO-FALLBACK).
//
// `tree-model.ts` is the pure, framework-free view-model layer the §10.6 renderer
// drives. It separates three concerns, each a pure function/structure tested here
// independently of the canvas/WebGL renderer:
//
//   (1) Bilingual node search index (§10.6 "한국어/영어 node name 검색", §11.2,
//       §16.3 <50ms). `buildNodeSearchIndex(docs)` tokenizes titleKo / titleEn /
//       aliasesKo / aliasesEn into an inverted prefix index; `index.search(q)`
//       returns the matching node docs (ko OR en OR alias resolves to one node,
//       per §10.1 "회피/evasion/ev" parity). A whitespace-only query returns [].
//
//   (2) Path preview over the allocated set (§10.6 "path preview"). Given the
//       render TreeGraph, the currently-allocated node id set, and a hovered
//       UNALLOCATED target, `previewPath(graph, allocated, targetId)` returns the
//       shortest sequence of NEWLY-allocated nodes (the target inclusive, the
//       already-allocated frontier exclusive) — a BFS over the undirected edge
//       graph from the allocated frontier. An unreachable / already-allocated /
//       unknown target returns null (NO-FALLBACK: never a fabricated partial path).
//
//   (3) Allocation delta view-model (§10.6 "allocation delta preview", §7.4
//       "passive allocation delta"). `buildAllocationDeltaModel(deltas, requested)`
//       turns a tree.previewAllocate `TreeStatDelta[]` into signed chips
//       { before, after, delta, direction } — a loss is a negative delta
//       (direction 'loss'), a real 0 stays a value (direction 'neutral'), and a
//       requested stat the core never returned is an explicit `missing` marker
//       (no fabricated 0 — DESIGN §6.4 NO-FALLBACK).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildTreeGraph,
  buildNodeSearchIndex,
  previewPath,
  buildAllocationDeltaModel,
} from '../src/index.js';
import type { RawTreeData, TreeGraph, NodeSearchDoc, NodeSearchIndex } from '../src/index.js';
import type { TreeStatDelta } from '@pob2/schema';

// ---------------------------------------------------------------------------
// Real fixture: the active 0_5 tree (4863 nodes) — for the <50ms search budget
// (§16.3) and the at-scale path walk. cwd = @pob2/ui package root.
// ---------------------------------------------------------------------------
const REAL_TREE = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../vendor/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json'),
    'utf8',
  ),
) as RawTreeData;

// ---------------------------------------------------------------------------
// Synthetic tree (same topology as tree-transform): a triangle n1-n2-n3, then a
// tail n3-n4-n5. We use it to pin the path-preview BFS exactly.
//   edges: {1,2},{1,3},{2,3},{3,4},{4,5}
// ---------------------------------------------------------------------------
const HALF_PI = Math.PI / 2;
const SYNTH: RawTreeData = {
  min_x: -1000,
  min_y: -1000,
  max_x: 1000,
  max_y: 1000,
  constants: {
    orbitRadii: [0, 100],
    skillsPerOrbit: [1, 4],
    orbitAnglesByOrbit: [
      [0, 2 * Math.PI],
      [0, HALF_PI, Math.PI, 3 * HALF_PI, 2 * Math.PI],
    ],
  },
  groups: [
    { nodes: [1, 2, 3], orbits: [0, 1], x: 0, y: 0 },
    { nodes: [4, 5], orbits: [1], x: 500, y: 500 },
  ],
  nodes: {
    '1': {
      skill: 1,
      name: 'Resolute Technique',
      group: 1,
      orbit: 0,
      orbitIndex: 0,
      isKeystone: true,
      stats: [],
      connections: [
        { id: 2, orbit: 0 },
        { id: 3, orbit: 0 },
      ],
    },
    '2': {
      skill: 2,
      name: 'Profane Bloom',
      group: 1,
      orbit: 1,
      orbitIndex: 0,
      isNotable: true,
      stats: [],
      connections: [{ id: 3, orbit: 0 }],
    },
    '3': {
      skill: 3,
      name: 'Evasion',
      group: 1,
      orbit: 1,
      orbitIndex: 1,
      stats: [],
      connections: [{ id: 4, orbit: 0 }],
    },
    '4': {
      skill: 4,
      name: 'Jewel Socket',
      group: 2,
      orbit: 1,
      orbitIndex: 2,
      isJewelSocket: true,
      stats: [],
      connections: [{ id: 5, orbit: 0 }],
    },
    '5': {
      skill: 5,
      name: 'Life Mastery',
      group: 2,
      orbit: 1,
      orbitIndex: 3,
      isMastery: true,
      stats: [],
      connections: [],
    },
  },
};

const SYNTH_GRAPH: TreeGraph = buildTreeGraph(SYNTH);

// ---------------------------------------------------------------------------
// (1) Bilingual node search index — §10.6 한/영 검색, §11.2, §16.3 <50ms
// ---------------------------------------------------------------------------
// Tokens are deliberately collision-controlled so each prefix query below resolves
// to a known doc set. The shared stem is "keystone": doc1 (Resolute Technique) and
// doc5 (Life Mastery) both alias it, so a "keystone" query is the documented
// two-doc multi-hit; no other prefix collides across docs.
const DOCS: NodeSearchDoc[] = [
  {
    nodeId: 1,
    titleKo: '확고한 기술',
    titleEn: 'Resolute Technique',
    aliasesKo: ['적중'],
    aliasesEn: ['RT', 'keystone'],
  },
  {
    nodeId: 3,
    titleKo: '회피',
    titleEn: 'Evasion',
    aliasesKo: ['회피도'],
    aliasesEn: ['ev', 'evade'],
  },
  {
    nodeId: 5,
    titleKo: '생명력 숙련',
    titleEn: 'Life Mastery',
    aliasesKo: [],
    aliasesEn: ['hp', 'keystone'],
  },
];

function ids(docs: NodeSearchDoc[]): number[] {
  return docs.map((d) => d.nodeId).sort((a, b) => a - b);
}

describe('buildNodeSearchIndex — bilingual node search (DESIGN §10.6, §11.2)', () => {
  const index: NodeSearchIndex = buildNodeSearchIndex(DOCS);

  it('finds a node by its English title (case-insensitive)', () => {
    expect(ids(index.search('evasion'))).toEqual([3]);
    expect(ids(index.search('EVASION'))).toEqual([3]);
  });

  it('finds the same node by its Korean title (§10.1 한/영 parity)', () => {
    expect(ids(index.search('회피'))).toEqual([3]);
  });

  it('finds a node by an English alias / short form (회피 / evasion / ev)', () => {
    // "ev" prefixes doc3's "ev"/"evade"/"Evasion" tokens only — no other doc.
    expect(ids(index.search('ev'))).toEqual([3]);
  });

  it('finds a node by a Korean alias', () => {
    expect(ids(index.search('회피도'))).toEqual([3]);
  });

  it('matches a token prefix, not only the whole token', () => {
    // "res" is a prefix of "Resolute"; "life" a prefix of nothing else but doc 5.
    expect(ids(index.search('res'))).toEqual([1]);
    expect(ids(index.search('life'))).toEqual([5]);
  });

  it('returns every doc that shares a query token (multi-hit query)', () => {
    // "keystone" is aliased by doc1 (Resolute Technique) AND doc5 (Life Mastery);
    // one query resolves both, in ascending nodeId order.
    expect(ids(index.search('keystone'))).toEqual([1, 5]);
  });

  it('returns [] for a whitespace-only or empty query (no full-tree dump)', () => {
    expect(index.search('   ')).toEqual([]);
    expect(index.search('')).toEqual([]);
  });

  it('returns [] for a query that matches no token', () => {
    expect(index.search('zzzznotathing')).toEqual([]);
  });

  it('never returns the same node twice when several of its tokens match', () => {
    // "evasion" matches doc3 titleEn ("Evasion") AND its titleKo->no, but its own
    // multiple tokens never duplicate it — exactly one hit for doc3.
    const r = index.search('evasion');
    const seen = new Set(r.map((d) => d.nodeId));
    expect(seen.size).toBe(r.length);
    expect(ids(r)).toEqual([3]);
  });

  it('searches the real 4863-node tree within the §16.3 <50ms budget', () => {
    const docs: NodeSearchDoc[] = Object.values(REAL_TREE.nodes).map((n) => ({
      nodeId: n.skill,
      titleKo: n.name, // no ko mapping in the raw fixture; en stands in for both
      titleEn: n.name,
      aliasesKo: [],
      aliasesEn: [],
    }));
    const realIndex = buildNodeSearchIndex(docs);
    const start = performance.now();
    for (let i = 0; i < 20; i += 1) realIndex.search('evasion');
    const perQuery = (performance.now() - start) / 20;
    expect(perQuery).toBeLessThan(50);
    expect(realIndex.search('evasion').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// (2) Path preview over the allocated set — §10.6 "path preview"
// ---------------------------------------------------------------------------
describe('previewPath — shortest new-node path to a hovered node (DESIGN §10.6)', () => {
  it('returns the shortest newly-allocated node sequence ending at the target', () => {
    // allocated {1}. Hover 4. Shortest reach: 1 -[edge]-> 3 -> 4 (1 is allocated,
    // excluded). new nodes = [3, 4], in walk order, target last.
    const path = previewPath(SYNTH_GRAPH, new Set([1]), 4);
    expect(path).not.toBeNull();
    expect(path!.map((n) => n.nodeId)).toEqual([3, 4]);
  });

  it('excludes the already-allocated frontier from the returned path', () => {
    const path = previewPath(SYNTH_GRAPH, new Set([1, 3]), 4)!;
    // 3 already allocated; only 4 is newly added.
    expect(path.map((n) => n.nodeId)).toEqual([4]);
  });

  it('picks the shorter of two routes through the graph', () => {
    // allocated {2}. Hover 3. 2-3 is a direct edge (len 1) vs 2-1-3 (len 2).
    const path = previewPath(SYNTH_GRAPH, new Set([2]), 3)!;
    expect(path.map((n) => n.nodeId)).toEqual([3]);
  });

  it('walks a multi-hop chain in order (target last)', () => {
    const path = previewPath(SYNTH_GRAPH, new Set([1]), 5)!;
    expect(path.map((n) => n.nodeId)).toEqual([3, 4, 5]);
  });

  it('returns null when the target is already allocated (nothing to preview)', () => {
    expect(previewPath(SYNTH_GRAPH, new Set([1, 3]), 3)).toBeNull();
  });

  it('returns null for an unknown target id (NO-FALLBACK, never a partial path)', () => {
    expect(previewPath(SYNTH_GRAPH, new Set([1]), 999)).toBeNull();
  });

  it('returns null when no node is allocated yet (no frontier to grow from)', () => {
    expect(previewPath(SYNTH_GRAPH, new Set(), 4)).toBeNull();
  });

  it('returns null when the target is unreachable from the allocated set', () => {
    // Build a disconnected variant: drop the 3-4 edge so {4,5} is its own island.
    const disjoint: RawTreeData = {
      ...SYNTH,
      nodes: {
        ...SYNTH.nodes,
        '3': { ...SYNTH.nodes['3']!, connections: [] },
      },
    };
    const g = buildTreeGraph(disjoint);
    expect(previewPath(g, new Set([1]), 5)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) Allocation delta view-model — §10.6 allocation delta preview, §7.4
// ---------------------------------------------------------------------------
const DELTAS: TreeStatDelta[] = [
  { statId: 'TotalDPS', before: 100, after: 142, delta: 42 },
  { statId: 'TotalEHP', before: 1000, after: 940, delta: -60 },
  { statId: 'Armour', before: 200, after: 200, delta: 0 },
];

function chip(model: ReturnType<typeof buildAllocationDeltaModel>, statId: string) {
  const c = model.chips.find((x) => x.statId === statId);
  if (!c) throw new Error(`chip ${statId} missing`);
  return c;
}

describe('buildAllocationDeltaModel — signed allocation delta (DESIGN §10.6, §7.4)', () => {
  it('carries the raw before/after/delta numbers verbatim', () => {
    const model = buildAllocationDeltaModel(DELTAS, undefined);
    const dps = chip(model, 'TotalDPS');
    expect(dps.before).toBe(100);
    expect(dps.after).toBe(142);
    expect(dps.delta).toBe(42);
  });

  it('signs a loss as a negative delta (direction loss), not absolute value', () => {
    const ehp = chip(buildAllocationDeltaModel(DELTAS, undefined), 'TotalEHP');
    expect(ehp.delta).toBe(-60); // signed: a loss is negative, never abs()'d
    expect(ehp.direction).toBe('loss');
  });

  it('classifies a gain (positive delta) as direction gain', () => {
    expect(chip(buildAllocationDeltaModel(DELTAS, undefined), 'TotalDPS').direction).toBe('gain');
  });

  it('keeps a real 0 delta as a neutral value (NOT dropped, NOT missing)', () => {
    const armour = chip(buildAllocationDeltaModel(DELTAS, undefined), 'Armour');
    expect(armour.delta).toBe(0);
    expect(armour.direction).toBe('neutral');
    expect(armour.missing).toBeUndefined();
  });

  it('marks a requested stat the core did NOT return as missing (no fake 0)', () => {
    const model = buildAllocationDeltaModel(DELTAS, ['TotalDPS', 'CritChance']);
    const crit = chip(model, 'CritChance');
    expect(crit.missing).toBe(true);
    expect(crit.direction).toBe('missing');
    expect(crit.before).toBeUndefined();
    expect(crit.after).toBeUndefined();
    expect(crit.delta).toBeUndefined();
  });

  it('does not mark a requested stat that WAS returned as missing', () => {
    const dps = chip(buildAllocationDeltaModel(DELTAS, ['TotalDPS']), 'TotalDPS');
    expect(dps.missing).toBeUndefined();
    expect(dps.delta).toBe(42);
  });

  it('orders requested-but-missing chips after the returned ones', () => {
    const model = buildAllocationDeltaModel(DELTAS, ['CritChance']);
    const last = model.chips[model.chips.length - 1]!;
    expect(last.statId).toBe('CritChance');
    expect(last.missing).toBe(true);
  });

  it('without a requested set, emits exactly the returned deltas (no synthesis)', () => {
    const model = buildAllocationDeltaModel(DELTAS, undefined);
    expect(model.chips.map((c) => c.statId)).toEqual(['TotalDPS', 'TotalEHP', 'Armour']);
    expect(model.chips.every((c) => c.missing === undefined)).toBe(true);
  });
});
