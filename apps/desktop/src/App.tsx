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
import { useMemo, useState } from 'react';
import {
  AppShell,
  CommandPalette,
  OverviewPanel,
  WarningPanel,
  buildOverviewModel,
  buildWarningModel,
  stringsEn,
  stringsKo,
  NAV_ITEMS,
} from '@pob2/ui';
import type { Command, Locale, NavTab } from '@pob2/ui';
import type { CalcRunResponse } from '@pob2/schema';
import type { BuildSession, OpenResult, OpenSource, SaveFormat } from './build-session.js';

/** No build is loaded yet, so the calc result carries no stats. */
const EMPTY_CALC: CalcRunResponse = { buildId: '', stats: [] };

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
}

export function App({ session, resolveOpenSource }: AppProps = {}) {
  const [locale, setLocale] = useState<Locale>('ko-KR');
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  // The open build's { summary, stats }, or null until one is opened.
  const [build, setBuild] = useState<OpenResult | null>(null);

  const calc = build?.stats ?? EMPTY_CALC;
  const overview = buildOverviewModel(calc, build?.summary ?? {});
  const warnings = buildWarningModel({ calc, unsupported: [] });

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
      run: () => setActiveTab(id),
    }));

    // §10.9 / §11.1 build commands route through the injected session. Without a
    // session there is no runner to route to, so they are omitted (not faked).
    if (!session) return navCommands;

    const open = async () => {
      const source = resolveOpenSource ? await resolveOpenSource() : null;
      if (!source) return;
      setBuild(await session.open(source));
    };
    const save = (format: SaveFormat) => session.save({ format });

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
    ];
  }, [session, resolveOpenSource]);

  return (
    <>
      <AppShell
        locale={locale}
        onLocaleChange={setLocale}
        buildName={build?.summary.className ?? '—'}
        activeSkill="—"
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        workspace={<OverviewPanel locale={locale} model={overview} />}
        inspector={<WarningPanel locale={locale} model={warnings} />}
      />
      <CommandPalette commands={commands} />
    </>
  );
}
