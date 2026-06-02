// coverage-check.mjs — the Phase 6 `coverage` gate.
//   `pnpm --filter @pob2/localization run coverage:check`
// runs THIS node script (DESIGN §8.7 translation coverage thresholds, §17.1
// test-localization "report coverage"). It loads the generated ko-KR dictionary
// (generated/dictionary.json), computes per-domain coverage via src/coverage.ts
// (translated upstream ids / total upstream ids committed in that domain), and exits
// NON-ZERO when ANY domain is below its §8.7 MVP bar.
//
// NO-FALLBACK (DESIGN §8.7 "real numbers only", golden rule 3): a missing domain is
// honestly 0% (never an assumed 100%), so the gate FAILS until the data exists — it
// never reports a passing number without real data. The UI 100% leg is NOT measured
// from this term dictionary (UI strings live in @pob2/ui): it is cross-referenced to
// loc-stat-label-localize + the @pob2/ui i18n.test ko/en key-parity check, re-derived
// here directly from the two UI string sources (offline, no network, no cross-package
// build dependency) so the proof is REAL, not a hardcoded pass.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MVP_THRESHOLDS, checkCoverage } from '../dist/coverage.js';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');
const dictPath = join(pkgRoot, 'generated', 'dictionary.json');

// ── Load the generated ko-KR dictionary (NO-FALLBACK: absent -> empty -> all 0%) ──────
function loadDictionary() {
  if (!existsSync(dictPath)) return {};
  return JSON.parse(readFileSync(dictPath, 'utf8'));
}

// ── Cross-reference the UI 100% leg: @pob2/ui i18n ko/en key-parity (§2.1, §8.7 UI) ───
// Re-derive the exact proof the @pob2/ui i18n.test pins — that the en and ko UI string
// key sets are identical — directly from the two source dictionaries. Matches the keys
// the typecheck + i18n.test already guarantee; here it is the gate's own honest check.
const UI_I18N_DIR = join(pkgRoot, '..', 'ui', 'src', 'i18n');
const KEY_RE = /^\s*'([^']+)'\s*:/gm;

function uiKeys(file) {
  const src = readFileSync(join(UI_I18N_DIR, file), 'utf8');
  const keys = new Set();
  let m;
  while ((m = KEY_RE.exec(src)) !== null) keys.add(m[1]);
  return keys;
}

function uiKeyParity() {
  const en = uiKeys('strings.en.ts');
  const ko = uiKeys('strings.ko.ts');
  if (en.size === 0 || ko.size === 0) return false;
  if (en.size !== ko.size) return false;
  for (const key of en) if (!ko.has(key)) return false;
  return true;
}

// ── Grade every §8.7 MVP domain and fail on the first unmet bar ───────────────────────
const dict = loadDictionary();
const results = checkCoverage(dict, { uiKeyParity: uiKeyParity() });

const failures = [];
for (const { domain, percent, threshold, ok } of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${domain}: ${percent}% (MVP ${threshold}%)`);
  if (!ok) failures.push(domain);
}

if (failures.length > 0) {
  console.error(
    `localization coverage below MVP threshold for: ${failures.join(', ')} ` +
      `(graded ${results.length}/${Object.keys(MVP_THRESHOLDS).length} domains, ` +
      `${Object.keys(dict).length} dictionary terms)`,
  );
  // mod/stat MVP coverage is blocked on CONFIRMED OFFICIAL Korean terminology — the
  // documented Phase 6 human gate (dev-workflow spec §2.1 "공식 한국어 용어 … 최종 용어
  // 확정은 FLAG", §165 coverage gate FLAG). NO-FALLBACK: the gate stays RED rather than
  // fake a pass; it goes green once those terms are seeded with confirmed provenance.
  console.error(
    'FLAG: missing domains await confirmed official ko terminology (human gate) — ' +
      'NO-FALLBACK keeps the gate red until real terms land.',
  );
  process.exit(1);
}

console.log('localization coverage meets all §8.7 MVP thresholds');
