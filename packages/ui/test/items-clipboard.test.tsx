// Items tab clipboard-import / custom-item / shared-scope test
// (task p3-clipboard-import-ui).
//
// DESIGN references:
//   - §10.4 Items tab: "Import from Clipboard", custom item creation, and the
//     "공유 보관함 (shared item scope)" the old UI hid — exposed here as a library
//     scope filter (build | shared stash).
//   - §8.6 한국어 아이템 붙여넣기 파싱: parseClipboard returns parsed mods + a
//     separate `unsupported[]` list and an estimated/hinted locale; the inspector
//     must render parsed and unsupported lines apart.
//   - §6.3 items.parseClipboard / items.createCustom: the Core API the hook calls.
//   - §5.1 injectable client: the real CoreClient spawns an out-of-process Lua
//     runner jsdom cannot host, so `useItemsTab` takes the client as a dependency.
//     These tests inject a recording MOCK that returns canned @pob2/core-client
//     shapes; @pob2/core-client internals are NOT touched.
//   - §6.4 NO-FALLBACK: the hook only routes + re-shapes; it never fabricates a
//     parsed item or a created item on failure.
//
// What is under test:
//   - useItemsTab(client) container hook:
//       * importFromClipboard(text, localeHint?) -> client.parseClipboard, then
//         exposes the result as an InspectedItem (parsed/unsupported split) so the
//         ItemInspector can render it; the estimated locale is surfaced.
//       * createCustom(baseId, mods) -> client.createCustom, returns the created
//         item and appends it to the build-scope library.
//       * scope state: 'build' | 'shared', `setScope`, and `library` returns the
//         rows for the active scope (the §10.4 shared-stash drawer/filter).
//   - ClipboardImport component: a textarea + import button that drives
//     importFromClipboard and renders the parsed result through the inspector,
//     with parsed and unsupported affixes split (§8.6/§11.3 badges).
//   - CustomItemForm component: a base <select> + mod <textarea> that calls
//     onCreate(baseId, mods) with one ItemModInput per non-empty line.
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  within,
  cleanup,
  fireEvent,
  renderHook,
  act as actHook,
} from '@testing-library/react';
import type {
  ItemsParseClipboardResponse,
  ItemsCreateCustomResponse,
  ItemModInput,
  Locale,
} from '@pob2/schema';
import { useItemsTab, ClipboardImport, CustomItemForm, t } from '../src/index.js';
import type { ItemsClient, LibraryItem } from '../src/index.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures: the §10.4 Sorrow Sole / Hunting Shoes boots, ko-clipboard flavour.
// ---------------------------------------------------------------------------

// A Korean clipboard parse result: one parsed mod + one unsupported line, with
// the locale ESTIMATED as ko-KR by the runner (§8.6 step 1).
const KO_PARSE: ItemsParseClipboardResponse = {
  locale: 'ko-KR',
  baseId: '사냥 장화',
  rarity: '레어',
  name: '슬픔의 밑창',
  mods: [
    { raw: '+18% 화염 저항', status: 'parsed', statId: 'FireResist' },
    { raw: '미러된 알 수 없는 줄', status: 'unsupported' },
  ],
  unsupported: ['미러된 알 수 없는 줄'],
};

const CREATED: ItemsCreateCustomResponse = {
  itemId: 'custom-1',
  item: {
    slot: 'Boots',
    itemId: 'custom-1',
    name: 'My Boots',
    rarity: 'Rare',
    baseName: 'Hunting Shoes',
    requirements: { level: 33, str: 0, dex: 62, int: 0 },
    summaryMods: ['+18% to Fire Resistance'],
    unsupportedMods: [],
  },
};

const SHARED_ROWS: LibraryItem[] = [
  {
    itemId: 'shared-ring',
    name: 'Shared Ring',
    nameKo: '공유 반지',
    baseType: 'Gold Ring',
    baseTypeKo: '황금 반지',
    slot: 'Ring 1',
    type: 'Ring',
    rarity: 'Rare',
    requirements: { level: 20, str: 0, dex: 0, int: 0 },
  },
];

const BUILD_ROWS: LibraryItem[] = [
  {
    itemId: 'build-boots',
    name: 'Sorrow Sole',
    nameKo: '슬픔의 밑창',
    baseType: 'Hunting Shoes',
    baseTypeKo: '사냥 장화',
    slot: 'Boots',
    type: 'Boots',
    rarity: 'Rare',
    requirements: { level: 33, str: 0, dex: 62, int: 0 },
  },
];

/**
 * A recording mock ItemsClient: returns canned @pob2/core-client shapes and logs
 * every call so the wiring can be asserted (DESIGN §5.1 injectable client). No Lua
 * runner is spawned.
 */
function mockClient(
  overrides: Partial<ItemsClient> = {},
): ItemsClient & { calls: Array<{ method: string; arg: unknown }> } {
  const calls: Array<{ method: string; arg: unknown }> = [];
  return {
    calls,
    async parseClipboard(text: string, localeHint?: Locale) {
      calls.push({ method: 'parseClipboard', arg: { text, localeHint } });
      return KO_PARSE;
    },
    async createCustom(baseId: string, mods: ItemModInput[]) {
      calls.push({ method: 'createCustom', arg: { baseId, mods } });
      return CREATED;
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// useItemsTab — clipboard import (§10.4 Import from Clipboard, §8.6)
// ---------------------------------------------------------------------------

describe('useItemsTab — importFromClipboard (DESIGN §10.4, §8.6, §5.1)', () => {
  it('routes the clipboard text through client.parseClipboard with the locale hint', async () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );

    await actHook(async () => {
      await result.current.importFromClipboard('아이템 텍스트', 'ko-KR');
    });

    expect(client.calls).toEqual([
      { method: 'parseClipboard', arg: { text: '아이템 텍스트', localeHint: 'ko-KR' } },
    ]);
  });

  it('exposes the parsed result as an InspectedItem with parsed and unsupported lines split (§8.6)', async () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );

    await actHook(async () => {
      await result.current.importFromClipboard('아이템 텍스트', 'ko-KR');
    });

    const imported = result.current.importedItem;
    expect(imported).toBeTruthy();
    // The recognised mod is a parsed line; the unsupported line is kept apart.
    expect(imported!.parsedMods).toContain('+18% 화염 저항');
    expect(imported!.unsupportedMods).toContain('미러된 알 수 없는 줄');
    expect(imported!.parsedMods).not.toContain('미러된 알 수 없는 줄');
    // The estimated locale is surfaced (§8.6 step 1).
    expect(result.current.importedLocale).toBe('ko-KR');
  });

  it('does NOT fabricate an imported item before any import (NO-FALLBACK, §6.4)', () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );
    expect(result.current.importedItem).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// useItemsTab — custom item creation (§10.4 custom item, §6.3 items.createCustom)
// ---------------------------------------------------------------------------

describe('useItemsTab — createCustom (DESIGN §10.4, §6.3, §5.1)', () => {
  it('routes the base id + mod inputs through client.createCustom and returns the item', async () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );

    const mods: ItemModInput[] = [{ text: '+18% to Fire Resistance' }];
    let created: ItemsCreateCustomResponse | undefined;
    await actHook(async () => {
      created = await result.current.createCustom('Hunting Shoes', mods);
    });

    expect(client.calls).toEqual([
      { method: 'createCustom', arg: { baseId: 'Hunting Shoes', mods } },
    ]);
    expect(created).toEqual(CREATED);
  });

  it('appends the created item to the build-scope library (§10.4 라이브러리에 추가)', async () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );

    await actHook(async () => {
      await result.current.createCustom('Hunting Shoes', [{ text: '+18% to Fire Resistance' }]);
    });

    // The build scope now carries the original row plus the created item.
    const ids = result.current.library.map((r) => r.itemId);
    expect(ids).toContain('build-boots');
    expect(ids).toContain('custom-1');
  });
});

// ---------------------------------------------------------------------------
// useItemsTab — shared item scope (§10.4 "shared item 개념이 숨겨짐" 개선)
// ---------------------------------------------------------------------------

describe('useItemsTab — library scope (DESIGN §10.4 shared item scope)', () => {
  it('defaults to the build scope and lists the build library', () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );
    expect(result.current.scope).toBe('build');
    expect(result.current.library.map((r) => r.itemId)).toEqual(['build-boots']);
  });

  it('switches to the shared stash scope and lists the shared library', () => {
    const client = mockClient();
    const { result } = renderHook(() =>
      useItemsTab({ client, buildLibrary: BUILD_ROWS, sharedLibrary: SHARED_ROWS }),
    );

    actHook(() => {
      result.current.setScope('shared');
    });

    expect(result.current.scope).toBe('shared');
    expect(result.current.library.map((r) => r.itemId)).toEqual(['shared-ring']);
  });
});

// ---------------------------------------------------------------------------
// ClipboardImport component (§10.4 Import from Clipboard, §8.6)
// ---------------------------------------------------------------------------

describe('ClipboardImport (DESIGN §10.4 clipboard import → inspector)', () => {
  it('renders a paste textarea and an import button', () => {
    render(<ClipboardImport locale="ko-KR" onImport={vi.fn()} />);
    expect(screen.getByLabelText(t('ko-KR', 'items.clipboard.pasteLabel'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'items.importFromClipboard'))).toBeTruthy();
  });

  it('calls onImport with the pasted text when the import button is pressed', () => {
    const onImport = vi.fn();
    render(<ClipboardImport locale="ko-KR" onImport={onImport} />);
    const textarea = screen.getByLabelText(
      t('ko-KR', 'items.clipboard.pasteLabel'),
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '슬픔의 밑창\n사냥 장화' } });
    fireEvent.click(screen.getByText(t('ko-KR', 'items.importFromClipboard')));
    expect(onImport).toHaveBeenCalledWith('슬픔의 밑창\n사냥 장화');
  });

  it('renders the parsed result through the inspector with parsed/unsupported split (§8.6, §11.3)', () => {
    const inspected = {
      itemId: 'imported-1',
      name: '슬픔의 밑창',
      baseType: '사냥 장화',
      rarityColorKey: 'rare',
      sourceText: '슬픔의 밑창\n사냥 장화\n+18% 화염 저항',
      translatedText: '슬픔의 밑창\n사냥 장화\n+18% 화염 저항',
      parsedMods: ['+18% 화염 저항'],
      unsupportedMods: ['미러된 알 수 없는 줄'],
      slot: 'Boots',
    };
    const { container } = render(
      <ClipboardImport locale="ko-KR" onImport={vi.fn()} imported={inspected} />,
    );
    // One parsed affix, one unsupported affix (§8.6 split, rendered by the inspector).
    expect(container.querySelectorAll('[data-affix="parsed"]')).toHaveLength(1);
    const unsupported = container.querySelector('[data-affix="unsupported"]') as HTMLElement;
    expect(unsupported).toBeTruthy();
    // §11.3: the unsupported badge carries an icon AND a text label, not colour only.
    expect(unsupported.querySelector('[data-affix-icon]')).toBeTruthy();
    expect(within(unsupported).getByText(t('ko-KR', 'items.badge.unsupported'))).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// CustomItemForm component (§10.4 custom item creation: base + mods)
// ---------------------------------------------------------------------------

describe('CustomItemForm (DESIGN §10.4 custom item creation)', () => {
  const BASES = [
    { id: 'Hunting Shoes', name: 'Hunting Shoes' },
    { id: 'Iron Hat', name: 'Iron Hat' },
  ];

  it('renders a base selector with one option per base, and a mod input', () => {
    render(<CustomItemForm locale="ko-KR" bases={BASES} onCreate={vi.fn()} />);
    const baseSelect = screen.getByLabelText(t('ko-KR', 'items.custom.base')) as HTMLSelectElement;
    expect(within(baseSelect).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByLabelText(t('ko-KR', 'items.custom.mods'))).toBeTruthy();
  });

  it('calls onCreate with the chosen base id and one ItemModInput per non-empty mod line', () => {
    const onCreate = vi.fn();
    render(<CustomItemForm locale="ko-KR" bases={BASES} onCreate={onCreate} />);

    fireEvent.change(screen.getByLabelText(t('ko-KR', 'items.custom.base')), {
      target: { value: 'Iron Hat' },
    });
    fireEvent.change(screen.getByLabelText(t('ko-KR', 'items.custom.mods')), {
      // Two real lines plus a blank line that must be dropped (no empty mod).
      target: { value: '+18% to Fire Resistance\n\n25% increased Movement Speed' },
    });
    fireEvent.click(screen.getByText(t('ko-KR', 'items.custom.create')));

    expect(onCreate).toHaveBeenCalledWith('Iron Hat', [
      { text: '+18% to Fire Resistance' },
      { text: '25% increased Movement Speed' },
    ]);
  });

  it('does not call onCreate when no base is chosen (NO-FALLBACK, §6.4)', () => {
    const onCreate = vi.fn();
    // An empty base list means there is no base to select; create is a no-op.
    render(<CustomItemForm locale="ko-KR" bases={[]} onCreate={onCreate} />);
    fireEvent.click(screen.getByText(t('ko-KR', 'items.custom.create')));
    expect(onCreate).not.toHaveBeenCalled();
  });
});
