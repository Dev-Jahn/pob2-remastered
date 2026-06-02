/**
 * build-session — the thin async data layer that connects the read-only Overview
 * viewer to @pob2/core-client (DESIGN §18 Phase 2 doneCriteria "기존 build 파일을
 * 열어 Overview 표시", §6.3 load/save/loadShareCode/saveShareCode, §12.3 round-trip).
 *
 * Given build XML or a share code, it drives `CoreClient.load`/`loadShareCode`
 * followed by `calcRun`, and returns `{ summary, stats }` already shaped for the
 * Overview view-model: `summary` is the runner's plain BuildSummary and `stats`
 * is the `CalcRunResponse` — exactly what @pob2/ui's `buildOverviewModel(stats,
 * summary)` consumes. `save()` round-trips the open build back out as PoB XML or a
 * share code.
 *
 * INJECTABLE CLIENT (DESIGN §5.1: the host layer owns the out-of-process Lua
 * runner; the UI/data layer is pure). The real {@link CoreClient} spawns a Lua
 * subprocess (overlays/lua/runner.lua) that jsdom cannot host, so this layer takes
 * the client as a dependency rather than constructing one. The dependency surface
 * is the minimal {@link BuildClient} subset of the Core API this layer calls; the
 * concrete `CoreClient` satisfies it structurally, and a test can inject a mock.
 * @pob2/core-client internals are NOT touched.
 *
 * NO-FALLBACK (DESIGN §6.4): this layer only routes and re-shapes. It does not
 * fabricate a summary or stats; a load/calc failure propagates the client's
 * CoreClientError unchanged. `save()` before any `open()` throws rather than
 * inventing a build id to round-trip.
 */
import type {
  BuildSaveResponse,
  CalcExplainResponse,
  CalcRunResponse,
  ConfigGetOptionsResponse,
  EquippedItem,
  GemInput,
  ItemModInput,
  ItemsCompareResponse,
  ItemsCreateCustomResponse,
  ItemsGetEquippedResponse,
  ItemsParseClipboardResponse,
  Locale,
  SkillsGetGroupsResponse,
  TreeApplyAllocateResponse,
  TreeGetDataResponse,
  TreeNode,
  TreePreviewAllocateResponse,
  TreeStatDelta,
} from '@pob2/schema';
import type { BuildSummary, InspectedItem, TreeGraph, TreeGraphNode, TreeNodeKind } from '@pob2/ui';

/**
 * The slice of the @pob2/core-client `CoreClient` Core API this data layer needs,
 * declared structurally so the concrete client satisfies it and a test can inject
 * a mock without spawning the Lua runner (DESIGN §5.1). Mirrors the relevant
 * `CoreClient` method signatures exactly.
 */
export interface BuildClient {
  /** build.load — load from upstream PoB XML, returning the build id + summary. */
  load(xml: string): Promise<{ buildId: string; summary: BuildSummary }>;
  /** build.loadShareCode — decode a PoB share code to XML and load it. */
  loadShareCode(code: string): Promise<{ buildId: string; summary: BuildSummary }>;
  /** calc.run — run the calc pass and return the curated numeric stats. */
  calcRun(buildId: string): Promise<CalcRunResponse>;
  /** build.save — export the open build as PoB XML. */
  save(buildId: string): Promise<BuildSaveResponse>;
  /** build.exportShareCode — export the open build as a PoB share code. */
  saveShareCode(buildId: string): Promise<{ format: 'shareCode'; data: string }>;
  /** items.getEquipped — the cards equipped on the loaded build (DESIGN §6.3). */
  getEquipped(buildId: string): Promise<ItemsGetEquippedResponse>;
  /** items.parseClipboard — parse a clipboard item string (DESIGN §6.3, §8.6). */
  parseClipboard(text: string, localeHint?: Locale): Promise<ItemsParseClipboardResponse>;
  /** items.createCustom — build a custom item from a base id + mod inputs (§6.3). */
  createCustom(baseId: string, mods: ItemModInput[]): Promise<ItemsCreateCustomResponse>;
  /** items.compare — stat delta of equipping `item` in `slot` (DESIGN §6.3, §16.3). */
  equipDelta(buildId: string, item: EquippedItem, slot: string): Promise<ItemsCompareResponse>;
  /** skills.getGroups — the build's socket-group cards (DESIGN §6.3, §10.5). */
  getSkillGroups(buildId: string): Promise<SkillsGetGroupsResponse>;
  /** skills.setGemGroup — replace a group's gem list, returns the group ack (§6.3, §10.5). */
  setGemGroup(buildId: string, groupId: string, gems: GemInput[]): Promise<{ groupId: string }>;
  /** config.getOptions — the build's config-option cards (DESIGN §6.3, §10.8). */
  getConfigOptions(buildId: string): Promise<ConfigGetOptionsResponse>;
  /** config.setOption — write one option's value, returns the option ack (§6.3, §10.8). */
  setConfigOption(buildId: string, optionId: string, value: unknown): Promise<{ optionId: string }>;
  /** calc.explain — the formula trace for one stat (DESIGN §6.3, §10.7). */
  explainStat(
    buildId: string,
    statId: string,
    activeSkillId?: string,
  ): Promise<CalcExplainResponse>;
  /** tree.getData — the serialized passive TreeGraph of the build (DESIGN §6.3, §10.6). */
  getTreeData(buildId: string): Promise<TreeGetDataResponse>;
  /** tree.previewAllocate — the calc delta of allocating a node set, no mutation (§6.3, §7.4). */
  previewAllocate(buildId: string, nodeIds: number[]): Promise<TreePreviewAllocateResponse>;
  /** tree.applyAllocate — COMMIT a node-set allocation, returns the new allocated set (§6.3). */
  applyAllocate(buildId: string, nodeIds: number[]): Promise<TreeApplyAllocateResponse>;
}

/** What `open()` accepts: build XML or a PoB share code (DESIGN §12.2, §10.9). */
export type OpenSource = { xml: string } | { shareCode: string };

/** The Overview data `open()` yields: a BuildSummary header + a CalcRunResponse. */
export interface OpenResult {
  summary: BuildSummary;
  stats: CalcRunResponse;
}

/** Export format for `save()` (DESIGN §12.2 PoB XML / share code). */
export type SaveFormat = 'xml' | 'shareCode';

/** The equipped-gear data the Items tab consumes: the build's `EquippedItem[]`. */
export interface EquippedResult {
  equipped: EquippedItem[];
}

/**
 * The Passive Tree data the §10.6 TreePanel consumes: the render-ready `TreeGraph`
 * the canvas paints plus the numeric set of currently-allocated node ids (the
 * canvas's allocated-visual input). The session transforms the runner's flat
 * `TreeGetDataResponse` into this UI shape — see {@link treeResponseToGraph}.
 */
export interface TreeDataResult {
  graph: TreeGraph;
  allocated: Set<number>;
}

/** The §7.4 allocation-commit result: the new allocated set + the recomputed stats. */
export interface AllocateResult {
  allocated: Set<number>;
  stats: CalcRunResponse;
}

/** What `parseClipboard()` yields: an inspector-ready item + its source locale. */
export interface ParsedItemResult {
  /** The parsed clipboard item, shaped for the @pob2/ui ItemInspector (§10.4). */
  item: InspectedItem;
  /** The locale the import was parsed under (estimated or hinted, §8.6). */
  locale: Locale;
}

/** A loaded build session: open a source, save the open build (DESIGN §10.9). */
export interface BuildSession {
  /**
   * Load a build from XML or a share code and run the calc pass, returning the
   * `{ summary, stats }` the Overview view-model consumes. Records the resulting
   * build id so a later `save()` can round-trip it.
   */
  open(source: OpenSource): Promise<OpenResult>;
  /**
   * Export the open build back out (DESIGN §12.3 round-trip). Throws if no build
   * has been opened — there is no build id to round-trip (NO-FALLBACK).
   */
  save(options: { format: SaveFormat }): Promise<BuildSaveResponse>;
  /**
   * The cards equipped on the open build (DESIGN §6.3 items.getEquipped), the
   * input to the §10.4 equipped-gear grid. Throws if no build has been opened —
   * there is no build id to query (NO-FALLBACK).
   */
  getEquipped(): Promise<EquippedResult>;
  /**
   * Parse a clipboard item string (DESIGN §6.3 items.parseClipboard, §8.6) and
   * shape it for the §10.4 inspector. Does NOT require an open build — pasting an
   * item is independent of the loaded build.
   */
  parseClipboard(text: string, localeHint?: Locale): Promise<ParsedItemResult>;
  /**
   * The open build's socket-group cards (DESIGN §6.3 skills.getGroups, §10.5), the
   * input to the Skills tab. Throws if no build has been opened (NO-FALLBACK).
   */
  getSkillGroups(): Promise<SkillsGetGroupsResponse>;
  /**
   * Replace one socket group's gem list (DESIGN §6.3 skills.setGemGroup, §10.5),
   * then RE-RUN calc.run and return the refreshed stats (빌드 수정 → 즉시 재계산).
   * Throws if no build has been opened (NO-FALLBACK).
   */
  setGemGroup(groupId: string, gems: GemInput[]): Promise<CalcRunResponse>;
  /**
   * The open build's config-option cards (DESIGN §6.3 config.getOptions, §10.8),
   * the input to the Config tab. Throws if no build has been opened (NO-FALLBACK).
   */
  getConfigOptions(): Promise<ConfigGetOptionsResponse>;
  /**
   * Write one config option's value (DESIGN §6.3 config.setOption, §10.8), then
   * RE-RUN calc.run and return the refreshed stats (빌드 수정 → 즉시 재계산). Throws
   * if no build has been opened (NO-FALLBACK).
   */
  setConfigOption(optionId: string, value: unknown): Promise<CalcRunResponse>;
  /**
   * The formula trace for one stat (DESIGN §6.3 calc.explain, §10.7), the input to
   * the Calcs breakdown explorer. Throws if no build has been opened (NO-FALLBACK).
   */
  explainStat(statId: string, activeSkillId?: string): Promise<CalcExplainResponse>;
  /**
   * The open build's Passive Tree (DESIGN §6.3 tree.getData, §10.6), transformed
   * into the render-ready `{ graph, allocated }` the §10.6 TreePanel consumes.
   * Throws if no build has been opened (NO-FALLBACK).
   */
  getTreeData(): Promise<TreeDataResult>;
  /**
   * The per-stat allocation deltas of allocating `nodeIds` WITHOUT mutating the
   * build (DESIGN §6.3 tree.previewAllocate, §10.6 allocation delta preview, §7.4) —
   * the host debounces this on node hover. Throws if no build has been opened.
   */
  previewAllocate(nodeIds: number[]): Promise<TreeStatDelta[]>;
  /**
   * COMMIT the allocation of `nodeIds` (DESIGN §6.3 tree.applyAllocate), then RE-RUN
   * calc.run and return the new allocated set + the refreshed stats (빌드 수정 →
   * 즉시 재계산). Throws if no build has been opened (NO-FALLBACK).
   */
  applyAllocate(nodeIds: number[]): Promise<AllocateResult>;
}

/**
 * Map a runner tree-node `type` string to the renderer's `TreeNodeKind` (DESIGN
 * §10.6). The runner serializes the upstream `node.type` (PassiveTree.lua): Socket →
 * jewel-socket, Keystone → keystone, Notable → notable, Mastery → mastery; every
 * other type (Normal/ClassStart/AscendClassStart/OnlyImage) is a `small` node by
 * definition (NO-FALLBACK — never a guessed kind).
 */
function kindOf(type: string): TreeNodeKind {
  switch (type) {
    case 'Socket':
      return 'jewel-socket';
    case 'Keystone':
      return 'keystone';
    case 'Notable':
      return 'notable';
    case 'Mastery':
      return 'mastery';
    default:
      return 'small';
  }
}

/** Lift one runner `TreeNode` into a render `TreeGraphNode` (§6.4 label/statId split). */
function toGraphNode(node: TreeNode): TreeGraphNode {
  return {
    nodeId: node.nodeId,
    statId: String(node.nodeId),
    label: node.name,
    kind: kindOf(node.type),
    x: node.x,
    y: node.y,
    orbit: node.orbit,
    orbitIndex: node.orbitIndex,
    group: node.group,
    // The runner serializes the node's scalar identity + coordinates, not its raw
    // stat lines, so the render node carries no stat data (DESIGN §6.4 no core leak).
    stats: [],
  };
}

/**
 * Transform the runner's flat `TreeGetDataResponse` into the render-ready
 * `{ graph, allocated }` the §10.6 TreePanel consumes (DESIGN §10.6 "UI 전용 data
 * transform layer"). The runner already serializes ABSOLUTE node coordinates (its
 * own orbit math), so each node is lifted field-by-field; the deduplicated
 * undirected edge list is derived from each node's `connections` (core
 * `node.linkedId`) so the §10.6 canvas paints the connecting edges and the
 * path-preview can walk the graph. A connection to a node absent from the graph,
 * or a self-edge, is DROPPED (DESIGN §6.4 NO-FALLBACK: an absent edge is never a
 * fabricated one). `bounds`/`nodeIndex` are computed from the node coordinates for
 * the §16.3 viewport-culling + §10.6 path-preview inputs.
 */
export function treeResponseToGraph(response: TreeGetDataResponse): TreeDataResult {
  const nodes = response.nodes.map(toGraphNode);
  const nodeIndex: Record<number, TreeGraphNode> = {};
  for (const node of nodes) nodeIndex[node.nodeId] = node;

  // Deduplicate the per-node connections into undirected edges (a < b), dropping
  // self-edges and connections to nodes absent from the graph (same rule as
  // buildTreeGraph — NO phantom edge, DESIGN §6.4).
  const edges: { a: number; b: number }[] = [];
  const seen = new Set<string>();
  for (const node of response.nodes) {
    for (const targetId of node.connections) {
      if (targetId === node.nodeId) continue; // no self-edges
      if (!nodeIndex[targetId]) continue; // dangling target → drop
      const a = Math.min(node.nodeId, targetId);
      const b = Math.max(node.nodeId, targetId);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (node.x < minX) minX = node.x;
    if (node.x > maxX) maxX = node.x;
    if (node.y < minY) minY = node.y;
    if (node.y > maxY) maxY = node.y;
  }

  // An empty tree (no nodes) leaves the bounds at their Infinity seeds, which would
  // make the §10.6 minimap fit compute `maxX - minX = -Infinity`/`NaN`. Collapse to a
  // zero rect so the minimap renders a safe empty viewport (NO-FALLBACK: real bounds
  // when there are nodes, an honest zero rect when there are none).
  const bounds =
    nodes.length === 0 ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };

  return {
    graph: { nodes, edges, bounds, nodeIndex },
    allocated: new Set(response.allocatedNodeIds),
  };
}

/**
 * Shape an `items.parseClipboard` response for the @pob2/ui ItemInspector (DESIGN
 * §10.4 inspector, §8.6 split). Mirrors the @pob2/ui useItemsTab mapping: parsed
 * mod lines are the entries the parser recognised; the unsupported lines come from
 * the dedicated `unsupported[]` list, kept apart so an unrecognised line is never
 * read as a parsed mod. The verbatim source text is reconstructed from the
 * recognised name/base + every line (§8.6 "원문 보존"); the translated block reuses
 * it (a dedicated ko translation arrives with the i18n data layer, NO-FALLBACK).
 */
function toInspected(parsed: ItemsParseClipboardResponse): InspectedItem {
  const parsedMods = parsed.mods.filter((m) => m.status === 'parsed').map((m) => m.raw);
  const unsupportedMods = [...parsed.unsupported];
  const name = parsed.name ?? '';
  const baseType = parsed.baseId ?? '';
  const sourceText = [name, baseType, ...parsedMods, ...unsupportedMods]
    .filter((l) => l.length > 0)
    .join('\n');
  return {
    itemId: 'imported',
    name,
    baseType,
    rarityColorKey: (parsed.rarity ?? '').trim().toLowerCase(),
    sourceText,
    translatedText: sourceText,
    parsedMods,
    unsupportedMods,
    // The clipboard item is not equipped, so the inspector's slot selector
    // defaults to the first weapon slot (matching @pob2/ui useItemsTab).
    slot: 'Weapon 1',
  };
}

/**
 * Create a build session over an injected {@link BuildClient} (DESIGN §5.1). The
 * client owns the Lua runner; this session just routes load/calc/save through it
 * and shapes the result for the Overview view-model.
 */
export function createBuildSession(client: BuildClient): BuildSession {
  // The id of the build currently open; null until the first successful open().
  let buildId: string | null = null;

  return {
    async open(source) {
      const loaded =
        'xml' in source
          ? await client.load(source.xml)
          : await client.loadShareCode(source.shareCode);
      buildId = loaded.buildId;
      const stats = await client.calcRun(loaded.buildId);
      return { summary: loaded.summary, stats };
    },

    async save({ format }) {
      if (buildId === null) {
        throw new Error('build-session: save() called before a build was opened');
      }
      return format === 'shareCode' ? client.saveShareCode(buildId) : client.save(buildId);
    },

    async getEquipped() {
      if (buildId === null) {
        throw new Error('build-session: getEquipped() called before a build was opened');
      }
      return client.getEquipped(buildId);
    },

    async parseClipboard(text, localeHint) {
      const parsed = await client.parseClipboard(text, localeHint);
      return { item: toInspected(parsed), locale: parsed.locale };
    },

    async getSkillGroups() {
      if (buildId === null) {
        throw new Error('build-session: getSkillGroups() called before a build was opened');
      }
      return client.getSkillGroups(buildId);
    },

    async setGemGroup(groupId, gems) {
      if (buildId === null) {
        throw new Error('build-session: setGemGroup() called before a build was opened');
      }
      // Edit the build, then re-run the calc so the caller gets the refreshed
      // stats (DESIGN §6.3 빌드 수정 → 즉시 재계산).
      await client.setGemGroup(buildId, groupId, gems);
      return client.calcRun(buildId);
    },

    async getConfigOptions() {
      if (buildId === null) {
        throw new Error('build-session: getConfigOptions() called before a build was opened');
      }
      return client.getConfigOptions(buildId);
    },

    async setConfigOption(optionId, value) {
      if (buildId === null) {
        throw new Error('build-session: setConfigOption() called before a build was opened');
      }
      // Edit the build, then re-run the calc (DESIGN §6.3 빌드 수정 → 즉시 재계산).
      await client.setConfigOption(buildId, optionId, value);
      return client.calcRun(buildId);
    },

    async explainStat(statId, activeSkillId) {
      if (buildId === null) {
        throw new Error('build-session: explainStat() called before a build was opened');
      }
      return client.explainStat(buildId, statId, activeSkillId);
    },

    async getTreeData() {
      if (buildId === null) {
        throw new Error('build-session: getTreeData() called before a build was opened');
      }
      return treeResponseToGraph(await client.getTreeData(buildId));
    },

    async previewAllocate(nodeIds) {
      if (buildId === null) {
        throw new Error('build-session: previewAllocate() called before a build was opened');
      }
      const { deltas } = await client.previewAllocate(buildId, nodeIds);
      return deltas;
    },

    async applyAllocate(nodeIds) {
      if (buildId === null) {
        throw new Error('build-session: applyAllocate() called before a build was opened');
      }
      // Commit the allocation, then re-run the calc (DESIGN §6.3 빌드 수정 → 즉시 재계산).
      const { allocatedNodeIds } = await client.applyAllocate(buildId, nodeIds);
      const stats = await client.calcRun(buildId);
      return { allocated: new Set(allocatedNodeIds), stats };
    },
  };
}
