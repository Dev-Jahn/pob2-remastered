// Upstream diff classifier unit suite (task p7-sync-classifier; DESIGN §7.3).
//
// The classifier is the pure, table-driven heart of the §7.2 sync workflow: it maps
// a list of changed vendor paths to the verification ROUTES that must run before an
// auto-PR is opened (schema+i18n coverage, golden regression, parser fixtures, tree
// snapshot, exporter dry-run, packaging, UI parity checklist). It touches no git and
// no network — it operates purely on an in-memory path list, so it is unit-testable
// in isolation here.
//
// The behaviour this suite pins down (each maps to a §7.3 table row):
//   src/Data/*.lua                         → schema + i18n coverage
//   src/Modules/Calc*.lua                  → golden regression
//   src/Modules/ModParser.lua              → parser fixtures
//   src/TreeData/*                         → tree snapshot
//   src/Export/*                           → exporter dry-run
//   manifest.cfg / UpdateCheck / UpdateApply → packaging
//   src/Classes/*                          → UI parity checklist
//   anything else                          → surfaced as `unknown` (NOT silently dropped)
import { describe, it, expect } from 'vitest';
import { classifyDiff, classifyPath, ROUTES } from '../src/classify.mjs';

// --- single-path routing (the §7.3 table, row by row) -----------------------

describe('classifyPath maps each §7.3 area to its verification route', () => {
  const cases = [
    // src/Data/*.lua → schema + i18n coverage
    ['src/Data/Uniques/weapons.lua', 'schema-i18n-coverage'],
    ['src/Data/Gems.lua', 'schema-i18n-coverage'],
    ['src/Data/ModItem.lua', 'schema-i18n-coverage'],
    // src/Modules/Calc*.lua → golden regression
    ['src/Modules/Calcs.lua', 'golden-regression'],
    ['src/Modules/CalcOffence.lua', 'golden-regression'],
    ['src/Modules/CalcDefence.lua', 'golden-regression'],
    // src/Modules/ModParser.lua → parser fixtures (more specific than Calc*/Modules)
    ['src/Modules/ModParser.lua', 'parser-fixtures'],
    // src/TreeData/* → tree snapshot
    ['src/TreeData/0_5/tree.lua', 'tree-snapshot'],
    ['src/TreeData/legion/nodes.json', 'tree-snapshot'],
    // src/Export/* → exporter dry-run
    ['src/Export/Scripts/gems.lua', 'exporter-dry-run'],
    // packaging triggers
    ['manifest.cfg', 'packaging'],
    ['src/UpdateCheck.lua', 'packaging'],
    ['src/UpdateApply.lua', 'packaging'],
    // src/Classes/* → UI parity checklist
    ['src/Classes/ItemsTab.lua', 'ui-parity-checklist'],
    ['src/Classes/PassiveTreeView.lua', 'ui-parity-checklist'],
  ];
  for (const [path, route] of cases) {
    it(`${path} → ${route}`, () => {
      expect(classifyPath(path)).toBe(route);
    });
  }
});

// --- the unknown contract: unclassified paths are SURFACED, not dropped -----

describe('unclassified paths are surfaced as `unknown` (never silently ignored)', () => {
  it('a path matching no §7.3 area classifies as unknown', () => {
    expect(classifyPath('README.md')).toBe('unknown');
    expect(classifyPath('src/GameVersions.lua')).toBe('unknown');
    expect(classifyPath('runtime/lua/bit.lua')).toBe('unknown');
  });
});

// --- precedence: ModParser must NOT be swallowed by the broader Modules rule -

describe('rule precedence is specific-over-general', () => {
  it('ModParser.lua routes to parser-fixtures, not golden-regression', () => {
    // ModParser.lua lives under src/Modules but is NOT a Calc* file; it has its own
    // §7.3 row, so the parser-fixtures rule must win over any Modules-level rule.
    expect(classifyPath('src/Modules/ModParser.lua')).toBe('parser-fixtures');
  });
  it('a non-Calc, non-ModParser Modules file is unknown, not golden-regression', () => {
    // Only Calc* files trigger golden regression per §7.3; other Modules files
    // (e.g. Build.lua) have no row and must surface as unknown.
    expect(classifyPath('src/Modules/Build.lua')).toBe('unknown');
  });
});

// --- aggregate classification over a path SET -------------------------------

describe('classifyDiff aggregates a path set into routes + an unknown bucket', () => {
  it('groups multiple paths under their routes and de-duplicates routes', () => {
    const result = classifyDiff([
      'src/Data/Gems.lua',
      'src/Data/Uniques/weapons.lua',
      'src/Modules/CalcOffence.lua',
      'src/Modules/ModParser.lua',
      'src/TreeData/0_5/tree.lua',
      'src/Export/Scripts/gems.lua',
      'manifest.cfg',
      'src/Classes/ItemsTab.lua',
      'docs/notes.md',
    ]);

    // routes is keyed by route id; each holds the paths that triggered it.
    expect(result.routes['schema-i18n-coverage']).toEqual([
      'src/Data/Gems.lua',
      'src/Data/Uniques/weapons.lua',
    ]);
    expect(result.routes['golden-regression']).toEqual(['src/Modules/CalcOffence.lua']);
    expect(result.routes['parser-fixtures']).toEqual(['src/Modules/ModParser.lua']);
    expect(result.routes['tree-snapshot']).toEqual(['src/TreeData/0_5/tree.lua']);
    expect(result.routes['exporter-dry-run']).toEqual(['src/Export/Scripts/gems.lua']);
    expect(result.routes['packaging']).toEqual(['manifest.cfg']);
    expect(result.routes['ui-parity-checklist']).toEqual(['src/Classes/ItemsTab.lua']);

    // the unclassified path is surfaced, not dropped.
    expect(result.unknown).toEqual(['docs/notes.md']);

    // routesTriggered is the de-duplicated, ordered list of route ids that fired.
    expect(result.routesTriggered).toEqual([
      'schema-i18n-coverage',
      'golden-regression',
      'parser-fixtures',
      'tree-snapshot',
      'exporter-dry-run',
      'packaging',
      'ui-parity-checklist',
    ]);

    // hasUnknown is a convenience flag for the caller (the sync bot must not
    // auto-merge when unknowns exist — they need manual triage).
    expect(result.hasUnknown).toBe(true);
  });

  it('a clean classification has no unknowns', () => {
    const result = classifyDiff(['src/Data/Gems.lua', 'src/Modules/Calcs.lua']);
    expect(result.unknown).toEqual([]);
    expect(result.hasUnknown).toBe(false);
    expect(result.routesTriggered).toEqual(['schema-i18n-coverage', 'golden-regression']);
  });

  it('an empty diff yields no routes and no unknowns', () => {
    const result = classifyDiff([]);
    expect(result.routesTriggered).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.hasUnknown).toBe(false);
  });

  it('a path that triggers nothing but is the only change still surfaces as unknown', () => {
    const result = classifyDiff(['LICENSE']);
    expect(result.hasUnknown).toBe(true);
    expect(result.unknown).toEqual(['LICENSE']);
    expect(result.routesTriggered).toEqual([]);
  });

  it('preserves input order of paths within each route bucket', () => {
    const result = classifyDiff([
      'src/Data/Z.lua',
      'src/Data/A.lua', // intentionally out of alphabetical order
    ]);
    expect(result.routes['schema-i18n-coverage']).toEqual(['src/Data/Z.lua', 'src/Data/A.lua']);
  });
});

// --- input validation: pure function, defensive about bad input -------------

describe('input handling', () => {
  it('rejects a non-array diff', () => {
    expect(() => classifyDiff('src/Data/Gems.lua')).toThrow(/array/i);
  });
  it('rejects a non-string path', () => {
    expect(() => classifyPath(42)).toThrow(/string/i);
  });
});

// --- ROUTES metadata is the single source of truth for the §7.3 table -------

describe('ROUTES table', () => {
  it('exposes every §7.3 route with a human-readable description and verify hint', () => {
    const ids = [
      'schema-i18n-coverage',
      'golden-regression',
      'parser-fixtures',
      'tree-snapshot',
      'exporter-dry-run',
      'packaging',
      'ui-parity-checklist',
    ];
    for (const id of ids) {
      expect(ROUTES[id], `route ${id} is documented`).toBeDefined();
      expect(typeof ROUTES[id].description).toBe('string');
      expect(ROUTES[id].description.length).toBeGreaterThan(0);
    }
  });
});
