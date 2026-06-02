// Passive Tree performance-budget benchmark (task p5-tree-perf; DESIGN §16.3
// "Performance budget" — "search response 50ms 이하", "passive tree pan/zoom
// 60 FPS 목표", "대규모 redraw는 viewport culling 적용", §10.6 Passive Tree tab).
//
// This is the deterministic Phase-5 gate benchmark for the §16.3 tree budgets. It
// drives the SAME pure primitives the §10.6 renderer uses — `buildTreeGraph`,
// `buildNodeSearchIndex`, and the `visibleNodes` culling predicate — over the FULL
// real 0_5 `tree.json` (4863 nodes / 1572 groups, the upstream gamedata fixture),
// then ASSERTS two things:
//
//   (1) NODE SEARCH ≤ the §16.3 50ms response target. The bilingual prefix index
//       (`buildNodeSearchIndex`) must answer a query in well under 50ms on the
//       whole tree. Measured deterministically as the mean over many warmed
//       queries spanning many buckets so a single GC/JIT spike can not flip the
//       gate.
//
//   (2) ONE FRAME (with viewport culling) ≤ the §16.3 16.6ms (60 FPS) budget, AND
//       it draws ONLY the on-screen nodes. The per-frame work a redraw performs —
//       `visibleNodes` culling + the world→screen position math for every visible
//       node and edge — must finish inside one 60 FPS frame. We also assert the
//       culling is real: at a normal working zoom the frame paints only a small
//       fraction of the 4863 nodes (the "보이는 노드만 그리는지" requirement), and
//       that a fully-zoomed-out frame (every node on screen, the worst case) still
//       fits the budget.
//
// Thresholds are the §16.3 targets themselves (50ms / 16.6ms). The primitives run
// orders of magnitude under those targets, so the targets double as a generous
// environment-variance margin: a genuine regression (a dropped search index, a
// disabled cull, an O(nodes²) frame) blows the budget by a wide margin, while
// normal CI/host jitter never approaches it. The benchmark is deterministic — no
// randomness, no network, no wall-clock dependence beyond `performance.now`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildTreeGraph, buildNodeSearchIndex, visibleNodes, worldToScreen } from '../src/index.js';
import type {
  RawTreeData,
  TreeGraph,
  NodeSearchDoc,
  NodeSearchIndex,
  Viewport,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// The FULL real 0_5 tree (4863 nodes / 1572 groups) — the upstream gamedata
// fixture. vitest runs with cwd = the @pob2/ui package root (see vitest.config.ts).
// ---------------------------------------------------------------------------
const REAL_TREE = JSON.parse(
  readFileSync(
    resolve(process.cwd(), '../../vendor/PathOfBuilding-PoE2/src/TreeData/0_5/tree.json'),
    'utf8',
  ),
) as RawTreeData;

const GRAPH: TreeGraph = buildTreeGraph(REAL_TREE);

// §16.3 budgets (ms).
const SEARCH_BUDGET_MS = 50; // "search response 50ms 이하"
const FRAME_BUDGET_MS = 1000 / 60; // 60 FPS → 16.6ms per frame

/**
 * Run `fn` `iters` times after a warm-up pass and return the mean wall-clock ms
 * per iteration. The warm-up lets the JIT settle so the measured mean reflects
 * steady-state work, not first-call compilation — a deterministic measurement.
 */
function meanMs(
  fn: () => void,
  iters: number,
  warmup = Math.max(5, Math.floor(iters / 10)),
): number {
  for (let i = 0; i < warmup; i += 1) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i += 1) fn();
  return (performance.now() - start) / iters;
}

// ===========================================================================
// (1) Node search ≤ §16.3 50ms response target on the full tree.
// ===========================================================================
describe('tree node search performance (DESIGN §16.3 "search response 50ms 이하")', () => {
  // Build the bilingual search index over every real node (en stands in for ko in
  // the raw fixture, which carries no ko mapping — the index work is identical).
  const docs: NodeSearchDoc[] = Object.values(REAL_TREE.nodes).map((n) => ({
    nodeId: n.skill,
    titleKo: n.name,
    titleEn: n.name,
    aliasesKo: [],
    aliasesEn: [],
  }));
  const index: NodeSearchIndex = buildNodeSearchIndex(docs);

  // A spread of real query stems hitting many different buckets, so the mean is
  // not dominated by one cheap/empty bucket.
  const QUERIES = [
    'evasion',
    'life',
    'fire',
    'critical',
    'attack',
    'spell',
    'minion',
    'chaos',
    'armour',
    'energy',
    'damage',
    'resist',
  ];

  it('indexes the whole 4863-node tree (the search corpus is the full gamedata)', () => {
    expect(docs).toHaveLength(4863);
    // sanity: a common stem actually resolves to real nodes (not an empty index).
    expect(index.search('life').length).toBeGreaterThan(0);
  });

  it('answers a node-search query within the §16.3 50ms budget', () => {
    let qi = 0;
    const per = meanMs(() => {
      index.search(QUERIES[qi % QUERIES.length]!);
      qi += 1;
    }, 2000);
    expect(per).toBeLessThan(SEARCH_BUDGET_MS);
  });

  it('stays within budget on the single worst-case (largest result set) query', () => {
    // Pick the query with the largest result set — the most index work per call —
    // and budget THAT one, so the gate is the worst case, not just the mean.
    let worst = QUERIES[0]!;
    let worstLen = -1;
    for (const q of QUERIES) {
      const len = index.search(q).length;
      if (len > worstLen) {
        worstLen = len;
        worst = q;
      }
    }
    expect(worstLen).toBeGreaterThan(0);
    const per = meanMs(() => {
      index.search(worst);
    }, 2000);
    expect(per).toBeLessThan(SEARCH_BUDGET_MS);
  });
});

// ===========================================================================
// (2) One frame (with viewport culling) ≤ §16.3 16.6ms (60 FPS) — and it draws
//     ONLY the visible nodes ("보이는 노드만 그리는지").
// ===========================================================================
describe('tree frame-render performance (DESIGN §16.3 "pan/zoom 60 FPS 목표", viewport culling)', () => {
  // A canvas viewport. The transform/culling math lives in the real exported
  // primitives; this just supplies the screen geometry a frame uses.
  const CANVAS_W = 1600;
  const CANVAS_H = 900;

  /**
   * Centre the viewport on the tree at `scale`, mirroring how the §10.6 panel
   * frames the tree (centre of the bounds at the centre of the canvas).
   */
  function centredViewport(scale: number): Viewport {
    const cx = (GRAPH.bounds.minX + GRAPH.bounds.maxX) / 2;
    const cy = (GRAPH.bounds.minY + GRAPH.bounds.maxY) / 2;
    return {
      scale,
      offsetX: CANVAS_W / 2 - cx * scale,
      offsetY: CANVAS_H / 2 - cy * scale,
      width: CANVAS_W,
      height: CANVAS_H,
    };
  }

  /**
   * The per-frame render WORK a redraw performs, headless: cull to the visible
   * node subset, then compute the world→screen position of every visible node and
   * of every edge whose endpoint is visible (exactly what `drawScene` does before
   * each `arc` / `lineTo`). Returns the visible node count so the caller can assert
   * the cull is real. No DOM / no 2D context — the geometry is the cost, and it is
   * the same pure math the renderer runs.
   */
  function renderFrameWork(vp: Viewport): number {
    const visible = visibleNodes(GRAPH, vp);
    const visibleIds = new Set(visible.map((n) => n.nodeId));
    // Edge pass: world→screen for both endpoints of every edge with a visible end.
    for (const edge of GRAPH.edges) {
      if (!visibleIds.has(edge.a) && !visibleIds.has(edge.b)) continue;
      const a = GRAPH.nodeIndex[edge.a];
      const b = GRAPH.nodeIndex[edge.b];
      if (!a || !b) continue;
      worldToScreen(vp, a.x, a.y);
      worldToScreen(vp, b.x, b.y);
    }
    // Node pass: world→screen for every visible node disc.
    for (const node of visible) worldToScreen(vp, node.x, node.y);
    return visible.length;
  }

  it('culls to only the on-screen nodes at a normal working zoom (보이는 노드만)', () => {
    // A normal editing zoom: a region of the tree, not the whole thing. Far fewer
    // than all 4863 nodes are on screen — the cull must be real, not a no-op.
    const vp = centredViewport(0.5);
    const visibleCount = visibleNodes(GRAPH, vp).length;
    expect(visibleCount).toBeGreaterThan(0); // something is on screen
    expect(visibleCount).toBeLessThan(GRAPH.nodes.length); // not everything (culled)
    // and it really is a small fraction — a regression that disabled culling would
    // draw the whole tree, blowing this assertion well before the time budget.
    expect(visibleCount).toBeLessThan(GRAPH.nodes.length / 2);
  });

  it('renders one frame within the §16.3 16.6ms (60 FPS) budget at a working zoom', () => {
    const vp = centredViewport(0.5);
    const per = meanMs(() => {
      renderFrameWork(vp);
    }, 300);
    expect(per).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('renders the worst case — the whole tree zoomed to fit — within the 60 FPS budget', () => {
    // Zoom out far enough that the entire bounds fit the canvas: every node is
    // on screen, so the cull saves nothing and the frame does its maximum work.
    const spanX = GRAPH.bounds.maxX - GRAPH.bounds.minX;
    const spanY = GRAPH.bounds.maxY - GRAPH.bounds.minY;
    const fitScale = Math.min(CANVAS_W / spanX, CANVAS_H / spanY);
    const vp = centredViewport(fitScale);
    // Confirm this really is the all-nodes-visible worst case.
    expect(visibleNodes(GRAPH, vp).length).toBe(GRAPH.nodes.length);
    const per = meanMs(() => {
      renderFrameWork(vp);
    }, 200);
    expect(per).toBeLessThan(FRAME_BUDGET_MS);
  });
});
