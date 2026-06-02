// build-dictionary.mjs — the Phase 6 `build` script (DESIGN §8.4 step H, §12.2).
//   `pnpm --filter @pob2/localization run build`
// runs `tsc -b` (compiling src/ -> dist/) and then THIS node script, which runs the
// §8.4 pipeline (importer -> match -> assemble + manual overrides) and emits the
// deterministic ko-KR dictionary artifact to `generated/dictionary.json`.
//
// OFFLINE BY CONSTRUCTION: it reads the checked-in PoE2DB fixtures and the vendored
// `src/Data` snapshot (read-only) — never the network, never writes vendor/. The
// output is byte-identical across rebuilds (serializeDictionary sorts keys + appends a
// trailing newline), so the artifact is a stable, diff-friendly build product.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDictionary, loadUpstreamSnapshot, serializeDictionary } from '../dist/dictionary.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const fixtureDir = join(pkgRoot, 'fixtures', 'poe2db');
const dataDir = join(pkgRoot, '..', '..', 'vendor', 'PathOfBuilding-PoE2', 'src', 'Data');
const overridePath = join(pkgRoot, 'manual_ko_overrides.json');
const outPath = join(pkgRoot, 'generated', 'dictionary.json');

const snapshot = loadUpstreamSnapshot(dataDir);
const dict = buildDictionary(fixtureDir, snapshot, overridePath);
const json = serializeDictionary(dict);

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, json, 'utf8');

console.log(
  `wrote ${Object.keys(dict).length} terms to ${join('generated', 'dictionary.json')} ` +
    `(${json.length} bytes)`,
);
