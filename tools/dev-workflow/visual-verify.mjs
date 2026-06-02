// visual-verify.mjs — spec §6 GUI visual verification helper.
//
// Two layers:
//   • Tier 1 / Tier 2 capture primitives (`captureUrl` / `captureTauri`) — used by
//     the phase-pipeline gate-agent and the `url`/`tauri` CLI modes.
//   • The `--route <route> --check` path (this file's headline): the full spec §6
//     route for a `gates.mjs` VISUAL screen — build a fixture harness that mounts
//     the REAL @pob2/ui screen with representative data (spec §2: fixtures, NOT a
//     live network/runner), serve the built dist statically, Playwright-screenshot
//     it at 1366×768 / 1366×1100, assert the screen carries the VISUAL[route].assert
//     facts, then clean up the harness/dist (working tree clean). The LLM vision
//     step (gemini-vision, or direct-vision FLAG) is layered on top by the caller.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, resolve } from 'node:path';
import { VISUAL } from './gates.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
// The desktop app already has vite + @vitejs/plugin-react + a workspace link to
// @pob2/ui, so building the harness from inside it resolves the SHIPPED package
// (spec §2: reuse, don't fabricate) without adding a dependency anywhere.
const HARNESS_HOST = join(REPO_ROOT, 'apps', 'desktop');

export async function captureUrl(url, out, { width = 1366, height = 768 } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.screenshot({ path: out, fullPage: false });
  } finally {
    await browser.close();
  }
  return out;
}

function firstAvailable(cands) {
  for (const c of cands) if (spawnSync('bash', ['-lc', `command -v ${c}`]).status === 0) return c;
  return null;
}

export function captureTauri(bin, out) {
  const shooter = firstAvailable(['import', 'scrot', 'gnome-screenshot']);
  if (!shooter) return { ok: false, reason: 'no screenshot tool (import/scrot/gnome-screenshot)' };
  const hasXvfb = spawnSync('bash', ['-lc', 'command -v xvfb-run']).status === 0;
  const shotCmd =
    shooter === 'import'
      ? `import -window root ${out}`
      : shooter === 'scrot'
        ? `scrot ${out}`
        : `gnome-screenshot -f ${out}`;
  const inner = `("${bin}" & APP=$!; sleep 6; ${shotCmd}; kill $APP 2>/dev/null)`;
  const cmd = hasXvfb
    ? `xvfb-run -a --server-args="-screen 0 1366x768x24" bash -lc '${inner}'`
    : `bash -lc '${inner}'`; // fall back to live $DISPLAY/WSLg
  const p = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout: 120000 });
  if (p.status !== 0)
    return { ok: false, reason: `capture failed exit=${p.status} ${p.stderr || ''}`.trim() };
  return { ok: true, out };
}

// ---------------------------------------------------------------------------
// Fixture harness (spec §2 / §6): a tiny Vite app that mounts the REAL @pob2/ui
// screen for a VISUAL route with §10-representative data. NOT the live app — the
// production route drives the screen from a live Tauri-IPC core session a static
// serve has no runner for, so the harness supplies fixture data instead.
// ---------------------------------------------------------------------------

/** Locate the VISUAL screen registered for `route`, across all phases. */
function visualScreenFor(route) {
  for (const screens of Object.values(VISUAL)) {
    const hit = screens.find((s) => s.route === route);
    if (hit) return hit;
  }
  return undefined;
}

// §10.7 representative Calcs breakdown data (gates.mjs VISUAL[4].assert): a
// calc.run with several stats across Summary/Offence/Defence/Resource, plus
// calc.explain traces carrying a classified contribution `sources:` list and a
// `formula:` string + upstream raw stat id — the exact facts the screen asserts.
// Embedded as a source string so `harnessFiles('/calcs').entry` is the buildable
// .tsx and the representative data round-trips through the SHIPPED buildCalcsModel.
const CALCS_HARNESS_ENTRY = `import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AppShell, CalcsPanel, buildCalcsModel } from '@pob2/ui';
import '@pob2/ui/styles.css';
import type {
  CalcRunResponse,
  CalcExplainResponse,
  CalcRunRequest,
  CalcExplainRequest,
} from '@pob2/schema';

const buildId = 'fixture-build' as CalcRunRequest['buildId'];

// A prior run (for before/after delta) and the current run — several stats across
// every §10.7 section so the breakdown tree is populated, not a stub.
const prevRun: CalcRunResponse = {
  buildId,
  stats: [
    { statId: 'TotalDPS', value: 100000, label: 'Total DPS' },
    { statId: 'AverageDamage', value: 7400, label: 'Average Damage' },
    { statId: 'CritChance', value: 68, label: 'Critical Hit Chance' },
    { statId: 'CritMultiplier', value: 350, label: 'Critical Damage Bonus' },
    { statId: 'IgniteDPS', value: 18000, label: 'Ignite DPS' },
    { statId: 'TotalDotDPS', value: 22000, label: 'Total DoT DPS' },
    { statId: 'Life', value: 4200, label: 'Life' },
    { statId: 'EnergyShield', value: 1600, label: 'Energy Shield' },
    { statId: 'Mana', value: 1100, label: 'Mana' },
    { statId: 'FireResist', value: 75, label: 'Fire Resistance' },
    { statId: 'ColdResist', value: 75, label: 'Cold Resistance' },
    { statId: 'LightningResist', value: 70, label: 'Lightning Resistance' },
    { statId: 'ChaosResist', value: -12, label: 'Chaos Resistance' },
    { statId: 'Armour', value: 9800, label: 'Armour' },
    { statId: 'Evasion', value: 5200, label: 'Evasion' },
    { statId: 'TotalEHP', value: 21000, label: 'Effective Hit Pool' },
    { statId: 'Spirit', value: 100, label: 'Spirit' },
    { statId: 'SpiritReserved', value: 70, label: 'Spirit Reserved' },
    { statId: 'ManaReserved', value: 480, label: 'Mana Reserved' },
    { statId: 'ManaUnreserved', value: 620, label: 'Unreserved Mana' },
  ],
};
const run: CalcRunResponse = {
  buildId,
  stats: [
    { statId: 'TotalDPS', value: 125000, label: 'Total DPS' },
    { statId: 'AverageDamage', value: 8200, label: 'Average Damage' },
    { statId: 'CritChance', value: 71, label: 'Critical Hit Chance' },
    { statId: 'CritMultiplier', value: 370, label: 'Critical Damage Bonus' },
    { statId: 'IgniteDPS', value: 21000, label: 'Ignite DPS' },
    { statId: 'TotalDotDPS', value: 24000, label: 'Total DoT DPS' },
    { statId: 'Life', value: 4500, label: 'Life' },
    { statId: 'EnergyShield', value: 1600, label: 'Energy Shield' },
    { statId: 'Mana', value: 1180, label: 'Mana' },
    { statId: 'FireResist', value: 75, label: 'Fire Resistance' },
    { statId: 'ColdResist', value: 75, label: 'Cold Resistance' },
    { statId: 'LightningResist', value: 75, label: 'Lightning Resistance' },
    { statId: 'ChaosResist', value: -8, label: 'Chaos Resistance' },
    { statId: 'Armour', value: 10400, label: 'Armour' },
    { statId: 'Evasion', value: 5200, label: 'Evasion' },
    { statId: 'TotalEHP', value: 22500, label: 'Effective Hit Pool' },
    { statId: 'Spirit', value: 100, label: 'Spirit' },
    { statId: 'SpiritReserved', value: 70, label: 'Spirit Reserved' },
    { statId: 'ManaReserved', value: 480, label: 'Mana Reserved' },
    { statId: 'ManaUnreserved', value: 620, label: 'Unreserved Mana' },
  ],
};

// calc.explain traces: each carries a classified contribution \`sources\` list
// (item/passive/skillGem/supportGem/config/buff) + a \`formula\` trace string +
// the upstream raw stat id (gates.mjs VISUAL[4] "source list + formula trace").
const explains: CalcExplainResponse[] = [
  {
    statId: 'TotalDPS',
    finalValue: 125000,
    label: 'Total DPS',
    sources: [
      { kind: 'skillGem', label: 'Lightning Arrow', value: 60000 },
      { kind: 'supportGem', label: 'Added Lightning Damage', value: 28000 },
      { kind: 'item', label: 'Doryani Catalyst', value: 22000 },
      { kind: 'passive', label: 'Heart of Thunder', value: 10000 },
      { kind: 'config', label: 'Shock (effect 50%)', value: 5000 },
    ],
    formula: 'baseHit 8200 × critMult 1.45 × hitRate 10.5 = 125000',
    upstreamStatId: 'Output.TotalDPS',
  },
  {
    statId: 'TotalEHP',
    finalValue: 22500,
    label: 'Effective Hit Pool',
    sources: [
      { kind: 'item', label: 'Kaom\\'s Heart', value: 9000 },
      { kind: 'passive', label: 'Constitution', value: 4500 },
      { kind: 'buff', label: 'Determination', value: 6000 },
      { kind: 'config', label: 'Fortify', value: 3000 },
    ],
    formula: 'life 4500 + es 1600 mitigated by armour 10400 = 22500 EHP',
    upstreamStatId: 'Output.TotalEHP',
  },
  {
    statId: 'CritChance',
    finalValue: 71,
    label: 'Critical Hit Chance',
    sources: [
      { kind: 'skillGem', label: 'Lightning Arrow', value: 8 },
      { kind: 'item', label: 'Diamond Ring', value: 40 },
      { kind: 'passive', label: 'Deadly Draw', value: 23 },
    ],
    formula: 'base 8% × (1 + 790% increased) = 71%',
    upstreamStatId: 'Output.CritChance',
  },
  {
    statId: 'FireResist',
    finalValue: 75,
    label: 'Fire Resistance',
    sources: [
      { kind: 'item', label: 'Topaz Ring', value: 35 },
      { kind: 'item', label: 'Gold Amulet', value: 28 },
      { kind: 'passive', label: 'Diamond Skin', value: 12 },
    ],
    formula: 'sum 110% capped at 75% (max)',
    upstreamStatId: 'Output.FireResist',
  },
];

// Exercise the lazy calc.explain path too: stats WITHOUT a preloaded trace render a
// "trace 없음" marker until expanded — onExplain fills it in (NO-FALLBACK §6.4).
const explainById = new Map(explains.map((e) => [e.statId, e]));

function Harness() {
  const [loaded, setLoaded] = useState(explains);
  const model = buildCalcsModel(run, loaded, prevRun);
  const onExplain = (statId: string) => {
    const e = explainById.get(statId);
    if (e && !loaded.some((x) => x.statId === statId)) setLoaded([...loaded, e]);
  };
  return (
    <AppShell
      locale="ko-KR"
      onLocaleChange={() => {}}
      buildName="Deadeye / Lightning Arrow"
      activeSkill="Lightning Arrow"
      activeTab="calcs"
      workspace={<CalcsPanel locale="ko-KR" model={model} onExplain={onExplain} />}
      inspector={null}
    />
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
`;

// §10.6 representative Passive Tree data (gates.mjs VISUAL[5].assert): an abridged
// raw tree graph (a few groups of orbit-placed nodes, a notable + a keystone, real
// connections) run through the SHIPPED buildTreeGraph so the canvas paints real
// nodes + edges; an allocated set so allocated/unallocated discs differ; a bilingual
// node search index from buildNodeSearchIndex; and a CONTROLLED hovered node id +
// tree.previewAllocate deltas so the hover tooltip + the allocation-delta chips
// paint without any pointer interaction. Embedded as a source string so
// `harnessFiles('/tree').entry` is the buildable .tsx and the representative data
// round-trips through the SHIPPED transforms (spec §2: reuse, don't fabricate).
const TREE_HARNESS_ENTRY = `import { createRoot } from 'react-dom/client';
import { AppShell, TreePanel, buildTreeGraph, buildNodeSearchIndex } from '@pob2/ui';
import type { RawTreeData, NodeSearchDoc } from '@pob2/ui';
import type { TreeStatDelta } from '@pob2/schema';
import '@pob2/ui/styles.css';

// An abridged raw tree (the upstream tree.json shape buildTreeGraph consumes): two
// groups, several orbit-placed nodes incl. a notable + a keystone, real undirected
// connections. Orbit 0 = the group centre; orbit 1 = a ring of placed nodes. The
// constants give orbit 1 a non-zero radius + per-slot angles so the nodes spread.
const TAU = Math.PI * 2;
const orbit1Angles = Array.from({ length: 6 }, (_, i) => (i / 6) * TAU);
const raw: RawTreeData = {
  nodes: {
    '1': { skill: 1, name: '시작 (Start)', group: 1, orbit: 0, orbitIndex: 0, stats: [], connections: [{ id: 2, orbit: 1 }, { id: 3, orbit: 1 }] },
    '2': { skill: 2, name: '근력 (Strength)', group: 1, orbit: 1, orbitIndex: 0, stats: ['+10 to Strength'], connections: [{ id: 1, orbit: 0 }, { id: 4, orbit: 1 }] },
    '3': { skill: 3, name: '민첩 (Dexterity)', group: 1, orbit: 1, orbitIndex: 2, stats: ['+10 to Dexterity'], connections: [{ id: 1, orbit: 0 }, { id: 5, orbit: 1 }] },
    '4': { skill: 4, name: '불굴 (Resolute Technique)', group: 2, orbit: 1, orbitIndex: 1, stats: ['Your hits cannot be evaded'], isKeystone: true, connections: [{ id: 2, orbit: 1 }, { id: 6, orbit: 1 }] },
    '5': { skill: 5, name: '정밀 (Precision)', group: 2, orbit: 1, orbitIndex: 3, stats: ['+40% increased critical strike chance'], isNotable: true, connections: [{ id: 3, orbit: 1 }, { id: 6, orbit: 1 }] },
    '6': { skill: 6, name: '체력 (Vitality)', group: 2, orbit: 1, orbitIndex: 5, stats: ['+8% increased maximum Life'], isNotable: true, connections: [{ id: 4, orbit: 1 }, { id: 5, orbit: 1 }] },
  },
  groups: [
    { x: 0, y: 0, nodes: [1, 2, 3], orbits: [0, 1] },
    { x: 600, y: 200, nodes: [4, 5, 6], orbits: [1] },
  ],
  constants: { orbitRadii: [0, 250], skillsPerOrbit: [1, 6], orbitAnglesByOrbit: [[0], orbit1Angles] },
  min_x: -300,
  min_y: -300,
  max_x: 900,
  max_y: 500,
};

const graph = buildTreeGraph(raw);

// The allocated set (gold discs + a gold path edge between allocated nodes).
const allocated = new Set<number>([1, 2, 4]);

// The bilingual (한/영) node search index over the graph (NodeSearchDoc per node).
const docs: NodeSearchDoc[] = graph.nodes.map((node) => ({
  nodeId: node.nodeId,
  titleKo: node.label,
  titleEn: node.label,
  aliasesKo: [],
  aliasesEn: [],
}));
const index = buildNodeSearchIndex(docs);

// A CONTROLLED hovered node (the unallocated notable 5) + its tree.previewAllocate
// deltas, so the hover tooltip + the §10.6 allocation-delta chips paint statically.
const hoveredNodeId = 5;
const hoverDeltas: TreeStatDelta[] = [
  { statId: 'CritChance', before: 45, after: 63, delta: 18 },
  { statId: 'TotalDPS', before: 120000, after: 138000, delta: 18000 },
  { statId: 'Life', before: 4500, after: 4500, delta: 0 },
];

createRoot(document.getElementById('root')!).render(
  <AppShell
    locale="ko-KR"
    onLocaleChange={() => {}}
    buildName="Deadeye / Lightning Arrow"
    activeSkill="Lightning Arrow"
    activeTab="passiveTree"
    workspace={
      <TreePanel
        locale="ko-KR"
        graph={graph}
        allocated={allocated}
        index={index}
        hoveredNodeId={hoveredNodeId}
        hoverDeltas={hoverDeltas}
      />
    }
    inspector={null}
  />,
);
`;

/** Map a VISUAL route to its harness entry source + index.html. */
const HARNESS_ENTRIES = { '/calcs': CALCS_HARNESS_ENTRY, '/tree': TREE_HARNESS_ENTRY };

// Per-route stat rows to pre-expand before screenshotting, so the §10.7 source
// list + formula trace (collapsed by default) are VISIBLE in the capture. These
// stat ids carry a real calc.explain trace in the route's harness fixture data.
const HARNESS_EXPAND = { '/calcs': ['TotalDPS', 'TotalEHP'] };

/**
 * Count the non-transparent pixels actually PAINTED on a route's canvas, read back
 * from the live 2D context in the page. The canvas bitmap is not in the DOM, so a
 * blank `<canvas>` would otherwise pass every served-DOM assertion; this readback is
 * the deterministic fact that proves the §10.6 nodes + edges drew (a blank canvas
 * reads 0). `null` for routes with no canvas to assert (e.g. /calcs).
 */
const ROUTE_CANVAS_SELECTOR = { '/tree': 'canvas.pob-tree-canvas' };

async function countCanvasPixels(page, selector) {
  return page
    .evaluate((sel) => {
      const canvas = document.querySelector(sel);
      if (!(canvas instanceof HTMLCanvasElement)) return 0;
      const ctx = canvas.getContext('2d');
      if (!ctx) return 0;
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let painted = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted += 1;
      return painted;
    }, selector)
    .catch(() => 0);
}

/**
 * The fixture-harness files for a VISUAL `route`: the buildable entry `.tsx`
 * (mounts the SHIPPED screen with representative data) and the `index.html` that
 * mounts it on `#root`. Throws if the route has no harness yet.
 */
export function harnessFiles(route) {
  const entry = HARNESS_ENTRIES[route];
  if (!entry) throw new Error(`no harness for route ${route}`);
  const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PoB2 Remastered — visual harness ${route}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./harness.tsx"></script>
  </body>
</html>
`;
  return { entry, html };
}

/** Run a command in HARNESS_HOST, returning {status, stdout, stderr}. */
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: HARNESS_HOST,
    encoding: 'utf8',
    timeout: 180000,
    ...opts,
  });
}

/**
 * Build the fixture harness for `route` into a transient workdir under the host
 * app, returning { workdir, dist }. The workdir is removed by `runVisualCheck`'s
 * cleanup so the working tree stays clean. Throws on a build failure.
 */
export async function buildHarness(route) {
  const { entry, html } = harnessFiles(route);
  const workdir = join(HARNESS_HOST, `.visual-harness-${route.replace(/\W+/g, '') || 'root'}`);
  const dist = join(workdir, 'dist');
  await rm(workdir, { recursive: true, force: true });
  await mkdir(workdir, { recursive: true });
  await writeFile(join(workdir, 'harness.tsx'), entry);
  await writeFile(join(workdir, 'index.html'), html);
  // Minimal vite config: react plugin (resolved from the host app), root = workdir,
  // relative base so the static server can serve the dist from any mount path.
  await writeFile(
    join(workdir, 'vite.config.mjs'),
    `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ root: '${workdir.replace(/\\/g, '\\\\')}', base: './', plugins: [react()], build: { outDir: '${dist.replace(/\\/g, '\\\\')}', emptyOutDir: true } });
`,
  );
  const p = run('npx', ['vite', 'build', '--config', join(workdir, 'vite.config.mjs')]);
  if (p.status !== 0) {
    await rm(workdir, { recursive: true, force: true });
    throw new Error(`harness build failed (exit ${p.status}):\n${p.stdout}\n${p.stderr}`);
  }
  return { workdir, dist };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** Serve `dir` over a static http server on a free port; returns {url, close}. */
export function serveDir(dir) {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(dir, path);
    if (!file.startsWith(dir)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolveServe) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolveServe({
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise((c) => server.close(c)),
      });
    });
  });
}

/**
 * The full spec §6 visual-check path for a VISUAL `route`: build the fixture
 * harness → serve it → Playwright-screenshot it at every `dims` (default
 * 1366×768 + 1366×1100) → capture the painted DOM for assertion. Returns
 * { screen, shots, servedHtml, canvasPaintedPixels, workdir, cleanup }. The caller
 * runs the vision assertion (gemini-vision or direct vision) over `shots`;
 * `servedHtml` lets a deterministic check confirm the VISUAL[route].assert facts
 * actually painted, and `canvasPaintedPixels` (for a canvas route like /tree) is the
 * non-transparent pixel count read back from the live 2D context — the fact that a
 * blank canvas (0 pixels) cannot fake. `cleanup()` removes the harness workdir +
 * screenshots (working tree clean).
 */
export async function runVisualCheck(route, { dims = ['1366x768', '1366x1100'], outDir } = {}) {
  const screen = visualScreenFor(route);
  if (!screen) throw new Error(`no VISUAL screen registered for route ${route}`);
  // A UNIQUE per-run subdir under tmp-visual (gitignored), so two concurrent checks
  // (e.g. /calcs + /tree under one `vitest run`) never share an output dir — one's
  // cleanup must not wipe the other's screenshots. `cleanup()` removes only THIS
  // subdir, never the shared parent (which stays empty + gitignored = tree clean).
  const out =
    outDir || join(REPO_ROOT, 'tmp-visual', `${screen.name}-${process.pid}-${Date.now()}`);
  await mkdir(out, { recursive: true });

  const canvasSelector = ROUTE_CANVAS_SELECTOR[route];
  const { workdir, dist } = await buildHarness(route);
  const served = await serveDir(dist);
  const shots = [];
  let servedHtml = '';
  let canvasPaintedPixels = canvasSelector ? 0 : undefined;
  const browser = await chromium.launch();
  try {
    for (const dim of dims) {
      const [width, height] = dim.split('x').map(Number);
      const page = await browser.newPage({ viewport: { width, height } });
      await page.goto(served.url, { waitUntil: 'networkidle', timeout: 30000 });
      // Let React paint the SPA before capturing (the screen's root container).
      await page.waitForSelector('.pob-calcs, .pob-tree', { timeout: 15000 }).catch(() => {});
      // Expand the representative trace rows so the §10.7 source list + formula
      // trace are VISIBLE in the screenshot (collapsed rows hide them). These rows
      // carry a real calc.explain trace in the fixture data. (calcs only.)
      for (const statId of HARNESS_EXPAND[route] || []) {
        await page
          .click(`li[data-stat-row="${statId}"] [data-stat-toggle]`, { timeout: 5000 })
          .catch(() => {});
        await page.waitForSelector('[data-source-kind]', { timeout: 5000 }).catch(() => {});
      }
      // Canvas routes (the §10.6 tree): read back the painted-pixel count once a
      // canvas is on screen (a blank canvas reads 0, so this is the no-false-pass
      // fact). Keep the max across dims — at least one capture must have painted.
      if (canvasSelector) {
        await page.waitForSelector(canvasSelector, { timeout: 5000 }).catch(() => {});
        canvasPaintedPixels = Math.max(
          canvasPaintedPixels,
          await countCanvasPixels(page, canvasSelector),
        );
      }
      const path = join(out, `pob-${screen.name}-${dim}.png`);
      await page.screenshot({ path, fullPage: false });
      shots.push({ path, dim });
      if (!servedHtml) servedHtml = await page.content();
      await page.close();
    }
  } finally {
    await browser.close();
    await served.close();
  }

  const cleanup = async () => {
    await rm(workdir, { recursive: true, force: true });
    // Remove only THIS run's output subdir (its screenshots), never the shared
    // tmp-visual parent — a concurrent run may still be using a sibling subdir.
    if (existsSync(out)) await rm(out, { recursive: true, force: true });
  };
  return { screen, shots, servedHtml, canvasPaintedPixels, workdir, dist, cleanup };
}

/**
 * Per-route deterministic DOM/canvas assertions: each returns the failures that
 * prove the route's VISUAL assert facts did NOT paint (empty ⇒ all facts present).
 * A blank/stub harness that dropped a §10 element trips a failure here, so it can
 * never false-pass the visual gate.
 */
const ROUTE_ASSERTS = {
  '/calcs'(res) {
    const html = res.servedHtml;
    const lower = html.toLowerCase();
    const failures = [];
    // The §10.7 breakdown sections must all be present in the painted tree.
    for (const section of ['summary', 'offence', 'defence', 'resource']) {
      if (!lower.includes(section)) failures.push(`missing ${section} section`);
    }
    // A classified contribution source list (gates.mjs VISUAL[4] "source list").
    if (!/data-source-kind=/.test(html)) failures.push('no contribution source list painted');
    // A formula trace (gates.mjs VISUAL[4] "formula trace").
    if (!/data-formula/.test(html)) failures.push('no formula trace painted');
    return failures;
  },
  '/tree'(res) {
    const html = res.servedHtml;
    const failures = [];
    // The §10.6 canvas (gates.mjs VISUAL[5] "canvas renders nodes + edges"): the
    // element must be present AND have actually painted (the live-context pixel
    // readback) — a blank canvas reads 0 pixels and cannot fake nodes + edges.
    if (!/class="[^"]*pob-tree-canvas/.test(html)) failures.push('no tree canvas painted');
    if (!(res.canvasPaintedPixels > 0))
      failures.push(`tree canvas blank (painted pixels: ${res.canvasPaintedPixels})`);
    // The minimap (gates.mjs VISUAL[5] "minimap present").
    if (!/data-minimap-viewport/.test(html)) failures.push('no minimap painted');
    // The node search box (gates.mjs VISUAL[5] "node search box").
    if (!/data-testid="tree-search"/.test(html)) failures.push('no node search box painted');
    return failures;
  },
};

/**
 * `--route <route> --check`: run the spec §6 path and assert the painted screen
 * carries every VISUAL[route].assert fact deterministically (a blank/stub harness
 * cannot pass). Keeps the screenshots in place and prints their paths + the assert
 * list so the caller (gate-agent / driver) can run the LLM vision step over them
 * (gemini-vision preferred, direct-vision FLAG if OAuth is unset — spec §6.1).
 */
async function checkRoute(route) {
  const asserts = ROUTE_ASSERTS[route];
  if (!asserts) {
    console.error(`VISUAL_CHECK_FAIL ${route}:\n  no deterministic asserts registered for route`);
    return 1;
  }
  const res = await runVisualCheck(route);
  const failures = asserts(res);
  // Non-blank screenshots (shared across routes).
  for (const s of res.shots) {
    if (!existsSync(s.path) || statSync(s.path).size < 3000)
      failures.push(`blank/missing screenshot ${s.path}`);
  }

  if (failures.length) {
    // Clean up the transient harness + screenshots and fail.
    await res.cleanup();
    console.error(`VISUAL_CHECK_FAIL ${route}:\n  ${failures.join('\n  ')}`);
    return 1;
  }
  console.log(`VISUAL_CHECK_OK ${route}`);
  console.log(`route: ${route}  screen: ${res.screen.name}`);
  console.log('asserts (verify these in the screenshots via vision):');
  for (const a of res.screen.assert) console.log(`  - ${a}`);
  console.log('screenshots:');
  for (const s of res.shots) console.log(`  ${s.dim}  ${s.path}`);
  // 🚩 gemini-vision OAuth is unset in this env (spec §6.1) — the precise LLM
  // verifier is unavailable, so the caller falls back to DIRECT vision over the
  // screenshots above and records a flag. The screenshots are LEFT in place for
  // that read; the transient harness/dist is removed below (working tree clean).
  await rm(res.workdir, { recursive: true, force: true });
  console.log(
    'FLAG gemini-vision-unavailable: verify the screenshots above by direct vision (spec §6.1).',
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const routeIdx = argv.indexOf('--route');
  if (routeIdx !== -1 && argv.includes('--check')) {
    const route = argv[routeIdx + 1];
    if (!route) {
      console.error('usage: visual-verify.mjs --route <route> --check');
      process.exit(2);
    }
    process.exit(await checkRoute(route));
  }
  const [mode, a, b, dim] = argv;
  if (mode === 'url') {
    const [w, h] = (dim || '1366x768').split('x').map(Number);
    await captureUrl(a, b, { width: w, height: h });
    console.log(`OK ${b}`);
  } else if (mode === 'tauri') {
    const r = captureTauri(a, b);
    if (!r.ok) {
      console.log(`TIER2_UNAVAILABLE: ${r.reason}`);
      process.exit(3);
    }
    console.log(`OK ${b}`);
  } else {
    console.error(
      'usage: visual-verify.mjs --route <route> --check | url <url> <out.png> [WxH] | tauri <bin> <out.png>',
    );
    process.exit(2);
  }
}
