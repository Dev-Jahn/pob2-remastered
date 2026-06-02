// @vitest-environment node
//
// Config scenario-preset integration guard (DESIGN §10.8 Config tab presets, §6.3
// config.setOption, §18 Phase 4 doneCriteria "주요 빌드 수정 flow가 기존 PoB 없이 가능").
//
// The shipped Config tab leads with §10.8 scenario presets (general mapping /
// bossing / shocked enemy / …), and applying one routes EACH of its
// `{ optionId, value }` entries through the session's config.setOption — which the
// real runner validates against the upstream ConfigOptions `var` set, rejecting an
// unknown optionId with a BUILD_PARSE_FAILED CoreError (modern_api.lua
// config.setOption). So a preset that names an option id the core does NOT define
// is a SILENTLY BROKEN feature: selecting it in the app rejects, never recalcs.
//
// The @pob2/ui config-vm unit tests only check the presets reduce to the right
// SHAPE — they use the preset's optionId strings as opaque fixtures, so a preset
// pointing at a non-existent core var passes those tests while being broken at
// runtime. This integration test closes that gap: it drives the REAL runner (the
// same createCoreClient the desktop host wires) and asserts EVERY non-custom
// preset's every option id genuinely resolves through config.setOption against the
// live build — exactly the call the app makes when the user picks that preset.
//
// This is a Node-environment suite (the runner is an out-of-process LuaJIT
// subprocess jsdom cannot host; DESIGN §5.1) — the `@vitest-environment node`
// pragma overrides the desktop package's default jsdom env for this file only.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createCoreClient, type CoreClient } from '@pob2/core-client';
import { CONFIG_PRESETS, presetToConfigOptions } from '@pob2/ui';

const here = dirname(fileURLToPath(import.meta.url));
// apps/desktop/src -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

describe('§10.8 Config scenario presets resolve against the real core (DESIGN §6.3 config.setOption)', () => {
  let client: CoreClient;
  let buildId: string;

  beforeAll(async () => {
    client = await createCoreClient();
    const loaded = await client.load(sampleXml);
    buildId = loaded.buildId;
  });

  afterAll(async () => {
    await client?.dispose();
  });

  // Every non-custom preset's option ids must be real upstream ConfigOptions vars:
  // applying the preset writes each through config.setOption, which the core only
  // accepts for a defined `var`. A typo'd id (e.g. conditionShockedEnemy instead of
  // the real conditionEnemyShocked) would reject here — the bug this guard catches.
  for (const preset of CONFIG_PRESETS.filter((p) => p.id !== 'custom')) {
    it(`applies the "${preset.id}" preset through config.setOption without an unknown-option rejection`, async () => {
      const payload = presetToConfigOptions(preset);
      expect(payload.length).toBeGreaterThan(0);
      for (const { optionId, value } of payload) {
        // A real option id echoes back; an unknown one rejects with a CoreClientError
        // (BUILD_PARSE_FAILED). We assert the genuine success path, so a broken preset
        // fails this test loudly instead of silently no-op'ing in the shipped app.
        const result = await client.setConfigOption(buildId, optionId, value);
        expect(result.optionId, `preset "${preset.id}" option "${optionId}"`).toBe(optionId);
      }
    });
  }
});
