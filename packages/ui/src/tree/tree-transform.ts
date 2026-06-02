/**
 * TreeData transform — DESIGN §10.6 Passive Tree tab ("렌더러는 UI 전용 data
 * transform layer에서 JSON graph로 변환"), §16.3 viewport culling, §6.4
 * serialization. Turns the upstream `src/TreeData/<ver>/tree.json` core graph into
 * the render-ready normalized JSON graph the §10.6 canvas/WebGL renderer consumes.
 *
 * The upstream node carries only its group + (orbit, orbitIndex); the renderer
 * needs absolute coordinates. `buildTreeGraph` applies the canonical PoB position
 * formula (upstream Classes/PassiveTree.lua:526-529) to every node:
 *
 *     angle  = orbitAnglesByOrbit[orbit][orbitIndex]   (already in radians)
 *     radius = orbitRadii[orbit]
 *     x = group.x + sin(angle) * radius
 *     y = group.y - cos(angle) * radius
 *
 * `node.group` is a 1-BASED index into the `groups` array (node.group=1030 reads
 * groups[1029]) — the off-by-one upstream Lua hides behind its 1-based tables.
 *
 * It also (a) collapses the per-node `connections` into a deduplicated undirected
 * edge list keyed on the unordered node pair, (b) classifies each node into
 * notable / keystone / mastery / small / jewel-socket in upstream priority, and
 * (c) produces the min/max bounds + numeric nodeId → node lookup index that the
 * §16.3 viewport culling and the §10.6 path-preview walk read.
 *
 * §6.4 label split: `label` is the display name (localized); `statId` is the
 * machine-readable node id; the raw `stats` lines are carried as machine data,
 * never folded into the label.
 *
 * NO-FALLBACK (DESIGN §6.4): a connection whose target node is absent is DROPPED,
 * not faked into a phantom edge; classification is by explicit flag, never a
 * guessed default — an unflagged node is a `small` node by definition.
 */

/** One raw connection edge as it appears on an upstream tree-node. */
export interface RawTreeConnection {
  /** Target node id (matches another node's `skill`). */
  id: number;
  orbit: number;
}

/**
 * One raw passive-tree node from `tree.json`. `skill` is the node id (equal to the
 * node's key in the `nodes` map); `name` is the display label; `stats` are the
 * machine-readable stat lines; the `is*` flags drive classification.
 */
export interface RawTreeNode {
  skill: number;
  name: string;
  /** 1-based index into the `groups` array. */
  group: number;
  orbit: number;
  orbitIndex: number;
  stats: string[];
  connections: RawTreeConnection[];
  isNotable?: boolean;
  isKeystone?: boolean;
  isMastery?: boolean;
  isJewelSocket?: boolean;
  ascendancyName?: string;
}

/** One raw passive-tree group from `tree.json` — its layout-space centre. */
export interface RawTreeGroup {
  x: number;
  y: number;
  nodes: number[];
  orbits: number[];
}

/**
 * The passive-tree layout constants used for node positioning (`tree.json`
 * `constants`). `orbitAnglesByOrbit[orbit]` is the per-slot angle list in radians;
 * `orbitRadii[orbit]` is that orbit's radius.
 */
export interface RawTreeConstants {
  orbitRadii: number[];
  skillsPerOrbit: number[];
  orbitAnglesByOrbit: number[][];
}

/** The raw upstream `tree.json` shape `buildTreeGraph` consumes (DESIGN §10.6). */
export interface RawTreeData {
  nodes: Record<string, RawTreeNode>;
  groups: RawTreeGroup[];
  constants: RawTreeConstants;
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

/** A node's render class (DESIGN §10.6). An unflagged node is `small`. */
export type TreeNodeKind = 'notable' | 'keystone' | 'mastery' | 'small' | 'jewel-socket';

/** One render-ready passive-tree node with absolute coordinates (DESIGN §10.6). */
export interface TreeGraphNode {
  /** Numeric node id (the lookup-index key). */
  nodeId: number;
  /** Machine-readable node id (§6.4), the stable string form of `nodeId`. */
  statId: string;
  /** Localized display label (§6.4) — the upstream `name`, never the stat data. */
  label: string;
  /** Render class (DESIGN §10.6). */
  kind: TreeNodeKind;
  /** Absolute layout x (group.x + sin(angle)·radius). */
  x: number;
  /** Absolute layout y (group.y − cos(angle)·radius). */
  y: number;
  orbit: number;
  orbitIndex: number;
  /** 1-based group index (carried for jewel/radius lookups). */
  group: number;
  /** Raw machine-readable stat lines (§6.4), never merged into `label`. */
  stats: string[];
  /** Ascendancy tree name, when the node belongs to one. */
  ascendancyName?: string;
}

/** One deduplicated undirected edge, normalized so `a < b` (DESIGN §10.6). */
export interface TreeGraphEdge {
  a: number;
  b: number;
}

/** The render-graph bounding box for §16.3 viewport culling. */
export interface TreeGraphBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * The render-ready normalized passive-tree graph (DESIGN §10.6). `nodes` carry
 * absolute coordinates; `edges` is the deduplicated undirected edge list;
 * `bounds` + `nodeIndex` are the §16.3 viewport-culling / §10.6 path-preview
 * inputs.
 */
export interface TreeGraph {
  nodes: TreeGraphNode[];
  edges: TreeGraphEdge[];
  bounds: TreeGraphBounds;
  /** Numeric nodeId → node lookup index (every node, by id). */
  nodeIndex: Record<number, TreeGraphNode>;
}

/**
 * Compute a node's absolute layout coordinate from its group + orbit position
 * (upstream PassiveTree.lua:526-529). `group` is 1-based into `groups`.
 */
function nodeCoord(node: RawTreeNode, data: RawTreeData): { x: number; y: number } {
  const group = data.groups[node.group - 1];
  if (!group) throw new Error(`tree node ${node.skill} references missing group ${node.group}`);
  const angle = data.constants.orbitAnglesByOrbit[node.orbit]?.[node.orbitIndex];
  const radius = data.constants.orbitRadii[node.orbit];
  if (angle === undefined || radius === undefined) {
    throw new Error(`tree node ${node.skill} has no orbit ${node.orbit}/${node.orbitIndex} angle`);
  }
  return {
    x: group.x + Math.sin(angle) * radius,
    y: group.y - Math.cos(angle) * radius,
  };
}

/**
 * Classify a node by its flags in upstream priority (PassiveTree.lua:223-254):
 * jewel-socket → keystone → notable → mastery → small. An unflagged node is
 * `small` (NO-FALLBACK: by definition, never a guessed kind).
 */
function classify(node: RawTreeNode): TreeNodeKind {
  if (node.isJewelSocket) return 'jewel-socket';
  if (node.isKeystone) return 'keystone';
  if (node.isNotable) return 'notable';
  if (node.isMastery) return 'mastery';
  return 'small';
}

/** Build one render node (absolute coords + classification + §6.4 label split). */
function toGraphNode(node: RawTreeNode, data: RawTreeData): TreeGraphNode {
  const { x, y } = nodeCoord(node, data);
  return {
    nodeId: node.skill,
    statId: String(node.skill),
    label: node.name,
    kind: classify(node),
    x,
    y,
    orbit: node.orbit,
    orbitIndex: node.orbitIndex,
    group: node.group,
    stats: node.stats,
    ...(node.ascendancyName !== undefined ? { ascendancyName: node.ascendancyName } : {}),
  };
}

/**
 * Build the render-ready normalized passive-tree graph from raw upstream
 * `tree.json` (DESIGN §10.6). Computes absolute node coordinates, the deduplicated
 * undirected edge list, the node classification, and the bounds + lookup index
 * that drive §16.3 viewport culling and §10.6 path preview.
 */
export function buildTreeGraph(data: RawTreeData): TreeGraph {
  const nodes: TreeGraphNode[] = [];
  const nodeIndex: Record<number, TreeGraphNode> = {};

  for (const raw of Object.values(data.nodes)) {
    const node = toGraphNode(raw, data);
    nodes.push(node);
    nodeIndex[node.nodeId] = node;
  }

  // Deduplicate connections into undirected edges (a < b). A connection to a node
  // that is not in the graph is dropped (NO-FALLBACK — never a phantom edge).
  const edges: TreeGraphEdge[] = [];
  const seen = new Set<string>();
  for (const raw of Object.values(data.nodes)) {
    for (const conn of raw.connections) {
      if (conn.id === raw.skill) continue; // no self-edges
      if (!nodeIndex[conn.id]) continue; // dangling target → drop
      const a = Math.min(raw.skill, conn.id);
      const b = Math.max(raw.skill, conn.id);
      const key = `${a}-${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b });
    }
  }

  // Bounds from the absolute node coordinates (the §16.3 viewport-culling box).
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

  return { nodes, edges, bounds: { minX, minY, maxX, maxY }, nodeIndex };
}
