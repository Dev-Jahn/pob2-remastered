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
  CommandPalette,
  ItemsPanel,
  OverviewPanel,
  WarningPanel,
  buildEquippedGridModel,
  buildOverviewModel,
  buildWarningModel,
  stringsEn,
  stringsKo,
  NAV_ITEMS,
} from '@pob2/ui';
import type { Command, EquippedGridModel, InspectedItem, Locale, NavTab } from '@pob2/ui';
import type { CalcRunResponse } from '@pob2/schema';
import type { BuildSession, OpenResult, OpenSource, SaveFormat } from './build-session.js';

/** No build is loaded yet, so the calc result carries no stats. */
const EMPTY_CALC: CalcRunResponse = { buildId: '', stats: [] };

/** Empty equipped grid: every slot a card, none occupied (DESIGN §10.4, §6.4). */
const EMPTY_GRID: EquippedGridModel = buildEquippedGridModel([]);

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

  const calc = build?.stats ?? EMPTY_CALC;
  const overview = buildOverviewModel(calc, build?.summary ?? {});
  const warnings = buildWarningModel({ calc, unsupported: [] });

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
    ];
  }, [session, resolveOpenSource, resolveClipboardText, selectTab]);

  // The workspace pane is routed by the active tab (DESIGN §10.2): Items renders
  // the §10.4 ItemsPanel (driven by the build's equipped grid + the last pasted
  // item), every other tab keeps the Overview for now (later phases add panels).
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
