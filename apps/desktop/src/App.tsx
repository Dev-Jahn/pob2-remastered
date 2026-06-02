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
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppShell,
  CalcsPanel,
  CommandPalette,
  ConfigPanel,
  ItemsPanel,
  OverviewPanel,
  SkillsPanel,
  WarningPanel,
  buildCalcsModel,
  buildConfigModel,
  buildEquippedGridModel,
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
} from '@pob2/ui';
import type {
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  SkillsGetGroupsResponse,
} from '@pob2/schema';
import type { BuildSession, OpenResult, OpenSource, SaveFormat } from './build-session.js';

/** No build is loaded yet, so the calc result carries no stats. */
const EMPTY_CALC: CalcRunResponse = { buildId: '', stats: [] };

/** Empty equipped grid: every slot a card, none occupied (DESIGN §10.4, §6.4). */
const EMPTY_GRID: EquippedGridModel = buildEquippedGridModel([]);

/** No build is loaded yet, so the build has no socket groups (DESIGN §10.5). */
const EMPTY_SKILL_GROUPS: SkillsGetGroupsResponse = { groups: [] };

/** No build is loaded yet, so the build has no config options (DESIGN §10.8). */
const EMPTY_CONFIG_OPTIONS: ConfigGetOptionsResponse = { options: [] };

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
}

export function App({ session, resolveOpenSource, resolveClipboardText }: AppProps = {}) {
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
      setCalcExplains(new Map());
      setPrevStats(undefined);
    };
    const save = (format: SaveFormat) => session.save({ format });

    // §11.1 "아이템 붙여넣기": read clipboard text, parse it through the session,
    // stage the result in the Items inspector, and switch to the Items tab so the
    // pasted item is visible. Reads the system clipboard unless a resolver is
    // injected. Empty/aborted reads do nothing (NO-FALLBACK — no blank item).
    const pasteItem = async () => {
      const text = resolveClipboardText
        ? await resolveClipboardText()
        : await navigator.clipboard.readText();
      if (!text) return;
      const { item } = await session.parseClipboard(text);
      setPastedItem(item);
      selectTab('items');
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
  }, [session, resolveOpenSource, resolveClipboardText, selectTab]);

  // The workspace pane is routed by the active tab (DESIGN §10.2): Items renders
  // the §10.4 ItemsPanel, Skills the §10.5 SkillsPanel, Config the §10.8
  // ConfigPanel, Calcs the §10.7 CalcsPanel; every other tab keeps the Overview.
  // The Config/Calcs panels drive the §13.4 build-mutation flow (apply preset →
  // recompute → Overview/Calcs refresh) via the shared handlers above.
  const workspace =
    activeTab === 'items' ? (
      <ItemsPanel
        locale={locale}
        grid={grid}
        library={[]}
        itemSets={[{ id: 'default', name: stringsKo['items.set.default'] }]}
        activeSetId="default"
        inspectedItem={pastedItem}
      />
    ) : activeTab === 'skills' ? (
      <SkillsPanel locale={locale} model={skills} />
    ) : activeTab === 'config' ? (
      <ConfigPanel locale={locale} model={config} onApplyPreset={applyConfigPreset} />
    ) : activeTab === 'calcs' ? (
      <CalcsPanel locale={locale} model={calcs} onExplain={explainStat} />
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
