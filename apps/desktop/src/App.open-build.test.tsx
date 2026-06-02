/**
 * @pob2/desktop "open build → Overview" integration test (review follow-up).
 *
 * This verifies the Phase 2 doneCriteria "기존 build 파일을 열어 Overview 표시"
 * (DESIGN §18 Phase 2) at the App composition level — the level the shipped app
 * uses — rather than only in the isolated build-session unit tests. It renders the
 * real desktop `App` with an INJECTED session (the real CoreClient spawns a Lua
 * runner jsdom cannot host; DESIGN §5.1 injectable client) and drives the Ctrl+K
 * "Open Build" command, then asserts the Overview re-renders from the loaded
 * build's REAL stats and the header shows the loaded build name.
 *
 * NO-FALLBACK (DESIGN §6.4, §10.3): before opening, every Overview stat resolves
 * to its explicit "missing" marker — never a fabricated 0. After opening, the
 * stats the session returned (and only those) become present. A stat the session
 * did NOT return stays missing, proving the Overview reflects the build and does
 * not invent values.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { stringsKo } from '@pob2/ui';
import type { CalcRunResponse } from '@pob2/schema';
import { App } from '../src/App.js';
import type { BuildSession, OpenSource, SaveFormat } from '../src/build-session.js';

afterEach(cleanup);

/** Stats a calc.run returns for the opened build (a present Life, an absent ES). */
const OPENED_STATS: CalcRunResponse = {
  buildId: 'build-1',
  stats: [
    { statId: 'Life', value: 65, label: 'Life' },
    { statId: 'TotalDPS', value: 8.16, label: 'Total DPS' },
  ],
};

/** A recording session: open() yields a fixed { summary, stats }; save() records. */
function fakeSession(): BuildSession & { opened: OpenSource[]; saved: SaveFormat[] } {
  const opened: OpenSource[] = [];
  const saved: SaveFormat[] = [];
  return {
    opened,
    saved,
    async open(source) {
      opened.push(source);
      return { summary: { className: 'Ranger', level: 1 }, stats: OPENED_STATS };
    },
    async save({ format }) {
      saved.push(format);
      return { format: 'xml', data: '<xml/>' };
    },
    // The Items-tab session surface (DESIGN §6.3): this Overview-focused suite
    // does not exercise equipped gear, so getEquipped yields an empty grid (no
    // fabricated cards) and parseClipboard is never called here.
    async getEquipped() {
      return { equipped: [] };
    },
    async parseClipboard() {
      throw new Error('parseClipboard not used in the open-build suite');
    },
    // The Skills/Config session surface (DESIGN §6.3): opening a build now
    // populates every tab, so getSkillGroups/getConfigOptions are driven by open()
    // and yield empty results here (no fabricated cards/options — NO-FALLBACK §6.4),
    // since this Overview-focused suite asserts only the Overview. The mutation /
    // explain methods stay unexercised and error if accidentally driven.
    async getSkillGroups() {
      return { groups: [] };
    },
    async setGemGroup() {
      throw new Error('setGemGroup not used in the open-build suite');
    },
    async getConfigOptions() {
      return { options: [] };
    },
    async setConfigOption() {
      throw new Error('setConfigOption not used in the open-build suite');
    },
    async explainStat() {
      throw new Error('explainStat not used in the open-build suite');
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

/** The value text rendered in the Overview's Life stat row. */
function lifeValue(): string {
  const row = document.querySelector('[data-stat-id="Life"]') as HTMLElement;
  return within(row).getByText('65').textContent ?? '';
}

describe('@pob2/desktop App — open build → Overview (DESIGN §18 Phase 2 doneCriteria)', () => {
  it('starts with no build: the Life stat is missing (—), not a fabricated 0', () => {
    render(<App />);
    const row = document.querySelector('[data-stat-id="Life"]') as HTMLElement;
    expect(row.getAttribute('data-missing')).toBe('true');
  });

  it('opening a build through the Open command renders its real stats into the Overview', async () => {
    const session = fakeSession();
    const source: OpenSource = { xml: '<PathOfBuilding/>' };
    render(<App session={session} resolveOpenSource={async () => source} />);

    // Run the §11.1 "Open Build" command from the Ctrl+K palette.
    runCommand('build-open');
    // The open() handler is async; let its microtasks flush so the Overview
    // re-renders from the returned { summary, stats }.
    await screen.findByText('65');

    // The Life row is now PRESENT with the build's real value, no longer missing.
    const lifeRow = document.querySelector('[data-stat-id="Life"]') as HTMLElement;
    expect(lifeRow.getAttribute('data-missing')).toBeNull();
    expect(lifeValue()).toBe('65');

    // A stat the calc did NOT return (Energy Shield) stays missing — not invented.
    const esRow = document.querySelector('[data-stat-id="EnergyShield"]') as HTMLElement;
    expect(esRow.getAttribute('data-missing')).toBe('true');

    // The header build name reflects the loaded build's class (was "—" before).
    expect(screen.getByText('Ranger')).toBeTruthy();

    // The session actually received the resolved source.
    expect(session.opened).toEqual([source]);
  });

  it('omits the Open command entirely when no session is injected (no fake affordance)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    // Nav "go to" commands exist, but no build-open/build-save without a runner.
    expect(document.querySelector('[data-command-id="build-open"]')).toBeNull();
    // The nav-overview command is still present (sanity: palette is populated).
    expect(document.querySelector('[data-command-id="nav-overview"]')).toBeTruthy();
    // Korean default is intact.
    expect(screen.getByText(stringsKo['nav.overview'])).toBeTruthy();
  });
});
