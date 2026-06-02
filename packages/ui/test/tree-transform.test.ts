// TreeData transform test (task p5-tree-transform; DESIGN §10.6 Passive Tree tab
// "렌더러는 UI 전용 data transform layer에서 JSON graph로 변환", §16.3 "대규모
// redraw는 viewport culling 적용", §6.4 serialization "표시용 localized label" /
// "기계 판독용 stat id" 분리).
//
// `buildTreeGraph(treeData)` turns the upstream `src/TreeData/<ver>/tree.json`
// core graph into the render-ready normalized JSON graph the §10.6 canvas/WebGL
// renderer consumes:
//
//   (1) Absolute node coordinates. The upstream node carries only its group +
//       (orbit, orbitIndex). The transform applies the canonical PoB position
//       formula (PassiveTree.lua:526-529):
//           angle  = orbitAnglesByOrbit[orbit][orbitIndex]   (radians)
//           radius = orbitRadii[orbit]
//           x = group.x + sin(angle) * radius
//           y = group.y - cos(angle) * radius
//       group is a 1-based index into the `groups` array (node.group=1030 →
//       groups[1029]).
//   (2) Deduplicated undirected edge list. Each node lists its `connections`;
//       the transform emits one edge per unordered node pair (min,max), never
//       twice, and drops self/dangling edges (NO-FALLBACK: an edge to a missing
//       node is dropped, never faked).
//   (3) Node classification — notable / keystone / mastery / small / jewel-socket
//       — in upstream priority (jewel-socket → keystone → notable → mastery →
//       small) so an overlapping flag resolves deterministically.
//   (4) min/max bounds + a numeric nodeId → node lookup index, the inputs the
//       §16.3 viewport culling and the §10.6 path-preview walk read.
//   (5) §6.4 label split: `label` is the display name (localized); `statId` is the
//       machine-readable node id; raw `stats` lines are carried as machine data,
//       never merged into the label.
//
// The synthetic fixture pins the exact coordinate math, dedup, classification and
// bounds; the real 4863-node 0_5 tree.json fixture validates the transform at
// scale (node count, every edge endpoint resolvable, every node classified).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTreeGraph } from '../src/index.js';
import type { RawTreeData, TreeGraph, TreeNodeKind } from '../src/index.js';

// ---------------------------------------------------------------------------
// Real fixture: the active 0_5 tree (4863 nodes) — loaded from vendor upstream.
// vitest runs with cwd = the @pob2/ui package root (see vitest.config.ts).
// ---------------------------------------------------------------------------
const REAL_TREE = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../vendor/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json'),
    'utf8',
  ),
) as RawTreeData;

// ---------------------------------------------------------------------------
// Synthetic fixture: a tiny, hand-checkable tree that pins the exact math.
//
// orbitRadii = [0, 100], skillsPerOrbit = [1, 4]; orbitAnglesByOrbit row 1 is
// [0, π/2, π, 3π/2, 2π] (4 cardinal slots + the closing duplicate of 0).
// Two groups at known coords. Node coords (group.x + sin·r, group.y − cos·r):
//   n1 orbit 0 idx 0 @ group A(0,0)      → (0, 0)            keystone
//   n2 orbit 1 idx 0 @ group A(0,0)      → sin0·100, −cos0·100 = (0, -100)   notable
//   n3 orbit 1 idx 1 @ group A(0,0)      → sin(π/2)·100, −cos(π/2)·100 = (100, 0) small
//   n4 orbit 1 idx 2 @ group B(500,500)  → sin(π)·100, −cos(π)·100 = (500, 600)  jewel
//   n5 orbit 1 idx 3 @ group B(500,500)  → sin(3π/2)·100, −cos(3π/2)·100 = (400, 500) mastery
// Connections (declared once each, plus one duplicate-direction to prove dedup):
//   n1↔n2, n2↔n3, n3↔n1 (triangle), n3↔n4, n4↔n5, and n2 also lists n1 (dup).
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
      stats: ['Your hits cannot be Evaded', 'Never deal Critical Hits'],
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
      stats: ['20% increased Area of Effect'],
      // includes a duplicate-direction edge back to node 1 to prove dedup.
      connections: [
        { id: 3, orbit: 0 },
        { id: 1, orbit: 0 },
      ],
    },
    '3': {
      skill: 3,
      name: 'Evasion',
      group: 1,
      orbit: 1,
      orbitIndex: 1,
      stats: ['8% increased Evasion Rating'],
      connections: [
        { id: 1, orbit: 0 },
        { id: 4, orbit: 0 },
      ],
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
      stats: ['+10 to maximum Life'],
      connections: [],
    },
  },
};

function nodeById(graph: TreeGraph, id: number) {
  const n = graph.nodeIndex[id];
  if (!n) throw new Error(`node ${id} missing from index`);
  return n;
}

function hasEdge(graph: TreeGraph, a: number, b: number): boolean {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  return graph.edges.some((e) => e.a === lo && e.b === hi);
}

describe('buildTreeGraph — orbit coordinate math (DESIGN §10.6 renderer input)', () => {
  it('places each node at group.x/y + orbit radius along its orbit angle', () => {
    const g = buildTreeGraph(SYNTH);
    // group A (0,0): orbit 0 sits dead centre; orbit-1 cardinal slots fan out.
    expect(nodeById(g, 1).x).toBeCloseTo(0, 6);
    expect(nodeById(g, 1).y).toBeCloseTo(0, 6);
    expect(nodeById(g, 2).x).toBeCloseTo(0, 6); // sin(0)*100
    expect(nodeById(g, 2).y).toBeCloseTo(-100, 6); // -cos(0)*100
    expect(nodeById(g, 3).x).toBeCloseTo(100, 6); // sin(π/2)*100
    expect(nodeById(g, 3).y).toBeCloseTo(0, 6); // -cos(π/2)*100
    // group B (500,500): orbit-1 slots offset from the group centre.
    expect(nodeById(g, 4).x).toBeCloseTo(500, 6); // 500 + sin(π)*100
    expect(nodeById(g, 4).y).toBeCloseTo(600, 6); // 500 - cos(π)*100
    expect(nodeById(g, 5).x).toBeCloseTo(400, 6); // 500 + sin(3π/2)*100
    expect(nodeById(g, 5).y).toBeCloseTo(500, 6); // 500 - cos(3π/2)*100
  });

  it('resolves the 1-based group index into the groups array', () => {
    // node.group is 1-based: a node in group 2 must read groups[1] (x=500), not
    // groups[2] (out of range). If the off-by-one were wrong, n4/n5 would land at
    // the origin or NaN.
    const g = buildTreeGraph(SYNTH);
    expect(Number.isFinite(nodeById(g, 4).x)).toBe(true);
    expect(nodeById(g, 4).x).toBeGreaterThan(0);
  });
});

describe('buildTreeGraph — edge dedup (DESIGN §10.6 connections → edge list)', () => {
  it('emits one undirected edge per node pair, deduping repeated directions', () => {
    const g = buildTreeGraph(SYNTH);
    // declared: 1-2, 1-3 (from n1); 2-3, 2-1 (dup) (from n2); 3-1 (dup), 3-4
    // (from n3); 4-5 (from n4). Unique undirected pairs: {1,2},{1,3},{2,3},{3,4},{4,5}.
    expect(g.edges).toHaveLength(5);
    expect(hasEdge(g, 1, 2)).toBe(true);
    expect(hasEdge(g, 1, 3)).toBe(true);
    expect(hasEdge(g, 2, 3)).toBe(true);
    expect(hasEdge(g, 3, 4)).toBe(true);
    expect(hasEdge(g, 4, 5)).toBe(true);
  });

  it('normalizes each edge to (a < b) so direction never duplicates a pair', () => {
    const g = buildTreeGraph(SYNTH);
    for (const e of g.edges) expect(e.a).toBeLessThan(e.b);
  });

  it('drops a connection whose target node is absent (NO-FALLBACK)', () => {
    const dangling: RawTreeData = {
      ...SYNTH,
      nodes: {
        ...SYNTH.nodes,
        '3': {
          ...SYNTH.nodes['3']!,
          connections: [
            { id: 1, orbit: 0 },
            { id: 999, orbit: 0 },
          ],
        },
      },
    };
    const g = buildTreeGraph(dangling);
    expect(hasEdge(g, 3, 999)).toBe(false);
    // the valid endpoints of node 3 are still present.
    expect(hasEdge(g, 1, 3)).toBe(true);
  });
});

describe('buildTreeGraph — node classification (DESIGN §10.6)', () => {
  it('classifies notable / keystone / mastery / small / jewel-socket', () => {
    const g = buildTreeGraph(SYNTH);
    const kind = (id: number): TreeNodeKind => nodeById(g, id).kind;
    expect(kind(1)).toBe('keystone');
    expect(kind(2)).toBe('notable');
    expect(kind(3)).toBe('small');
    expect(kind(4)).toBe('jewel-socket');
    expect(kind(5)).toBe('mastery');
  });

  it('resolves an overlapping flag by upstream priority (jewel-socket wins)', () => {
    // A node flagged both jewel-socket AND notable must classify as jewel-socket
    // (upstream tests isJewelSocket before isNotable). Deterministic, NO-FALLBACK.
    const overlap: RawTreeData = {
      ...SYNTH,
      nodes: {
        ...SYNTH.nodes,
        '2': { ...SYNTH.nodes['2']!, isJewelSocket: true },
      },
    };
    const g = buildTreeGraph(overlap);
    expect(nodeById(g, 2).kind).toBe('jewel-socket');
  });
});

describe('buildTreeGraph — §6.4 localized label vs machine stat id split', () => {
  it('keeps the display name as label and the node id as the machine statId', () => {
    const g = buildTreeGraph(SYNTH);
    const n1 = nodeById(g, 1);
    expect(n1.label).toBe('Resolute Technique'); // localized display label
    expect(n1.statId).toBe('1'); // machine-readable node id, never the label
    // raw stat lines are carried as machine data, not folded into the label.
    expect(n1.stats).toEqual(['Your hits cannot be Evaded', 'Never deal Critical Hits']);
  });
});

describe('buildTreeGraph — bounds + lookup index (DESIGN §16.3 viewport culling)', () => {
  it('computes min/max bounds from the absolute node coordinates', () => {
    const g = buildTreeGraph(SYNTH);
    // node xs: 0,0,100,500,400 → minX 0, maxX 500; ys: 0,-100,0,600,500 → minY -100, maxY 600.
    expect(g.bounds.minX).toBeCloseTo(0, 6);
    expect(g.bounds.maxX).toBeCloseTo(500, 6);
    expect(g.bounds.minY).toBeCloseTo(-100, 6);
    expect(g.bounds.maxY).toBeCloseTo(600, 6);
  });

  it('exposes a numeric nodeId → node lookup index for every node', () => {
    const g = buildTreeGraph(SYNTH);
    expect(Object.keys(g.nodeIndex)).toHaveLength(g.nodes.length);
    for (const node of g.nodes) expect(g.nodeIndex[node.nodeId]).toBe(node);
  });
});

describe('buildTreeGraph — real 0_5 tree.json fixture (4863 nodes)', () => {
  const g = buildTreeGraph(REAL_TREE);

  it('transforms every real node into the graph with finite coordinates', () => {
    expect(g.nodes).toHaveLength(4863);
    for (const node of g.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it('resolves every emitted edge endpoint to a real node and dedups to unique pairs', () => {
    const seen = new Set<string>();
    for (const e of g.edges) {
      expect(e.a).toBeLessThan(e.b);
      expect(g.nodeIndex[e.a]).toBeDefined();
      expect(g.nodeIndex[e.b]).toBeDefined();
      const key = `${e.a}-${e.b}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    // The 0_5 tree declares 5789 distinct undirected connection pairs + 1 self
    // loop. 14 of those pairs point at a node id NOT in the serialized `nodes`
    // map (upstream class-start / ascendancy stubs); the transform DROPS those
    // dangling edges (NO-FALLBACK), leaving 5775 fully-resolvable edges.
    expect(g.edges).toHaveLength(5775);
  });

  it('classifies every node and matches the upstream flag counts', () => {
    const counts: Record<TreeNodeKind, number> = {
      notable: 0,
      keystone: 0,
      mastery: 0,
      small: 0,
      'jewel-socket': 0,
    };
    for (const node of g.nodes) counts[node.kind] += 1;
    // upstream 0_5 flags: 33 keystones, 18 jewel sockets, 1182 notables, 0 mastery.
    expect(counts.keystone).toBe(33);
    expect(counts['jewel-socket']).toBe(18);
    expect(counts.notable).toBe(1182);
    expect(counts.mastery).toBe(0);
    // everything else is a small node — the four kinds sum to the whole tree.
    expect(counts.small).toBe(4863 - 33 - 18 - 1182);
  });

  it('reports bounds enclosing the whole tree', () => {
    // bounds derive from node coords, so they sit within the tree-data min/max box.
    expect(g.bounds.minX).toBeGreaterThanOrEqual(REAL_TREE.min_x);
    expect(g.bounds.maxX).toBeLessThanOrEqual(REAL_TREE.max_x);
    expect(g.bounds.minY).toBeGreaterThanOrEqual(REAL_TREE.min_y);
    expect(g.bounds.maxY).toBeLessThanOrEqual(REAL_TREE.max_y);
    expect(g.bounds.minX).toBeLessThan(g.bounds.maxX);
    expect(g.bounds.minY).toBeLessThan(g.bounds.maxY);
  });

  it('separates label (name) from the machine statId (node id) on real nodes', () => {
    const start = g.nodeIndex[50459]; // Shadow/Monk class-start "SIX"
    expect(start).toBeDefined();
    expect(start!.statId).toBe('50459');
    expect(typeof start!.label).toBe('string');
    expect(start!.label.length).toBeGreaterThan(0);
  });
});
