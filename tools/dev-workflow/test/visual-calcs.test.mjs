import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, rmSync } from 'node:fs';
import { VISUAL } from '../gates.mjs';
import { harnessFiles, runVisualCheck } from '../visual-verify.mjs';

// VISUAL[4] '/calcs' — the §10.7 Calcs breakdown screen. These tests cover the
// spec §6 verification path that `visual-verify.mjs --route /calcs --check` runs:
// build a fixture harness that mounts the REAL @pob2/ui CalcsPanel with §10.7
// representative data (multiple stats + contribution sources + formula trace),
// serve it, screenshot it at 1366×768 / 1366×1100, and assert the screen carries
// the VISUAL[4].assert facts. The LLM vision step is layered on top (gemini-vision,
// or direct-vision FLAG); these tests pin the deterministic build/serve/capture +
// assert-fact core so a blank/stub screen cannot false-pass.

describe('VISUAL[4] /calcs harness source', () => {
  it('targets the route registered in gates.mjs VISUAL', () => {
    const screen = VISUAL[4].find((s) => s.route === '/calcs');
    expect(screen, 'gates.mjs VISUAL[4] defines a /calcs screen').toBeTruthy();
  });

  it('mounts the real CalcsPanel with §10.7 representative data', () => {
    const files = harnessFiles('/calcs');
    // Entry imports the SHIPPED components (AppShell + CalcsPanel), not a fake.
    expect(files.entry).toMatch(/from ['"]@pob2\/ui['"]/);
    expect(files.entry).toMatch(/CalcsPanel/);
    expect(files.entry).toMatch(/AppShell/);
    // §10.7 representative data: the four breakdown sections, several stats with a
    // contribution source list and a formula trace (the VISUAL[4] assert facts).
    expect(files.entry).toMatch(/buildCalcsModel/);
    expect(files.entry).toMatch(/sources:/); // 기여 source list
    expect(files.entry).toMatch(/formula:/); // formula trace
    // The harness html mounts a #root (so the SPA actually paints).
    expect(files.html).toMatch(/id="root"/);
  });
});

const SHOTS = [];
afterAll(() => {
  for (const p of SHOTS) rmSync(p, { force: true });
});

describe('VISUAL[4] /calcs build → serve → screenshot (spec §6)', () => {
  it('builds the harness, serves it, and captures a non-blank Calcs breakdown screen', async () => {
    const res = await runVisualCheck('/calcs', { dims: ['1366x768', '1366x1100'] });
    try {
      // Two screenshots captured (1366×768 + 1366×1100 per the deliverable).
      expect(res.shots.length).toBe(2);
      for (const shot of res.shots) {
        SHOTS.push(shot.path);
        expect(existsSync(shot.path), `${shot.path} exists`).toBe(true);
        // A blank page is a few hundred bytes; a real painted screen is larger.
        expect(statSync(shot.path).size, `${shot.path} non-blank`).toBeGreaterThan(3000);
      }
      // The served harness DOM actually carries the VISUAL[4].assert facts — the
      // four §10.7 sections, a classified contribution source, and a formula
      // trace — so a stub/blank harness cannot false-pass the visual gate.
      const html = res.servedHtml.toLowerCase();
      for (const section of ['summary', 'offence', 'defence', 'resource']) {
        expect(html.includes(section), `served DOM has ${section} section`).toBe(true);
      }
      expect(/data-source-kind=/.test(res.servedHtml), 'served DOM has a source list').toBe(true);
      expect(/data-formula/.test(res.servedHtml), 'served DOM has a formula trace').toBe(true);
    } finally {
      await res.cleanup();
    }
  }, 180000);

  it('leaves the working tree clean (fixture + dist removed after capture)', async () => {
    const res = await runVisualCheck('/calcs', { dims: ['1366x768'] });
    res.shots.forEach((s) => SHOTS.push(s.path));
    await res.cleanup();
    // The transient harness workdir is gone after cleanup.
    expect(existsSync(res.workdir), 'harness workdir removed').toBe(false);
  }, 180000);
});
