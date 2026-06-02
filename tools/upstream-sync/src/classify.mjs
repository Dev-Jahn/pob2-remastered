// Upstream diff classifier — pure & table-driven (DESIGN §7.3).
//
// Maps changed vendor paths to the verification ROUTES that must run before the
// §7.2 sync bot opens an auto-PR. No git, no network, no filesystem: it operates
// purely on an in-memory list of POSIX-style path strings, so it is trivially
// unit-testable and deterministic.
//
// The §7.3 rule table is the single source of truth. Order matters: rules are
// evaluated top-to-bottom and the FIRST match wins, so more-specific rows must
// precede broader ones (e.g. ModParser.lua before any Calc*/Modules rule). A path
// that matches no rule is NOT dropped — it surfaces in the `unknown` bucket so the
// sync bot can require manual triage instead of silently auto-merging it.

/**
 * The §7.3 verification routes. Keyed by a stable route id used throughout the
 * sync workflow; each entry documents what the route verifies (the "자동 처리"
 * column) and the manual review it still needs (the "수동 검토" column).
 */
export const ROUTES = {
  'schema-i18n-coverage': {
    description: 'Data schema load + search index rebuild + i18n coverage report',
    manualReview: 'Confirm meaning of new stat/mod entries',
  },
  'golden-regression': {
    description: 'Run the full golden calc regression suite',
    manualReview: 'Review any calc-result diffs',
  },
  'parser-fixtures': {
    description: 'Re-run item-paste parser fixtures',
    manualReview: 'Refresh Korean mod-parser mapping',
  },
  'tree-snapshot': {
    description: 'Tree renderer snapshot + node-id consistency check',
    manualReview: 'Handle new league/tree version',
  },
  'exporter-dry-run': {
    description: 'Run the data exporter in dry-run mode',
    manualReview: 'Reflect upstream exporter changes',
  },
  packaging: {
    description: 'Packaging / update-channel compatibility test',
    manualReview: 'Review update-policy conflicts',
  },
  'ui-parity-checklist': {
    description: 'Update the feature parity checklist',
    manualReview: 'Identify UI features missing from the modern fork',
  },
};

/**
 * The route id used for any path that matches no §7.3 rule. Exported so callers
 * can branch on it explicitly rather than hard-coding the literal.
 */
export const UNKNOWN = 'unknown';

// The §7.3 table, encoded as ordered { match, route } rules. `match(path)` returns
// true when the rule applies. FIRST match wins — keep specific rules above general
// ones. Each rule cites the §7.3 row it implements.
const RULES = [
  // src/Modules/ModParser.lua → parser fixtures.
  // MUST precede the Calc* rule below so the Modules-level paths don't shadow it.
  {
    route: 'parser-fixtures',
    match: (p) => p === 'src/Modules/ModParser.lua',
  },
  // src/Modules/Calc*.lua → golden regression. Only Calc-prefixed Modules files.
  {
    route: 'golden-regression',
    match: (p) => /^src\/Modules\/Calc[^/]*\.lua$/.test(p),
  },
  // src/Data/*.lua → schema + i18n coverage (recursive: src/Data/**.lua).
  {
    route: 'schema-i18n-coverage',
    match: (p) => p.startsWith('src/Data/') && p.endsWith('.lua'),
  },
  // src/TreeData/* → tree snapshot (any file under the tree, not just .lua).
  {
    route: 'tree-snapshot',
    match: (p) => p.startsWith('src/TreeData/'),
  },
  // src/Export/* → exporter dry-run.
  {
    route: 'exporter-dry-run',
    match: (p) => p.startsWith('src/Export/'),
  },
  // manifest.cfg / UpdateCheck.lua / UpdateApply.lua → packaging.
  // Matched by basename so the rule is path-prefix agnostic (e.g. src/UpdateApply.lua).
  {
    route: 'packaging',
    match: (p) => {
      const base = p.slice(p.lastIndexOf('/') + 1);
      return base === 'manifest.cfg' || base === 'UpdateCheck.lua' || base === 'UpdateApply.lua';
    },
  },
  // src/Classes/* → UI parity checklist.
  {
    route: 'ui-parity-checklist',
    match: (p) => p.startsWith('src/Classes/'),
  },
];

/**
 * Classify a single changed path to its §7.3 verification route.
 *
 * @param {string} path - a POSIX-style repo-relative path (vendor-relative).
 * @returns {string} the matching route id, or `'unknown'` if no §7.3 rule applies.
 */
export function classifyPath(path) {
  if (typeof path !== 'string') {
    throw new TypeError(`classifyPath expects a string path, got ${typeof path}`);
  }
  for (const rule of RULES) {
    if (rule.match(path)) return rule.route;
  }
  return UNKNOWN;
}

/**
 * @typedef {object} DiffClassification
 * @property {Record<string, string[]>} routes - route id → paths that triggered it,
 *   in input order, only for routes that actually fired.
 * @property {string[]} routesTriggered - de-duplicated route ids in first-trigger order.
 * @property {string[]} unknown - paths that matched no §7.3 rule (input order, never dropped).
 * @property {boolean} hasUnknown - true iff `unknown` is non-empty.
 */

/**
 * Classify a set of changed paths into the §7.3 verification routes plus an
 * explicit `unknown` bucket. Pure: derived solely from the input array.
 *
 * @param {string[]} paths - the in-memory list of changed vendor paths.
 * @returns {DiffClassification}
 */
export function classifyDiff(paths) {
  if (!Array.isArray(paths)) {
    throw new TypeError(`classifyDiff expects an array of paths, got ${typeof paths}`);
  }

  /** @type {Record<string, string[]>} */
  const routes = {};
  const routesTriggered = [];
  const unknown = [];

  for (const path of paths) {
    const route = classifyPath(path);
    if (route === UNKNOWN) {
      unknown.push(path);
      continue;
    }
    if (!routes[route]) {
      routes[route] = [];
      routesTriggered.push(route);
    }
    routes[route].push(path);
  }

  return {
    routes,
    routesTriggered,
    unknown,
    hasUnknown: unknown.length > 0,
  };
}
