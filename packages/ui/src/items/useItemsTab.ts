/**
 * useItemsTab — the §10.4 Items-tab container hook (DESIGN §10.4 Items tab redesign,
 * §8.6 한국어 아이템 붙여넣기, §6.3 items.parseClipboard / items.createCustom, §5.1
 * injectable client).
 *
 * It owns the three pieces of Items-tab state the §10.4 redesign adds on top of the
 * pure view-models:
 *
 *   1. Clipboard import (§10.4 "Import from Clipboard", §8.6): `importFromClipboard`
 *      routes the pasted text through `client.parseClipboard`, splits the result into
 *      parsed vs unsupported lines (§8.6 step 4), and exposes it as an
 *      {@link InspectedItem} the {@link ItemInspector} can render. The estimated
 *      (or hinted) locale is surfaced as `importedLocale` (§8.6 step 1).
 *
 *   2. Custom item creation (§10.4 custom item): `createCustom` routes a base id +
 *      mod inputs through `client.createCustom`, returns the created item, and
 *      appends its library row to the build scope (§10.4 "라이브러리에 추가").
 *
 *   3. Library scope (§10.4 "shared item 개념이 숨겨짐" 개선): `scope` is `'build'`
 *      or `'shared'`, `setScope` switches it, and `library` returns the rows for the
 *      active scope — the shared-stash drawer/filter the old UI hid.
 *
 * INJECTABLE CLIENT (DESIGN §5.1): the real {@link CoreClient} spawns an
 * out-of-process Lua runner jsdom cannot host, so this hook takes the client as a
 * dependency (the minimal {@link ItemsClient} slice of the Core API), exactly like
 * the desktop build-session. @pob2/core-client internals are NOT touched.
 *
 * NO-FALLBACK (DESIGN §6.4): the hook only routes + re-shapes. Before any import,
 * `importedItem` is `undefined` (never a blank placeholder item); `createCustom`
 * returns the client's response verbatim and appends only what the client created.
 */
import { useCallback, useMemo, useState } from 'react';
import type {
  EquippedItem,
  ItemModInput,
  ItemsCreateCustomResponse,
  ItemsParseClipboardResponse,
  Locale,
} from '@pob2/schema';
import type { InspectedItem } from './ItemInspector.js';
import type { LibraryItem } from './library-search.js';

/**
 * The slice of the @pob2/core-client `CoreClient` Core API this hook calls, declared
 * structurally so the concrete client satisfies it and a test can inject a mock
 * without spawning the Lua runner (DESIGN §5.1). Mirrors the relevant `CoreClient`
 * method signatures exactly.
 */
export interface ItemsClient {
  /** items.parseClipboard — parse a clipboard item string (DESIGN §6.3, §8.6). */
  parseClipboard(text: string, localeHint?: Locale): Promise<ItemsParseClipboardResponse>;
  /** items.createCustom — build a custom item from a base id + mod inputs (§6.3). */
  createCustom(baseId: string, mods: ItemModInput[]): Promise<ItemsCreateCustomResponse>;
}

/** Which library the §10.4 scope filter is showing: this build, or the shared stash. */
export type LibraryScope = 'build' | 'shared';

export interface UseItemsTabOptions {
  /** The injected Core API client (DESIGN §5.1). */
  client: ItemsClient;
  /** The current build's library rows (the default `build` scope). */
  buildLibrary: LibraryItem[];
  /** The shared-stash rows (the §10.4 shared item scope). */
  sharedLibrary: LibraryItem[];
}

/** The Items-tab container state + actions the panel binds to. */
export interface UseItemsTabResult {
  /** Active library scope (DESIGN §10.4 shared item scope). */
  scope: LibraryScope;
  /** Switch the active library scope. */
  setScope: (scope: LibraryScope) => void;
  /** The library rows for the active scope (build rows include created customs). */
  library: LibraryItem[];

  /** The last clipboard-imported item, ready for the inspector; `undefined` until
   *  the first import (NO-FALLBACK, §6.4). */
  importedItem: InspectedItem | undefined;
  /** The locale the last import was parsed under (estimated or hinted, §8.6). */
  importedLocale: Locale | undefined;
  /** Parse `text` via the client and stage the result for the inspector (§10.4, §8.6). */
  importFromClipboard: (text: string, localeHint?: Locale) => Promise<void>;

  /** Create a custom item via the client and append it to the build scope (§10.4). */
  createCustom: (baseId: string, mods: ItemModInput[]) => Promise<ItemsCreateCustomResponse>;
}

/**
 * Map an `items.parseClipboard` response to the inspector's view of it (DESIGN
 * §10.4 inspector, §8.6 split). Parsed lines and the separate `unsupported[]` list
 * become the inspector's `parsedMods` / `unsupportedMods`. The verbatim source text
 * is reconstructed from the recognised name/base + every line (§8.6 "원문 보존"); the
 * translated block reuses it (a dedicated ko translation arrives with the i18n data
 * layer, not this routing hook).
 */
function toInspected(parsed: ItemsParseClipboardResponse): InspectedItem {
  // Parsed mod lines are exactly the entries the parser recognised (status
  // 'parsed'); the unsupported lines come from the dedicated `unsupported[]` list,
  // kept apart so an unrecognised line is never read as a parsed mod (§8.6 step 4).
  const parsedMods = parsed.mods.filter((m) => m.status === 'parsed').map((m) => m.raw);
  const unsupportedMods = [...parsed.unsupported];

  const name = parsed.name ?? '';
  const baseType = parsed.baseId ?? '';
  const sourceLines = [name, baseType, ...parsedMods, ...unsupportedMods].filter(
    (l) => l.length > 0,
  );
  const sourceText = sourceLines.join('\n');

  return {
    itemId: 'imported',
    name,
    baseType,
    rarityColorKey: (parsed.rarity ?? '').trim().toLowerCase(),
    sourceText,
    translatedText: sourceText,
    parsedMods,
    unsupportedMods,
    slot: 'Weapon 1',
  };
}

/** Map a created `EquippedItem` to a library row (DESIGN §10.4 라이브러리에 추가). */
function toLibraryRow(item: EquippedItem): LibraryItem {
  return {
    itemId: item.itemId,
    name: item.name,
    // No localized name/base from items.createCustom yet; mirror the English so the
    // ko↔en search still indexes the row (never a fabricated translation, §6.4).
    nameKo: item.name,
    baseType: item.baseName,
    baseTypeKo: item.baseName,
    slot: item.slot,
    type: item.slot,
    rarity: item.rarity,
    requirements: item.requirements,
  };
}

export function useItemsTab(options: UseItemsTabOptions): UseItemsTabResult {
  const { client, buildLibrary, sharedLibrary } = options;

  const [scope, setScope] = useState<LibraryScope>('build');
  const [importedItem, setImportedItem] = useState<InspectedItem | undefined>(undefined);
  const [importedLocale, setImportedLocale] = useState<Locale | undefined>(undefined);
  // Custom items created this session, appended to the build scope.
  const [createdRows, setCreatedRows] = useState<LibraryItem[]>([]);

  const importFromClipboard = useCallback(
    async (text: string, localeHint?: Locale) => {
      const parsed = await client.parseClipboard(text, localeHint);
      setImportedItem(toInspected(parsed));
      setImportedLocale(parsed.locale);
    },
    [client],
  );

  const createCustom = useCallback(
    async (baseId: string, mods: ItemModInput[]) => {
      const created = await client.createCustom(baseId, mods);
      setCreatedRows((rows) => [...rows, toLibraryRow(created.item)]);
      return created;
    },
    [client],
  );

  const library = useMemo(
    () => (scope === 'shared' ? sharedLibrary : [...buildLibrary, ...createdRows]),
    [scope, buildLibrary, sharedLibrary, createdRows],
  );

  return {
    scope,
    setScope,
    library,
    importedItem,
    importedLocale,
    importFromClipboard,
    createCustom,
  };
}
