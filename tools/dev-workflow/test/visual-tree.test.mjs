import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, rmSync } from 'node:fs';
import { VISUAL } from '../gates.mjs';
import { harnessFiles, runVisualCheck } from '../visual-verify.mjs';

// VISUAL[5] '/tree' — the §10.6 Passive Tree screen. These tests cover the spec §6
// verification path that `visual-verify.mjs --route /tree --check` runs: build a
// fixture harness that mounts the REAL @pob2/ui AppShell + TreePanel with §10.6
// representative data (an abridged tree graph + an allocated set + a hover delta),
// serve it, screenshot it at 1366×768 / 1366×1100, and assert the painted screen
// carries the VISUAL[5].assert facts — a canvas that actually drew nodes + edges,
// a minimap, and a node search box. The LLM vision step is layered on top
// (gemini-vision, or direct-vision FLAG); these tests pin the deterministic
// build/serve/capture + assert-fact core so a blank/stub screen cannot false-pass.

describe('VISUAL[5] /tree harness source', () => {
  it('targets the route registered in gates.mjs VISUAL', () => {
    const screen = VISUAL[5].find((s) => s.route === '/tree');
    expect(screen, 'gates.mjs VISUAL[5] defines a /tree screen').toBeTruthy();
  });

  it('mounts the real AppShell + TreePanel with §10.6 representative data', () => {
    const files = harnessFiles('/tree');
    // Entry imports the SHIPPED components (AppShell + TreePanel) + the SHIPPED tree
    // transforms, not a fake.
    expect(files.entry).toMatch(/from ['"]@pob2\/ui['"]/);
    expect(files.entry).toMatch(/TreePanel/);
    expect(files.entry).toMatch(/AppShell/);
    // The render graph + search index round-trip through the SHIPPED helpers so the
    // fixture is real §10.6 data, not a hand-faked TreeGraph.
    expect(files.entry).toMatch(/buildTreeGraph/);
    expect(files.entry).toMatch(/buildNodeSearchIndex/);
    // §10.6 representative data: an allocated set + a hover allocation delta (so the
    // canvas paints allocated/unallocated nodes and the delta panel paints chips).
    expect(files.entry).toMatch(/allocated/);
    expect(files.entry).toMatch(/hoverDeltas/);
    // The harness html mounts a #root (so the SPA actually paints).
    expect(files.html).toMatch(/id="root"/);
  });
});

const SHOTS = [];
afterAll(() => {
  for (const p of SHOTS) rmSync(p, { force: true });
});

describe('VISUAL[5] /tree build → serve → screenshot (spec §6)', () => {
  it('builds the harness, serves it, and captures a non-blank Passive Tree screen', async () => {
    const res = await runVisualCheck('/tree', { dims: ['1366x768', '1366x1100'] });
    try {
      // Two screenshots captured (1366×768 + 1366×1100 per the deliverable).
      expect(res.shots.length).toBe(2);
      for (const shot of res.shots) {
        SHOTS.push(shot.path);
        expect(existsSync(shot.path), `${shot.path} exists`).toBe(true);
        // A blank page is a few hundred bytes; a real painted screen is larger.
        expect(statSync(shot.path).size, `${shot.path} non-blank`).toBeGreaterThan(3000);
      }
      // The served harness DOM actually carries the VISUAL[5].assert facts — the
      // tree canvas, the minimap, and the node search box — so a stub harness that
      // forgot one of the §10.6 elements cannot false-pass the visual gate.
      const html = res.servedHtml;
      expect(/class="[^"]*pob-tree-canvas/.test(html), 'served DOM has a tree canvas').toBe(true);
      expect(/data-minimap-viewport/.test(html), 'served DOM has a minimap').toBe(true);
      expect(/data-testid="tree-search"/.test(html), 'served DOM has a search box').toBe(true);
      // The canvas DOM element alone cannot prove nodes + edges drew (canvas pixels
      // are not in the DOM). `runVisualCheck` reports the painted-pixel count read
      // back from the live 2D context — a blank canvas reads 0, so this is the fact
      // that makes a blank harness impossible to false-pass.
      expect(res.canvasPaintedPixels, 'canvas painted pixels reported').toBeGreaterThan(0);
    } finally {
      await res.cleanup();
    }
  }, 180000);

  it('leaves the working tree clean (fixture + dist removed after capture)', async () => {
    const res = await runVisualCheck('/tree', { dims: ['1366x768'] });
    res.shots.forEach((s) => SHOTS.push(s.path));
    await res.cleanup();
    // The transient harness workdir is gone after cleanup.
    expect(existsSync(res.workdir), 'harness workdir removed').toBe(false);
  }, 180000);
});
