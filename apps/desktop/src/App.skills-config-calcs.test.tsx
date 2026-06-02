/**
 * @pob2/desktop App — Skills / Config / Calcs tab routing + build-mutation flow
 * (p4-app-wiring task; DESIGN §10.5 Skills, §10.8 Config, §10.7 Calcs, §18 Phase 4,
 * §11.1 command palette, §13.4 "주요 빌드 수정 flow가 기존 PoB 없이 가능").
 *
 * This is the App-composition gate for the Phase 4 Skills/Config/Calcs tabs. It
 * renders the real desktop `App` with an INJECTED session (the real CoreClient
 * spawns a Lua runner jsdom cannot host; DESIGN §5.1 injectable client) and proves
 * the wiring the shipped app uses:
 *
 *   1. Selecting the Skills / Config / Calcs nav tabs routes the workspace pane to
 *      the @pob2/ui SkillsPanel / ConfigPanel / CalcsPanel respectively.
 *   2. Opening a build populates each panel from the session's REAL data:
 *      skills.getGroups → skill-group cards, config.getOptions → option rows,
 *      calc.run → the Calcs breakdown final values (NO-FALLBACK, §6.4).
 *   3. The `/calcs` route (gates.mjs VISUAL[4].route) selects the Calcs tab on
 *      mount, and selecting a tab reflects into window.location.pathname, so the
 *      VISUAL gate's route resolves to the screen it asserts.
 *   4. The Ctrl+K palette carries the §11.1 build-mutation commands "config preset
 *      변경" and "계산 trace 열기" (only when a session is injected — no fake runner,
 *      no fake affordance, §6.4).
 *   5. THE FULL BUILD-MUTATION FLOW (doneCriteria "주요 빌드 수정 flow가 기존 PoB
 *      없이 가능"): applying a config preset routes through the session's
 *      setConfigOption, which re-runs calc.run, and BOTH the Overview AND the Calcs
 *      breakdown re-render from the recalculated stats — no upstream PoB needed.
 *
 * The filename carries `skills-config-calcs` so
 * `pnpm --filter @pob2/desktop test skills-config-calcs` selects exactly this suite
 * (the verifyCmd). It runs under jsdom (vitest.config.ts), driving @pob2/ui through
 * the App's real composition.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent, act } from '@testing-library/react';
import { stringsKo } from '@pob2/ui';
import type {
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  SkillsGetGroupsResponse,
} from '@pob2/schema';
import { App } from '../src/App.js';
import type { BuildSession, OpenSource } from '../src/build-session.js';

afterEach(cleanup);

// Each test starts from the app root path so route-sync assertions are isolated.
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

/** The build's skill-group cards (one group, one active gem) the session returns. */
const SKILL_GROUPS: SkillsGetGroupsResponse = {
  groups: [
    {
      groupId: 'g1',
      label: 'Fireball',
      enabled: true,
      spirit: 0,
      reservation: 0,
      activeGems: [{ gemId: 'fireball', name: 'Fireball', level: 20, quality: 0, enabled: true }],
      supportGems: [],
    },
  ],
};

/** The build's config options (one boolean "enemy is boss" toggle). */
const CONFIG_OPTIONS: ConfigGetOptionsResponse = {
  options: [
    {
      optionId: 'enemyIsBoss',
      type: 'check',
      label: '적이 보스임',
      value: false,
      dependentModifiers: [],
    },
  ],
};

/** calc.run before any mutation: Total DPS 100. */
const STATS_BEFORE: CalcRunResponse = {
  buildId: 'b1',
  stats: [
    { statId: 'Life', value: 65, label: 'Life' },
    { statId: 'TotalDPS', value: 100, label: 'Total DPS' },
  ],
};

/** calc.run AFTER applying the bossing preset: Total DPS recalculated to 250. */
const STATS_AFTER: CalcRunResponse = {
  buildId: 'b1',
  stats: [
    { statId: 'Life', value: 65, label: 'Life' },
    { statId: 'TotalDPS', value: 250, label: 'Total DPS' },
  ],
};

/** A calc.explain trace for Total DPS the session returns on demand (§10.7). */
const DPS_EXPLAIN: CalcExplainResponse = {
  statId: 'TotalDPS',
  finalValue: 250,
  label: 'Total DPS',
  sources: [{ kind: 'skillGem', label: 'Fireball', value: 250 }],
  formula: '250 = base * more',
  upstreamStatId: 'TotalDPS',
};

/**
 * A recording session that drives the Skills/Config/Calcs tabs and the full
 * build-mutation flow. open() yields STATS_BEFORE; once setConfigOption is called,
 * it re-runs calc.run and yields STATS_AFTER (DESIGN §6.3 빌드 수정 → 즉시 재계산).
 * It logs the calls the App makes so the wiring is assertable without a Lua runner.
 */
function fakeSession(): BuildSession & {
  opened: OpenSource[];
  setOptions: Array<{ optionId: string; value: unknown }>;
  explained: string[];
} {
  const opened: OpenSource[] = [];
  const setOptions: Array<{ optionId: string; value: unknown }> = [];
  const explained: string[] = [];
  // Flips to true after the first config mutation so calc.run reflects the edit.
  let mutated = false;
  return {
    opened,
    setOptions,
    explained,
    async open(source) {
      opened.push(source);
      return { summary: { className: 'Witch', level: 1 }, stats: STATS_BEFORE };
    },
    async save() {
      return { format: 'xml', data: '<xml/>' };
    },
    async getEquipped() {
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('parseClipboard not used in the skills-config-calcs suite');
    },
    async getSkillGroups() {
      return SKILL_GROUPS;
    },
    async setGemGroup() {
      mutated = true;
      return STATS_AFTER;
    },
    async getConfigOptions() {
      return CONFIG_OPTIONS;
    },
    async setConfigOption(optionId, value) {
      setOptions.push({ optionId, value });
      mutated = true;
      // The §6.3 contract: setConfigOption re-runs calc and returns fresh stats.
      return mutated ? STATS_AFTER : STATS_BEFORE;
    },
    async explainStat(statId) {
      explained.push(statId);
      return DPS_EXPLAIN;
    },
    // The §10.6 Passive Tree paths are not exercised by this suite; the App's open
    // flow calls getTreeData, so it yields an empty tree (no nodes, no allocation).
    async getTreeData() {
      return {
        graph: {
          nodes: [],
          edges: [],
          bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
          nodeIndex: {},
        },
        allocated: new Set<number>(),
      };
    },
    async previewAllocate() {
      return [];
    },
    async applyAllocate() {
      return { allocated: new Set<number>(), stats: STATS_BEFORE };
    },
  };
}

/** Open the Ctrl+K palette and click the option with the given data-command-id. */
function runCommand(commandId: string): void {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const target = document.querySelector(`[data-command-id="${commandId}"]`) as HTMLElement | null;
  if (!target) throw new Error(`command not found in palette: ${commandId}`);
  fireEvent.click(target);
}

/** Click the nav-rail entry with the given Korean label to switch the workspace. */
function selectTab(label: string): void {
  const nav = screen.getByRole('navigation');
  fireEvent.click(within(nav).getByText(label));
}

/** The final value rendered in a Calcs breakdown stat row (Summary group). */
function calcStatValue(statId: string): string {
  const rows = document.querySelectorAll(`[data-stat-row="${statId}"]`);
  const row = rows[0] as HTMLElement;
  return (row.querySelector('[data-final-value]')?.textContent ?? '').trim();
}

describe('@pob2/desktop App — Skills/Config/Calcs routing + build-mutation flow (DESIGN §18 Phase 4)', () => {
  it('routes the workspace to the SkillsPanel when the Skills tab is selected', () => {
    render(<App session={fakeSession()} />);
    // Overview is the default workspace — no Skills region yet.
    expect(document.querySelector('[data-region="groups"]')).toBeNull();

    selectTab(stringsKo['nav.skills']);

    // The §10.5 2-region layout (skill-group list | inspector) is mounted.
    expect(document.querySelector('.pob-skills [data-region="groups"]')).toBeTruthy();
    expect(document.querySelector('.pob-skills [data-region="inspector"]')).toBeTruthy();
  });

  it('routes the workspace to the ConfigPanel when the Config tab is selected', () => {
    render(<App session={fakeSession()} />);
    expect(document.querySelector('[data-region="presets"]')).toBeNull();

    selectTab(stringsKo['nav.config']);

    // The §10.8 2-region layout (scenario presets | typed options) is mounted.
    expect(document.querySelector('.pob-config [data-region="presets"]')).toBeTruthy();
    expect(document.querySelector('.pob-config [data-region="options"]')).toBeTruthy();
  });

  it('routes the workspace to the CalcsPanel when the Calcs tab is selected', () => {
    render(<App session={fakeSession()} />);
    expect(document.querySelector('.pob-calcs')).toBeNull();

    selectTab(stringsKo['nav.calcs']);

    // The §10.7 breakdown explorer is mounted.
    expect(document.querySelector('.pob-calcs')).toBeTruthy();
    expect(document.querySelector('[data-section="summary"]')).toBeTruthy();
  });

  it("populates the skill-group cards from the opened build's real getGroups result", async () => {
    render(
      <App
        session={fakeSession()}
        resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
      />,
    );

    runCommand('build-open');
    selectTab(stringsKo['nav.skills']);

    // The build's REAL socket group (Fireball) renders as a selectable card in the
    // groups region (scoped to the group-select button — the gem chip also reads
    // "Fireball", so the assertion targets the card itself).
    const groups = await screen.findByText(
      'Fireball',
      { selector: '[data-skill-group-select]' },
      { timeout: 2000 },
    );
    expect(groups).toBeTruthy();
  });

  it("populates the config options from the opened build's real getOptions result", async () => {
    render(
      <App
        session={fakeSession()}
        resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
      />,
    );

    runCommand('build-open');
    selectTab(stringsKo['nav.config']);

    // The build's REAL config option (적이 보스임) renders as an option row.
    const options = document.querySelector('.pob-config [data-region="options"]') as HTMLElement;
    expect(await within(options).findByText('적이 보스임')).toBeTruthy();
  });

  it("populates the Calcs breakdown final values from the opened build's calc.run", async () => {
    render(
      <App
        session={fakeSession()}
        resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })}
      />,
    );

    runCommand('build-open');
    await screen.findByText('Witch'); // open() flushed (header shows the class)
    selectTab(stringsKo['nav.calcs']);

    // The Summary Total DPS row carries the build's REAL computed value (100).
    expect(calcStatValue('TotalDPS')).toBe('100');
  });

  it('selects the Calcs tab on mount when the location is the /calcs route (VISUAL[4])', () => {
    window.history.replaceState(null, '', '/calcs');
    render(<App session={fakeSession()} />);

    // The Calcs nav entry is active, and the breakdown explorer is mounted.
    const nav = screen.getByRole('navigation');
    const active = within(nav).getByRole('button', { current: 'page' });
    expect(active.textContent).toBe(stringsKo['nav.calcs']);
    expect(document.querySelector('.pob-calcs')).toBeTruthy();
  });

  it('reflects the /calcs route into window.location.pathname (route sync)', () => {
    render(<App session={fakeSession()} />);
    expect(window.location.pathname).toBe('/');

    selectTab(stringsKo['nav.calcs']);
    expect(window.location.pathname).toBe('/calcs');
  });

  it('exposes the §11.1 build-mutation commands when a session is injected', () => {
    render(<App session={fakeSession()} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(document.querySelector('[data-command-id="config-apply-preset"]')).toBeTruthy();
    expect(document.querySelector('[data-command-id="calc-open-trace"]')).toBeTruthy();
  });

  it('omits the build-mutation commands when no session is injected (no fake affordance)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(document.querySelector('[data-command-id="config-apply-preset"]')).toBeNull();
    expect(document.querySelector('[data-command-id="calc-open-trace"]')).toBeNull();
    // Nav commands still populate the palette (sanity).
    expect(document.querySelector('[data-command-id="nav-config"]')).toBeTruthy();
  });

  it('build-mutation flow: applying a config preset recomputes Overview AND Calcs stats', async () => {
    const session = fakeSession();
    render(
      <App session={session} resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })} />,
    );

    // Open the build: Overview shows the pre-mutation Total DPS (100).
    runCommand('build-open');
    await screen.findByText('Witch');
    const dpsRowBefore = document.querySelector('[data-stat-id="TotalDPS"]') as HTMLElement;
    expect(within(dpsRowBefore).getByText('100')).toBeTruthy();

    // Apply a config preset through the §11.1 command. The ConfigPanel reduces the
    // chosen preset to its { optionId, value }[] payload and the App routes each
    // entry through the session's setConfigOption (which re-runs calc.run).
    selectTab(stringsKo['nav.config']);
    const bossing = document.querySelector('[data-preset-id="bossing"]') as HTMLElement;
    await act(async () => {
      fireEvent.click(bossing);
    });

    // The session received the preset's option write.
    expect(session.setOptions).toEqual([{ optionId: 'enemyIsBoss', value: true }]);

    // The OVERVIEW re-rendered from the recalculated stats (Total DPS 100 → 250).
    selectTab(stringsKo['nav.overview']);
    const dpsRowAfter = document.querySelector('[data-stat-id="TotalDPS"]') as HTMLElement;
    expect(within(dpsRowAfter).getByText('250')).toBeTruthy();

    // The CALCS breakdown also reflects the recalculated stats (no upstream PoB).
    selectTab(stringsKo['nav.calcs']);
    expect(calcStatValue('TotalDPS')).toBe('250');
  });

  it('calc-open-trace command opens the Calcs tab', () => {
    render(<App session={fakeSession()} />);
    expect(document.querySelector('.pob-calcs')).toBeNull();

    runCommand('calc-open-trace');

    expect(document.querySelector('.pob-calcs')).toBeTruthy();
    expect(window.location.pathname).toBe('/calcs');
  });
});
