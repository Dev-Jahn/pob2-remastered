/**
 * TreePanel — the §10.6 Passive Tree tab layout (DESIGN §10.6). It assembles the
 * Phase-5 tree pieces into one screen:
 *
 *   ┌──────────────────────────────────────────────┬───────────────┐
 *   │  [ 노드 검색 (한/영) ]    ┌──────────┐         │ 이 노드를 찍으면│
 *   │  ┌ search results ┐       │ minimap  │         │ 증가하는 stat  │
 *   │  └────────────────┘       │ + viewport│        │ (tooltip)      │
 *   │                           └──────────┘         │                │
 *   │                                                │ 할당 변화      │
 *   │            TreeCanvas (중앙)                    │ (delta chips)  │
 *   │                                                │                │
 *   └──────────────────────────────────────────────┴───────────────┘
 *
 * Four §10.6 elements:
 *   - the central {@link TreeCanvas} (the `buildTreeGraph` graph painted on canvas);
 *   - a {@link TreeMinimap} — a reduced full-tree view + a rectangle marking the
 *     current canvas viewport (so the user sees where on the whole tree they are);
 *   - a node search box — bilingual (한/영) over a {@link NodeSearchIndex}; clicking
 *     a result PANS the canvas so the chosen node lands at the canvas centre;
 *   - a hover tooltip ("이 노드를 찍으면 증가하는 stat") + an allocation-delta panel
 *     showing the host-supplied `tree.previewAllocate` delta chips for the hovered
 *     node ({@link buildAllocationDeltaModel}).
 *
 * The panel OWNS the viewport (so the search→pan and the minimap rectangle share
 * one source of truth) plus the search query and the local hover id; everything
 * data — the graph, the allocated set, the search index, the hover deltas — is
 * supplied by the host, so the panel stays free of app/IO coupling (like the Items
 * / Skills / Config panels). Hovering a node fires `onHoverNode(id)` so the host
 * can debounce `tree.previewAllocate` (DESIGN §10.6 "노드 hover 시 … debounce") and
 * feed the result back as `hoverDeltas`. All chrome text resolves through `t`
 * (§8.1: a 한국어 label carrying its 영문 alias).
 *
 * NO-FALLBACK (§6.4): an empty/whitespace query shows no result list (never a
 * full-tree dump); with no hovered node there is no tooltip / no delta panel; and
 * the delta chips render only what the host hands them — a real 0 stays a neutral
 * value, a requested-but-unreturned stat is an explicit missing marker, never a
 * fabricated 0 (delegated to {@link buildAllocationDeltaModel}).
 */
import { useEffect, useRef, useState } from 'react';
import type { TreeStatDelta } from '@pob2/schema';
import { t } from '../i18n/index.js';
import type { Locale } from '../i18n/index.js';
import { TreeCanvas } from './TreeCanvas.js';
import type { Viewport } from './TreeCanvas.js';
import type { TreeGraph } from './tree-transform.js';
import { buildAllocationDeltaModel } from './tree-model.js';
import type { NodeSearchDoc, NodeSearchIndex } from './tree-model.js';

/** Default canvas pixel size (DESIGN §10.6 "전체 화면 canvas"). */
const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

/** Default minimap pixel size (DESIGN §10.6 minimap — a reduced full-tree view). */
const MINIMAP_WIDTH = 200;
const MINIMAP_HEIGHT = 150;

/** Initial viewport (scale 1, no offset, full canvas pixel size). */
function initialViewport(width: number, height: number): Viewport {
  return { scale: 1, offsetX: 0, offsetY: 0, width, height };
}

/**
 * Re-centre the viewport so world point `(wx, wy)` lands at the canvas centre
 * (the §10.6 search→pan target). Scale is preserved; only the offset is re-solved:
 * `screen = world*scale + offset`, so for the centre pixel `offset = centre − world*scale`.
 */
function centreOn(vp: Viewport, wx: number, wy: number): Viewport {
  return {
    ...vp,
    offsetX: vp.width / 2 - wx * vp.scale,
    offsetY: vp.height / 2 - wy * vp.scale,
  };
}

// ===========================================================================
// Minimap — a reduced full-tree view + the current-viewport rectangle (§10.6).
// ===========================================================================

interface TreeMinimapProps {
  locale: Locale;
  graph: TreeGraph;
  /** The CANVAS viewport, so the rectangle marks what the main canvas shows. */
  viewport: Viewport;
  width?: number;
  height?: number;
}

/**
 * The minimap scale + offset that fits the whole tree bounds into the minimap box
 * (DESIGN §10.6 "전체 트리 축소뷰"). A uniform scale (the smaller of the x/y fit)
 * keeps the tree's aspect ratio; the offset centres it.
 */
function minimapFit(
  graph: TreeGraph,
  width: number,
  height: number,
): { scale: number; offsetX: number; offsetY: number } {
  const { minX, minY, maxX, maxY } = graph.bounds;
  const treeW = Math.max(1, maxX - minX);
  const treeH = Math.max(1, maxY - minY);
  const scale = Math.min(width / treeW, height / treeH);
  return {
    scale,
    offsetX: (width - treeW * scale) / 2 - minX * scale,
    offsetY: (height - treeH * scale) / 2 - minY * scale,
  };
}

/**
 * The minimap: a canvas painting every node as a dot under the {@link minimapFit}
 * transform, plus a `data-minimap-viewport` rectangle overlay marking the world
 * area the main canvas currently shows. The rectangle's screen box is the main
 * viewport's visible-world corners re-projected into minimap pixels.
 */
function TreeMinimap({
  locale,
  graph,
  viewport,
  width = MINIMAP_WIDTH,
  height = MINIMAP_HEIGHT,
}: TreeMinimapProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const fit = minimapFit(graph, width, height);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#5a6070';
    for (const node of graph.nodes) {
      const x = node.x * fit.scale + fit.offsetX;
      const y = node.y * fit.scale + fit.offsetY;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }, [graph, width, height, fit.scale, fit.offsetX, fit.offsetY]);

  // The world rectangle the main canvas currently shows (screen (0,0)→(w,h)
  // inverse-transformed), re-projected into minimap pixels.
  const worldLeft = (0 - viewport.offsetX) / viewport.scale;
  const worldTop = (0 - viewport.offsetY) / viewport.scale;
  const worldRight = (viewport.width - viewport.offsetX) / viewport.scale;
  const worldBottom = (viewport.height - viewport.offsetY) / viewport.scale;
  const rectLeft = worldLeft * fit.scale + fit.offsetX;
  const rectTop = worldTop * fit.scale + fit.offsetY;
  const rectW = (worldRight - worldLeft) * fit.scale;
  const rectH = (worldBottom - worldTop) * fit.scale;

  return (
    <section
      className="pob-tree__minimap"
      data-testid="tree-minimap"
      aria-label={t(locale, 'tree.minimap')}
    >
      <canvas className="pob-tree__minimap-canvas" ref={ref} width={width} height={height} />
      <div
        className="pob-tree__minimap-viewport"
        data-minimap-viewport
        style={{
          position: 'absolute',
          left: `${rectLeft}px`,
          top: `${rectTop}px`,
          width: `${rectW}px`,
          height: `${rectH}px`,
        }}
      />
    </section>
  );
}

// ===========================================================================
// The TreePanel component (DESIGN §10.6 layout).
// ===========================================================================

export interface TreePanelProps {
  /** Active locale, drives every chrome label (§8.1). */
  locale: Locale;
  /** The render-ready graph from `buildTreeGraph` (DESIGN §10.6 data transform). */
  graph: TreeGraph;
  /** The currently-allocated node ids (drives the allocated visual class). */
  allocated: Set<number>;
  /** The bilingual node search index (한/영) over the tree (p5-tree-model). */
  index: NodeSearchIndex;
  /**
   * The hovered node id, supplied by the host once it knows which node is hovered
   * (a controlled hover so the host can pair it with the debounced previewAllocate
   * result). Absent → the panel's own last hover id is used (uncontrolled hover).
   */
  hoveredNodeId?: number;
  /**
   * The `tree.previewAllocate` deltas for the hovered node (DESIGN §7.4), supplied
   * by the host after its debounced fetch (DESIGN §10.6). Absent → no delta chips.
   */
  hoverDeltas?: TreeStatDelta[];
  /** Canvas pixel width (default 800). */
  width?: number;
  /** Canvas pixel height (default 600). */
  height?: number;
  /** Hover changed: the hovered node id, or null when over empty space. */
  onHoverNode?: (nodeId: number | null) => void;
  /** A node disc was clicked (not dragged): allocate / deallocate it. */
  onAllocate?: (nodeId: number) => void;
  /** Called with the next viewport on every pan/zoom (search→pan, drag, wheel). */
  onViewportChange?: (viewport: Viewport) => void;
}

/** Render a signed delta value, e.g. `+20` / `-3` / `0` (the §10.6 delta chip). */
function signed(delta: number | undefined): string {
  if (delta === undefined) return '';
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function TreePanel(props: TreePanelProps) {
  const { locale, graph, allocated, index, hoverDeltas, onHoverNode, onAllocate } = props;
  const width = props.width ?? CANVAS_WIDTH;
  const height = props.height ?? CANVAS_HEIGHT;

  const [viewport, setViewport] = useState<Viewport>(() => initialViewport(width, height));
  const [query, setQuery] = useState('');
  const [localHover, setLocalHover] = useState<number | null>(null);

  // Keep the viewport pixel size in sync with the canvas size props.
  useEffect(() => {
    setViewport((vp) =>
      vp.width === width && vp.height === height ? vp : { ...vp, width, height },
    );
  }, [width, height]);

  const updateViewport = (next: Viewport): void => {
    setViewport(next);
    props.onViewportChange?.(next);
  };

  const handleHover = (id: number | null): void => {
    setLocalHover(id);
    onHoverNode?.(id);
  };

  // Clicking a search result pans the canvas so the node lands at the centre.
  const handleSelectResult = (nodeId: number): void => {
    const node = graph.nodeIndex[nodeId];
    if (!node) return; // NO-FALLBACK: never pan to a phantom node.
    updateViewport(centreOn(viewport, node.x, node.y));
  };

  const results: NodeSearchDoc[] = query.trim() === '' ? [] : index.search(query);

  // The hovered node: the host-controlled id when given, else the local one.
  const hoveredId = props.hoveredNodeId ?? localHover ?? undefined;
  const hoveredNode = hoveredId !== undefined ? graph.nodeIndex[hoveredId] : undefined;
  const deltaModel =
    hoveredNode && hoverDeltas ? buildAllocationDeltaModel(hoverDeltas, undefined) : undefined;

  return (
    <div className="pob-tree">
      <aside className="pob-tree__search" data-testid="tree-search">
        <input
          type="text"
          className="pob-tree__search-input"
          role="textbox"
          placeholder={t(locale, 'tree.search.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {results.length > 0 ? (
          <ul className="pob-tree__search-results" data-testid="tree-search-results" role="list">
            {results.map((doc) => (
              <li key={doc.nodeId} className="pob-tree__search-result" role="listitem">
                <button
                  type="button"
                  className="pob-tree__search-result-btn"
                  data-node-id={doc.nodeId}
                  onClick={() => handleSelectResult(doc.nodeId)}
                >
                  {/* §8.1: the 한국어 label first, the 영문 alias kept alongside. */}
                  {doc.titleKo} ({doc.titleEn})
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </aside>

      <section
        className="pob-tree__canvas-region"
        data-testid="tree-canvas-region"
        aria-label={t(locale, 'tree.canvas')}
      >
        <TreeCanvas
          graph={graph}
          allocated={allocated}
          width={width}
          height={height}
          viewport={viewport}
          onViewportChange={updateViewport}
          onHoverNode={handleHover}
          onAllocate={onAllocate}
        />
      </section>

      <TreeMinimap locale={locale} graph={graph} viewport={viewport} />

      {hoveredNode ? (
        <aside className="pob-tree__inspector">
          <div className="pob-tree__tooltip" data-testid="tree-hover-tooltip">
            <h4 className="pob-tree__tooltip-title">{t(locale, 'tree.tooltip.title')}</h4>
            <p className="pob-tree__tooltip-node">{hoveredNode.label}</p>
          </div>

          {deltaModel ? (
            <div className="pob-tree__delta" data-testid="tree-delta-panel">
              <h4 className="pob-tree__delta-title">{t(locale, 'tree.delta.title')}</h4>
              <ul className="pob-tree__delta-chips" role="list">
                {deltaModel.chips.map((chip) => (
                  <li
                    key={chip.statId}
                    className="pob-tree__delta-chip"
                    data-delta-stat={chip.statId}
                    data-direction={chip.direction}
                    role="listitem"
                  >
                    <span className="pob-tree__delta-stat">{chip.statId}</span>
                    <span className="pob-tree__delta-value">
                      {chip.missing ? t(locale, 'tree.delta.missing') : signed(chip.delta)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
