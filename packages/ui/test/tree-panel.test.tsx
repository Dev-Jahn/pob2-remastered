// Passive Tree panel component test (task p5-tree-panel; DESIGN §10.6 Passive Tree
// tab layout, §8.1 ko/en alias, §6.4 NO-FALLBACK, §16.3 viewport culling).
//
// TreePanel assembles the §10.6 screen out of the Phase-5 tree pieces:
//
//   - the central TreeCanvas (the buildTreeGraph render-graph painted on canvas);
//   - a minimap — a reduced full-tree view + a rectangle marking the current
//     canvas viewport (so the user sees where on the whole tree they are);
//   - a node search box — bilingual (한/영) over buildNodeSearchIndex; clicking a
//     result PANS the canvas so the chosen node lands at the canvas centre;
//   - a hover tooltip ("이 노드를 찍으면 증가하는 stat") + an allocation-delta
//     panel that, while a node is hovered, shows the host-supplied previewAllocate
//     delta chips (buildAllocationDeltaModel).
//
// The panel owns the viewport (so the search→pan and the minimap rectangle share
// one source of truth) and the hovered-node id + search query; everything data —
// the graph, the allocated set, the search docs, the hover deltas — is supplied by
// the host (no app/IO coupling, like the Items / Skills / Config panels). Hovering
// a node fires onHoverNode(id) so the host can debounce tree.previewAllocate; the
// host feeds the result back as `hoverDeltas`.
//
// jsdom has no canvas 2D implementation, so this suite stubs getContext + layout
// exactly as the TreeCanvas suite does, and asserts on the rendered DOM (region
// markers, search results, tooltip, delta chips) and on the pan/hover callbacks.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
import { buildTreeGraph, buildNodeSearchIndex, TreePanel, t } from '../src/index.js';
import type {
  RawTreeData,
  TreeGraph,
  NodeSearchDoc,
  NodeSearchIndex,
  Viewport,
} from '../src/index.js';
import type { TreeStatDelta } from '@pob2/schema';

// ---------------------------------------------------------------------------
// A small hand-built render graph: four nodes on orbit-0 groups (so a node sits
// at its group centre). node 1 is a notable; the rest small. Three edges chain
// 1-2-3-4; node 4 is far away (used to prove a search→pan moves the viewport).
// ---------------------------------------------------------------------------
function makeGraph(): TreeGraph {
  const constants = {
    orbitRadii: [0],
    skillsPerOrbit: [1],
    orbitAnglesByOrbit: [[0]],
  };
  const node = (skill: number, isNotable = false) => ({
    skill,
    name: `node-${skill}`,
    group: skill,
    orbit: 0,
    orbitIndex: 0,
    stats: [],
    connections: [] as { id: number; orbit: number }[],
    ...(isNotable ? { isNotable: true } : {}),
  });
  const n1 = node(1, true);
  const n2 = node(2);
  const n3 = node(3);
  const n4 = node(4);
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

// Bilingual search docs over the graph (한/영 + alias parity, §8.1).
function makeSearchIndex(): NodeSearchIndex {
  const docs: NodeSearchDoc[] = [
    { nodeId: 1, titleKo: '점화', titleEn: 'Ignite', aliasesKo: ['화상'], aliasesEn: ['burn'] },
    { nodeId: 2, titleKo: '회피', titleEn: 'Evasion', aliasesKo: [], aliasesEn: ['ev'] },
    { nodeId: 3, titleKo: '생명력', titleEn: 'Life', aliasesKo: [], aliasesEn: ['hp'] },
    { nodeId: 4, titleKo: '머나먼', titleEn: 'Faraway', aliasesKo: [], aliasesEn: [] },
  ];
  return buildNodeSearchIndex(docs);
}

// The host-supplied hover delta for node 4 (tree.previewAllocate result).
const HOVER_DELTAS: TreeStatDelta[] = [
  { statId: 'Life', before: 100, after: 120, delta: 20 },
  { statId: 'FireResist', before: 75, after: 75, delta: 0 },
];

// A recording 2D context stub (jsdom has no canvas). Property writes are kept too.
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
  return {
    calls,
    canvas: undefined as unknown,
    save: rec('save'),
    restore: rec('restore'),
    beginPath: rec('beginPath'),
    closePath: rec('closePath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    rect: rec('rect'),
    fill: rec('fill'),
    fillRect: rec('fillRect'),
    stroke: rec('stroke'),
    strokeRect: rec('strokeRect'),
    clearRect: rec('clearRect'),
    setTransform: rec('setTransform'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
}

beforeEach(() => {
  const ctxStub = makeCtxStub();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    ctxStub.canvas = this;
    return ctxStub as unknown as CanvasRenderingContext2D;
  } as typeof HTMLCanvasElement.prototype.getContext);
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

const KO = 'ko-KR' as const;

// ===========================================================================
// (1) The three §10.6 layout elements render: canvas + minimap + search box.
// ===========================================================================
describe('TreePanel layout (DESIGN §10.6: canvas + minimap + search box)', () => {
  it('renders the central tree canvas region', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const canvasRegion = screen.getByTestId('tree-canvas-region');
    expect(canvasRegion).toBeTruthy();
    // The TreeCanvas <canvas> lives inside it.
    expect(canvasRegion.querySelector('canvas')).toBeTruthy();
  });

  it('renders the minimap region with its own canvas + a viewport rectangle marker', () => {
    const { container } = render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const minimap = screen.getByTestId('tree-minimap');
    expect(minimap).toBeTruthy();
    // The minimap paints a reduced tree on a canvas …
    expect(minimap.querySelector('canvas')).toBeTruthy();
    // … and overlays a rectangle marking the current canvas viewport.
    expect(container.querySelector('[data-minimap-viewport]')).toBeTruthy();
  });

  it('renders the node search box (한/영) input', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const search = screen.getByTestId('tree-search');
    expect(search).toBeTruthy();
    expect(within(search).getByRole('textbox')).toBeTruthy();
  });

  it('labels the three regions through the i18n resolver (§8.1 ko label + en alias)', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    // The search box placeholder is a ko label carrying its en alias (§8.1).
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    const placeholder = input.getAttribute('placeholder') ?? '';
    expect(placeholder).toBe(t(KO, 'tree.search.placeholder'));
    expect(placeholder).toMatch(/[가-힣]/); // a Korean label …
    expect(placeholder).toMatch(/[A-Za-z]/); // … with an English alias.
  });
});

// ===========================================================================
// (2) Node search → click result → pan to that node (§10.6 한/영 검색 + pan).
// ===========================================================================
describe('TreePanel search → pan (DESIGN §10.6 한/영 node 검색, click → pan)', () => {
  it('shows bilingual search results for a Korean query', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    fireEvent.change(input, { target: { value: '회피' } });
    const results = screen.getByTestId('tree-search-results');
    // node 2 (회피 / Evasion) is matched; its bilingual label is shown.
    const item = within(results).getByText(/회피/);
    expect(item).toBeTruthy();
  });

  it('shows bilingual search results for an English alias query (§8.1 alias parity)', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    // 'ev' is the en alias of node 2 (회피/Evasion).
    fireEvent.change(input, { target: { value: 'ev' } });
    const results = screen.getByTestId('tree-search-results');
    expect(within(results).getByText(/Evasion/)).toBeTruthy();
  });

  it('clicking a search result pans the viewport so the node lands at the canvas centre', () => {
    const onViewportChange = vi.fn();
    render(
      <TreePanel
        locale={KO}
        graph={makeGraph()}
        allocated={new Set()}
        index={makeSearchIndex()}
        onViewportChange={onViewportChange}
      />,
    );
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    // Search for the far node 4 (world (5000,5000)) and click it.
    fireEvent.change(input, { target: { value: '머나먼' } });
    const results = screen.getByTestId('tree-search-results');
    fireEvent.click(within(results).getByText(/머나먼/));

    // The panel reports a new viewport; with it, node 4's world coords map to the
    // 800×600 canvas centre (400,300).
    expect(onViewportChange).toHaveBeenCalled();
    const vp = onViewportChange.mock.calls.at(-1)![0] as Viewport;
    const screenX = 5000 * vp.scale + vp.offsetX;
    const screenY = 5000 * vp.scale + vp.offsetY;
    expect(screenX).toBeCloseTo(400, 3);
    expect(screenY).toBeCloseTo(300, 3);
  });

  it('an empty query shows no result list (NO-FALLBACK: no full-tree dump)', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.queryByTestId('tree-search-results')).toBeNull();
  });
});

// ===========================================================================
// (3) Hover a node → tooltip + allocation-delta panel (§10.6 "이 노드를 찍으면
//     증가하는 stat" tooltip + allocation delta preview).
// ===========================================================================
describe('TreePanel hover → delta (DESIGN §10.6 tooltip + allocation delta)', () => {
  it('fires onHoverNode with the hovered node id so the host can debounce previewAllocate', () => {
    const onHoverNode = vi.fn();
    const { container } = render(
      <TreePanel
        locale={KO}
        graph={makeGraph()}
        allocated={new Set()}
        index={makeSearchIndex()}
        onHoverNode={onHoverNode}
      />,
    );
    const canvas = container.querySelector(
      '[data-testid="tree-canvas-region"] canvas',
    ) as HTMLCanvasElement;
    // node 1 is at world/screen (0,0); hover it.
    fireEvent.mouseMove(canvas, { clientX: 0, clientY: 0 });
    expect(onHoverNode).toHaveBeenLastCalledWith(1);
  });

  it('renders the hovered node tooltip ("이 노드를 찍으면 증가하는 stat") with its label', () => {
    render(
      <TreePanel
        locale={KO}
        graph={makeGraph()}
        allocated={new Set([1])}
        index={makeSearchIndex()}
        hoveredNodeId={4}
        hoverDeltas={HOVER_DELTAS}
      />,
    );
    const tooltip = screen.getByTestId('tree-hover-tooltip');
    // The §10.6 tooltip heading ("이 노드를 찍으면 증가하는 stat").
    expect(within(tooltip).getByText(t(KO, 'tree.tooltip.title'))).toBeTruthy();
    // The hovered node's display label (node 4).
    expect(within(tooltip).getByText(/node-4/)).toBeTruthy();
  });

  it('renders allocation-delta chips for the hovered node (gain positive, real 0 neutral)', () => {
    render(
      <TreePanel
        locale={KO}
        graph={makeGraph()}
        allocated={new Set([1])}
        index={makeSearchIndex()}
        hoveredNodeId={4}
        hoverDeltas={HOVER_DELTAS}
      />,
    );
    const panel = screen.getByTestId('tree-delta-panel');
    const lifeChip = within(panel).getByText(/Life/).closest('[data-delta-stat]') as HTMLElement;
    expect(lifeChip.getAttribute('data-direction')).toBe('gain');
    expect(within(lifeChip).getByText(/\+20/)).toBeTruthy();

    const resChip = within(panel)
      .getByText(/FireResist/)
      .closest('[data-delta-stat]') as HTMLElement;
    // A REAL 0 delta is neutral, never an absent/missing chip (§6.4).
    expect(resChip.getAttribute('data-direction')).toBe('neutral');
  });

  it('with no hovered node, shows no tooltip / no delta panel (NO-FALLBACK)', () => {
    render(
      <TreePanel locale={KO} graph={makeGraph()} allocated={new Set()} index={makeSearchIndex()} />,
    );
    expect(screen.queryByTestId('tree-hover-tooltip')).toBeNull();
    expect(screen.queryByTestId('tree-delta-panel')).toBeNull();
  });
});
