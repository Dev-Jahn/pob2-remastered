/**
 * core-ipc-client — the WebView-side CoreClient adapter that drives the Rust
 * host's allowlisted `core_request` IPC command (DESIGN §5.1 "Rust host layer"
 * owns the Lua runner, §6.2 out-of-process runner, §14.1 "허용된 command만
 * expose"). It is the Tauri-WebView counterpart of @pob2/core-client's
 * `CoreClient`: the Node client spawns the Lua runner via `node:child_process`,
 * which cannot run inside the Tauri WebView, so this adapter routes the SAME Core
 * API over `invoke('core_request', { method, params })` to the Rust host, which
 * owns the out-of-process runner.
 *
 * It satisfies build-session's {@link BuildClient} interface structurally, so the
 * SAME {@link createBuildSession} drives Overview/Items over either transport
 * (Node subprocess in tests/headless, Tauri IPC in the desktop app) — resolving
 * the PROGRESS.md "CARRYOVER→Phase 3 — core bridge over Tauri IPC" blocker.
 *
 * BROWSER-SAFE (no `node:*`): this module pulls only @pob2/schema / @pob2/ui types
 * (pure) and Tauri's `invoke`. The runner's wire shapes are assembled into the
 * typed Core API responses here, mirroring @pob2/core-client's `CoreClient` — but
 * @pob2/core-client itself is NOT imported (it transitively pulls
 * `node:child_process` / `node:zlib`). The `invoke` and the share-code `codec` are
 * INJECTABLE so a test exercises the wiring without a Tauri runtime.
 *
 * NO-FALLBACK (DESIGN §14.2): a runner crash / malformed reply comes back as the
 * Rust command's `Err` payload — a serialized CoreError envelope — which Tauri
 * rejects the `invoke` Promise with. This adapter rethrows it as a {@link
 * CoreClientError} unchanged; it never fabricates a buildId, summary, or stats.
 */
import type {
  BuildSaveResponse,
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  ConfigOptionCard,
  CoreError,
  EquipDelta,
  EquippedItem,
  ExplainSource,
  ExplainSourceKind,
  GemInput,
  ItemModInput,
  ItemsCompareResponse,
  ItemsCreateCustomResponse,
  ItemsGetEquippedResponse,
  ItemsParseClipboardResponse,
  Locale,
  SkillGemRef,
  SkillGroupCard,
  SkillsGetGroupsResponse,
  StatResult,
  TreeApplyAllocateResponse,
  TreeConstants,
  TreeGetDataResponse,
  TreeGroup,
  TreeNode,
  TreePreviewAllocateResponse,
  TreeStatDelta,
} from '@pob2/schema';
import type { BuildSummary } from '@pob2/ui';
import type { BuildClient } from './build-session.js';
import { strFromU8, strToU8, unzlibSync, zlibSync } from 'fflate';

/**
 * The Tauri `invoke` surface this adapter needs (DESIGN §14.1). Declared
 * structurally so a test injects a mock and production injects (or defaults to)
 * `@tauri-apps/api/core`'s `invoke`. The only command ever invoked is
 * `core_request`; `args` carries the allowlisted method + its params.
 */
export type CoreInvoke = (
  command: 'core_request',
  args: { method: string; params: unknown },
) => Promise<unknown>;

/**
 * Share-code codec (DESIGN §5.1 "build share code import/export adapter" lives on
 * the host layer; §6.3 loadShareCode/exportShareCode). A PoB share code is
 * `base64url(zlib.deflate(buildXml))`. The decode (import) path inflates any valid
 * zlib stream, so it is sound regardless of the encoder's compression level.
 * Injected so this WebView module carries no `node:zlib`; the desktop host supplies
 * a browser-safe implementation (see {@link defaultShareCodeCodec}).
 */
export interface ShareCodeCodec {
  /** Decode a PoB share code back to build XML. */
  decode(code: string): string;
  /** Encode build XML to a PoB share code. */
  encode(xml: string): string;
}

/** Options for {@link createIpcCoreClient}. Both deps default to the Tauri host. */
export interface IpcCoreClientOptions {
  /** Tauri `invoke`; defaults to `@tauri-apps/api/core`'s `invoke`. */
  invoke?: CoreInvoke;
  /** Share-code codec; defaults to {@link defaultShareCodeCodec}. */
  codec?: ShareCodeCodec;
}

/**
 * Error carrying the normalised {@link CoreError} envelope (DESIGN §6.4). The Rust
 * `core_request` command's `Err` payload IS a CoreError, so a rejected `invoke`
 * already gives us `{ code, message, … }`; this wraps it in an `Error` subclass so
 * callers can both `instanceof`-check and read the typed `code` (matching
 * @pob2/core-client's `CoreClientError` so consumers see one error shape).
 */
export class CoreClientError extends Error implements CoreError {
  readonly code: CoreError['code'];
  readonly details?: unknown;
  readonly upstreamStack?: string;

  constructor(error: CoreError) {
    super(error.message);
    this.name = 'CoreClientError';
    this.code = error.code;
    this.details = error.details;
    this.upstreamStack = error.upstreamStack;
  }
}

/** Type guard: a rejected-invoke value that is a serialized CoreError envelope. */
function isCoreError(value: unknown): value is CoreError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * The default Tauri `invoke`, loaded lazily from `@tauri-apps/api/core` so this
 * module stays importable (and the test build runnable) without a Tauri runtime —
 * the dynamic import only happens if no `invoke` is injected, i.e. in the real
 * desktop app. NO-FALLBACK: if the Tauri API cannot load, the failure propagates;
 * there is no non-IPC fallback transport in the WebView.
 */
const tauriInvoke: CoreInvoke = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke(command, args);
};

/** Encode bytes as base64url (PoB share codes use `-`/`_`, no padding). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode base64url (PoB share-code alphabet) back to bytes. */
function base64UrlToBytes(code: string): Uint8Array {
  const b64 = code.trim().replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Browser-safe default share-code codec for the WebView (DESIGN §5.1, §6.3). A PoB
 * share code is `base64url(zlib.deflate(buildXml))`. This uses fflate's SYNCHRONOUS
 * `zlibSync`/`unzlibSync` (RFC 1950, the same `0x78` zlib wrapper Node's
 * `deflateSync`/`inflateSync` and upstream PoB produce) so the {@link ShareCodeCodec}
 * surface stays synchronous and carries no `node:zlib` — it runs in the WebView.
 *
 * DECODE inflates any valid zlib stream, so a code from upstream PoB / the Node
 * client round-trips here. ENCODE pins `level: 9` (`Z_BEST_COMPRESSION`) to match
 * upstream's compressor — resolving the PROGRESS.md p1/encode-byte-identity caveat
 * for valid-format round-trips (the per-byte match against a real captured PoB code
 * remains the gamedata gate).
 */
export const defaultShareCodeCodec: ShareCodeCodec = {
  decode(code: string): string {
    try {
      return strFromU8(unzlibSync(base64UrlToBytes(code)));
    } catch (err) {
      throw new CoreClientError({
        code: 'BUILD_PARSE_FAILED',
        message: `share-code decode failed: ${String(err)}`,
      });
    }
  },
  encode(xml: string): string {
    return bytesToBase64Url(zlibSync(strToU8(xml), { level: 9 }));
  },
};

/**
 * Create an IPC-backed Core API client that satisfies {@link BuildClient}. Every
 * method routes through `invoke('core_request', { method, params })` to the Rust
 * host (DESIGN §14.1 allowlisted command); the runner's wire result is assembled
 * into the typed Core API response, mirroring @pob2/core-client's `CoreClient`.
 */
export function createIpcCoreClient(options: IpcCoreClientOptions = {}): BuildClient {
  const invoke = options.invoke ?? tauriInvoke;
  const codec = options.codec ?? defaultShareCodeCodec;

  /**
   * Issue one allowlisted Core API request to the Rust host and return the
   * runner's raw result JSON. A rejected `invoke` (the command's CoreError `Err`
   * payload) is rethrown as a {@link CoreClientError}, unchanged (NO-FALLBACK).
   */
  async function request(method: string, params: unknown): Promise<unknown> {
    try {
      return await invoke('core_request', { method, params });
    } catch (err) {
      if (err instanceof CoreClientError) throw err;
      if (isCoreError(err)) throw new CoreClientError(err);
      // A non-CoreError rejection means the IPC layer itself failed (e.g. the
      // Tauri bridge is unavailable); surface it as a CORE_INIT_FAILED CoreError
      // rather than leaking a raw transport error to the UI.
      throw new CoreClientError({
        code: 'CORE_INIT_FAILED',
        message: `core_request('${method}') failed: ${String(err)}`,
      });
    }
  }

  async function load(xml: string): Promise<{ buildId: string; summary: BuildSummary }> {
    const result = (await request('build.load', { xml })) as {
      buildId?: unknown;
      summary?: unknown;
    };
    if (!result || typeof result.buildId !== 'string') {
      throw new CoreClientError({
        code: 'BUILD_PARSE_FAILED',
        message: 'build.load did not return a buildId',
      });
    }
    return {
      buildId: result.buildId,
      summary: (result.summary as BuildSummary) ?? {},
    };
  }

  return {
    load,

    async loadShareCode(code: string) {
      // The host owns the share-code adapter (DESIGN §5.1); decode to XML here,
      // then load through the SAME build.load command — the runner only sees XML.
      return load(codec.decode(code));
    },

    async calcRun(buildId: string): Promise<CalcRunResponse> {
      const result = (await request('calc.run', { buildId })) as { stats?: StatResult[] };
      // The runner returns {stats}; the adapter owns the buildId it sent, so inject
      // it to satisfy the {buildId, stats} CalcRunResponse shape.
      return { buildId, stats: result.stats ?? [] };
    },

    async save(buildId: string): Promise<BuildSaveResponse> {
      const result = (await request('build.save', { buildId })) as { xml?: string };
      if (typeof result.xml !== 'string') {
        throw new CoreClientError({
          code: 'UPSTREAM_INCOMPATIBLE',
          message: 'build.save did not return xml',
        });
      }
      return { format: 'xml', data: result.xml };
    },

    async saveShareCode(buildId: string) {
      const { data: xml } = await this.save(buildId);
      return { format: 'shareCode', data: codec.encode(xml) };
    },

    async getEquipped(buildId: string): Promise<ItemsGetEquippedResponse> {
      const result = (await request('items.getEquipped', { buildId })) as {
        equipped?: EquippedItem[];
      };
      // The runner serializes the exact EquippedItem card shape; absent means no
      // equipped gear (an empty grid), never a fabricated card (NO-FALLBACK).
      return { equipped: result.equipped ?? [] };
    },

    async parseClipboard(text: string, localeHint?: Locale): Promise<ItemsParseClipboardResponse> {
      return (await request('items.parseClipboard', {
        text,
        localeHint,
      })) as ItemsParseClipboardResponse;
    },

    async createCustom(baseId: string, mods: ItemModInput[]): Promise<ItemsCreateCustomResponse> {
      // DOCUMENTED GAP (mirrors @pob2/core-client): the runner does not implement
      // items.createCustom yet, so a well-formed request surfaces the host's
      // method-not-found CoreError rather than a fabricated item (NO-FALLBACK).
      return (await request('items.createCustom', { baseId, mods })) as ItemsCreateCustomResponse;
    },

    async equipDelta(
      buildId: string,
      item: EquippedItem,
      slot: string,
    ): Promise<ItemsCompareResponse> {
      // Route through the runner's items.compare, which drives the core's OWN
      // non-mutating comparison machinery (GetMiscCalculator): it recomputes the
      // full output as if `item` occupied `slot` WITHOUT mutating the build and
      // diffs it against the live baseline (mirrors @pob2/core-client equipDelta).
      const result = (await request('items.compare', {
        buildId,
        itemId: item.itemId,
        slot,
      })) as { slot?: string; deltas?: EquipDelta[] };
      // The runner serializes the exact { slot, deltas: EquipDelta[] } shape; absent
      // deltas means an empty diff, never a fabricated one (NO-FALLBACK).
      return { slot: result.slot ?? slot, deltas: result.deltas ?? [] };
    },

    async getSkillGroups(buildId: string): Promise<SkillsGetGroupsResponse> {
      const result = (await request('skills.getGroups', { buildId })) as { groups?: unknown[] };
      // The runner carries gems in ONE list with an isSupport flag and spirit/
      // reservation as nested tables; lift each group into the registry
      // SkillGroupCard (active/support split, scalar spirit/reservation) — mirrors
      // @pob2/core-client's getSkillGroups assembly (DESIGN §6.4, §10.5).
      return { groups: result.groups?.map(toSkillGroupCard) ?? [] };
    },

    async setGemGroup(
      buildId: string,
      groupId: string,
      gems: GemInput[],
    ): Promise<{ groupId: string }> {
      const result = (await request('skills.setGemGroup', { buildId, groupId, gems })) as {
        groupId?: unknown;
      };
      if (typeof result.groupId !== 'string') {
        throw new CoreClientError({
          code: 'UPSTREAM_INCOMPATIBLE',
          message: 'skills.setGemGroup did not return a groupId',
        });
      }
      return { groupId: result.groupId };
    },

    async getConfigOptions(buildId: string): Promise<ConfigGetOptionsResponse> {
      const result = (await request('config.getOptions', { buildId })) as { options?: unknown[] };
      // The runner surfaces the dependency hints as four separate lists; the card
      // joins them into the one dependentModifiers list — mirrors @pob2/core-client
      // getConfigOptions assembly (DESIGN §6.4, §10.8).
      return { options: result.options?.map(toConfigOptionCard) ?? [] };
    },

    async setConfigOption(
      buildId: string,
      optionId: string,
      value: unknown,
    ): Promise<{ optionId: string }> {
      const result = (await request('config.setOption', { buildId, optionId, value })) as {
        optionId?: unknown;
      };
      if (typeof result.optionId !== 'string') {
        throw new CoreClientError({
          code: 'UPSTREAM_INCOMPATIBLE',
          message: 'config.setOption did not return an optionId',
        });
      }
      return { optionId: result.optionId };
    },

    async explainStat(
      buildId: string,
      statId: string,
      activeSkillId?: string,
    ): Promise<CalcExplainResponse> {
      const params = activeSkillId ? { buildId, statId, activeSkillId } : { buildId, statId };
      const result = await request('calc.explain', params);
      // The runner emits the trace as a string ARRAY and the id as
      // upstreamRawStatId; assemble into the registry CalcExplainResponse — mirrors
      // @pob2/core-client assembleExplain (DESIGN §6.4, §10.7).
      return assembleExplain(result, statId);
    },

    async getTreeData(buildId: string): Promise<TreeGetDataResponse> {
      const wire = (await request('tree.getData', { buildId })) as Partial<TreeGetDataResponse>;
      // The runner already emits the exact {treeVersion, nodes, groups, constants,
      // allocatedNodeIds} shape; lift each field explicitly — an absent list means an
      // empty tree, never a fabricated node (NO-FALLBACK §6.4). Mirrors
      // @pob2/core-client's getTreeData assembly.
      return {
        treeVersion: typeof wire.treeVersion === 'string' ? wire.treeVersion : '',
        nodes: (wire.nodes as TreeNode[]) ?? [],
        groups: (wire.groups as TreeGroup[]) ?? [],
        constants:
          (wire.constants as TreeConstants) ??
          ({
            classes: {},
            orbitAnglesByOrbit: [],
            orbitRadii: [],
            skillsPerOrbit: [],
          } as TreeConstants),
        allocatedNodeIds: (wire.allocatedNodeIds as number[]) ?? [],
      };
    },

    async previewAllocate(
      buildId: string,
      nodeIds: number[],
    ): Promise<TreePreviewAllocateResponse> {
      const result = (await request('tree.previewAllocate', { buildId, nodeIds })) as {
        deltas?: TreeStatDelta[];
      };
      // The runner serializes the exact {statId, before, after, delta} list; absent
      // means an empty (no-op) preview, never a fabricated delta (NO-FALLBACK).
      return { deltas: result.deltas ?? [] };
    },

    async applyAllocate(buildId: string, nodeIds: number[]): Promise<TreeApplyAllocateResponse> {
      const result = (await request('tree.applyAllocate', { buildId, nodeIds })) as {
        allocatedNodeIds?: number[];
      };
      // The runner commits the allocation and echoes the new allocated set back;
      // absent means no allocated nodes, never a fabricated set (NO-FALLBACK).
      return { allocatedNodeIds: result.allocatedNodeIds ?? [] };
    },
  };
}

// ----------------------------------------------------------------------------
// Wire -> registry assemblers for the §6.3 skills/config/calc.explain methods.
// The Rust host returns the runner's raw wire result, so these mirror the SAME
// assembly @pob2/core-client applies (DESIGN §6.4): each field is explicitly
// copied and a missing scalar resolves to an explicit default — no live runner
// sub-table is passed through, so the assembled value satisfies the schema.
// ----------------------------------------------------------------------------

/** One gem as the runner serializes it inside a skills.getGroups socket group. */
interface WireGem {
  gemId?: unknown;
  nameSpec?: unknown;
  level?: unknown;
  quality?: unknown;
  enabled?: unknown;
  isSupport?: unknown;
}

/** One socket group as the runner serializes it for skills.getGroups. */
interface WireGroup {
  groupId?: unknown;
  label?: unknown;
  enabled?: unknown;
  gems?: WireGem[];
  spirit?: { reserved?: unknown };
  reservation?: { mana?: { reserved?: unknown } };
}

/** Map a runner wire gem to the registry SkillGemRef (DESIGN §6.3, §10.5). */
function toSkillGemRef(gem: WireGem): SkillGemRef {
  return {
    gemId: typeof gem.gemId === 'string' ? gem.gemId : '',
    name: typeof gem.nameSpec === 'string' ? gem.nameSpec : '',
    level: typeof gem.level === 'number' ? gem.level : 0,
    quality: typeof gem.quality === 'number' ? gem.quality : 0,
    enabled: gem.enabled === true,
  };
}

/** Map a runner wire socket group to the registry SkillGroupCard (DESIGN §6.3, §10.5). */
function toSkillGroupCard(value: unknown): SkillGroupCard {
  const group = (value ?? {}) as WireGroup;
  const activeGems: SkillGemRef[] = [];
  const supportGems: SkillGemRef[] = [];
  for (const gem of group.gems ?? []) {
    (gem.isSupport === true ? supportGems : activeGems).push(toSkillGemRef(gem));
  }
  return {
    groupId: typeof group.groupId === 'string' ? group.groupId : '',
    label: typeof group.label === 'string' ? group.label : '',
    enabled: group.enabled === true,
    spirit: typeof group.spirit?.reserved === 'number' ? group.spirit.reserved : 0,
    reservation:
      typeof group.reservation?.mana?.reserved === 'number' ? group.reservation.mana.reserved : 0,
    // Order-preserving full gem list (the wire order), the skills.setGemGroup source.
    gems: (group.gems ?? []).map(toSkillGemRef),
    activeGems,
    supportGems,
  };
}

/** The runner's per-option dependency-hint fields, joined into dependentModifiers. */
const CONFIG_DEPENDENCY_FIELDS = ['ifSkillData', 'ifEnemyCond', 'ifCond', 'ifOption'] as const;

/** One config option as the runner serializes it for config.getOptions. */
interface WireOption {
  optionId?: unknown;
  type?: unknown;
  label?: unknown;
  value?: unknown;
  ifSkillData?: unknown;
  ifEnemyCond?: unknown;
  ifCond?: unknown;
  ifOption?: unknown;
}

/** Map a runner wire option to the registry ConfigOptionCard (DESIGN §6.3, §10.8). */
function toConfigOptionCard(value: unknown): ConfigOptionCard {
  const option = (value ?? {}) as WireOption;
  const dependentModifiers: string[] = [];
  for (const field of CONFIG_DEPENDENCY_FIELDS) {
    const hint = option[field];
    if (Array.isArray(hint)) {
      for (const id of hint) if (typeof id === 'string') dependentModifiers.push(id);
    }
  }
  return {
    optionId: typeof option.optionId === 'string' ? option.optionId : '',
    type: typeof option.type === 'string' ? option.type : '',
    label: typeof option.label === 'string' ? option.label : '',
    value: option.value,
    dependentModifiers,
  };
}

/** The closed ExplainSource kind set the registry response schema accepts. */
const EXPLAIN_SOURCE_KINDS: readonly ExplainSourceKind[] = [
  'item',
  'passive',
  'skillGem',
  'supportGem',
  'config',
  'buff',
];

/** One contribution source as the runner serializes it inside calc.explain. */
interface WireExplainSource {
  kind?: unknown;
  source?: unknown;
  sourceName?: unknown;
  name?: unknown;
  value?: unknown;
}

/** Map a runner wire contribution source to the registry ExplainSource (§10.7). */
function toExplainSource(value: unknown): ExplainSource {
  const src = (value ?? {}) as WireExplainSource;
  const kind = (EXPLAIN_SOURCE_KINDS as readonly string[]).includes(src.kind as string)
    ? (src.kind as ExplainSourceKind)
    : 'buff';
  const label =
    typeof src.sourceName === 'string' && src.sourceName.length > 0
      ? src.sourceName
      : typeof src.name === 'string' && src.name.length > 0
        ? src.name
        : typeof src.source === 'string'
          ? src.source
          : '';
  return { kind, label, value: typeof src.value === 'number' ? src.value : 0 };
}

/** Lift the runner's flat breakdown into the registry CalcExplainResponse (§6.3, §10.7). */
function assembleExplain(value: unknown, requestedStatId: string): CalcExplainResponse {
  const r = (value ?? {}) as {
    statId?: unknown;
    upstreamRawStatId?: unknown;
    finalValue?: unknown;
    label?: unknown;
    trace?: unknown;
    sources?: unknown[];
  };
  const traceLines = Array.isArray(r.trace)
    ? r.trace.filter((l): l is string => typeof l === 'string')
    : [];
  return {
    statId: typeof r.statId === 'string' ? r.statId : requestedStatId,
    finalValue: typeof r.finalValue === 'number' ? r.finalValue : 0,
    label: typeof r.label === 'string' ? r.label : requestedStatId,
    sources: (r.sources ?? []).map(toExplainSource),
    formula: traceLines.join('\n'),
    upstreamStatId: typeof r.upstreamRawStatId === 'string' ? r.upstreamRawStatId : requestedStatId,
  };
}
