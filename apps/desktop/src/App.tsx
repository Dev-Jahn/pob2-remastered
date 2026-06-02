/**
 * App — the @pob2/desktop root component (DESIGN §10.2 App shell, §10.3 Overview).
 *
 * Holds the locale state (default ko-KR per §8.1) and mounts the @pob2/ui
 * AppShell with the LocaleToggle wired: the shell's header toggle calls back into
 * `setLocale`, which re-renders all chrome in the chosen locale. Overview is the
 * default route — `activeTab` is "overview" and the workspace pane renders the
 * OverviewPanel.
 *
 * The live build comes from the @pob2/core-client-backed `build-session` data
 * layer (DESIGN §18 Phase 2 "기존 build 파일을 열어 Overview 표시"). Because the real
 * CoreClient spawns an out-of-process Lua runner that jsdom cannot host, App takes
 * the {@link BuildSession} as an OPTIONAL injected prop (DESIGN §5.1: the host
 * owns the runner) — production wires a real session, tests inject a mock or none.
 *
 * With no session opened yet, the Overview view-model is built from an empty
 * `calc.run` result: every stat field resolves to its explicit `missing` marker
 * rather than a fabricated `0` (DESIGN §6.4, §10.3 NO-FALLBACK). Once a build is
 * opened via the Open command, its `{ summary, stats }` drives the Overview and
 * the header build name.
 *
 * The shell's `[Ctrl+K Search]` (DESIGN §10.2) is wired to the @pob2/ui
 * CommandPalette: each nav tab becomes a "go to tab" command whose Korean title,
 * English title, and aliases come from both locale dictionaries, so the bilingual
 * search index keeps an English-origin term reachable from the Korean client and
 * vice versa (DESIGN §8.1, §10.1, §11.1/§11.2). When a session is injected, Open
 * and Save build commands (§10.9, §11.1 "빌드 내보내기") route through it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppShell,
  CalcsPanel,
  CommandPalette,
  ConfigPanel,
  ItemsPanel,
  OverviewPanel,
  SkillsPanel,
  TreePanel,
  WarningPanel,
  buildCalcsModel,
  buildConfigModel,
  buildEquippedGridModel,
  buildNodeSearchIndex,
  buildOverviewModel,
  buildSkillGroupsModel,
  buildWarningModel,
  stringsEn,
  stringsKo,
  NAV_ITEMS,
} from '@pob2/ui';
import type {
  Command,
  ConfigOptionValue,
  ConfigPresetId,
  EquippedGridModel,
  InspectedItem,
  Locale,
  NavTab,
  NodeSearchDoc,
  NodeSearchIndex,
  TreeGraph,
} from '@pob2/ui';
import type {
  BuildSaveResponse,
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  GemInput,
  SkillsGetGroupsResponse,
  TreeStatDelta,
} from '@pob2/schema';
import type { BuildSession, OpenResult, OpenSource, SaveFormat } from './build-session.js';

/**
 * Debounce window (ms) for the §10.6 hover→previewAllocate fetch (DESIGN §10.6
 * "노드 hover 시 tree.previewAllocate 호출을 debounce"). Hovering across the tree
 * fires many hover events; only the last one within this window triggers a fetch.
 */
const TREE_HOVER_DEBOUNCE_MS = 120;

/** No build is loaded yet, so the calc result carries no stats. */
const EMPTY_CALC: CalcRunResponse = { buildId: '', stats: [] };

/** Empty equipped grid: every slot a card, none occupied (DESIGN §10.4, §6.4). */
const EMPTY_GRID: EquippedGridModel = buildEquippedGridModel([]);

/** No build is loaded yet, so the build has no socket groups (DESIGN §10.5). */
const EMPTY_SKILL_GROUPS: SkillsGetGroupsResponse = { groups: [] };

/** No build is loaded yet, so the build has no config options (DESIGN §10.8). */
const EMPTY_CONFIG_OPTIONS: ConfigGetOptionsResponse = { options: [] };

/** No build is loaded yet, so the passive tree has no nodes (DESIGN §10.6, §6.4). */
const EMPTY_TREE_GRAPH: TreeGraph = {
  nodes: [],
  edges: [],
  bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
  nodeIndex: {},
};

/** No build is loaded yet, so the node search index is empty (DESIGN §10.6, §11.2). */
const EMPTY_TREE_INDEX: NodeSearchIndex = buildNodeSearchIndex([]);

/**
 * Build the bilingual (한/영) node search index from a render `TreeGraph` (DESIGN
 * §10.6 한/영 node 검색, §11.2). Each node's display label is the searchable title;
 * a dedicated ko/en split + synonym aliases arrive with the i18n data layer, so the
 * label seeds both title fields for now (NO-FALLBACK — no invented synonyms).
 */
function treeSearchIndex(graph: TreeGraph): NodeSearchIndex {
  const docs: NodeSearchDoc[] = graph.nodes.map((node) => ({
    nodeId: node.nodeId,
    titleKo: node.label,
    titleEn: node.label,
    aliasesKo: [],
    aliasesEn: [],
  }));
  return buildNodeSearchIndex(docs);
}

/**
 * URL path ↔ nav tab map (DESIGN §10.2 routes; gates.mjs VISUAL routes
 * `/`/`/items`/`/calcs`/`/tree`). Overview is the app root; the passive tree's
 * nav id is `passiveTree` but its route is `/tree` (matching VISUAL[5]); every
 * other tab routes to `/<navId>`. The map is the single source of truth so the
 * route the VISUAL gate screenshots resolves to the screen it asserts.
 */
const TAB_TO_PATH: Partial<Record<NavTab, string>> = {
  overview: '/',
  passiveTree: '/tree',
};

/** The URL path for a nav tab (DESIGN §10.2). */
function tabToPath(tab: NavTab): string {
  return TAB_TO_PATH[tab] ?? `/${tab}`;
}

/** The nav tab a URL path selects, or `overview` for an unmapped/root path. */
function pathToTab(pathname: string): NavTab {
  const normalized = pathname === '' ? '/' : pathname;
  const entry = NAV_ITEMS.find(({ id }) => tabToPath(id) === normalized);
  return entry?.id ?? 'overview';
}

export interface AppProps {
  /**
   * The build data layer over @pob2/core-client (DESIGN §5.1 injectable client).
   * Optional: when absent, Open/Save are unavailable and the Overview shows its
   * no-build state — the same path jsdom tests take, since the real session spawns
   * a Lua runner.
   */
  session?: BuildSession;
  /** Where the Open command loads from; defaults to an in-app file/share prompt
   * resolver the host supplies. Optional so tests can inject a fixed source. */
  resolveOpenSource?: () => Promise<OpenSource | null>;
  /**
   * Where the §11.1 "아이템 붙여넣기" (Paste Item) command reads clipboard text;
   * defaults to the system clipboard (`navigator.clipboard.readText`). Optional so
   * tests can inject a fixed string. Returns `null`/empty to abort the paste.
   */
  resolveClipboardText?: () => Promise<string | null>;
  /**
   * Where the Save/Export commands SEND the exported build (DESIGN §10.9, §11.1
   * "빌드 내보내기"): the host writes XML to a file (Tauri save dialog →
   * `save_build_file`) and copies a share code to the clipboard. Without it the
   * Save commands are unavailable (not faked) — so the desktop entry MUST inject it.
   */
  deliverSaveResult?: (result: BuildSaveResponse) => void | Promise<void>;
}

export function App({
  session,
  resolveOpenSource,
  resolveClipboardText,
  deliverSaveResult,
}: AppProps = {}) {
  const [locale, setLocale] = useState<Locale>('ko-KR');
  // The active tab is seeded from the initial URL path so the VISUAL gate's
  // `/items`/`/calcs`/`/tree` routes open straight onto that screen (§10.2).
  const [activeTab, setActiveTab] = useState<NavTab>(() =>
    typeof window === 'undefined' ? 'overview' : pathToTab(window.location.pathname),
  );
  // The open build's { summary, stats }, or null until one is opened.
  const [build, setBuild] = useState<OpenResult | null>(null);
  // The open build's equipped-gear grid (§10.4), refreshed on each open(); the
  // empty grid (all slots empty) until a build is opened — never fabricated.
  const [grid, setGrid] = useState<EquippedGridModel>(EMPTY_GRID);
  // The last clipboard-pasted item, staged for the Items inspector; undefined
  // until the §11.1 paste command runs (NO-FALLBACK, §6.4).
  const [pastedItem, setPastedItem] = useState<InspectedItem | undefined>(undefined);
  // The open build's socket-group cards (§10.5) and config-option cards (§10.8),
  // refreshed on each open(); empty until a build is opened — never fabricated.
  const [skillGroups, setSkillGroups] = useState<SkillsGetGroupsResponse>(EMPTY_SKILL_GROUPS);
  const [configOptions, setConfigOptions] =
    useState<ConfigGetOptionsResponse>(EMPTY_CONFIG_OPTIONS);
  // calc.explain traces fetched lazily as Calcs stat rows are expanded (§10.7),
  // keyed by stat id; empty until a row is expanded (NO-FALLBACK — no fake trace).
  const [calcExplains, setCalcExplains] = useState<Map<string, CalcExplainResponse>>(
    () => new Map(),
  );
  // The calc.run from BEFORE the last build mutation, for the §10.7 before/after
  // delta; undefined until a mutation re-runs calc (never a fabricated baseline).
  const [prevStats, setPrevStats] = useState<CalcRunResponse | undefined>(undefined);
  // The §10.6 Passive Tree render graph + the currently-allocated node set,
  // refreshed on each open() and after each allocation; empty until a build is
  // opened — never a fabricated tree (NO-FALLBACK §6.4).
  const [treeGraph, setTreeGraph] = useState<TreeGraph>(EMPTY_TREE_GRAPH);
  const [treeAllocated, setTreeAllocated] = useState<Set<number>>(() => new Set());
  // The node currently hovered on the canvas, and the host-fetched §10.6 allocation
  // delta chips for it; both reset when the cursor leaves a node (NO-FALLBACK).
  const [treeHoverNodeId, setTreeHoverNodeId] = useState<number | undefined>(undefined);
  const [treeHoverDeltas, setTreeHoverDeltas] = useState<TreeStatDelta[] | undefined>(undefined);
  // The pending hover→previewAllocate debounce timer (DESIGN §10.6); cleared on each
  // new hover so only the last hover within the window fetches.
  const treeHoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // The §10.6 bilingual node search index, derived from the live tree graph.
  const treeIndex = useMemo(
    () => (treeGraph.nodes.length === 0 ? EMPTY_TREE_INDEX : treeSearchIndex(treeGraph)),
    [treeGraph],
  );

  const calc = build?.stats ?? EMPTY_CALC;
  const overview = buildOverviewModel(calc, build?.summary ?? {});
  const warnings = buildWarningModel({ calc, unsupported: [] });
  // The §10.5 skill-group, §10.8 config, and §10.7 Calcs breakdown view-models
  // derive purely from the open build's data (NO-FALLBACK: empty inputs → empty
  // cards/options, missing stat rows, never invented values).
  const skills = buildSkillGroupsModel(skillGroups);
  const config = buildConfigModel(configOptions);
  const calcs = buildCalcsModel(calc, [...calcExplains.values()], prevStats);

  // Keep window.location.pathname in lockstep with the active tab so the route is
  // shareable/bookmarkable and the VISUAL gate's route resolves to this screen
  // (DESIGN §10.2). pushState avoids a full navigation (the app is a single page).
  const selectTab = useCallback((tab: NavTab) => {
    setActiveTab(tab);
    if (typeof window !== 'undefined' && window.location.pathname !== tabToPath(tab)) {
      window.history.pushState(null, '', tabToPath(tab));
    }
  }, []);

  // Browser back/forward re-selects the tab the popped URL maps to (DESIGN §10.2).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPop = () => setActiveTab(pathToTab(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // §11.1 "config preset 변경": apply a §10.8 scenario preset by writing each of
  // its `{ optionId, value }` entries through config.setOption — which RE-RUNS
  // calc.run (DESIGN §6.3 빌드 수정 → 즉시 재계산) — then refresh the Overview/Calcs
  // from the LAST recomputed stats and re-fetch the config options (their values
  // changed). The pre-mutation stats become the §10.7 before/after baseline; the
  // now-stale calc.explain traces are cleared so they re-fetch lazily. Shared by
  // both the §11.1 command and the ConfigPanel's onApplyPreset, so the two routes
  // run the identical mutation flow.
  const applyConfigPreset = useCallback(
    async (_presetId: ConfigPresetId, payload: ConfigOptionValue[]) => {
      if (!session || payload.length === 0) return;
      setPrevStats(build?.stats ?? EMPTY_CALC);
      let stats: CalcRunResponse | undefined;
      for (const { optionId, value } of payload) {
        stats = await session.setConfigOption(optionId, value);
      }
      if (stats !== undefined) {
        setBuild((current) => (current ? { ...current, stats } : current));
      }
      setConfigOptions(await session.getConfigOptions());
      setCalcExplains(new Map());
    },
    [session, build],
  );

  // §10.8 individual config option edit: write ONE option through config.setOption —
  // which RE-RUNS calc.run (DESIGN §6.3 빌드 수정 → 즉시 재계산) — then refresh the
  // Overview/Calcs from the recomputed stats and re-fetch the config options (the
  // edited value, and any dependent options, changed). The pre-mutation stats become
  // the §10.7 before/after baseline; stale calc.explain traces are cleared. This is
  // the per-option counterpart of applyConfigPreset, wired to ConfigPanel.onChangeOption.
  const applyConfigOption = useCallback(
    async (optionId: string, value: unknown) => {
      if (!session) return;
      setPrevStats(build?.stats ?? EMPTY_CALC);
      const stats = await session.setConfigOption(optionId, value);
      setBuild((current) => (current ? { ...current, stats } : current));
      setConfigOptions(await session.getConfigOptions());
      setCalcExplains(new Map());
    },
    [session, build],
  );

  // §10.5 gem enable toggle: flip ONE gem's enabled in its socket group, re-sending the
  // group's gems in their ORIGINAL order (skills.setGemGroup source `gems`) so the toggle
  // never reorders the group — then RE-RUN calc.run (DESIGN §6.3 빌드 수정 → 즉시 재계산),
  // refresh the Overview/Calcs + the socket-group cards, and clear stale traces. The
  // pre-mutation stats become the §10.7 before/after baseline.
  const toggleGem = useCallback(
    async (groupId: string, gemId: string) => {
      if (!session) return;
      const group = skillGroups.groups.find((g) => g.groupId === groupId);
      if (!group) return;
      const gems: GemInput[] = group.gems.map((gem) => ({
        gemId: gem.gemId,
        level: gem.level,
        quality: gem.quality,
        enabled: gem.gemId === gemId ? !gem.enabled : gem.enabled,
      }));
      setPrevStats(build?.stats ?? EMPTY_CALC);
      const stats = await session.setGemGroup(groupId, gems);
      setBuild((current) => (current ? { ...current, stats } : current));
      setSkillGroups(await session.getSkillGroups());
      setCalcExplains(new Map());
    },
    [session, build, skillGroups],
  );

  // §10.7 lazy calc.explain: fetch one stat's formula trace through the session and
  // stage it for the Calcs breakdown. Already-loaded traces are not refetched (the
  // CalcsPanel debounces and suppresses those), so this only adds new ones. Shared
  // by the CalcsPanel's onExplain dispatch.
  const explainStat = useCallback(
    async (statId: string) => {
      if (!session) return;
      const explain = await session.explainStat(statId);
      setCalcExplains((current) => new Map(current).set(statId, explain));
    },
    [session],
  );

  // §10.6 hover → debounced tree.previewAllocate: a node hover stages its id and
  // schedules a previewAllocate fetch; the timer is reset on every new hover so only
  // the LAST hovered node within the window is fetched (DESIGN §10.6 "노드 hover 시
  // … debounce"). Leaving every node (id null) cancels the pending fetch and clears
  // the staged hover + its delta chips (NO-FALLBACK — no stale tooltip).
  const previewTreeNode = useCallback(
    (nodeId: number | null) => {
      if (treeHoverTimer.current !== undefined) clearTimeout(treeHoverTimer.current);
      if (nodeId === null) {
        treeHoverTimer.current = undefined;
        setTreeHoverNodeId(undefined);
        setTreeHoverDeltas(undefined);
        return;
      }
      setTreeHoverNodeId(nodeId);
      // A new hover invalidates the previous node's chips until the fetch resolves.
      setTreeHoverDeltas(undefined);
      if (!session) return;
      treeHoverTimer.current = setTimeout(() => {
        void (async () => {
          const deltas = await session.previewAllocate([nodeId]);
          setTreeHoverDeltas(deltas);
        })();
      }, TREE_HOVER_DEBOUNCE_MS);
    },
    [session],
  );

  // Clear the pending hover-preview timer on unmount.
  useEffect(
    () => () => {
      if (treeHoverTimer.current !== undefined) clearTimeout(treeHoverTimer.current);
    },
    [],
  );

  // §10.6 click → tree.applyAllocate: committing a node mutates the live build,
  // re-runs calc.run (DESIGN §6.3 빌드 수정 → 즉시 재계산), and BOTH the tree's
  // allocated set AND the Overview/Calcs re-render from the fresh stats. The
  // pre-mutation stats become the §10.7 before/after baseline; the now-stale
  // calc.explain traces are cleared so they re-fetch lazily.
  const allocateTreeNode = useCallback(
    async (nodeId: number) => {
      if (!session) return;
      setPrevStats(build?.stats ?? EMPTY_CALC);
      const { allocated, stats } = await session.applyAllocate([nodeId]);
      setTreeAllocated(allocated);
      setBuild((current) => (current ? { ...current, stats } : current));
      setCalcExplains(new Map());
    },
    [session, build],
  );

  // §11.1 "아이템 붙여넣기": read clipboard text, parse it through the session, stage the
  // result in the Items inspector, and switch to the Items tab. Lifted to a callback so
  // BOTH the Ctrl+K command AND the §10.4 Items toolbar Import button drive the same flow.
  // Reads the system clipboard unless a resolver is injected; empty/aborted reads do
  // nothing (NO-FALLBACK — no blank item).
  const pasteItem = useCallback(async () => {
    if (!session) return;
    const text = resolveClipboardText
      ? await resolveClipboardText()
      : await navigator.clipboard.readText();
    if (!text) return;
    const { item } = await session.parseClipboard(text);
    setPastedItem(item);
    selectTab('items');
  }, [session, resolveClipboardText, selectTab]);

  // §11.1 build commands: one "go to tab" command per nav entry. titleKo/titleEn
  // are sourced from both locale dictionaries so the §11.2 bilingual search index
  // resolves either language regardless of the active UI locale (§8.1 alias never
  // dropped). The id mirrors the nav id (e.g. "nav-overview").
  const commands: Command[] = useMemo(() => {
    const navCommands: Command[] = NAV_ITEMS.map(({ id, key }) => ({
      id: `nav-${id}`,
      titleKo: stringsKo[key],
      titleEn: stringsEn[key],
      aliases: [],
      run: () => selectTab(id),
    }));

    // §10.9 / §11.1 build commands route through the injected session. Without a
    // session there is no runner to route to, so they are omitted (not faked).
    if (!session) return navCommands;

    const open = async () => {
      const source = resolveOpenSource ? await resolveOpenSource() : null;
      if (!source) return;
      setBuild(await session.open(source));
      // Refresh the §10.4 equipped grid from the build's real getEquipped result.
      const equipped = await session.getEquipped();
      setGrid(buildEquippedGridModel(equipped.equipped));
      // Populate the §10.5 Skills and §10.8 Config tabs from the build's real
      // socket groups / config options (DESIGN §6.3 skills.getGroups /
      // config.getOptions). A freshly-opened build starts with no calc.explain
      // traces and no before/after baseline — both reset (NO-FALLBACK §6.4).
      setSkillGroups(await session.getSkillGroups());
      setConfigOptions(await session.getConfigOptions());
      // Populate the §10.6 Passive Tree tab from the build's real tree.getData
      // (render graph + allocated node set). A fresh hover has no staged node or
      // delta chips yet — both reset (NO-FALLBACK §6.4).
      const tree = await session.getTreeData();
      setTreeGraph(tree.graph);
      setTreeAllocated(tree.allocated);
      setTreeHoverNodeId(undefined);
      setTreeHoverDeltas(undefined);
      setCalcExplains(new Map());
      setPrevStats(undefined);
    };
    // §10.9 Save/Export: export the open build, then SEND it somewhere real —
    // XML to a file, a share code to the clipboard — via the host-injected
    // deliverSaveResult. Without a deliverer the export result would be discarded,
    // so the command is a no-op then (the desktop entry always injects one).
    const save = async (format: SaveFormat) => {
      const result = await session.save({ format });
      if (deliverSaveResult) await deliverSaveResult(result);
    };

    return [
      ...navCommands,
      {
        id: 'build-open',
        titleKo: '빌드 열기',
        titleEn: 'Open Build',
        aliases: ['load', 'import'],
        run: () => void open(),
      },
      {
        id: 'build-save',
        titleKo: '빌드 내보내기',
        titleEn: 'Export Build (XML)',
        aliases: ['save', 'export', 'xml'],
        run: () => void save('xml'),
      },
      {
        id: 'build-save-share-code',
        titleKo: '공유 코드 내보내기',
        titleEn: 'Export Share Code',
        aliases: ['save', 'export', 'share'],
        run: () => void save('shareCode'),
      },
      {
        id: 'items-paste',
        titleKo: '아이템 붙여넣기',
        titleEn: 'Paste Item',
        aliases: ['clipboard', 'import', 'paste'],
        run: () => void pasteItem(),
      },
      // §11.1 "config preset 변경": jump to the Config tab so the user can pick a
      // §10.8 scenario preset; applying one runs the shared mutation flow above
      // (config.setOption → recompute → Overview/Calcs refresh).
      {
        id: 'config-apply-preset',
        titleKo: 'config preset 변경',
        titleEn: 'Change Config Preset',
        aliases: ['config', 'preset', 'scenario'],
        run: () => selectTab('config'),
      },
      // §11.1 "계산 trace 열기": jump to the Calcs breakdown explorer, where
      // expanding a stat row dispatches the lazy calc.explain (DESIGN §10.7).
      {
        id: 'calc-open-trace',
        titleKo: '계산 trace 열기',
        titleEn: 'Open Calc Trace',
        aliases: ['calc', 'trace', 'explain', 'breakdown'],
        run: () => selectTab('calcs'),
      },
    ];
  }, [session, resolveOpenSource, resolveClipboardText, deliverSaveResult, selectTab, pasteItem]);

  // The workspace pane is routed by the active tab (DESIGN §10.2): Items renders
  // the §10.4 ItemsPanel, Skills the §10.5 SkillsPanel, Config the §10.8
  // ConfigPanel, Calcs the §10.7 CalcsPanel, Passive Tree the §10.6 TreePanel;
  // every other tab keeps the Overview. The Config/Calcs/Tree panels drive the
  // §13.4 build-mutation flow (mutate → recompute → Overview/Calcs refresh) via the
  // shared handlers above — the tree's hover preview is debounced (§10.6).
  const workspace =
    activeTab === 'items' ? (
      <ItemsPanel
        locale={locale}
        grid={grid}
        library={[]}
        itemSets={[{ id: 'default', name: stringsKo['items.set.default'] }]}
        activeSetId="default"
        inspectedItem={pastedItem}
        onImportFromClipboard={() => void pasteItem()}
      />
    ) : activeTab === 'skills' ? (
      <SkillsPanel
        locale={locale}
        model={skills}
        onToggleGem={(groupId, gemId) => void toggleGem(groupId, gemId)}
      />
    ) : activeTab === 'config' ? (
      <ConfigPanel
        locale={locale}
        model={config}
        onApplyPreset={applyConfigPreset}
        onChangeOption={applyConfigOption}
      />
    ) : activeTab === 'calcs' ? (
      <CalcsPanel locale={locale} model={calcs} onExplain={explainStat} />
    ) : activeTab === 'passiveTree' ? (
      <TreePanel
        locale={locale}
        graph={treeGraph}
        allocated={treeAllocated}
        index={treeIndex}
        hoveredNodeId={treeHoverNodeId}
        hoverDeltas={treeHoverDeltas}
        onHoverNode={previewTreeNode}
        onAllocate={(nodeId) => void allocateTreeNode(nodeId)}
      />
    ) : (
      <OverviewPanel locale={locale} model={overview} />
    );

  return (
    <>
      <AppShell
        locale={locale}
        onLocaleChange={setLocale}
        buildName={build?.summary.className ?? '—'}
        activeSkill="—"
        activeTab={activeTab}
        onSelectTab={selectTab}
        workspace={workspace}
        inspector={<WarningPanel locale={locale} model={warnings} />}
      />
      <CommandPalette commands={commands} />
    </>
  );
}
