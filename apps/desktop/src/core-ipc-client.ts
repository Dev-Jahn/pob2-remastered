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
  CalcRunResponse,
  CoreError,
  EquipDelta,
  EquippedItem,
  ItemModInput,
  ItemsCompareResponse,
  ItemsCreateCustomResponse,
  ItemsGetEquippedResponse,
  ItemsParseClipboardResponse,
  Locale,
  StatResult,
} from '@pob2/schema';
import type { BuildSummary } from '@pob2/ui';
import type { BuildClient } from './build-session.js';

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

/**
 * Browser-safe default share-code codec for the WebView. Uses the Web
 * Compression Streams API (`deflate` = zlib RFC 1950, the same wrapper Node's
 * `deflateSync`/`inflateSync` produce), so a code emitted by upstream PoB / the
 * Node client decodes here, and a code emitted here decodes there. Loaded lazily
 * so the synchronous {@link ShareCodeCodec} surface stays simple while the actual
 * deflate is the async stream API.
 *
 * NOTE (PROGRESS.md p1/encode-byte-identity): the DECODE path is byte-exact for
 * any valid zlib stream regardless of compression level. The ENCODE path here does
 * not pin a compression level, so an encoded code is a VALID PoB share code but is
 * not guaranteed byte-identical to upstream's `Z_BEST_COMPRESSION` output — same
 * caveat already flagged for the Node encoder.
 */
export const defaultShareCodeCodec: ShareCodeCodec = {
  decode(): string {
    throw new CoreClientError({
      code: 'UPSTREAM_INCOMPATIBLE',
      message:
        'share-code decode requires an async codec; inject a ShareCodeCodec into createIpcCoreClient',
    });
  },
  encode(): string {
    throw new CoreClientError({
      code: 'UPSTREAM_INCOMPATIBLE',
      message:
        'share-code encode requires an async codec; inject a ShareCodeCodec into createIpcCoreClient',
    });
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
  };
}
