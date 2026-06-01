#!/usr/bin/env node
/**
 * record-baselines.mjs — golden fixture baseline recorder (task golden-fixtures;
 * DESIGN §7.4 golden test, §16 testing).
 *
 * Drives the deterministic golden fixtures under fixtures/ through the REAL
 * vendored core — `luajit overlays/lua/runner.lua`, the same out-of-process
 * JSON-RPC provenance path the Node core-client uses and the same one the
 * existing sample-build.xml fixture exercises — and records, per fixture, a
 * baseline JSON of the DESIGN §7.4 core stats (average hit, rates, hit/crit
 * chance, total + DoT DPS, life/mana/ES, reservation, armour/evasion/ES, max
 * resists, EHP). Those committed baselines are the PARITY ANCHOR the golden gate
 * compares against (DESIGN §7.4 "fork와 upstream 계산 차이 감지").
 *
 * Provenance (humanGate=gamedata, SAFE best-effort): fixtures are authored from
 * the upstream PoB2 save formats (Build:Save / SkillsTab:Save / ItemsTab:Save /
 * TreeTab:Save) using only gamedata IDs that already exist in the vendored
 * `vendor/PathOfBuilding-PoE2/src/Data` — NOT live-scraped, and bundling NO GGG
 * assets (icons/images stay remote-ref, DESIGN §9/§15). Each fixture documents
 * its intent and the gamedata IDs it uses in fixtures/<id>.xml and README.md.
 *
 * Modes:
 *   node record-baselines.mjs            record/refresh every baseline JSON
 *   node record-baselines.mjs --check    re-record and FAIL on any divergence
 *                                        from the committed baselines (the gate)
 *
 * Self-contained by design: it spawns luajit directly and speaks NDJSON JSON-RPC,
 * so it needs ONLY luajit + the in-repo overlays/vendor — no TypeScript build, no
 * @pob2/core-client dist. That keeps `node record-baselines.mjs --check` runnable
 * from a clean checkout, which is exactly what the per-task verifyCmd requires.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// tools/golden-tests -> repo root
const REPO_ROOT = resolve(here, '..', '..');
const RUNNER_PATH = resolve(REPO_ROOT, 'overlays', 'lua', 'runner.lua');
const FIXTURES_DIR = resolve(here, 'fixtures');
const BASELINES_DIR = resolve(here, 'baselines');

/**
 * The DESIGN §7.4 "핵심 stat" id set, in the curated order the core emits them
 * (mirrors overlays/lua/modern_api.lua CORE_STATS / headless_bootstrap
 * CORE_STAT_KEYS — the machine-readable mainOutput keys). A baseline may only
 * carry ids from this set; a stat absent from a given build is simply omitted
 * (NO-FALLBACK: real numbers only, never null placeholders).
 */
export const CORE_STAT_IDS = [
  'Life',
  'Mana',
  'EnergyShield',
  'Ward',
  'Spirit',
  'TotalDPS',
  'CombinedDPS',
  'FullDPS',
  'AverageHit',
  'AverageDamage',
  'WithDotDPS',
  'TotalDot',
  'Armour',
  'Evasion',
  'EvasionRating',
  'TotalEHP',
  'FireResist',
  'ColdResist',
  'LightningResist',
  'ChaosResist',
];

/**
 * The golden fixture corpus (DESIGN §7.4 case matrix). Each entry names its XML
 * file, the §7.4 cases it covers (`cases`), a one-line intent, and the headline
 * gamedata IDs it references — so the corpus self-documents its provenance. The
 * detailed intent + full ID list lives in each fixtures/<file>.xml header and in
 * README.md.
 */
export const FIXTURES = [
  {
    id: 'unarmed-monk',
    file: 'unarmed-monk.xml',
    cases: ['unarmed'],
    intent: 'Level 1 Monk with no weapon and no skill — pure defensive/resource baseline.',
    gamedata: ['class:Monk(classId=10)'],
  },
  {
    id: 'single-skill-mace',
    file: 'single-skill-mace.xml',
    cases: ['single-skill'],
    intent: 'Warrior with one One Hand Mace and a single Mace Strike active — minimal attack DPS.',
    gamedata: [
      'class:Warrior(classId=6)',
      'base:Akoyan Club(One Hand Mace)',
      'gem:Metadata/Items/Gems/SkillGemMaceStrike',
      'skill:MeleeMaceMacePlayer',
    ],
  },
  {
    id: 'single-spell-spark',
    file: 'single-spell-spark.xml',
    cases: ['single-skill', 'crit'],
    intent: 'Sorceress casting Spark from a Wand — a single spell with non-zero base crit.',
    gamedata: [
      'class:Sorceress(classId=7)',
      'base:Attuned Wand(Wand)',
      'gem:Metadata/Items/Gems/SkillGemSpark',
      'skill:SparkPlayer',
    ],
  },
  {
    id: 'spell-support-arc',
    file: 'spell-support-arc.xml',
    cases: ['single-skill', 'party-support'],
    intent: 'Sorceress casting Arc supported by Elemental Focus — exercises the support-gem path.',
    gamedata: [
      'class:Sorceress(classId=7)',
      'base:Attuned Wand(Wand)',
      'gem:Metadata/Items/Gems/SkillGemArc',
      'skill:ArcPlayer',
      'support:Metadata/Items/Gems/SupportGemElementalFocus',
    ],
  },
  {
    id: 'aura-discipline',
    file: 'aura-discipline.xml',
    cases: ['aura-reservation'],
    intent: 'Sorceress running the Discipline aura — exercises spirit reservation + ES aura.',
    gamedata: [
      'class:Sorceress(classId=7)',
      'gem:Metadata/Items/Gems/SkillGemDiscipline',
      'skill:DisciplinePlayer',
    ],
  },
  {
    id: 'herald-of-ice',
    file: 'herald-of-ice.xml',
    cases: ['aura-reservation'],
    intent: 'Ranger running Herald of Ice — a persistent reserved buff (reservation path).',
    gamedata: [
      'class:Ranger(classId=2)',
      'gem:Metadata/Items/Gems/SkillGemHeraldOfIce',
      'skill:HeraldOfIcePlayer',
    ],
  },
  {
    id: 'minion-skeletal-arsonist',
    file: 'minion-skeletal-arsonist.xml',
    cases: ['minion'],
    intent: 'Witch summoning Skeletal Arsonists — exercises the minion calc path.',
    gamedata: [
      'class:Witch(classId=1)',
      'gem:Metadata/Items/Gems/SkillGemSkeletalArsonist',
      'skill:SummonSkeletalArsonistsPlayer',
    ],
  },
  {
    id: 'dot-essence-drain',
    file: 'dot-essence-drain.xml',
    cases: ['dot', 'ailment'],
    intent: 'Witch casting Essence Drain from a Wand — a chaos damage-over-time spell.',
    gamedata: [
      'class:Witch(classId=1)',
      'base:Attuned Wand(Wand)',
      'gem:Metadata/Items/Gems/SkillGemEssenceDrain',
      'skill:EssenceDrainPlayer',
    ],
  },
  {
    id: 'dot-contagion',
    file: 'dot-contagion.xml',
    cases: ['dot', 'ailment'],
    intent: 'Witch casting Contagion from a Wand — a chaos area damage-over-time spell.',
    gamedata: [
      'class:Witch(classId=1)',
      'base:Attuned Wand(Wand)',
      'gem:Metadata/Items/Gems/SkillGemContagion',
      'skill:ContagionPlayer',
    ],
  },
  {
    id: 'armoured-mace',
    file: 'armoured-mace.xml',
    cases: ['single-skill', 'item-set-swap'],
    intent:
      'Warrior with a Mace + Body Armour and TWO item sets (armour-only vs no-armour) — the second set is the swap target, so the saved active set is deterministic.',
    gamedata: [
      'class:Warrior(classId=6)',
      'base:Akoyan Club(One Hand Mace)',
      'base:Bearskin Mantle(Body Armour, Armour=207/ES=60)',
      'gem:Metadata/Items/Gems/SkillGemMaceStrike',
      'skill:MeleeMaceMacePlayer',
    ],
  },
  {
    id: 'passive-delta-life',
    file: 'passive-delta-life.xml',
    cases: ['passive-delta'],
    intent:
      'Warrior with extra passive nodes allocated vs the unarmed baseline — a passive-allocation delta over the same class.',
    gamedata: ['class:Warrior(classId=6)', 'tree:nodes=allocated life/attribute cluster'],
  },
  {
    id: 'jewel-ranger',
    file: 'jewel-ranger.xml',
    cases: ['jewel-radius-conversion'],
    intent:
      'Ranger with a Diamond jewel socketed into the tree — exercises the jewel/radius socket path.',
    gamedata: ['class:Ranger(classId=2)', 'base:Diamond(Jewel)', 'jewel:socketed in tree'],
  },
];

/** Absolute path to a fixture's authored XML file. */
export function fixturePath(fixture) {
  return resolve(FIXTURES_DIR, fixture.file);
}

/** Absolute path to a fixture's recorded baseline JSON. */
export function baselinePath(fixture) {
  return resolve(BASELINES_DIR, `${fixture.id}.json`);
}

/** Typed error for a core/transport failure (mirrors core-client CoreClientError shape). */
class CoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CoreError';
  }
}

/**
 * Merge the luarocks `--local` Lua module search paths into the child env so the
 * runner can `require('dkjson')` (the JSON codec) and `require('lua-utf8')` (the
 * native module the vendored core needs). Mirrors core-client RunnerClient.childEnv
 * — the single source of truth for how the runner is provisioned. Absent luarocks,
 * the parent env is used unchanged, so a missing module surfaces as a clear runner
 * boot error rather than a silent wrong answer.
 */
function childEnv() {
  const env = { ...process.env };
  const read = (flag) => {
    const r = spawnSync('luarocks', ['--local', 'path', flag], { encoding: 'utf8' });
    if (r.status !== 0 || typeof r.stdout !== 'string') return undefined;
    const value = r.stdout.trim();
    return value.length > 0 ? value : undefined;
  };
  const lrPath = read('--lr-path');
  const lrCpath = read('--lr-cpath');
  if (lrPath) env.LUA_PATH = `${lrPath};${env.LUA_PATH ?? ';;'}`;
  if (lrCpath) env.LUA_CPATH = `${lrCpath};${env.LUA_CPATH ?? ';;'}`;
  return env;
}

/**
 * Spawn the runner subprocess and complete the core.version handshake. Returns a
 * tiny driver with `call(method, params)` and `dispose()`. NDJSON JSON-RPC, one
 * request per line, responses correlated by id — the same wire contract
 * overlays/lua/runner.lua serves the Node core-client.
 */
export async function openCore({ luajit = 'luajit', timeoutMs = 120_000 } = {}) {
  const child = spawn(luajit, [RUNNER_PATH], {
    cwd: REPO_ROOT,
    env: childEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  let deadError;
  const stderrChunks = [];

  const fail = (err) => {
    if (deadError) return;
    deadError = err;
    for (const [, p] of pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    pending.clear();
  };

  child.on('error', (e) => fail(new CoreError(`runner process error: ${e.message}`)));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (c) => {
    stderrChunks.push(c);
    if (stderrChunks.length > 200) stderrChunks.shift();
  });
  let disposed = false;
  child.on('exit', (code, signal) => {
    if (disposed) return;
    fail(
      new CoreError(
        `runner exited unexpectedly (${signal ? `signal ${signal}` : `code ${code}`})\n` +
          stderrChunks.join('').slice(-4000),
      ),
    );
  });

  const rl = createInterface({ input: child.stdout });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      fail(new CoreError(`runner emitted a non-JSON protocol line: ${line.slice(0, 200)}`));
      return;
    }
    const id = typeof frame.id === 'number' ? frame.id : undefined;
    if (id === undefined) return;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (frame.error) {
      const detail = frame.error.data && frame.error.data.code ? ` [${frame.error.data.code}]` : '';
      entry.reject(new CoreError(`${frame.error.message ?? 'runner error'}${detail}`));
      return;
    }
    entry.resolve(frame.result);
  });

  const call = (method, params) =>
    new Promise((resolveCall, rejectCall) => {
      if (deadError) return rejectCall(deadError);
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        fail(new CoreError(`runner request '${method}' timed out after ${timeoutMs}ms`));
        rejectCall(deadError);
      }, timeoutMs);
      pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (e) => {
        if (e) {
          pending.delete(id);
          clearTimeout(timer);
          rejectCall(new CoreError(`failed to write to runner: ${e.message}`));
        }
      });
    });

  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    rl.close();
    fail(new CoreError('runner disposed'));
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((res) => {
      child.once('exit', res);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        res();
      }, 2000).unref();
    });
  };

  // Ready handshake: block on core.version before handing the driver back.
  const version = await call('core.version', {});
  if (!version || typeof version.version !== 'string' || version.version.length === 0) {
    await dispose();
    throw new CoreError('runner core.version handshake returned no version');
  }
  return { call, dispose, version: version.version };
}

/**
 * Load one fixture's XML through the core and record its curated §7.4 core stats
 * as a flat {statId: value} map (only CORE_STAT_IDS the build actually produced).
 * Returns {id, cases, intent, stats} — the baseline document shape.
 */
export async function recordFixture(core, fixture, xml) {
  const loaded = await core.call('build.load', { xml });
  if (!loaded || typeof loaded.buildId !== 'string') {
    throw new CoreError(`${fixture.id}: build.load returned no buildId`);
  }
  const calc = await core.call('calc.run', { buildId: loaded.buildId });
  const list = (calc && calc.stats) || [];
  const allowed = new Set(CORE_STAT_IDS);
  const stats = {};
  for (const entry of list) {
    if (entry && typeof entry.statId === 'string' && allowed.has(entry.statId)) {
      if (typeof entry.value === 'number' && Number.isFinite(entry.value)) {
        stats[entry.statId] = entry.value;
      }
    }
  }
  if (Object.keys(stats).length === 0) {
    throw new CoreError(`${fixture.id}: core produced no curated §7.4 core stats`);
  }
  return { id: fixture.id, cases: fixture.cases, intent: fixture.intent, stats };
}

/**
 * Compare a baseline stat map against a freshly recorded one (DESIGN §7.4
 * tolerance: integers exact; floats within 1e-6). Returns a list of human-readable
 * divergence strings — empty means parity. A stat present in one side but not the
 * other is itself a divergence (the curated set changed).
 */
export function compareStats(baseline, fresh) {
  const diffs = [];
  const ids = new Set([...Object.keys(baseline), ...Object.keys(fresh)]);
  for (const id of [...ids].sort()) {
    const b = baseline[id];
    const f = fresh[id];
    if (b === undefined) {
      diffs.push(`+${id}: appeared (=${f})`);
      continue;
    }
    if (f === undefined) {
      diffs.push(`-${id}: disappeared (was ${b})`);
      continue;
    }
    if (Number.isInteger(b) && Number.isInteger(f)) {
      if (b !== f) diffs.push(`${id}: ${b} -> ${f}`);
    } else if (Math.abs(b - f) > 1e-6) {
      diffs.push(`${id}: ${b} -> ${f} (Δ=${Math.abs(b - f).toExponential(3)})`);
    }
  }
  return diffs;
}

/**
 * Serialize a baseline document deterministically. Output matches the repo
 * Prettier JSON style (2-space indent, short `cases` array inline) so a plain
 * `record-baselines.mjs` run produces files that already pass `prettier --check`,
 * with zero extra runtime dependency (keeping `--check` luajit-only). Stats are
 * emitted in the canonical CORE_STAT_IDS order.
 */
function serializeBaseline(doc) {
  const stats = {};
  for (const id of CORE_STAT_IDS) {
    if (Object.prototype.hasOwnProperty.call(doc.stats, id)) stats[id] = doc.stats[id];
  }
  // Build the full doc, then inline the (always-short) `cases` array to match
  // Prettier, which keeps arrays that fit on one line unwrapped.
  const expanded = JSON.stringify(
    { id: doc.id, cases: doc.cases, intent: doc.intent, stats },
    null,
    2,
  );
  // Prettier puts a space after each array element comma; JSON.stringify does not.
  const inlineCases = `"cases": [${doc.cases.map((c) => JSON.stringify(c)).join(', ')}]`;
  return `${expanded.replace(/"cases": \[[^\]]*\]/, inlineCases)}\n`;
}

async function main() {
  const check = process.argv.includes('--check');
  const core = await openCore();
  let failures = 0;
  let recorded = 0;
  try {
    for (const fixture of FIXTURES) {
      const xmlPath = fixturePath(fixture);
      if (!existsSync(xmlPath)) {
        console.error(`MISSING fixture xml: ${xmlPath}`);
        failures++;
        continue;
      }
      const xml = readFileSync(xmlPath, 'utf8');
      let fresh;
      try {
        fresh = await recordFixture(core, fixture, xml);
      } catch (e) {
        console.error(`FAIL  ${fixture.id}: ${e.message}`);
        failures++;
        continue;
      }
      const outPath = baselinePath(fixture);
      if (check) {
        if (!existsSync(outPath)) {
          console.error(`FAIL  ${fixture.id}: no committed baseline at ${outPath}`);
          failures++;
          continue;
        }
        const committed = JSON.parse(readFileSync(outPath, 'utf8'));
        const diffs = compareStats(committed.stats, fresh.stats);
        if (diffs.length > 0) {
          console.error(`DIFF  ${fixture.id} (${fixture.cases.join(', ')}):`);
          for (const d of diffs) console.error(`        ${d}`);
          failures++;
        } else {
          console.log(`ok    ${fixture.id} (${Object.keys(fresh.stats).length} stats)`);
        }
      } else {
        writeFileSync(outPath, serializeBaseline(fresh));
        console.log(`wrote ${fixture.id} -> ${outPath} (${Object.keys(fresh.stats).length} stats)`);
        recorded++;
      }
    }
  } finally {
    await core.dispose();
  }

  if (check) {
    if (failures > 0) {
      console.error(`\n${failures} fixture(s) diverged from baseline.`);
      process.exit(1);
    }
    console.log(`\nAll ${FIXTURES.length} golden fixtures match their committed baselines.`);
  } else {
    if (failures > 0) {
      console.error(`\n${failures} fixture(s) failed to record.`);
      process.exit(1);
    }
    console.log(`\nRecorded ${recorded} baseline(s).`);
  }
}

// Run as a CLI only when invoked directly (not when imported by the test suite).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e?.stack || String(e));
    process.exit(1);
  });
}
