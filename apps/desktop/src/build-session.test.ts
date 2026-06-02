/**
 * build-session test (build-open-save task) — the thin async data layer that
 * wires the read-only Overview viewer to @pob2/core-client (DESIGN §18 Phase 2
 * doneCriteria "기존 build 파일을 열어 Overview 표시", §6.3 load/save/share-code,
 * §12.3 round-trip).
 *
 * The real CoreClient spawns an out-of-process Lua runner (overlays/lua/runner.lua)
 * which jsdom/vitest cannot host, so the data layer takes the client as an
 * INJECTABLE dependency (DESIGN §5.1: host owns the runner, UI/data layer is pure).
 * These tests inject a MOCK client that records calls and returns canned
 * {buildId, summary} / {buildId, stats} / {format, data} shapes — exactly the
 * @pob2/core-client method results — so we assert the data layer's wiring without
 * a live runner. @pob2/core-client internals are NOT touched.
 *
 * Coverage:
 *   - open({ xml }) routes through client.load + client.calcRun and returns
 *     { summary, stats } where `stats` is a CalcRunResponse that drives the
 *     buildOverviewModel (the Overview view-model from @pob2/ui).
 *   - open({ shareCode }) routes through client.loadShareCode (not load).
 *   - save() round-trips: save({ format: 'xml' }) -> client.save, and
 *     save({ format: 'shareCode' }) -> client.saveShareCode, returning the
 *     client's {format, data} verbatim. Saving before open is rejected.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildOverviewModel } from '@pob2/ui';
import type {
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  EquippedItem,
  GemInput,
  ItemsParseClipboardResponse,
  SkillsGetGroupsResponse,
  TreeGetDataResponse,
} from '@pob2/schema';
import { createBuildSession, treeResponseToGraph, type BuildClient } from './build-session.js';

const here = dirname(fileURLToPath(import.meta.url));
// apps/desktop/src -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

/** Curated stats a real calc.run returns for the sample build (DESIGN §10.3). */
const SAMPLE_STATS: CalcRunResponse = {
  buildId: 'build-1',
  stats: [
    { statId: 'TotalDPS', value: 1234.5, label: 'Total DPS' },
    { statId: 'Life', value: 50, label: 'Life' },
    { statId: 'Mana', value: 40, label: 'Mana' },
  ],
};

/** The build's equipped boots an items.getEquipped pass returns (DESIGN §6.3). */
const SAMPLE_BOOTS: EquippedItem = {
  slot: 'Boots',
  itemId: 'item-boots-1',
  name: 'Sorrow Sole',
  rarity: 'Rare',
  baseName: 'Hunting Shoes',
  requirements: { level: 33, str: 0, dex: 62, int: 0 },
  summaryMods: ['25% increased Movement Speed'],
  unsupportedMods: ['Mirror something the parser cannot read'],
};

/** A clipboard parse with one recognised mod, one unrecognised line (DESIGN §8.6). */
const SAMPLE_PARSE: ItemsParseClipboardResponse = {
  locale: 'en-US',
  baseId: 'Hunting Shoes',
  rarity: 'Rare',
  name: 'Sorrow Sole',
  mods: [{ raw: '25% increased Movement Speed', status: 'parsed', statId: 'move_speed' }],
  unsupported: ['Mirror something the parser cannot read'],
};

/** The sample build's one socket group a skills.getGroups pass returns (§10.5). */
const SAMPLE_GROUPS: SkillsGetGroupsResponse = {
  groups: [
    {
      groupId: '1',
      label: 'Mace Strike',
      enabled: true,
      spirit: 0,
      reservation: 0,
      gems: [
        { gemId: 'SkillGemMaceStrike', name: 'Mace Strike', level: 1, quality: 0, enabled: true },
      ],
      activeGems: [
        { gemId: 'SkillGemMaceStrike', name: 'Mace Strike', level: 1, quality: 0, enabled: true },
      ],
      supportGems: [],
    },
  ],
};

/** The build's config-option cards a config.getOptions pass returns (§10.8). */
const SAMPLE_OPTIONS: ConfigGetOptionsResponse = {
  options: [
    {
      optionId: 'enemyIsBoss',
      type: 'list',
      label: 'Enemy is a Boss',
      value: 'Pinnacle',
      dependentModifiers: ['EnemyModifier'],
    },
  ],
};

/** The calc.explain formula trace a stat-explain pass returns for Life (§10.7). */
const SAMPLE_EXPLAIN: CalcExplainResponse = {
  statId: 'Life',
  finalValue: 65,
  label: 'Life',
  sources: [],
  formula: '62 base x 1.05',
  upstreamStatId: 'Life',
};

/** The recalculated stats a calc.run AFTER a build mutation returns (§6.3 recalc). */
const RECALC_STATS: CalcRunResponse = {
  buildId: 'build-1',
  stats: [
    { statId: 'TotalDPS', value: 9999.9, label: 'Total DPS' },
    { statId: 'Life', value: 50, label: 'Life' },
    { statId: 'Mana', value: 40, label: 'Mana' },
  ],
};

/** A gem swap input a setGemGroup pass writes (§6.3 skills.setGemGroup). */
const SWAP_GEMS: GemInput[] = [
  { gemId: 'SkillGemBoneshatter', level: 20, quality: 0, enabled: true },
];

/**
 * A recording mock CoreClient: structurally a {@link BuildClient}, returns canned
 * @pob2/core-client shapes and logs every call so the wiring can be asserted. No
 * Lua runner is spawned (DESIGN §5.1 injectable client).
 *
 * `calcRun` returns SAMPLE_STATS the first time and RECALC_STATS on every later
 * call, so a "mutate then recalc" flow (setGemGroup/setConfigOption) can be proven
 * to surface the FRESH calc.run output, not a stale snapshot.
 */
function mockClient(): BuildClient & {
  calls: Array<{ method: string; arg: unknown }>;
} {
  const calls: Array<{ method: string; arg: unknown }> = [];
  let calcRuns = 0;
  return {
    calls,
    async load(xml: string) {
      calls.push({ method: 'load', arg: xml });
      return { buildId: 'build-1', summary: { className: 'Ranger', level: 1, itemCount: 1 } };
    },
    async loadShareCode(code: string) {
      calls.push({ method: 'loadShareCode', arg: code });
      return { buildId: 'build-1', summary: { className: 'Ranger', level: 1, itemCount: 1 } };
    },
    async calcRun(buildId: string) {
      calls.push({ method: 'calcRun', arg: buildId });
      // First run returns the load-time stats; every later run returns the
      // post-mutation stats so a recalc surfaces fresh output, not a snapshot.
      return calcRuns++ === 0 ? SAMPLE_STATS : RECALC_STATS;
    },
    async save(buildId: string) {
      calls.push({ method: 'save', arg: buildId });
      return { format: 'xml', data: sampleXml };
    },
    async saveShareCode(buildId: string) {
      calls.push({ method: 'saveShareCode', arg: buildId });
      return { format: 'shareCode', data: 'eNcOdEd' };
    },
    async getEquipped(buildId: string) {
      calls.push({ method: 'getEquipped', arg: buildId });
      return { equipped: [SAMPLE_BOOTS] };
    },
    async parseClipboard(text: string, localeHint?) {
      calls.push({ method: 'parseClipboard', arg: { text, localeHint } });
      return SAMPLE_PARSE;
    },
    async createCustom(baseId: string, mods) {
      calls.push({ method: 'createCustom', arg: { baseId, mods } });
      return { itemId: 'custom-1', item: { ...SAMPLE_BOOTS, itemId: 'custom-1' } };
    },
    async equipDelta(buildId: string, item, slot) {
      calls.push({ method: 'equipDelta', arg: { buildId, itemId: item.itemId, slot } });
      return { slot, deltas: [] };
    },
    async getSkillGroups(buildId: string) {
      calls.push({ method: 'getSkillGroups', arg: buildId });
      return SAMPLE_GROUPS;
    },
    async setGemGroup(buildId: string, groupId: string, gems) {
      calls.push({ method: 'setGemGroup', arg: { buildId, groupId, gems } });
      return { groupId };
    },
    async getConfigOptions(buildId: string) {
      calls.push({ method: 'getConfigOptions', arg: buildId });
      return SAMPLE_OPTIONS;
    },
    async setConfigOption(buildId: string, optionId: string, value) {
      calls.push({ method: 'setConfigOption', arg: { buildId, optionId, value } });
      return { optionId };
    },
    async explainStat(buildId: string, statId: string, activeSkillId?) {
      calls.push({ method: 'explainStat', arg: { buildId, statId, activeSkillId } });
      return SAMPLE_EXPLAIN;
    },
    // The §10.6 Passive Tree client surface (DESIGN §6.3 tree.getData/previewAllocate/
    // applyAllocate). Exercised by the tree-handler suite in App.tree.test.tsx; here
    // they return empty/no-op shapes so the mock satisfies the BuildClient contract.
    async getTreeData(buildId: string) {
      calls.push({ method: 'getTreeData', arg: buildId });
      return {
        treeVersion: '',
        nodes: [],
        groups: [],
        constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
        allocatedNodeIds: [],
      };
    },
    async previewAllocate(buildId: string, nodeIds: number[]) {
      calls.push({ method: 'previewAllocate', arg: { buildId, nodeIds } });
      return { deltas: [] };
    },
    async applyAllocate(buildId: string, nodeIds: number[]) {
      calls.push({ method: 'applyAllocate', arg: { buildId, nodeIds } });
      return { allocatedNodeIds: [] };
    },
  };
}

describe('build-session — open()', () => {
  it('loads the sample-build XML via client.load + client.calcRun and yields { summary, stats }', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    const result = await session.open({ xml: sampleXml });

    // Routed through load (with the XML) then calcRun (with the returned buildId).
    expect(client.calls).toEqual([
      { method: 'load', arg: sampleXml },
      { method: 'calcRun', arg: 'build-1' },
    ]);

    // Shaped for the Overview view-model: a BuildSummary plus a CalcRunResponse.
    expect(result.summary).toEqual({ className: 'Ranger', level: 1, itemCount: 1 });
    expect(result.stats).toBe(SAMPLE_STATS);
  });

  it('yields stats that drive the Overview view-model (offence Total DPS present)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    const { summary, stats } = await session.open({ xml: sampleXml });
    const model = buildOverviewModel(stats, summary);

    // The summary header flows through unchanged.
    expect(model.summary.className).toBe('Ranger');

    // Total DPS is the first offence field and resolves to the real calc value.
    const totalDps = model.offence.fields.find((f) => f.statId === 'TotalDPS');
    expect(totalDps?.present).toBe(true);
    expect(totalDps?.present && totalDps.value).toBe(1234.5);

    // A stat the calc did not emit (Energy Shield) stays missing, never a 0.
    const es = model.defence.fields.find((f) => f.statId === 'EnergyShield');
    expect(es?.present).toBe(false);
  });

  it('routes a share code through client.loadShareCode (not client.load)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ shareCode: 'eNcOdEd' });

    expect(client.calls).toEqual([
      { method: 'loadShareCode', arg: 'eNcOdEd' },
      { method: 'calcRun', arg: 'build-1' },
    ]);
  });
});

describe('build-session — save() round-trip', () => {
  it('exports XML through client.save after a build is open', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const saved = await session.save({ format: 'xml' });

    expect(saved).toEqual({ format: 'xml', data: sampleXml });
    expect(client.calls.at(-1)).toEqual({ method: 'save', arg: 'build-1' });
  });

  it('exports a share code through client.saveShareCode after a build is open', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const saved = await session.save({ format: 'shareCode' });

    expect(saved).toEqual({ format: 'shareCode', data: 'eNcOdEd' });
    expect(client.calls.at(-1)).toEqual({ method: 'saveShareCode', arg: 'build-1' });
  });

  it('rejects save() when no build has been opened (no buildId to round-trip)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.save({ format: 'xml' })).rejects.toThrow();
    // Nothing was sent to the client.
    expect(client.calls).toEqual([]);
  });
});

describe('build-session — Items tab paths (DESIGN §10.4, §6.3)', () => {
  it('getEquipped() routes to client.getEquipped with the open buildId', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const equipped = await session.getEquipped();

    // Returns the build's real equipped gear, routed with the open build id.
    expect(equipped.equipped).toHaveLength(1);
    expect(equipped.equipped.at(0)?.name).toBe('Sorrow Sole');
    expect(client.calls.at(-1)).toEqual({ method: 'getEquipped', arg: 'build-1' });
  });

  it('rejects getEquipped() before a build is opened (no buildId to query)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.getEquipped()).rejects.toThrow();
    // Nothing was sent to the client (NO-FALLBACK — no fabricated empty grid).
    expect(client.calls).toEqual([]);
  });

  it('parseClipboard() shapes the parse into an inspector item (parsed/unsupported split)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    // No open build required — pasting an item is independent of the loaded build.
    const { item, locale } = await session.parseClipboard('Sorrow Sole\nHunting Shoes');

    expect(client.calls).toEqual([
      {
        method: 'parseClipboard',
        arg: { text: 'Sorrow Sole\nHunting Shoes', localeHint: undefined },
      },
    ]);
    // The recognised mod is parsed; the unrecognised line stays separate (§8.6).
    expect(item.name).toBe('Sorrow Sole');
    expect(item.baseType).toBe('Hunting Shoes');
    expect(item.parsedMods).toEqual(['25% increased Movement Speed']);
    expect(item.unsupportedMods).toEqual(['Mirror something the parser cannot read']);
    // The detected source locale is surfaced for the §8.6 import indicator.
    expect(locale).toBe('en-US');
  });
});

describe('build-session — Skills/Config/Calcs read paths (DESIGN §6.3, §10.5/§10.7/§10.8)', () => {
  it('getSkillGroups() routes to client.getSkillGroups with the open buildId', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const groups = await session.getSkillGroups();

    // Returns the build's real socket groups, routed with the open build id.
    expect(groups).toBe(SAMPLE_GROUPS);
    expect(client.calls.at(-1)).toEqual({ method: 'getSkillGroups', arg: 'build-1' });
  });

  it('rejects getSkillGroups() before a build is opened (no buildId to query)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.getSkillGroups()).rejects.toThrow();
    // Nothing was sent to the client (NO-FALLBACK — no fabricated empty group list).
    expect(client.calls).toEqual([]);
  });

  it('getConfigOptions() routes to client.getConfigOptions with the open buildId', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const options = await session.getConfigOptions();

    expect(options).toBe(SAMPLE_OPTIONS);
    expect(client.calls.at(-1)).toEqual({ method: 'getConfigOptions', arg: 'build-1' });
  });

  it('rejects getConfigOptions() before a build is opened (no buildId to query)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.getConfigOptions()).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });

  it('explainStat() routes to client.explainStat with the open buildId, statId and skill', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const explain = await session.explainStat('Life', 'skill-1');

    expect(explain).toBe(SAMPLE_EXPLAIN);
    expect(client.calls.at(-1)).toEqual({
      method: 'explainStat',
      arg: { buildId: 'build-1', statId: 'Life', activeSkillId: 'skill-1' },
    });
  });

  it('explainStat() passes an undefined active skill straight through (optional arg)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    await session.explainStat('Life');

    expect(client.calls.at(-1)).toEqual({
      method: 'explainStat',
      arg: { buildId: 'build-1', statId: 'Life', activeSkillId: undefined },
    });
  });

  it('rejects explainStat() before a build is opened (no buildId to query)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.explainStat('Life')).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });
});

describe('build-session — mutate then recalc (DESIGN §6.3 빌드 수정 → 즉시 재계산)', () => {
  it('setGemGroup() writes the group then re-runs calc.run, returning the FRESH stats', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    const opened = await session.open({ xml: sampleXml });
    // The load-time calc.run yields the baseline stats.
    expect(opened.stats).toBe(SAMPLE_STATS);

    const stats = await session.setGemGroup('1', SWAP_GEMS);

    // The write is routed, then a fresh calc.run re-runs on the open build id.
    expect(client.calls).toEqual([
      { method: 'load', arg: sampleXml },
      { method: 'calcRun', arg: 'build-1' },
      { method: 'setGemGroup', arg: { buildId: 'build-1', groupId: '1', gems: SWAP_GEMS } },
      { method: 'calcRun', arg: 'build-1' },
    ]);
    // The returned stats are the RECALCULATED ones, not the stale snapshot.
    expect(stats).toBe(RECALC_STATS);
    expect(stats.stats.find((s) => s.statId === 'TotalDPS')?.value).toBe(9999.9);
  });

  it('setConfigOption() writes the option then re-runs calc.run, returning the FRESH stats', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const stats = await session.setConfigOption('enemyIsBoss', 'None');

    expect(client.calls).toEqual([
      { method: 'load', arg: sampleXml },
      { method: 'calcRun', arg: 'build-1' },
      {
        method: 'setConfigOption',
        arg: { buildId: 'build-1', optionId: 'enemyIsBoss', value: 'None' },
      },
      { method: 'calcRun', arg: 'build-1' },
    ]);
    expect(stats).toBe(RECALC_STATS);
  });

  it('rejects setGemGroup() before a build is opened (no buildId — no write, no recalc)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.setGemGroup('1', SWAP_GEMS)).rejects.toThrow();
    // NO-FALLBACK: nothing was written and no calc.run was triggered.
    expect(client.calls).toEqual([]);
  });

  it('rejects setConfigOption() before a build is opened (no buildId — no write, no recalc)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.setConfigOption('enemyIsBoss', 'None')).rejects.toThrow();
    expect(client.calls).toEqual([]);
  });
});

// The §10.6 renderer paints the connecting edges and the path-preview walks the
// graph — both need the edge list derived from each node's `connections` (core
// `node.linkedId`). If the transform dropped the edges, the shipped /tree canvas
// would render disconnected floating discs and path-preview would be dead. This
// guards the live transform (DESIGN §10.6, §6.4 NO phantom edge).
describe('build-session — treeResponseToGraph edge derivation (DESIGN §10.6)', () => {
  function node(nodeId: number, connections: number[]): TreeGetDataResponse['nodes'][number] {
    return {
      nodeId,
      name: `n${nodeId}`,
      type: 'Normal',
      x: nodeId * 10,
      y: 0,
      orbit: 0,
      orbitIndex: 0,
      group: 1,
      isAscendancy: false,
      connections,
    };
  }

  it('derives a deduplicated undirected edge list from node connections', () => {
    const response: TreeGetDataResponse = {
      treeVersion: '0_5',
      // 1—2—3 chain; the 1↔2 link is declared from BOTH ends (must dedup to one edge).
      nodes: [node(1, [2]), node(2, [1, 3]), node(3, [2])],
      groups: [{ groupId: 1, x: 0, y: 0 }],
      constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
      allocatedNodeIds: [1],
    };

    const { graph } = treeResponseToGraph(response);

    // Two undirected edges, normalized a<b, the 1↔2 pair deduped to a single edge.
    expect(graph.edges).toEqual([
      { a: 1, b: 2 },
      { a: 2, b: 3 },
    ]);
  });

  it('drops self-edges and connections to nodes absent from the graph (NO phantom edge)', () => {
    const response: TreeGetDataResponse = {
      treeVersion: '0_5',
      // node 1 links to itself (self-edge) and to 999 (not in the graph) — both dropped;
      // only the real 1↔2 edge survives.
      nodes: [node(1, [1, 999, 2]), node(2, [1])],
      groups: [{ groupId: 1, x: 0, y: 0 }],
      constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
      allocatedNodeIds: [],
    };

    const { graph } = treeResponseToGraph(response);

    expect(graph.edges).toEqual([{ a: 1, b: 2 }]);
  });
});
