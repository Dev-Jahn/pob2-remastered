/**
 * @pob2/desktop App — Passive Tree tab wiring (p5-app-wire-tree task; DESIGN §10.6
 * Passive Tree tab, §7.4 allocation delta, §6.3 tree.getData/previewAllocate/
 * applyAllocate, §18 Phase 5, §6.4 NO-FALLBACK).
 *
 * This is the App-composition gate for the Phase 5 Passive Tree tab. It renders the
 * real desktop `App` with an INJECTED session (the real CoreClient spawns a Lua
 * runner jsdom cannot host; DESIGN §5.1 injectable client) and proves the wiring the
 * shipped app uses:
 *
 *   1. Selecting the Passive Tree nav tab routes the workspace pane to the @pob2/ui
 *      TreePanel (replacing the OverviewPanel fallback the route used to show).
 *   2. Opening a build drives the session's getTreeData → the live TreeGraph +
 *      allocated node set the canvas renders (NO-FALLBACK, §6.4).
 *   3. Hovering a node debounces tree.previewAllocate (§10.6 "노드 hover 시 …
 *      debounce") and feeds the result back as the delta panel's chips.
 *   4. Clicking a node commits tree.applyAllocate, which recomputes the build and
 *      re-renders the Overview/Calcs from the fresh stats (§6.3 빌드 수정 → 즉시 재계산).
 *
 * It also unit-covers the build-session tree handlers (the TreeGetDataResponse →
 * TreeGraph transform, the previewAllocate/applyAllocate routing) and the
 * core-ipc-client tree routing (the three tree.* methods over core_request) — both
 * live in this `tree`-named file so `pnpm --filter @pob2/desktop test tree` selects
 * the whole Phase-5 wiring gate.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react';
import { stringsKo } from '@pob2/ui';
import type { CalcRunResponse, TreeGetDataResponse, TreeStatDelta } from '@pob2/schema';
import { App } from '../src/App.js';
import { createBuildSession, treeResponseToGraph, type BuildClient } from '../src/build-session.js';
import {
  createIpcCoreClient,
  type CoreInvoke,
  type ShareCodeCodec,
} from '../src/core-ipc-client.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // jsdom has no canvas 2D context; the TreeCanvas/minimap only paint, so a no-op
  // stub keeps the panel renderable (it asserts on DOM markers, not pixels).
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    setTransform: () => {},
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
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

/**
 * The runner's tree.getData envelope for a tiny three-node tree: node 1 is a
 * ClassStart (allocated), node 2 a Notable, node 3 a small. The session's transform
 * lifts these into the render-ready TreeGraph the panel draws.
 */
const TREE_DATA: TreeGetDataResponse = {
  treeVersion: '0_5',
  nodes: [
    {
      nodeId: 1,
      name: 'Start',
      type: 'ClassStart',
      x: 0,
      y: 0,
      orbit: 0,
      orbitIndex: 0,
      group: 1,
      isAscendancy: false,
      connections: [2],
    },
    {
      nodeId: 2,
      name: 'Heavy Hitter',
      type: 'Notable',
      x: 100,
      y: 0,
      orbit: 0,
      orbitIndex: 0,
      group: 2,
      isAscendancy: false,
      connections: [1, 3],
    },
    {
      nodeId: 3,
      name: 'Minor Boost',
      type: 'Normal',
      x: 200,
      y: 0,
      orbit: 0,
      orbitIndex: 0,
      group: 3,
      isAscendancy: false,
      connections: [2],
    },
  ],
  groups: [
    { groupId: 1, x: 0, y: 0 },
    { groupId: 2, x: 100, y: 0 },
    { groupId: 3, x: 200, y: 0 },
  ],
  constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
  allocatedNodeIds: [1],
};

/** The previewAllocate deltas the runner returns for hovering node 2 (§7.4). */
const PREVIEW_DELTAS: TreeStatDelta[] = [
  { statId: 'Life', before: 100, after: 130, delta: 30 },
  { statId: 'FireResist', before: 75, after: 75, delta: 0 },
];

/** calc.run before allocation: Total DPS 100. */
const STATS_BEFORE: CalcRunResponse = {
  buildId: 'b1',
  stats: [
    { statId: 'Life', value: 65, label: 'Life' },
    { statId: 'TotalDPS', value: 100, label: 'Total DPS' },
  ],
};

/** calc.run AFTER committing the allocation: Total DPS recalculated to 175. */
const STATS_AFTER: CalcRunResponse = {
  buildId: 'b1',
  stats: [
    { statId: 'Life', value: 65, label: 'Life' },
    { statId: 'TotalDPS', value: 175, label: 'Total DPS' },
  ],
};

/**
 * A recording session for the tree wiring. open() yields STATS_BEFORE; getTreeData
 * yields TREE_DATA (node 1 allocated); previewAllocate yields PREVIEW_DELTAS;
 * applyAllocate commits the node, re-runs calc (yielding STATS_AFTER) and reports
 * the grown allocated set. It logs the calls the App makes so the wiring is
 * assertable without a Lua runner.
 */
function fakeSession() {
  const previewed: number[][] = [];
  const applied: number[][] = [];
  let allocated = [...TREE_DATA.allocatedNodeIds];
  let mutated = false;
  return {
    previewed,
    applied,
    async open(source: unknown) {
      void source;
      return { summary: { className: 'Warrior', level: 1 }, stats: STATS_BEFORE };
    },
    async save() {
      return { format: 'xml' as const, data: '<xml/>' };
    },
    async getEquipped() {
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('parseClipboard not used in the tree suite');
    },
    async getSkillGroups() {
      return { groups: [] };
    },
    async setGemGroup() {
      return STATS_BEFORE;
    },
    async getConfigOptions() {
      return { options: [] };
    },
    async setConfigOption() {
      return STATS_BEFORE;
    },
    async explainStat() {
      throw new Error('explainStat not used in the tree suite');
    },
    async getTreeData() {
      // Drive the REAL session transform (the production path), so the App test
      // exercises the same edge-derivation the shipped app does — not a hand-rolled
      // mirror that could drift from (and hide a bug in) treeResponseToGraph.
      return { graph: treeResponseToGraph(TREE_DATA).graph, allocated: new Set(allocated) };
    },
    async previewAllocate(nodeIds: number[]) {
      previewed.push(nodeIds);
      return PREVIEW_DELTAS;
    },
    async applyAllocate(nodeIds: number[]) {
      applied.push(nodeIds);
      allocated = [...new Set([...allocated, ...nodeIds])];
      mutated = true;
      return { allocated: new Set(allocated), stats: mutated ? STATS_AFTER : STATS_BEFORE };
    },
  };
}

/** Click the nav-rail entry with the given Korean label to switch the workspace. */
function selectTab(label: string): void {
  const nav = screen.getByRole('navigation');
  fireEvent.click(within(nav).getByText(label));
}

describe('@pob2/desktop App — Passive Tree tab routing (DESIGN §10.6, §18 Phase 5)', () => {
  it('routes the workspace to the TreePanel when the Passive Tree tab is selected', () => {
    render(<App session={fakeSession() as never} />);
    // Overview is the default workspace — no tree canvas region yet.
    expect(document.querySelector('.pob-tree')).toBeNull();

    selectTab(stringsKo['nav.passiveTree']);

    // The §10.6 layout (canvas region + search box) is mounted — the OverviewPanel
    // fallback is gone.
    expect(document.querySelector('.pob-tree')).toBeTruthy();
    expect(screen.getByTestId('tree-canvas-region')).toBeTruthy();
    expect(screen.getByTestId('tree-search')).toBeTruthy();
  });

  it('selects the Passive Tree tab on mount when the location is the /tree route', () => {
    window.history.replaceState(null, '', '/tree');
    render(<App session={fakeSession() as never} />);

    const nav = screen.getByRole('navigation');
    const active = within(nav).getByRole('button', { current: 'page' });
    expect(active.textContent).toBe(stringsKo['nav.passiveTree']);
    expect(document.querySelector('.pob-tree')).toBeTruthy();
  });

  it('reflects the /tree route into window.location.pathname (route sync)', () => {
    render(<App session={fakeSession() as never} />);
    expect(window.location.pathname).toBe('/');

    selectTab(stringsKo['nav.passiveTree']);
    expect(window.location.pathname).toBe('/tree');
  });
});

describe('@pob2/desktop App — Passive Tree drives off the live session (DESIGN §6.3)', () => {
  it("populates the tree canvas from the opened build's getTreeData (search finds a real node)", async () => {
    render(
      <App
        session={fakeSession() as never}
        resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
      />,
    );

    // Open the build — getTreeData runs as part of the open flow.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(document.querySelector('[data-command-id="build-open"]') as HTMLElement);
    await screen.findByText('Warrior'); // open() flushed (header shows the class)

    selectTab(stringsKo['nav.passiveTree']);

    // Searching the build's REAL node label resolves a result (the search index was
    // built from the live getTreeData graph, not a fabricated one).
    const input = within(screen.getByTestId('tree-search')).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Heavy' } });
    const results = await screen.findByTestId('tree-search-results');
    expect(within(results).getByText(/Heavy Hitter/)).toBeTruthy();
  });

  it('hovering a node debounces tree.previewAllocate and shows its delta chips (§10.6)', async () => {
    vi.useFakeTimers();
    try {
      const session = fakeSession();
      render(
        <App
          session={session as never}
          resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
        />,
      );

      // Open the build, then switch to the tree.
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      fireEvent.click(document.querySelector('[data-command-id="build-open"]') as HTMLElement);
      await vi.runOnlyPendingTimersAsync(); // flush open()'s awaits
      selectTab(stringsKo['nav.passiveTree']);

      const canvas = document.querySelector(
        '[data-testid="tree-canvas-region"] canvas',
      ) as HTMLCanvasElement;

      // Hover node 2 (world/screen 100,0) several times in quick succession.
      fireEvent.mouseMove(canvas, { clientX: 100, clientY: 0 });
      fireEvent.mouseMove(canvas, { clientX: 100, clientY: 0 });
      fireEvent.mouseMove(canvas, { clientX: 100, clientY: 0 });

      // BEFORE the debounce window elapses, previewAllocate has NOT been called.
      expect(session.previewed).toEqual([]);

      // After the debounce window, exactly ONE previewAllocate fires for node 2.
      await vi.advanceTimersByTimeAsync(250);
      expect(session.previewed).toEqual([[2]]);

      // The returned deltas render as the §10.6 delta chips (Life gain +30).
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      const panel = screen.getByTestId('tree-delta-panel');
      const lifeChip = within(panel).getByText(/Life/).closest('[data-delta-stat]') as HTMLElement;
      expect(lifeChip.getAttribute('data-direction')).toBe('gain');
      expect(within(lifeChip).getByText(/\+30/)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clicking a node commits tree.applyAllocate and recomputes Overview/Calcs stats', async () => {
    const session = fakeSession();
    render(
      <App
        session={session as never}
        resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
      />,
    );

    // Open the build: Overview shows the pre-allocation Total DPS (100).
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(document.querySelector('[data-command-id="build-open"]') as HTMLElement);
    await screen.findByText('Warrior');
    const dpsBefore = document.querySelector('[data-stat-id="TotalDPS"]') as HTMLElement;
    expect(within(dpsBefore).getByText('100')).toBeTruthy();

    // Switch to the tree and click node 2 (world/screen 100,0).
    selectTab(stringsKo['nav.passiveTree']);
    const canvas = document.querySelector(
      '[data-testid="tree-canvas-region"] canvas',
    ) as HTMLCanvasElement;
    await act(async () => {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 0 });
      fireEvent.mouseUp(canvas, { clientX: 100, clientY: 0 });
    });

    // The session committed the allocation for node 2.
    expect(session.applied).toEqual([[2]]);

    // The OVERVIEW re-rendered from the recalculated stats (Total DPS 100 → 175).
    selectTab(stringsKo['nav.overview']);
    const dpsAfter = document.querySelector('[data-stat-id="TotalDPS"]') as HTMLElement;
    expect(within(dpsAfter).getByText('175')).toBeTruthy();
  });
});

// ===========================================================================
// build-session tree handlers (DESIGN §6.3 tree.getData/previewAllocate/applyAllocate)
// ===========================================================================

/** The runner's tree.getData wire envelope a BuildClient.getTreeData returns. */
const GETDATA_WIRE: TreeGetDataResponse = TREE_DATA;

/**
 * A recording mock BuildClient for the build-session tree handlers. calcRun returns
 * STATS_BEFORE first, then STATS_AFTER, so an applyAllocate → recalc surfaces fresh
 * stats. Only the methods the tree handlers touch are exercised here.
 */
function mockTreeClient(): BuildClient & { calls: Array<{ method: string; arg: unknown }> } {
  const calls: Array<{ method: string; arg: unknown }> = [];
  let calcRuns = 0;
  return {
    calls,
    async load(xml: string) {
      calls.push({ method: 'load', arg: xml });
      return { buildId: 'build-1', summary: { className: 'Warrior', level: 1 } };
    },
    async loadShareCode(code: string) {
      calls.push({ method: 'loadShareCode', arg: code });
      return { buildId: 'build-1', summary: { className: 'Warrior', level: 1 } };
    },
    async calcRun(buildId: string) {
      calls.push({ method: 'calcRun', arg: buildId });
      return calcRuns++ === 0 ? STATS_BEFORE : STATS_AFTER;
    },
    async save(buildId: string) {
      calls.push({ method: 'save', arg: buildId });
      return { format: 'xml', data: '<xml/>' };
    },
    async saveShareCode(buildId: string) {
      calls.push({ method: 'saveShareCode', arg: buildId });
      return { format: 'shareCode', data: 'eNcOdEd' };
    },
    async getEquipped(buildId: string) {
      calls.push({ method: 'getEquipped', arg: buildId });
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('not used');
    },
    async createCustom() {
      throw new Error('not used');
    },
    async equipDelta(buildId: string) {
      void buildId;
      return { slot: '', deltas: [] };
    },
    async getSkillGroups() {
      return { groups: [] };
    },
    async setGemGroup(buildId: string, groupId: string) {
      void buildId;
      return { groupId };
    },
    async getConfigOptions() {
      return { options: [] };
    },
    async setConfigOption(buildId: string, optionId: string) {
      void buildId;
      return { optionId };
    },
    async explainStat() {
      throw new Error('not used');
    },
    async getTreeData(buildId: string) {
      calls.push({ method: 'getTreeData', arg: buildId });
      return GETDATA_WIRE;
    },
    async previewAllocate(buildId: string, nodeIds: number[]) {
      calls.push({ method: 'previewAllocate', arg: { buildId, nodeIds } });
      return { deltas: PREVIEW_DELTAS };
    },
    async applyAllocate(buildId: string, nodeIds: number[]) {
      calls.push({ method: 'applyAllocate', arg: { buildId, nodeIds } });
      return { allocatedNodeIds: [...new Set([...GETDATA_WIRE.allocatedNodeIds, ...nodeIds])] };
    },
  };
}

describe('build-session — tree handlers (DESIGN §6.3, §10.6)', () => {
  it('getTreeData() transforms the runner envelope into a render TreeGraph + allocated set', async () => {
    const client = mockTreeClient();
    const session = createBuildSession(client);
    await session.open({ xml: '<Build/>' });

    const { graph, allocated } = await session.getTreeData();

    expect(client.calls.at(-1)).toEqual({ method: 'getTreeData', arg: 'build-1' });
    // The render graph carries every node, classified by its runner `type` string.
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodeIndex[2]?.kind).toBe('notable');
    expect(graph.nodeIndex[1]?.kind).toBe('small'); // ClassStart → small
    expect(graph.nodeIndex[2]?.label).toBe('Heavy Hitter');
    // Absolute coordinates from the runner are carried through (no orbit math).
    expect(graph.nodeIndex[2]?.x).toBe(100);
    // The allocated set is the runner's allocatedNodeIds, as a numeric Set.
    expect(allocated).toEqual(new Set([1]));
  });

  it('rejects getTreeData() before a build is opened (no buildId to query)', async () => {
    const client = mockTreeClient();
    const session = createBuildSession(client);
    await expect(session.getTreeData()).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  it('previewAllocate() routes the node ids to the client and returns the raw deltas', async () => {
    const client = mockTreeClient();
    const session = createBuildSession(client);
    await session.open({ xml: '<Build/>' });

    const deltas = await session.previewAllocate([2]);

    expect(deltas).toEqual(PREVIEW_DELTAS);
    expect(client.calls.at(-1)).toEqual({
      method: 'previewAllocate',
      arg: { buildId: 'build-1', nodeIds: [2] },
    });
  });

  it('applyAllocate() commits the node, re-runs calc, and returns the new allocated set + stats', async () => {
    const client = mockTreeClient();
    const session = createBuildSession(client);
    await session.open({ xml: '<Build/>' }); // calcRun #0 → STATS_BEFORE

    const { allocated, stats } = await session.applyAllocate([2]);

    // applyAllocate (commit) THEN calcRun (recalc) — the recalc surfaces fresh stats.
    expect(client.calls.map((c) => c.method)).toEqual([
      'load',
      'calcRun',
      'applyAllocate',
      'calcRun',
    ]);
    expect(allocated).toEqual(new Set([1, 2]));
    expect(stats).toBe(STATS_AFTER);
  });

  it('rejects previewAllocate()/applyAllocate() before a build is opened (NO-FALLBACK)', async () => {
    const client = mockTreeClient();
    const session = createBuildSession(client);
    await expect(session.previewAllocate([2])).rejects.toThrow();
    await expect(session.applyAllocate([2])).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });
});

// ===========================================================================
// core-ipc-client tree routing (DESIGN §14.1 allowlisted core_request)
// ===========================================================================

/** A recording mock `invoke`: returns canned runner wire shapes per method. */
function mockInvoke(
  responses: Record<string, unknown>,
): CoreInvoke & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  const fn = (async (command: string, args: { method: string; params: unknown }) => {
    expect(command).toBe('core_request');
    calls.push({ method: args.method, params: args.params });
    if (!(args.method in responses)) {
      throw new Error(`mock invoke: no canned response for ${args.method}`);
    }
    return responses[args.method];
  }) as CoreInvoke & { calls: Array<{ method: string; params: unknown }> };
  fn.calls = calls;
  return fn;
}

const stubCodec: ShareCodeCodec = {
  decode: (code) => `<xml-for:${code}>`,
  encode: (xml) => `code-for:${xml}`,
};

describe('core-ipc-client — tree Core API over core_request (DESIGN §6.3, §10.6)', () => {
  it('getTreeData(id) calls core_request("tree.getData", {buildId}) and lifts the envelope', async () => {
    const invoke = mockInvoke({ 'tree.getData': GETDATA_WIRE });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.getTreeData('build-1');

    expect(invoke.calls).toEqual([{ method: 'tree.getData', params: { buildId: 'build-1' } }]);
    expect(result.treeVersion).toBe('0_5');
    expect(result.nodes).toHaveLength(3);
    expect(result.allocatedNodeIds).toEqual([1]);
  });

  it('getTreeData(id) returns empty lists when the runner reports nothing (no fabrication)', async () => {
    const invoke = mockInvoke({ 'tree.getData': {} });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.getTreeData('build-1');
    expect(result).toEqual({
      treeVersion: '',
      nodes: [],
      groups: [],
      constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
      allocatedNodeIds: [],
    });
  });

  it('previewAllocate(id, ids) calls core_request("tree.previewAllocate", {buildId, nodeIds})', async () => {
    const invoke = mockInvoke({ 'tree.previewAllocate': { deltas: PREVIEW_DELTAS } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.previewAllocate('build-1', [2]);

    expect(invoke.calls).toEqual([
      { method: 'tree.previewAllocate', params: { buildId: 'build-1', nodeIds: [2] } },
    ]);
    expect(result).toEqual({ deltas: PREVIEW_DELTAS });
  });

  it('applyAllocate(id, ids) calls core_request("tree.applyAllocate", {buildId, nodeIds})', async () => {
    const invoke = mockInvoke({ 'tree.applyAllocate': { allocatedNodeIds: [1, 2] } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.applyAllocate('build-1', [2]);

    expect(invoke.calls).toEqual([
      { method: 'tree.applyAllocate', params: { buildId: 'build-1', nodeIds: [2] } },
    ]);
    expect(result).toEqual({ allocatedNodeIds: [1, 2] });
  });

  it('an IPC client satisfies BuildClient so the same build-session drives the tree', async () => {
    const invoke = mockInvoke({
      'build.load': { buildId: 'build-1', summary: { className: 'Warrior', level: 1 } },
      'calc.run': { stats: STATS_BEFORE.stats },
      'tree.getData': GETDATA_WIRE,
    });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });
    const session = createBuildSession(client);

    await session.open({ xml: '<Build/>' });
    const { graph, allocated } = await session.getTreeData();

    expect(graph.nodes).toHaveLength(3);
    expect(allocated).toEqual(new Set([1]));
  });
});
