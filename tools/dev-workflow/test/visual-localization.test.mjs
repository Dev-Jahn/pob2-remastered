import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, rmSync } from 'node:fs';
import { localizationScreen, harnessFiles, runVisualCheck } from '../visual-verify.mjs';

// '/settings/localization' — the §18 localization (coverage + manual review) screen.
// These tests cover the spec §6 verification path that
// `visual-verify.mjs --route /settings/localization --check` runs: build a fixture
// harness that mounts the REAL @pob2/ui CoverageDashboard + ManualReviewPanel with
// §8.7/§8.6 representative data (per-domain coverage incl. an UNDER-TARGET domain +
// a fuzzy/unsupported review queue), serve it, screenshot it at 1366×768 / 1366×1100,
// and assert the painted screen carries the localization-screen facts — per-domain
// coverage rows, under-target markers, and ko/en labels.
//
// IMPORTANT (deliverable): gates.mjs has NO VISUAL[6] entry and MUST NOT be modified,
// so this is a NON-BLOCKING best-effort check. The screen is therefore defined
// in-module (`localizationScreen`), not pulled from gates.mjs VISUAL. The LLM vision
// step is layered on top (gemini-vision, or direct-vision FLAG); these tests pin the
// deterministic build/serve/capture + assert-fact core so a blank/stub screen cannot
// false-pass.

describe('/settings/localization screen is defined in-module (no gates.mjs VISUAL[6])', () => {
  it('does not rely on a gates.mjs VISUAL[6] entry (gates.mjs unmodified)', async () => {
    const { VISUAL } = await import('../gates.mjs');
    // The deliverable forbids adding VISUAL[6] to gates.mjs — the localization visual
    // check is best-effort, so its screen lives in visual-verify.mjs instead.
    expect(VISUAL[6], 'gates.mjs has no VISUAL[6] entry').toBeUndefined();
  });

  it('registers a /settings/localization screen with its assert facts', () => {
    expect(localizationScreen, 'visual-verify exports the localization screen').toBeTruthy();
    expect(localizationScreen.route).toBe('/settings/localization');
    expect(localizationScreen.name).toBe('localization');
    // The assert list names the localization-screen facts a vision read verifies.
    const asserts = localizationScreen.assert.join(' ').toLowerCase();
    expect(asserts).toMatch(/coverage/);
    expect(asserts).toMatch(/under.?target/);
    expect(asserts).toMatch(/review/);
  });
});

describe('/settings/localization harness source', () => {
  it('mounts the real CoverageDashboard + ManualReviewPanel with §8.7/§8.6 data', () => {
    const files = harnessFiles('/settings/localization');
    // Entry imports the SHIPPED components (AppShell + the two localization screens),
    // not a fake.
    expect(files.entry).toMatch(/from ['"]@pob2\/ui['"]/);
    expect(files.entry).toMatch(/CoverageDashboard/);
    expect(files.entry).toMatch(/ManualReviewPanel/);
    expect(files.entry).toMatch(/AppShell/);
    // §8.7 representative coverage data round-trips through the SHIPPED view-model so
    // the dashboard rows are real loc-coverage numbers, not hand-faked rows. It must
    // include at least one UNDER-TARGET domain so the under-target marker paints.
    expect(files.entry).toMatch(/buildCoverageDashboardModel|coverage=/);
    expect(files.entry).toMatch(/under-target|underTarget|percent: 0|0,\s*total: 0/);
    // §8.6 representative review queue: a fuzzy term with candidate ids + an
    // unsupported clipboard line, so the review list paints rows.
    expect(files.entry).toMatch(/candidateUpstreamIds/);
    expect(files.entry).toMatch(/unsupportedClipboardLines/);
    // ko/en bilingual: the screen renders under locale ko-KR (the i18n labels carry
    // the English alias in parens, e.g. "UI 문자열 (UI Strings)").
    expect(files.entry).toMatch(/ko-KR/);
    // The harness html mounts a #root (so the SPA actually paints).
    expect(files.html).toMatch(/id="root"/);
  });
});

const SHOTS = [];
afterAll(() => {
  for (const p of SHOTS) rmSync(p, { force: true });
});

describe('/settings/localization build → serve → screenshot (spec §6)', () => {
  it('builds the harness, serves it, and captures a non-blank localization screen', async () => {
    const res = await runVisualCheck('/settings/localization', { dims: ['1366x768', '1366x1100'] });
    try {
      // Two screenshots captured (1366×768 + 1366×1100 per the deliverable).
      expect(res.shots.length).toBe(2);
      for (const shot of res.shots) {
        SHOTS.push(shot.path);
        expect(existsSync(shot.path), `${shot.path} exists`).toBe(true);
        // A blank page is a few hundred bytes; a real painted screen is larger.
        expect(statSync(shot.path).size, `${shot.path} non-blank`).toBeGreaterThan(3000);
      }
      // The served harness DOM actually carries the localization-screen facts — a
      // per-domain coverage table, an under-target status marker, the review queue,
      // and ko/en bilingual labels — so a stub/blank harness cannot false-pass.
      const html = res.servedHtml;
      // Per-domain coverage rows: the table + a data-domain row for every §8.7 domain.
      expect(/class="[^"]*pob-coverage__table/.test(html), 'served DOM has a coverage table').toBe(
        true,
      );
      for (const domain of ['ui', 'keyword', 'skill', 'mod', 'stat']) {
        expect(
          new RegExp(`data-domain="${domain}"`).test(html),
          `served DOM has the ${domain} coverage row`,
        ).toBe(true);
      }
      // An under-target marker (§11.3: status carries a data-attr AND localized text).
      expect(/data-status="under-target"/.test(html), 'served DOM has an under-target row').toBe(
        true,
      );
      // The manual review queue (the §8.6 review UI).
      expect(/class="[^"]*pob-review/.test(html), 'served DOM has the review panel').toBe(true);
      // ko/en bilingual labels: the ko-KR i18n strings carry the English alias in
      // parens (e.g. "번역 커버리지 (Translation Coverage)").
      expect(/\(Translation Coverage\)/.test(html), 'served DOM has ko/en bilingual labels').toBe(
        true,
      );
    } finally {
      await res.cleanup();
    }
  }, 180000);

  it('leaves the working tree clean (fixture + dist removed after capture)', async () => {
    const res = await runVisualCheck('/settings/localization', { dims: ['1366x768'] });
    res.shots.forEach((s) => SHOTS.push(s.path));
    await res.cleanup();
    // The transient harness workdir is gone after cleanup.
    expect(existsSync(res.workdir), 'harness workdir removed').toBe(false);
  }, 180000);
});
