// Passive Tree canvas renderer test (DESIGN §10.6 Passive Tree tab "전체 화면
// canvas/WebGL 렌더링", §16.3 "passive tree pan/zoom 60 FPS 목표" → viewport
// culling, §5.1 "Passive tree는 Canvas/WebGL 기반 별도 renderer").
//
// TreeCanvas draws a `buildTreeGraph` graph onto a 2D canvas: edges first, then
// nodes (so a node disc paints over its incident edges), with allocated /
// unallocated / notable nodes visually distinguished. A drag pans and a wheel
// zooms the viewport; nodes whose screen position falls outside the canvas are
// CULLED (never drawn). The component exposes onHoverNode / onAllocate.
//
// jsdom has no canvas 2D implementation, so this suite stubs getContext with a
// recording mock and asserts on the recorded draw calls. The viewport transform
// math (world↔screen, zoom-at-cursor, pan delta) and the culling predicate are
// pure functions, unit-tested directly without the DOM.
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import {
  TreeCanvas,
  worldToScreen,
  screenToWorld,
  zoomAt,
  panBy,
  visibleNodes,
} from '../src/index.js';
import type { Viewport } from '../src/index.js';
import { buildTreeGraph } from '../src/index.js';
import type { RawTreeData, TreeGraph } from '../src/index.js';

// ---------------------------------------------------------------------------
// A tiny hand-built render graph: four nodes on one orbit-0 group (so coords ==
// group centre), spread far apart, with three edges in a chain. node 1 is a
// notable; the rest are small.
// ---------------------------------------------------------------------------
function makeGraph(): TreeGraph {
  const constants = {
    // orbit 0: a single slot at angle 0 → sin0=0, cos0=1 ⇒ node sits at group
    // centre offset (0, -0). With radius 0 the node IS the group centre.
    orbitRadii: [0],
    skillsPerOrbit: [1],
    orbitAnglesByOrbit: [[0]],
  };
  const node = (skill: number, x: number, y: number, isNotable = false) => ({
    skill,
    name: `node-${skill}`,
    group: skill, // 1-based group index == skill, so groups[skill-1]
    orbit: 0,
    orbitIndex: 0,
    stats: [],
    connections: [] as { id: number; orbit: number }[],
    ...(isNotable ? { isNotable: true } : {}),
    _xy: { x, y },
  });

  const n1 = node(1, 0, 0, true);
  const n2 = node(2, 100, 0);
  const n3 = node(3, 100, 100);
  const n4 = node(4, 5000, 5000); // far away — used for culling
  n1.connections.push({ id: 2, orbit: 0 });
  n2.connections.push({ id: 3, orbit: 0 });
  n3.connections.push({ id: 4, orbit: 0 });

  const data: RawTreeData = {
    nodes: { '1': n1, '2': n2, '3': n3, '4': n4 },
    groups: [
      { x: 0, y: 0, nodes: [1], orbits: [0] },
      { x: 100, y: 0, nodes: [2], orbits: [0] },
      { x: 100, y: 100, nodes: [3], orbits: [0] },
      { x: 5000, y: 5000, nodes: [4], orbits: [0] },
    ],
    constants,
    min_x: 0,
    min_y: 0,
    max_x: 5000,
    max_y: 5000,
  };
  return buildTreeGraph(data);
}

// A recording 2D context stub: every method push a {op, args} record so a suite
// can assert call order/counts. Property writes (fillStyle, …) are tracked too.
interface DrawCall {
  op: string;
  args: unknown[];
}
function makeCtxStub() {
  const calls: DrawCall[] = [];
  const rec =
    (op: string) =>
    (...args: unknown[]) => {
      calls.push({ op, args });
    };
  const ctx = {
    calls,
    canvas: undefined as unknown,
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    clearRect: rec('clearRect'),
    setTransform: rec('setTransform'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  return ctx;
}

let ctxStub: ReturnType<typeof makeCtxStub>;

beforeEach(() => {
  ctxStub = makeCtxStub();
  // jsdom canvas getContext returns null by default — stub it with the recorder.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    ctxStub.canvas = this;
    return ctxStub as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
  // jsdom does not lay out, so width/height come back 0 — pin a viewport size.
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ===========================================================================
// (1) Viewport transform math (pure — no DOM). DESIGN §16.3 pan/zoom.
// ===========================================================================
describe('viewport transform math (DESIGN §10.6 pan/zoom)', () => {
  it('worldToScreen / screenToWorld round-trip is identity', () => {
    const vp: Viewport = { scale: 1.5, offsetX: 30, offsetY: -20, width: 800, height: 600 };
    const world = { x: 123.4, y: -56.7 };
    const screen = worldToScreen(vp, world.x, world.y);
    const back = screenToWorld(vp, screen.x, screen.y);
    expect(back.x).toBeCloseTo(world.x, 6);
    expect(back.y).toBeCloseTo(world.y, 6);
  });

  it('worldToScreen applies scale then offset', () => {
    const vp: Viewport = { scale: 2, offsetX: 10, offsetY: 5, width: 800, height: 600 };
    // screen = world*scale + offset.
    expect(worldToScreen(vp, 100, 50)).toEqual({ x: 100 * 2 + 10, y: 50 * 2 + 5 });
  });

  it('panBy shifts the screen offset by the raw pixel delta', () => {
    const vp: Viewport = { scale: 2, offsetX: 10, offsetY: 5, width: 800, height: 600 };
    const moved = panBy(vp, 25, -15);
    expect(moved.offsetX).toBe(35);
    expect(moved.offsetY).toBe(-10);
    // pan never changes scale.
    expect(moved.scale).toBe(2);
  });

  it('zoomAt keeps the world point under the cursor fixed (zoom toward cursor)', () => {
    const vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0, width: 800, height: 600 };
    const cursor = { x: 400, y: 300 };
    const worldBefore = screenToWorld(vp, cursor.x, cursor.y);
    const zoomed = zoomAt(vp, cursor.x, cursor.y, 1.25); // zoom in 25%
    expect(zoomed.scale).toBeCloseTo(1.25, 6);
    // The same world point still maps to the same screen pixel after the zoom.
    const screenAfter = worldToScreen(zoomed, worldBefore.x, worldBefore.y);
    expect(screenAfter.x).toBeCloseTo(cursor.x, 6);
    expect(screenAfter.y).toBeCloseTo(cursor.y, 6);
  });

  it('zoomAt clamps the scale to a sane min/max range', () => {
    const vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0, width: 800, height: 600 };
    // A huge zoom-in factor cannot exceed the max; a tiny one cannot go below min.
    const maxed = zoomAt(vp, 0, 0, 1000);
    const minned = zoomAt(vp, 0, 0, 0.00001);
    expect(maxed.scale).toBeLessThanOrEqual(10);
    expect(minned.scale).toBeGreaterThanOrEqual(0.05);
  });
});

// ===========================================================================
// (2) Viewport culling (pure). DESIGN §16.3 60 FPS via viewport culling.
// ===========================================================================
describe('viewport culling (DESIGN §16.3)', () => {
  it('returns only nodes whose screen position lies within the canvas (+ margin)', () => {
    const graph = makeGraph();
    // scale 1, no offset, 800×600 viewport: nodes 1/2/3 are at ≤(100,100), the
    // far node 4 is at (5000,5000) — off screen and must be culled.
    const vp: Viewport = { scale: 1, offsetX: 0, offsetY: 0, width: 800, height: 600 };
    const ids = visibleNodes(graph, vp)
      .map((n) => n.nodeId)
      .sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3]);
  });

  it('panning the far node into view un-culls it', () => {
    const graph = makeGraph();
    // Offset so the far node at world (5000,5000) lands near screen centre.
    const vp: Viewport = {
      scale: 1,
      offsetX: 400 - 5000,
      offsetY: 300 - 5000,
      width: 800,
      height: 600,
    };
    const ids = visibleNodes(graph, vp).map((n) => n.nodeId);
    expect(ids).toContain(4);
  });
});

// ===========================================================================
// (3) The TreeCanvas React component drawing onto the (stubbed) 2D context.
// ===========================================================================
describe('TreeCanvas component (DESIGN §10.6 / §16.3)', () => {
  it('renders a <canvas> element', () => {
    const graph = makeGraph();
    const { container } = render(<TreeCanvas graph={graph} allocated={new Set()} />);
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('draws edges BEFORE nodes (edges under node discs)', () => {
    const graph = makeGraph();
    render(<TreeCanvas graph={graph} allocated={new Set()} />);
    const ops = ctxStub.calls.map((c) => c.op);
    const firstArc = ops.indexOf('arc'); // nodes are drawn as arcs (discs)
    const lastLineTo = ops.lastIndexOf('lineTo'); // edges are line segments
    expect(firstArc).toBeGreaterThan(-1);
    expect(lastLineTo).toBeGreaterThan(-1);
    // Every edge segment is recorded before the first node disc.
    expect(lastLineTo).toBeLessThan(firstArc);
  });

  it('draws one arc (disc) per VISIBLE node — the far node is culled', () => {
    const graph = makeGraph();
    render(<TreeCanvas graph={graph} allocated={new Set()} />);
    const arcs = ctxStub.calls.filter((c) => c.op === 'arc').length;
    // 4 nodes in the graph, but the far node (5000,5000) is off the 800×600
    // canvas → culled, so only 3 discs are drawn.
    expect(arcs).toBe(3);
  });

  it('draws only the visible edges (an edge with both endpoints culled is skipped)', () => {
    const graph = makeGraph();
    render(<TreeCanvas graph={graph} allocated={new Set()} />);
    // Edges: 1-2, 2-3 (both visible) and 3-4 (endpoint 4 culled but 3 visible →
    // still drawn so the line into the off-screen node is shown). moveTo marks
    // one segment start each.
    const segments = ctxStub.calls.filter((c) => c.op === 'moveTo').length;
    expect(segments).toBe(3);
  });

  it('distinguishes allocated vs unallocated vs notable via distinct fill styles', () => {
    const graph = makeGraph();
    // Allocate node 2 (a small node). node 1 is a notable, node 3 unallocated.
    const allocated = new Set([2]);
    // Capture the fillStyle in effect at each `fill()` call.
    const fillsAt: string[] = [];
    const origFill = ctxStub.fill;
    ctxStub.fill = (...a: unknown[]) => {
      fillsAt.push(ctxStub.fillStyle);
      return origFill(...a);
    };
    render(<TreeCanvas graph={graph} allocated={allocated} />);
    // Three distinct visual classes appear among the node fills.
    const distinct = new Set(fillsAt);
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it('fires onAllocate with the node id when a node disc is clicked', () => {
    const graph = makeGraph();
    const onAllocate = vi.fn();
    const { container } = render(
      <TreeCanvas graph={graph} allocated={new Set()} onAllocate={onAllocate} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    // node 2 is at world (100,0) → screen (100,0) at scale 1, offset 0.
    fireEvent.mouseDown(canvas, { clientX: 100, clientY: 0 });
    fireEvent.mouseUp(canvas, { clientX: 100, clientY: 0 });
    expect(onAllocate).toHaveBeenCalledWith(2);
  });

  it('fires onHoverNode with the hovered node id, then null when leaving it', () => {
    const graph = makeGraph();
    const onHoverNode = vi.fn();
    const { container } = render(
      <TreeCanvas graph={graph} allocated={new Set()} onHoverNode={onHoverNode} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    // Hover over node 1 at world/screen (0,0).
    fireEvent.mouseMove(canvas, { clientX: 0, clientY: 0 });
    expect(onHoverNode).toHaveBeenLastCalledWith(1);
    // Move to empty space far from any node → hover clears to null.
    fireEvent.mouseMove(canvas, { clientX: 400, clientY: 300 });
    expect(onHoverNode).toHaveBeenLastCalledWith(null);
  });

  it('a drag (mousedown→move→up) pans rather than allocating', () => {
    const graph = makeGraph();
    const onAllocate = vi.fn();
    const { container } = render(
      <TreeCanvas graph={graph} allocated={new Set()} onAllocate={onAllocate} />,
    );
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    // Press on node 1, drag well past the click threshold, release → a pan, not
    // a click, so onAllocate must NOT fire.
    fireEvent.mouseDown(canvas, { clientX: 0, clientY: 0 });
    fireEvent.mouseMove(canvas, { clientX: 60, clientY: 40 });
    fireEvent.mouseUp(canvas, { clientX: 60, clientY: 40 });
    expect(onAllocate).not.toHaveBeenCalled();
  });
});
