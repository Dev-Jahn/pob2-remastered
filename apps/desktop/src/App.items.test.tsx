/**
 * @pob2/desktop App — Items tab routing + live session integration test
 * (p3-app-wire task; DESIGN §10.4 Items tab, §18 Phase 3, §11.1 command palette).
 *
 * This is the App-composition gate for the Phase 3 Items tab. It renders the real
 * desktop `App` with an INJECTED session (the real CoreClient spawns a Lua runner
 * jsdom cannot host; DESIGN §5.1 injectable client) and proves the wiring the
 * shipped app uses:
 *
 *   1. Selecting the Items nav tab routes the workspace pane to the @pob2/ui
 *      ItemsPanel — the §10.4 3-region layout (equipped grid | library | inspector).
 *   2. Opening a build drives the equipped grid from the session's REAL
 *      items.getEquipped result: the equipped slot card renders the build's actual
 *      item (name + base type), and an empty slot stays empty — never a fabricated
 *      placeholder item (NO-FALLBACK, §6.4).
 *   3. The `/items` route (gates.mjs VISUAL[3].route) selects the Items tab on
 *      mount, and selecting a tab reflects into window.location.pathname, so the
 *      VISUAL gate's route resolves to the screen it asserts.
 *   4. The Ctrl+K palette carries the §11.1 "아이템 붙여넣기 (Paste Item)" command,
 *      which routes pasted clipboard text through the session's parseClipboard and
 *      surfaces the parsed item in the inspector.
 *
 * The filename carries `items` so `pnpm --filter @pob2/desktop test items` selects
 * exactly this suite (the verifyCmd). It runs under jsdom (vitest.config.ts),
 * driving @pob2/ui through the App's real composition.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { stringsKo } from '@pob2/ui';
import type { EquippedItem } from '@pob2/schema';
import { App } from '../src/App.js';
import type { BuildSession, OpenSource, SaveFormat } from '../src/build-session.js';

afterEach(cleanup);

// Each test starts from the app root path so route-sync assertions are isolated.
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});

/** The build's real equipped gear: a Rare pair of boots; all other slots empty. */
const BOOTS: EquippedItem = {
  slot: 'Boots',
  itemId: 'item-boots-1',
  name: 'Sorrow Sole',
  rarity: 'Rare',
  baseName: 'Hunting Shoes',
  requirements: { level: 33, str: 0, dex: 62, int: 0 },
  summaryMods: ['25% increased Movement Speed'],
  unsupportedMods: [],
};

/**
 * A recording session that drives BOTH Overview (open/save) and the Items tab
 * (getEquipped/parseClipboard). It returns fixed shapes and logs calls so the
 * App's wiring can be asserted without a Lua runner (DESIGN §5.1).
 */
function fakeSession(): BuildSession & {
  opened: OpenSource[];
  saved: SaveFormat[];
  pasted: string[];
} {
  const opened: OpenSource[] = [];
  const saved: SaveFormat[] = [];
  const pasted: string[] = [];
  return {
    opened,
    saved,
    pasted,
    async open(source) {
      opened.push(source);
      return { summary: { className: 'Ranger', level: 1 }, stats: { buildId: 'b1', stats: [] } };
    },
    async save({ format }) {
      saved.push(format);
      return { format: 'xml', data: '<xml/>' };
    },
    async getEquipped() {
      return { equipped: [BOOTS] };
    },
    async parseClipboard(text) {
      pasted.push(text);
      return {
        item: {
          itemId: 'imported',
          name: 'Sorrow Sole',
          baseType: 'Hunting Shoes',
          rarityColorKey: 'rare',
          sourceText: 'Sorrow Sole\nHunting Shoes',
          translatedText: 'Sorrow Sole\nHunting Shoes',
          parsedMods: ['25% increased Movement Speed'],
          unsupportedMods: [],
          slot: 'Boots',
        },
        locale: 'en-US',
      };
    },
    // The Skills/Config session surface (DESIGN §6.3): opening a build now
    // populates every tab, so getSkillGroups/getConfigOptions are driven by open()
    // and yield empty results here (no fabricated cards/options — NO-FALLBACK §6.4),
    // since this Items-focused suite asserts only the Items tab. The mutation /
    // explain methods stay unexercised and error if accidentally driven.
    async getSkillGroups() {
      return { groups: [] };
    },
    async setGemGroup() {
      throw new Error('setGemGroup not used in the items suite');
    },
    async getConfigOptions() {
      return { options: [] };
    },
    async setConfigOption() {
      throw new Error('setConfigOption not used in the items suite');
    },
    async explainStat() {
      throw new Error('explainStat not used in the items suite');
    },
    // The §10.6 Passive Tree paths: open() now populates the tree tab too, so
    // getTreeData yields an empty tree here (no nodes/allocation — NO-FALLBACK §6.4);
    // the hover-preview / commit methods stay unexercised in this Items suite.
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
      throw new Error('previewAllocate not used in the items suite');
    },
    async applyAllocate() {
      throw new Error('applyAllocate not used in the items suite');
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

/** Click the Items nav-rail entry to switch the workspace to the Items tab. */
function selectItemsTab(): void {
  const nav = screen.getByRole('navigation');
  fireEvent.click(within(nav).getByText(stringsKo['nav.items']));
}

describe('@pob2/desktop App — Items tab routing + live session (DESIGN §18 Phase 3)', () => {
  it('renders the ItemsPanel 3-region layout when the Items tab is selected', () => {
    render(<App session={fakeSession()} />);
    // Overview is the default workspace — no Items regions yet.
    expect(document.querySelector('[data-region="equipped"]')).toBeNull();

    selectItemsTab();

    // The §10.4 3-region layout is now mounted.
    expect(document.querySelector('[data-region="equipped"]')).toBeTruthy();
    expect(document.querySelector('[data-region="library"]')).toBeTruthy();
    expect(document.querySelector('[data-region="inspector"]')).toBeTruthy();
  });

  it("drives the equipped grid from the opened build's real getEquipped result", async () => {
    const session = fakeSession();
    render(
      <App session={session} resolveOpenSource={async () => ({ xml: '<PathOfBuilding/>' })} />,
    );

    runCommand('build-open');
    selectItemsTab();

    // The Boots slot renders the build's REAL equipped item (name + base type).
    const bootsSlot = await screen.findByText('Sorrow Sole');
    expect(bootsSlot).toBeTruthy();
    expect(screen.getByText('Hunting Shoes')).toBeTruthy();

    // An unequipped slot (Helmet) stays empty — no fabricated placeholder item.
    const helmet = document.querySelector('[data-slot="Helmet"]') as HTMLElement;
    expect(helmet.getAttribute('data-occupied')).toBeNull();
    expect(within(helmet).queryByText('Sorrow Sole')).toBeNull();
  });

  it('selects the Items tab on mount when the location is the /items route (VISUAL[3])', () => {
    window.history.replaceState(null, '', '/items');
    render(<App session={fakeSession()} />);

    // The Items nav entry is the active tab, and the Items regions are mounted.
    const nav = screen.getByRole('navigation');
    const active = within(nav).getByRole('button', { current: 'page' });
    expect(active.textContent).toBe(stringsKo['nav.items']);
    expect(document.querySelector('[data-region="equipped"]')).toBeTruthy();
  });

  it('reflects the selected tab into window.location.pathname (route sync)', () => {
    render(<App session={fakeSession()} />);
    expect(window.location.pathname).toBe('/');

    selectItemsTab();
    expect(window.location.pathname).toBe('/items');
  });

  it('exposes the §11.1 "아이템 붙여넣기" command and routes paste through the session', async () => {
    const session = fakeSession();
    render(
      <App session={session} resolveClipboardText={async () => 'Sorrow Sole\nHunting Shoes'} />,
    );

    // The paste command is present in the Ctrl+K palette.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const paste = document.querySelector('[data-command-id="items-paste"]') as HTMLElement | null;
    expect(paste).toBeTruthy();
    fireEvent.click(paste!);

    // The pasted text reached the session's parseClipboard, and the parsed item
    // surfaces in the Items inspector (the tab is switched to Items by the command).
    await screen.findByText('Sorrow Sole');
    expect(session.pasted.length).toBe(1);
    const inspector = document.querySelector('[data-region="inspector"]') as HTMLElement;
    expect(within(inspector).getByText('Sorrow Sole')).toBeTruthy();
  });

  it('omits the paste command when no session is injected (no fake affordance)', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(document.querySelector('[data-command-id="items-paste"]')).toBeNull();
    // Nav commands still populate the palette (sanity).
    expect(document.querySelector('[data-command-id="nav-items"]')).toBeTruthy();
  });
});
