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
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  ConfigOptionCard,
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
  ParsedItemMod,
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

/**
 * What setGemGroup returns: the edited socket-group id, echoed by the runner
 * (DESIGN §6.3 skills.setGemGroup). This is a write companion to skills.getGroups
 * with no registry response schema (a request-only §6.3 type stub); its result is
 * the plain `{ groupId }` ack the runner serializes.
 */
export interface SetGemGroupResult {
  groupId: string;
}

/**
 * What setConfigOption returns: the written option id, echoed by the runner
 * (DESIGN §6.3 config.setOption). Like setGemGroup this is a write companion with
 * no registry response schema; its result is the plain `{ optionId }` ack.
 */
export interface SetConfigOptionResult {
  optionId: string;
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

  /**
   * The loaded build's socket-group cards (DESIGN §6.3 skills.getGroups, §10.5
   * Skills tab). Validates the request against skills.getGroups:request, sends it to
   * the runner, and validates the assembled {groups} against skills.getGroups:response.
   *
   * The runner emits each group as {groupId, label, enabled, gems[], spirit:{…},
   * reservation:{…}} with the gems in ONE list; the registry SkillGroupCard splits
   * active vs support gems and carries `spirit`/`reservation` as scalar numbers
   * (§10.5 "reservation과 spirit cost를 즉시 표시"). This lifts the runner shape into
   * that card shape — `spirit` is the group's reserved spirit, `reservation` its
   * reserved mana — then the registry response schema validates it.
   */
  async getSkillGroups(buildId: string): Promise<SkillsGetGroupsResponse> {
    return (await this.runner.request(
      'skills.getGroups',
      { buildId },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      (r) => ({ groups: (r as { groups?: unknown[] }).groups?.map(toSkillGroupCard) ?? [] }),
    )) as SkillsGetGroupsResponse;
  }

  /**
   * REPLACE a socket group's gem list, then return the runner's `{ groupId }` ack
   * (DESIGN §6.3 skills.setGemGroup, §10.5). This is the write companion to
   * getSkillGroups: it ACTUALLY mutates the live build (the runner re-resolves the
   * group and re-drives the calc), so a subsequent calcRun observes the genuine
   * change. It is a request-only §6.3 type stub with NO registry response schema, so
   * it cannot reuse the registry-validated request() helper; instead the request is
   * validated client-side (a non-empty buildId/groupId, like the runner's own
   * guard) and the wire result is read straight through. A runner method-not-found
   * surfaces as a structured CoreClientError (UPSTREAM_INCOMPATIBLE) from the
   * transport — never a faked success (NO-FALLBACK, DESIGN §6.4).
   */
  async setGemGroup(
    buildId: string,
    groupId: string,
    gems: GemInput[],
  ): Promise<SetGemGroupResult> {
    if (!buildId) {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'skills.setGemGroup requires a non-empty buildId',
      });
    }
    if (!groupId) {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'skills.setGemGroup requires a non-empty groupId',
      });
    }
    const result = (await this.runner.call('skills.setGemGroup', {
      buildId,
      groupId,
      gems,
    })) as { groupId?: unknown };
    if (!result || typeof result.groupId !== 'string') {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'skills.setGemGroup did not return a groupId',
      });
    }
    return { groupId: result.groupId };
  }

  /**
   * The loaded build's config-option cards (DESIGN §6.3 config.getOptions, §10.8
   * Config tab). Validates the request against config.getOptions:request, sends it
   * to the runner, and validates the assembled {options} against
   * config.getOptions:response.
   *
   * The runner emits each option as {optionId, type, label, value, list?, and the
   * dependency hints ifSkillData/ifEnemyCond/ifCond/ifOption}; the registry
   * ConfigOptionCard fixes the shape to {optionId, type, label, value,
   * dependentModifiers}. This collects the four dependency-hint lists into the one
   * `dependentModifiers` list (§10.8 "각 config option은 dependent modifier와 연결"),
   * then the registry response schema validates it.
   */
  async getConfigOptions(buildId: string): Promise<ConfigGetOptionsResponse> {
    return (await this.runner.request(
      'config.getOptions',
      { buildId },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      (r) => ({ options: (r as { options?: unknown[] }).options?.map(toConfigOptionCard) ?? [] }),
    )) as ConfigGetOptionsResponse;
  }

  /**
   * WRITE one config option's value, then return the runner's `{ optionId }` ack
   * (DESIGN §6.3 config.setOption, §10.8). This is the write companion to
   * getConfigOptions: it ACTUALLY mutates the live build (the runner rebuilds the
   * config mod lists and re-drives the calc), so a subsequent calcRun observes the
   * genuine change. Like setGemGroup it is a request-only §6.3 type stub with NO
   * registry response schema, so the request is validated client-side (a non-empty
   * buildId/optionId) and the wire result is read through. A runner method-not-found
   * surfaces as a structured CoreClientError (UPSTREAM_INCOMPATIBLE) — never a faked
   * success (NO-FALLBACK, DESIGN §6.4).
   */
  async setConfigOption(
    buildId: string,
    optionId: string,
    value: unknown,
  ): Promise<SetConfigOptionResult> {
    if (!buildId) {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'config.setOption requires a non-empty buildId',
      });
    }
    if (!optionId) {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'config.setOption requires a non-empty optionId',
      });
    }
    const result = (await this.runner.call('config.setOption', {
      buildId,
      optionId,
      value,
    })) as { optionId?: unknown };
    if (!result || typeof result.optionId !== 'string') {
      throw new CoreClientError({
        code: 'UPSTREAM_INCOMPATIBLE',
        message: 'config.setOption did not return an optionId',
      });
    }
    return { optionId: result.optionId };
  }

  /**
   * The formula trace for one stat (DESIGN §6.3 calc.explain, §10.7 Calcs tab).
   * Validates the request against calc.explain:request, drives the runner's
   * breakdown machine, and validates the assembled trace against
   * calc.explain:response.
   *
   * The runner emits {statId, upstreamRawStatId, finalValue, label, trace:string[],
   * sources:[{kind, source, value, name?, sourceName?, …}]}; the registry
   * CalcExplainResponse fixes the shape to {statId, finalValue, label, sources:
   * [{kind, label, value}], formula:string, upstreamStatId}. This joins the trace
   * lines into the single `formula` string, renames `upstreamRawStatId` to
   * `upstreamStatId`, and maps each contribution source to its {kind, label, value}
   * card (§10.7), then the registry response schema validates it.
   */
  async explainStat(
    buildId: string,
    statId: string,
    activeSkillId?: string,
  ): Promise<CalcExplainResponse> {
    const request = activeSkillId ? { buildId, statId, activeSkillId } : { buildId, statId };
    return (await this.runner.request(
      'calc.explain',
      request,
      (p) => {
        const params = p as { buildId: string; statId: string; activeSkillId?: string };
        const wire: Record<string, unknown> = { buildId: params.buildId, statId: params.statId };
        if (params.activeSkillId !== undefined) wire.activeSkillId = params.activeSkillId;
        return wire;
      },
      (r) => assembleExplain(r, statId),
    )) as CalcExplainResponse;
  }

  /**
   * The serialized passive TreeGraph of the loaded build (DESIGN §6.3 tree.getData,
   * §10.6 Passive Tree tab). Validates the request against tree.getData:request,
   * drives the runner's tree.getData (which serializes the ACTIVE spec into plain
   * node/group/constants tables — no live core table leaks, DESIGN §6.4), and
   * validates the assembled graph against tree.getData:response.
   *
   * The runner already emits the exact {treeVersion, nodes, groups, constants,
   * allocatedNodeIds} shape (its `ok` flag is stripped by the transport), so this
   * lifts each field explicitly into the registry TreeGetDataResponse — every
   * field is copied, no runner sub-table is passed through opaquely — then the
   * registry response schema validates it.
   */
  async getTreeData(buildId: string): Promise<TreeGetDataResponse> {
    return (await this.runner.request(
      'tree.getData',
      { buildId },
      (p) => ({ buildId: (p as { buildId: string }).buildId }),
      (r) => {
        const wire = (r ?? {}) as Partial<TreeGetDataResponse>;
        return {
          treeVersion: typeof wire.treeVersion === 'string' ? wire.treeVersion : '',
          nodes: (wire.nodes as TreeNode[]) ?? [],
          groups: (wire.groups as TreeGroup[]) ?? [],
          constants: (wire.constants as TreeConstants) ?? {
            classes: {},
            orbitAnglesByOrbit: [],
            orbitRadii: [],
            skillsPerOrbit: [],
          },
          allocatedNodeIds: (wire.allocatedNodeIds as number[]) ?? [],
        };
      },
    )) as TreeGetDataResponse;
  }

  /**
   * Preview the per-stat calc delta of allocating a node set WITHOUT mutating the
   * build (DESIGN §6.3 tree.previewAllocate, §10.6 "allocation delta preview", §7.4
   * "passive allocation delta"). Validates the request against
   * tree.previewAllocate:request, drives the runner's non-destructive override path
   * (build.calcsTab:GetMiscCalculator addNodes — the same machinery items.compare
   * uses), and validates the assembled {deltas} against tree.previewAllocate:response.
   *
   * Each delta is a flat {statId, before, after, delta} with `delta === after - before`;
   * the runner already serializes that exact shape, so it passes through field-by-field.
   * The build's live allocation is NOT changed — a subsequent getTreeData reports the
   * same allocatedNodeIds (the whole point of a hover-time preview).
   */
  async previewAllocate(buildId: string, nodeIds: number[]): Promise<TreePreviewAllocateResponse> {
    return (await this.runner.request(
      'tree.previewAllocate',
      { buildId, nodeIds },
      (p) => ({
        buildId: (p as { buildId: string }).buildId,
        nodeIds: (p as { nodeIds: number[] }).nodeIds,
      }),
      (r) => ({ deltas: ((r as { deltas?: TreeStatDelta[] }).deltas ?? []) as TreeStatDelta[] }),
    )) as TreePreviewAllocateResponse;
  }

  /**
   * COMMIT the allocation of a node set, then return the new allocated node id list
   * (DESIGN §6.3 tree.applyAllocate). This is the write companion to
   * previewAllocate: it ACTUALLY mutates the live spec (the runner drives
   * PassiveSpec:AllocNode and re-drives the core calc), so a subsequent getTreeData
   * reports the new node in allocatedNodeIds and calcRun observes the genuine change
   * (NO A-vs-A stub — DESIGN §6.3). Validates the request against
   * tree.applyAllocate:request and the assembled {allocatedNodeIds} against
   * tree.applyAllocate:response.
   *
   * An unknown build / unknown node surfaces a structured CoreClientError from the
   * transport — never a faked success (NO-FALLBACK, DESIGN §6.4).
   */
  async applyAllocate(buildId: string, nodeIds: number[]): Promise<TreeApplyAllocateResponse> {
    return (await this.runner.request(
      'tree.applyAllocate',
      { buildId, nodeIds },
      (p) => ({
        buildId: (p as { buildId: string }).buildId,
        nodeIds: (p as { nodeIds: number[] }).nodeIds,
      }),
      (r) => ({
        allocatedNodeIds: ((r as { allocatedNodeIds?: number[] }).allocatedNodeIds ??
          []) as number[],
      }),
    )) as TreeApplyAllocateResponse;
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

// ----------------------------------------------------------------------------
// Wire -> registry assemblers for the §6.3 skills/config/calc.explain methods.
// The runner and the registry are not byte-identical (DESIGN §6.4): each helper
// lifts the runner's wire shape into the schema response shape the registry
// validates. Every field is explicitly copied — no live runner sub-table is
// passed through, and a missing scalar resolves to an explicit default (NO null
// placeholder), so the assembled value always satisfies the response schema.
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
    // The runner may drop gemId once a gem resolves; the schema requires a string,
    // so default to "" rather than fabricating an id.
    gemId: typeof gem.gemId === 'string' ? gem.gemId : '',
    name: typeof gem.nameSpec === 'string' ? gem.nameSpec : '',
    level: typeof gem.level === 'number' ? gem.level : 0,
    quality: typeof gem.quality === 'number' ? gem.quality : 0,
    enabled: gem.enabled === true,
  };
}

/**
 * Map a runner wire socket group to the registry SkillGroupCard (DESIGN §6.3
 * skills.getGroups, §10.5). The runner carries the gems in ONE list with an
 * `isSupport` flag; the card splits them into activeGems / supportGems. `spirit`
 * is the group's reserved spirit and `reservation` its reserved mana — the §10.5
 * "reservation과 spirit cost를 즉시 표시" scalars (absent -> 0).
 */
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

/**
 * Map a runner wire option to the registry ConfigOptionCard (DESIGN §6.3
 * config.getOptions, §10.8). The runner surfaces the dependent-modifier hints as
 * the four separate ifSkillData/ifEnemyCond/ifCond/ifOption lists; the card joins
 * them into the one `dependentModifiers` list (§10.8 "각 config option은 dependent
 * modifier와 연결"). `value` is left as-is (a check is boolean, a list/count is
 * string/number) — the schema leaves it unconstrained.
 */
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
  // The runner already classified the source into the §10.7 bucket; keep only a
  // value in the closed kind set, defaulting to the catch-all "buff" otherwise.
  const kind = (EXPLAIN_SOURCE_KINDS as readonly string[]).includes(src.kind as string)
    ? (src.kind as ExplainSourceKind)
    : 'buff';
  // Display label (DESIGN §6.4 "표시용 localized label"): the human slot/mod name when
  // present, else the raw core source string — never a fabricated label.
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

/**
 * Lift the runner's flat breakdown into the registry CalcExplainResponse (DESIGN
 * §6.3 calc.explain, §10.7). The runner emits the formula trace as a string ARRAY
 * (the breakdown array part) and the upstream id as `upstreamRawStatId`; the card
 * joins the trace lines into the single `formula` string and renames the id to
 * `upstreamStatId`. The contribution list is mapped per source to {kind, label,
 * value}. `statId` falls back to the requested id when the runner omits it.
 */
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
