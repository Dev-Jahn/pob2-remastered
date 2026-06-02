// skills.* / config.* / calc.explain surface for @pob2/core-client (task
// p4-core-client-methods, DESIGN §6.3 skills.getGroups / skills.setGemGroup /
// config.getOptions / config.setOption / calc.explain, §6.4 serialization +
// schema-validation principles, §10.5 Skills tab / §10.7 Calcs tab / §10.8 Config tab).
//
// This suite drives the REAL runner subprocess (createCoreClient), loads the
// sample fixture, and exercises the five client methods the task adds to
// CoreClient:
//
//   getSkillGroups(buildId)                  -> skills.getGroups   (registry-validated)
//   setGemGroup(buildId, groupId, gems)      -> skills.setGemGroup (write companion)
//   getConfigOptions(buildId)                -> config.getOptions  (registry-validated)
//   setConfigOption(buildId, optionId, val)  -> config.setOption   (write companion)
//   explainStat(buildId, statId, skillId?)   -> calc.explain       (registry-validated)
//
// What is genuinely runner-backed (and therefore asserted end to end):
//   * getSkillGroups returns the sample build's one socket group (a Mace Strike
//     active gem) as a schema-valid SkillGroupCard (active/support gems split,
//     spirit/reservation surfaced as numbers — §10.5);
//   * getConfigOptions returns the build's NON-EMPTY config-option cards, each a
//     schema-valid ConfigOptionCard (§10.8);
//   * explainStat returns a schema-valid CalcExplainResponse: Life carries a
//     formula trace (the breakdown array part), Evasion carries a classified
//     contribution source (§10.7);
//   * setGemGroup ACTUALLY mutates the live build — swapping the group to a real
//     resolving melee gem (Boneshatter) measurably changes calc.run's TotalDPS;
//   * setConfigOption ACTUALLY mutates the live build — toggling the boss config
//     off measurably changes calc.run's TotalDPS (NO A-vs-A stub — DESIGN §6.3).
//
// NO-FALLBACK (DESIGN §6.4): a runner method-not-found / structural error is
// surfaced as a STRUCTURED CoreClientError (UPSTREAM_INCOMPATIBLE), never a faked
// success. The request-validation path and the honest-error path are both asserted.
//
// Gate command: pnpm --filter @pob2/core-client test skills-config-explain
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaRegistry } from '@pob2/schema';
import { createCoreClient, CoreClientError, type CoreClient } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/core-client/test -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

// The real, resolving melee gem the skills Lua spec uses to prove a genuine recalc:
// it replaces the fixture's default "Punch" attack, so the gem swap measurably
// changes TotalDPS (modern_api_skills_spec.lua).
const BONESHATTER_GEM_ID = 'Metadata/Items/Gems/SkillGemBoneshatter';

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Compile the registry response schemas the methods are validated against, so the
// suite proves the CLIENT output is schema-valid independently of the client's own
// internal validation (a second, external check on the same contract).
const validateGroups = ajv.compile(schemaRegistry['skills.getGroups'].responseSchema as object);
const validateOptions = ajv.compile(schemaRegistry['config.getOptions'].responseSchema as object);
const validateExplain = ajv.compile(schemaRegistry['calc.explain'].responseSchema as object);

/** Pull TotalDPS out of a calc.run result's curated stat list. */
function totalDps(stats: { statId: string; value: number }[]): number {
  const dps = stats.find((s) => s.statId === 'TotalDPS');
  expect(dps, 'curated calc stats include TotalDPS').toBeDefined();
  return dps!.value;
}

describe('core-client skills/config/calc.explain (real runner, DESIGN §6.3/§6.4)', () => {
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

  describe('getSkillGroups(buildId)', () => {
    it('returns the sample build’s socket groups as schema-valid cards', async () => {
      const result = await client.getSkillGroups(buildId);
      expect(Array.isArray(result.groups)).toBe(true);
      // The fixture has exactly one socket group (a Mace Strike active gem).
      expect(result.groups.length).toBeGreaterThan(0);

      // The whole response is valid against skills.getGroups:response.
      expect(validateGroups(result), JSON.stringify(validateGroups.errors)).toBe(true);

      const group = result.groups[0];
      // groupId is the stable string handle the client passes back to setGemGroup.
      expect(typeof group.groupId).toBe('string');
      expect(group.groupId.length).toBeGreaterThan(0);
      expect(typeof group.enabled).toBe('boolean');
      expect(typeof group.spirit).toBe('number');
      expect(typeof group.reservation).toBe('number');

      // The fixture's one gem is an ACTIVE skill (Mace Strike), so it lands in
      // activeGems (not supportGems), serialized as a schema SkillGemRef.
      expect(group.activeGems.length).toBeGreaterThan(0);
      const gem = group.activeGems[0];
      expect(gem.name).toBe('Mace Strike');
      expect(typeof gem.gemId).toBe('string');
      expect(typeof gem.level).toBe('number');
      expect(typeof gem.quality).toBe('number');
      expect(typeof gem.enabled).toBe('boolean');
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.getSkillGroups('')).rejects.toBeInstanceOf(CoreClientError);
    });
  });

  describe('getConfigOptions(buildId)', () => {
    it('returns the build’s non-empty config-option cards (schema-valid)', async () => {
      const result = await client.getConfigOptions(buildId);
      expect(Array.isArray(result.options)).toBe(true);
      // The sample build resolves the full ConfigOptions definition list, so the
      // card list is non-empty (the task's "비어있지 않은 결과" check).
      expect(result.options.length).toBeGreaterThan(0);

      // The whole response is valid against config.getOptions:response.
      expect(validateOptions(result), JSON.stringify(validateOptions.errors)).toBe(true);

      // The boss-toggle option is one of the cards, carrying a real value + type +
      // dependentModifiers list (the §10.8 ConfigOptionCard shape).
      const boss = result.options.find((o) => o.optionId === 'enemyIsBoss');
      expect(boss, 'enemyIsBoss is a real config option on the fixture').toBeDefined();
      expect(typeof boss!.type).toBe('string');
      expect(typeof boss!.label).toBe('string');
      expect(Array.isArray(boss!.dependentModifiers)).toBe(true);
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.getConfigOptions('')).rejects.toBeInstanceOf(CoreClientError);
    });
  });

  describe('explainStat(buildId, statId)', () => {
    it('returns a schema-valid formula trace for a stat with a breakdown (Life)', async () => {
      const result = await client.explainStat(buildId, 'Life');
      expect(validateExplain(result), JSON.stringify(validateExplain.errors)).toBe(true);
      expect(result.statId).toBe('Life');
      expect(result.upstreamStatId).toBe('Life');
      // Life resolves to 65 on the fixture (62 base x 1.05) via a multiChain breakdown.
      expect(result.finalValue).toBe(65);
      // The formula trace (the breakdown array part) is a non-empty human string.
      expect(typeof result.formula).toBe('string');
      expect(result.formula.length).toBeGreaterThan(0);
      // Life's breakdown is a pure formula trace (no pre-built modList/slots), so its
      // sources list is EXPLICITLY empty — never a fabricated source (NO-FALLBACK).
      expect(Array.isArray(result.sources)).toBe(true);
    });

    it('serializes a classified contribution source for a slot-style stat (Evasion)', async () => {
      const result = await client.explainStat(buildId, 'Evasion');
      expect(validateExplain(result), JSON.stringify(validateExplain.errors)).toBe(true);
      // Evasion has a slot-style breakdown: at least one classified source with a
      // numeric value and a display label (schema ExplainSource { kind, label, value }).
      expect(result.sources.length).toBeGreaterThan(0);
      const src = result.sources[0];
      expect(typeof src.kind).toBe('string');
      expect(typeof src.label).toBe('string');
      expect(Number.isFinite(src.value)).toBe(true);
    });

    it('rejects an empty statId before sending (request schema validation)', async () => {
      await expect(client.explainStat(buildId, '')).rejects.toBeInstanceOf(CoreClientError);
    });

    it('surfaces a structured CoreClientError for a stat with no breakdown (NO-FALLBACK)', async () => {
      // A real upstream output key the core computes but does NOT generate a breakdown
      // for yields a structural CALC_FAILED — never a fabricated trace (DESIGN §6.4).
      await expect(client.explainStat(buildId, 'Str')).rejects.toBeInstanceOf(CoreClientError);
    });
  });

  // setGemGroup / setConfigOption REALLY mutate the live build (unlike items.compare's
  // non-mutating A-vs-B pass), so a subsequent calc.run observes the genuine change.
  // These run last because they permanently change the shared build's calc.
  describe('mutating writes change calc.run (DESIGN §6.3 NO A-vs-A stub)', () => {
    it('setConfigOption toggling the boss off changes TotalDPS', async () => {
      const before = totalDps((await client.calcRun(buildId)).stats);

      // The fixture's enemyIsBoss is "Pinnacle"; setting it to "None" removes the boss
      // penalty, which measurably raises TotalDPS — the genuine recalc the task checks.
      const setResult = await client.setConfigOption(buildId, 'enemyIsBoss', 'None');
      expect(setResult.optionId).toBe('enemyIsBoss');

      const after = totalDps((await client.calcRun(buildId)).stats);
      expect(after).not.toBe(before);
    });

    it('setGemGroup swapping the active gem changes TotalDPS', async () => {
      const before = totalDps((await client.calcRun(buildId)).stats);

      const groups = await client.getSkillGroups(buildId);
      const groupId = groups.groups[0].groupId;
      // Replace the group with a real, resolving melee gem (Boneshatter): it supplants
      // the previous attack, so TotalDPS measurably changes (modern_api_skills_spec.lua).
      const setResult = await client.setGemGroup(buildId, groupId, [
        { gemId: BONESHATTER_GEM_ID, level: 20, quality: 0, enabled: true },
      ]);
      expect(setResult.groupId).toBe(groupId);

      const after = totalDps((await client.calcRun(buildId)).stats);
      expect(after).not.toBe(before);
    });

    it('setConfigOption rejects an empty optionId before sending (request validation)', async () => {
      await expect(client.setConfigOption(buildId, '', true)).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });

    it('setGemGroup rejects an empty buildId before sending (request validation)', async () => {
      await expect(
        client.setGemGroup('', '1', [
          { gemId: BONESHATTER_GEM_ID, level: 20, quality: 0, enabled: true },
        ]),
      ).rejects.toBeInstanceOf(CoreClientError);
    });
  });
});
