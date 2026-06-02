/**
 * TreeCanvas — the §10.6 Passive Tree "전체 화면 canvas/WebGL 렌더링" renderer
 * (DESIGN §10.6 Passive Tree tab, §5.1 "Passive tree는 Canvas/WebGL 기반 별도
 * renderer", §16.3 "passive tree pan/zoom 60 FPS 목표").
 *
 * It consumes the {@link TreeGraph} produced by `buildTreeGraph` and paints it on
 * an HTML5 2D canvas. DESIGN §10.6.렌더링 leaves the canvas/WebGL choice open;
 * this first pass picks Canvas 2D for simplicity (the §16.3 60 FPS target is met
 * with viewport culling, not GPU shaders). Draw order is edges → nodes so a node
 * disc paints over its incident edges, and allocated / unallocated / notable
 * nodes are given distinct fill styles (§10.1.6 "수정 가능한 값과 계산 결과를
 * 명확히 구분" — the allocation state is a visual class, never color-only relies
 * on a single channel since shape/size also vary by kind).
 *
 * Interaction:
 *   - drag (mouse down → move past a threshold → up) PANS the viewport.
 *   - wheel ZOOMS toward the cursor.
 *   - a click (down → up without a drag) on a node disc fires `onAllocate(id)`.
 *   - moving over a node fires `onHoverNode(id)`; leaving every node fires
 *     `onHoverNode(null)` (the §10.6 path-preview / tooltip driver — the host
 *     debounces the `tree.previewAllocate` call, not this component).
 *
 * The viewport-transform math ({@link worldToScreen}/{@link screenToWorld}/
 * {@link zoomAt}/{@link panBy}) and the {@link visibleNodes} culling predicate are
 * pure, exported, and unit-tested apart from the DOM (the §16.3 culling that keeps
 * a large redraw under budget — "대규모 redraw는 viewport culling 적용").
 */
import { useEffect, useRef, useState } from 'react';
import type { TreeGraph, TreeGraphNode } from './tree-transform.js';

// ===========================================================================
// Viewport transform — pure math (DESIGN §10.6 pan/zoom, §16.3 60 FPS).
// ===========================================================================

/**
 * The screen↔world transform state. A world point maps to screen pixels by
 * `screen = world * scale + offset`; `width`/`height` are the canvas pixel size
 * (the culling box). `offset` is in screen pixels, so a raw drag delta adds to it
 * directly (no scale division — the §10.6 "drag to pan" feel).
 */
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

/** Min / max zoom (DESIGN §16.3 — pan/zoom stays in a usable, jank-free range). */
const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

/** A pixel margin so a node straddling the canvas edge is not popped mid-frame. */
const CULL_MARGIN = 64;

/** A drag past this many pixels is a pan, not a click (DESIGN §10.6 drag-to-pan). */
const CLICK_DRAG_THRESHOLD = 4;

/** A click/hover hit-tests a node within this screen-pixel radius of the cursor. */
const HIT_RADIUS = 12;

/** Map a world coordinate to a screen pixel under the viewport transform. */
export function worldToScreen(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: x * vp.scale + vp.offsetX, y: y * vp.scale + vp.offsetY };
}

/** Inverse of {@link worldToScreen}: a screen pixel back to a world coordinate. */
export function screenToWorld(vp: Viewport, x: number, y: number): { x: number; y: number } {
  return { x: (x - vp.offsetX) / vp.scale, y: (y - vp.offsetY) / vp.scale };
}

/** Pan by a raw screen-pixel delta (DESIGN §10.6 drag-to-pan). Scale is unchanged. */
export function panBy(vp: Viewport, dx: number, dy: number): Viewport {
  return { ...vp, offsetX: vp.offsetX + dx, offsetY: vp.offsetY + dy };
}

/**
 * Zoom by `factor` about the screen pixel `(cx, cy)`, keeping the world point
 * under the cursor fixed (DESIGN §10.6 zoom-toward-cursor). The scale is clamped
 * to [{@link MIN_SCALE}, {@link MAX_SCALE}] and the offset is re-derived so that
 * `worldToScreen(zoomed, worldUnderCursor) === (cx, cy)` still holds.
 */
export function zoomAt(vp: Viewport, cx: number, cy: number, factor: number): Viewport {
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, vp.scale * factor));
  const world = screenToWorld(vp, cx, cy);
  // Re-solve offset so the world point still lands on the cursor pixel.
  return {
    ...vp,
    scale,
    offsetX: cx - world.x * scale,
    offsetY: cy - world.y * scale,
  };
}

/**
 * The §16.3 viewport-culling predicate: the subset of `graph.nodes` whose screen
 * position lies within the canvas (expanded by {@link CULL_MARGIN}). A large tree
 * redraws only what is on screen — the "대규모 redraw는 viewport culling 적용"
 * rule that keeps pan/zoom near the 60 FPS target.
 */
export function visibleNodes(graph: TreeGraph, vp: Viewport): TreeGraphNode[] {
  const out: TreeGraphNode[] = [];
  for (const node of graph.nodes) {
    const s = worldToScreen(vp, node.x, node.y);
    if (
      s.x >= -CULL_MARGIN &&
      s.x <= vp.width + CULL_MARGIN &&
      s.y >= -CULL_MARGIN &&
      s.y <= vp.height + CULL_MARGIN
    ) {
      out.push(node);
    }
  }
  return out;
}

// ===========================================================================
// Node styling — allocated / unallocated / notable visual classes (DESIGN §10.6).
// ===========================================================================

/** The fill + radius for a node, keyed on its allocation state and kind. */
interface NodeStyle {
  fill: string;
  radius: number;
}

/** Notables/keystones are larger discs (DESIGN §10.6 "mastery/jewel … 영향 표시"). */
function radiusFor(node: TreeGraphNode): number {
  if (node.kind === 'keystone') return 9;
  if (node.kind === 'notable') return 7;
  if (node.kind === 'mastery') return 6;
  if (node.kind === 'jewel-socket') return 6;
  return 4;
}

/**
 * Pick the §10.6 visual class for a node. Allocated nodes are gold; an unallocated
 * notable is amber (so it reads as a "goal" even un-taken); an unallocated small
 * node is muted grey. Three distinct fills, by allocation state then kind.
 */
function styleFor(node: TreeGraphNode, allocated: boolean): NodeStyle {
  const radius = radiusFor(node);
  if (allocated) return { fill: '#d9b24a', radius }; // allocated — gold
  if (node.kind === 'notable' || node.kind === 'keystone') {
    return { fill: '#8a6d2f', radius }; // unallocated notable — amber
  }
  return { fill: '#4a4f5a', radius }; // unallocated small — muted grey
}

// ===========================================================================
// Rendering — edges then nodes (DESIGN §10.6 draw order, §16.3 culling).
// ===========================================================================

/**
 * Draw the whole §10.6 scene onto `ctx`: a clear, then every VISIBLE edge, then
 * every VISIBLE node disc on top (so a node paints over its incident edges).
 * Culling (the §16.3 budget) is applied per node; an edge is drawn when at least
 * one endpoint is visible (so a line into an off-screen node is still shown).
 */
function drawScene(
  ctx: CanvasRenderingContext2D,
  graph: TreeGraph,
  vp: Viewport,
  allocated: Set<number>,
): void {
  ctx.clearRect(0, 0, vp.width, vp.height);

  const visible = visibleNodes(graph, vp);
  const visibleIds = new Set(visible.map((n) => n.nodeId));

  // Edges first (under the node discs). An allocated→allocated edge is gold.
  for (const edge of graph.edges) {
    if (!visibleIds.has(edge.a) && !visibleIds.has(edge.b)) continue; // both culled
    const a = graph.nodeIndex[edge.a];
    const b = graph.nodeIndex[edge.b];
    if (!a || !b) continue;
    const sa = worldToScreen(vp, a.x, a.y);
    const sb = worldToScreen(vp, b.x, b.y);
    const onPath = allocated.has(edge.a) && allocated.has(edge.b);
    ctx.strokeStyle = onPath ? '#d9b24a' : '#3a3f48';
    ctx.lineWidth = onPath ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
  }

  // Nodes on top (only the visible subset — the §16.3 culling).
  for (const node of visible) {
    const s = worldToScreen(vp, node.x, node.y);
    const style = styleFor(node, allocated.has(node.nodeId));
    ctx.fillStyle = style.fill;
    ctx.beginPath();
    ctx.arc(s.x, s.y, style.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Hit-test the screen pixel `(sx, sy)` against the visible node discs. */
function hitTest(graph: TreeGraph, vp: Viewport, sx: number, sy: number): TreeGraphNode | null {
  let best: TreeGraphNode | null = null;
  let bestDist = HIT_RADIUS * HIT_RADIUS;
  for (const node of visibleNodes(graph, vp)) {
    const s = worldToScreen(vp, node.x, node.y);
    const dx = s.x - sx;
    const dy = s.y - sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist) {
      bestDist = d2;
      best = node;
    }
  }
  return best;
}

// ===========================================================================
// The React component (DESIGN §10.6 passive tree canvas).
// ===========================================================================

export interface TreeCanvasProps {
  /** The render-ready graph from `buildTreeGraph` (DESIGN §10.6 data transform). */
  graph: TreeGraph;
  /** The currently-allocated node ids (drives the allocated visual class). */
  allocated: Set<number>;
  /** Canvas pixel width (default 800). */
  width?: number;
  /** Canvas pixel height (default 600). */
  height?: number;
  /**
   * Controlled viewport (DESIGN §10.6). When supplied, the canvas is fully driven
   * by this viewport and reports every pan/zoom up via {@link onViewportChange} so
   * a host (the §10.6 TreePanel) can share one viewport with the minimap + the
   * search→pan. When absent, the canvas owns its own internal viewport (the
   * standalone behaviour).
   */
  viewport?: Viewport;
  /** Called with the next viewport on every pan/zoom (controlled mode). */
  onViewportChange?: (viewport: Viewport) => void;
  /** Hover changed: the hovered node id, or null when over empty space. */
  onHoverNode?: (nodeId: number | null) => void;
  /** A node disc was clicked (not dragged): allocate / deallocate it. */
  onAllocate?: (nodeId: number) => void;
}

/** Drag-tracking state held across mouse events (a ref, never re-renders). */
interface DragState {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

export function TreeCanvas(props: TreeCanvasProps) {
  const { graph, allocated, onHoverNode, onAllocate, onViewportChange } = props;
  const width = props.width ?? 800;
  const height = props.height ?? 600;
  const controlled = props.viewport !== undefined;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const hoverRef = useRef<number | null>(null);
  const [internalViewport, setInternalViewport] = useState<Viewport>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    width,
    height,
  });

  // The viewport in effect: the controlled prop when supplied, else the internal
  // state. A controlled host (the §10.6 TreePanel) shares one viewport with the
  // minimap + search→pan; standalone, the canvas owns it.
  const viewport = props.viewport ?? internalViewport;

  // Apply a viewport transition: in controlled mode report it up (the host is the
  // source of truth); standalone, mutate the internal state.
  const updateViewport = (next: (vp: Viewport) => Viewport): void => {
    if (controlled) {
      onViewportChange?.(next(props.viewport!));
    } else {
      setInternalViewport(next);
    }
  };

  // Keep the internal viewport's pixel size in sync with the canvas size props.
  // (Controlled mode: the host owns width/height on its viewport.)
  useEffect(() => {
    if (controlled) return;
    setInternalViewport((vp) =>
      vp.width === width && vp.height === height ? vp : { ...vp, width, height },
    );
  }, [width, height, controlled]);

  // Repaint whenever the graph, allocation set, or viewport changes.
  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;
    drawScene(ctx, graph, viewport, allocated);
  }, [graph, allocated, viewport]);

  /** Translate a mouse event's client coords to canvas-local pixels. */
  const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    return { x: e.clientX - left, y: e.clientY - top };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = localPoint(e);
    dragRef.current = { startX: p.x, startY: p.y, lastX: p.x, lastY: p.y, moved: false };
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const p = localPoint(e);
    const drag = dragRef.current;
    if (drag) {
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      drag.lastX = p.x;
      drag.lastY = p.y;
      if (
        Math.abs(p.x - drag.startX) > CLICK_DRAG_THRESHOLD ||
        Math.abs(p.y - drag.startY) > CLICK_DRAG_THRESHOLD
      ) {
        drag.moved = true;
      }
      if (drag.moved) {
        updateViewport((vp) => panBy(vp, dx, dy));
        return; // panning suppresses hover updates
      }
    }
    // Hover hit-test (no active drag, or drag below threshold).
    const hit = hitTest(graph, viewport, p.x, p.y);
    const id = hit ? hit.nodeId : null;
    if (id !== hoverRef.current) {
      hoverRef.current = id;
      onHoverNode?.(id);
    }
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || drag.moved) return; // a pan, not a click
    const p = localPoint(e);
    const hit = hitTest(graph, viewport, p.x, p.y);
    if (hit) onAllocate?.(hit.nodeId);
  };

  const handleMouseLeave = () => {
    dragRef.current = null;
    if (hoverRef.current !== null) {
      hoverRef.current = null;
      onHoverNode?.(null);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const p = localPoint(e);
    // Wheel up (deltaY < 0) zooms in; down zooms out.
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    updateViewport((vp) => zoomAt(vp, p.x, p.y, factor));
  };

  return (
    <canvas
      ref={canvasRef}
      className="pob-tree-canvas"
      width={width}
      height={height}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
