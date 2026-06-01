/**
 * @pob2/core-client — the Node client the Rust host / tests use to spawn and
 * drive the out-of-process Lua runner (DESIGN §5.1 Rust host layer, §6.2
 * out-of-process runner, §6.3 Core API, §6.4 serialization/error principles).
 *
 * It owns one runner subprocess and exposes the MVP Core API as async methods:
 *   - load(xml)            -> build.load
 *   - save(buildId)        -> build.save  (PoB XML)
 *   - calcRun(buildId)     -> calc.run    (curated numeric stats)
 *   - parseClipboard(text) -> items.parseClipboard
 *   - version()            -> core.version (ready handshake)
 * plus the share-code wrappers (loadShareCode / saveShareCode) which delegate XML
 * <-> share-code compression to ./compression-adapter.
 *
 * VALIDATION (DESIGN §6.4): every request is validated against @pob2/schema's
 * registry request schema BEFORE send, and every response that the runner can
 * express in the registry's Core API shape is validated against the registry
 * response schema AFTER receive — a schema-invalid response is surfaced as a
 * CoreClientError (CORE_INIT_FAILED / UPSTREAM_INCOMPATIBLE …), never passed
 * through. The one documented exception is build.load's response: the headless
 * runner serializes a plain build `summary`, not the full BuildState the
 * build.load:response schema demands, so load() validates its request and returns
 * the summary verbatim rather than fabricating a BuildState (NO-FALLBACK). The
 * request side is still validated; the BuildState response is a tracked gap.
 */
import type {
  BuildSaveResponse,
  CalcRunResponse,
  EquipDelta,
  EquippedItem,
  ItemModInput,
  ItemsCompareResponse,
  ItemsCreateCustomResponse,
  ItemsGetEquippedResponse,
  ItemsParseClipboardResponse,
  Locale,
  ParsedItemMod,
  StatResult,
} from '@pob2/schema';
import {
  RunnerClient,
  CoreClientError,
  SHARE_CODE_MAX_BYTES,
  type RunnerClientOptions,
} from './runner-client.js';
import { decodeShareCode, encodeShareCode } from './compression-adapter.js';

export { CoreClientError } from './runner-client.js';
export { encodeShareCode, decodeShareCode } from './compression-adapter.js';

/** Result of core.version — the runner protocol version (DESIGN §6.3). */
export interface CoreVersion {
  version: string;
}

/** Plain build summary the headless runner serializes on load (see module note). */
export interface BuildSummary {
  className?: string;
  ascendancyName?: string;
  level?: number;
  itemCount?: number;
}

/** What load() returns: the build id plus the runner's plain build summary. */
export interface LoadResult {
  buildId: string;
  summary: BuildSummary;
}

export type CoreClientOptions = RunnerClientOptions;

/**
 * Public Core API client. One instance owns one runner subprocess; call
 * `dispose()` to kill it. Obtain one via {@link createCoreClient}, which spawns
 * the runner and completes the core.version ready handshake before resolving.
 */
export class CoreClient {
  private readonly runner: RunnerClient;
  private started = false;

  constructor(options: CoreClientOptions = {}) {
    this.runner = new RunnerClient(options);
  }

  /** Spawn the runner and block on the core.version ready handshake. */
  async start(): Promise<void> {
    if (this.started) return;
    await this.runner.start();
    this.started = true;
  }

  /**
   * The underlying RunnerClient. Exposed for the crash-isolation gate, which has
   * to drive raw/hostile lines through the transport and assert the SAME process
   * pid survives them (DESIGN §14.2). Not part of the typed Core API surface.
   */
  get runnerForTesting(): RunnerClient {
    return this.runner;
  }

  /** The runner protocol version reported by the core.version handshake. */
  async version(): Promise<CoreVersion> {
    const result = (await this.runner.call('core.version', {}, 10_000)) as { version?: unknown };
    if (!result || typeof result.version !== 'string') {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'core.version did not return a version string',
      });
    }
    return { version: result.version };
  }

  /**
   * Load a build from upstream PoB XML. The request is validated against the
   * build.load:request schema; the response is the runner's plain summary (see
   * the module note on the BuildState gap).
   */
  async load(xml: string): Promise<LoadResult> {
    // Validate the typed Core API request, then adapt to the runner wire params.
    const wireResult = (await this.runner.request(
      'build.load',
      { source: xml, format: 'xml' },
      () => ({ xml }),
      // The runner returns {buildId, summary}; that is NOT the BuildState shape
      // build.load:response requires, so we pass the runner result straight
      // through to the assembler below (no response-schema validation here).
      (r) => r,
      // No response-schema validation for build.load (documented gap): a
      // permissive responseValidate that always passes keeps request validation
      // and the wire hop intact without fabricating a BuildState.
      { validateResponse: false },
    )) as { buildId?: unknown; summary?: unknown };

    if (!wireResult || typeof wireResult.buildId !== 'string') {
      throw new CoreClientError({
        code: 'BUILD_PARSE_FAILED',
        message: 'build.load did not return a buildId',
      });
    }
    return {
      buildId: wireResult.buildId,
      summary: (wireResult.summary as BuildSummary) ?? {},
    };
  }

  /** Export the loaded build as PoB XML (build.save, validated response). */
  async save(buildId: string): Promise<BuildSaveResponse> {
    return (await this.runner.request(
      'build.save',
      { buildId, format: 'xml' },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      // Runner returns {xml}; lift it into the {format,data} Core API shape.
      (r) => ({ format: 'xml', data: (r as { xml?: string }).xml }),
    )) as BuildSaveResponse;
  }

  /** Run the calc pass and return curated numeric stats (validated response). */
  async calcRun(buildId: string): Promise<CalcRunResponse> {
    return (await this.runner.request(
      'calc.run',
      { buildId },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      // Runner returns {stats}; the client owns the buildId it sent, so inject it
      // to satisfy the {buildId, stats} calc.run:response shape.
      (r) => ({ buildId, stats: (r as { stats?: StatResult[] }).stats }),
    )) as CalcRunResponse;
  }

  /**
   * Parse a clipboard item string. The runner emits recognized mods as
   * {line, mods} and unrecognized lines in `unsupported`; this lifts both into
   * the registry's {raw, status, statId?} mod list + string `unsupported` list,
   * then validates against items.parseClipboard:response.
   */
  async parseClipboard(text: string, localeHint?: Locale): Promise<ItemsParseClipboardResponse> {
    const request = localeHint ? { text, localeHint } : { text };
    return (await this.runner.request(
      'items.parseClipboard',
      request,
      (p) => ({ text: (p as { text: string }).text }),
      (r) => this.assembleParseResult(r, localeHint),
    )) as ItemsParseClipboardResponse;
  }

  /**
   * The item cards equipped on the loaded build (DESIGN §6.3 items.getEquipped).
   * Validates the request against items.getEquipped:request, sends it to the
   * runner's items.getEquipped, and validates the runner's {equipped} result
   * against items.getEquipped:response — the runner already serializes the exact
   * EquippedItem card shape, so it passes straight through.
   */
  async getEquipped(buildId: string): Promise<ItemsGetEquippedResponse> {
    return (await this.runner.request(
      'items.getEquipped',
      { buildId },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      (r) => ({ equipped: (r as { equipped?: EquippedItem[] }).equipped ?? [] }),
    )) as ItemsGetEquippedResponse;
  }

  /**
   * Build a custom item from a base id plus mod inputs (DESIGN §6.3
   * items.createCustom). The request is validated against
   * items.createCustom:request, then sent to the runner's items.createCustom and
   * the result validated against items.createCustom:response.
   *
   * DOCUMENTED GAP (DESIGN §6.4 "러너가 표현 못하는 필드는 documented gap"): the
   * headless runner does not implement items.createCustom yet, so a well-formed
   * request surfaces a structured CoreClientError (method-not-found ->
   * UPSTREAM_INCOMPATIBLE) rather than a fabricated item card. The request-side
   * schema validation is real and runs regardless; this never fakes a success
   * (NO-FALLBACK).
   */
  async createCustom(baseId: string, mods: ItemModInput[]): Promise<ItemsCreateCustomResponse> {
    return (await this.runner.request(
      'items.createCustom',
      { baseId, mods },
      (p) => ({
        baseId: (p as { baseId: string }).baseId,
        mods: (p as { mods: ItemModInput[] }).mods,
      }),
      (r) => r,
    )) as ItemsCreateCustomResponse;
  }

  /**
   * Stat delta of equipping `item` in `slot` (DESIGN §6.3 items.compare, §16.3
   * "item equip delta"), routed through the runner's items.compare RPC. The runner
   * drives the core's OWN non-mutating comparison machinery
   * (calcsTab:GetMiscCalculator — Calcs.lua:123), recomputing the FULL output as if
   * `item` occupied `slot` WITHOUT mutating the live build, and diffs it against the
   * current baseline. Each stat is keyed by its machine-readable statId and
   * `delta === after - before`; request + response are validated against
   * items.compare:request / items.compare:response.
   *
   * This is a REAL before/after diff (not an A-vs-A pass): equipping the item
   * already in `slot` yields a measured 0 across the set, while a different item
   * yields the genuine non-zero change.
   */
  async equipDelta(
    buildId: string,
    item: EquippedItem,
    slot: string,
  ): Promise<ItemsCompareResponse> {
    return (await this.runner.request(
      'items.compare',
      { buildId, itemId: item.itemId, slot },
      (p) => ({
        buildId: (p as { buildId: string }).buildId,
        itemId: (p as { itemId: string }).itemId,
        slot: (p as { slot: string }).slot,
      }),
      // The runner already serializes the exact { slot, deltas: EquipDelta[] } shape
      // items.compare:response requires, so it passes straight through.
      (r) => ({
        slot: (r as { slot?: string }).slot ?? slot,
        deltas: (r as { deltas?: EquipDelta[] }).deltas ?? [],
      }),
    )) as ItemsCompareResponse;
  }

  /** Decode a PoB share code to XML and load it (DESIGN §6.3 loadShareCode). */
  async loadShareCode(code: string): Promise<LoadResult> {
    // Size limit BEFORE decode (DESIGN §14.2 "share code decode는 size limit
    // 적용"): refuse an oversized (e.g. zip-bomb-shaped) code rather than handing
    // it to the decompressor — a hostile code never reaches inflate.
    if (Buffer.byteLength(code, 'utf8') > SHARE_CODE_MAX_BYTES) {
      throw new CoreClientError({
        code: 'BUILD_PARSE_FAILED',
        message: `share code exceeds the ${SHARE_CODE_MAX_BYTES}-byte decode size limit`,
      });
    }
    let xml: string;
    try {
      xml = decodeShareCode(code);
    } catch (e) {
      throw new CoreClientError({
        code: 'BUILD_PARSE_FAILED',
        message: `share code could not be decompressed: ${String(e)}`,
      });
    }
    return this.load(xml);
  }

  /** Export the loaded build as a PoB share code (DESIGN §6.3 exportShareCode). */
  async saveShareCode(buildId: string): Promise<{ format: 'shareCode'; data: string }> {
    const { data: xml } = await this.save(buildId);
    return { format: 'shareCode', data: encodeShareCode(xml) };
  }

  /** Kill the runner subprocess and reject everything still in flight. */
  async dispose(): Promise<void> {
    await this.runner.dispose();
    this.started = false;
  }

  private assembleParseResult(
    wireResult: unknown,
    localeHint: Locale | undefined,
  ): ItemsParseClipboardResponse {
    const r = (wireResult ?? {}) as {
      locale?: string;
      item?: { name?: string; rarity?: string; baseName?: string };
      mods?: Array<{ line?: string }>;
      unsupported?: string[];
    };
    const mods: ParsedItemMod[] = [];
    for (const entry of r.mods ?? []) {
      if (typeof entry.line === 'string') mods.push({ raw: entry.line, status: 'parsed' });
    }
    const unsupported = (r.unsupported ?? []).filter((l): l is string => typeof l === 'string');
    for (const raw of unsupported) mods.push({ raw, status: 'unsupported' });

    const out: ItemsParseClipboardResponse = {
      // Locale (DESIGN §8.6 step 1): an explicit caller hint wins; otherwise use the
      // locale the runner ESTIMATED from the clipboard text (ko-KR vs en-US). Only a
      // valid Locale value is accepted from the wire, never a guessed default.
      locale: localeHint ?? coerceLocale(r.locale),
      mods,
      unsupported,
    };
    if (typeof r.item?.baseName === 'string') out.baseId = r.item.baseName;
    if (typeof r.item?.rarity === 'string') out.rarity = r.item.rarity;
    if (typeof r.item?.name === 'string') out.name = r.item.name;
    return out;
  }
}

/**
 * Coerce the runner's estimated locale string to a typed Locale (DESIGN §8.6 step
 * 1). The runner emits one of the closed Locale union values; anything else (an
 * older runner that omits it, or an unknown value) falls back to en-US — the
 * conservative default that keeps the English path unchanged, never a wrong guess.
 */
function coerceLocale(value: unknown): Locale {
  return value === 'ko-KR' || value === 'en-US' ? value : 'en-US';
}

/**
 * Create and start a CoreClient: spawns the runner subprocess and completes the
 * core.version ready handshake before resolving. A spawn failure or handshake
 * timeout rejects with a CORE_INIT_FAILED CoreClientError (never a hang).
 */
export async function createCoreClient(options: CoreClientOptions = {}): Promise<CoreClient> {
  const client = new CoreClient(options);
  await client.start();
  return client;
}
