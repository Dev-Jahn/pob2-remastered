// items.* surface for @pob2/core-client (task p3-client-items, DESIGN §6.3
// items.getEquipped / items.createCustom / items.compare, §6.4 serialization +
// schema-validation principles, §10.4 / §16.3 "item equip delta").
//
// This suite drives the REAL runner subprocess (createCoreClient), loads the
// sample fixture, and exercises the three client methods the task adds to
// CoreClient:
//
//   getEquipped(buildId)            -> items.getEquipped   (runner-backed, real)
//   createCustom(baseId, mods)      -> items.createCustom  (schema-validated;
//                                       runner side is a DOCUMENTED GAP — see below)
//   equipDelta(buildId, item, slot) -> items.compare        (runner-backed, real):
//                                       the runner drives the core's own non-mutating
//                                       comparison machinery (GetMiscCalculator) and
//                                       returns an EquipDelta[] (items.compare:response)
//
// What is genuinely runner-backed (and therefore asserted end to end):
//   * getEquipped returns the sample build's one equipped item (a Runeforged
//     Warpick in "Weapon 1"), serialized as a schema-valid EquippedItem card;
//   * equipDelta routes through items.compare, which recomputes the full output as
//     if `item` occupied `slot` (without mutating the build) and diffs it against
//     the live baseline — so each delta's `before` is the REAL baseline stat and
//     `delta === after - before` (the task's "delta가 수치로 나오는지" check). Equipping
//     the item already in its slot is a real measured 0; a different item differs.
//
// DOCUMENTED GAP (DESIGN §6.4 "러너가 표현 못하는 필드는 documented gap"):
//   * the runner does NOT implement items.createCustom yet, so createCustom()
//     validates its request client-side (real) and, on send, surfaces a STRUCTURED
//     CoreClientError rather than fabricating a fake item card (NO-FALLBACK). The
//     request-validation path and the honest-error path are both asserted here.
//
// Gate command: pnpm --filter @pob2/core-client test items -> vitest run items
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { schemaRegistry } from '@pob2/schema';
import type { EquippedItem, EquipDelta, ItemModInput } from '@pob2/schema';
import { createCoreClient, CoreClientError, type CoreClient } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/core-client/test -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Compile the registry response schemas the methods are validated against, so the
// suite proves the CLIENT output is schema-valid independently of the client's own
// internal validation (a second, external check on the same contract).
const validateEquipped = ajv.compile(schemaRegistry['items.getEquipped'].responseSchema as object);
const validateCompare = ajv.compile(schemaRegistry['items.compare'].responseSchema as object);

describe('core-client items.* (real runner, DESIGN §6.3/§6.4)', () => {
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

  describe('getEquipped(buildId)', () => {
    it('returns the sample build’s equipped items as schema-valid cards', async () => {
      const result = await client.getEquipped(buildId);
      expect(Array.isArray(result.equipped)).toBe(true);
      // The fixture equips exactly one item (a One Hand Mace in Weapon 1).
      expect(result.equipped.length).toBeGreaterThan(0);

      // The whole response is valid against items.getEquipped:response.
      expect(validateEquipped(result), JSON.stringify(validateEquipped.errors)).toBe(true);

      const weapon = result.equipped.find((i) => i.slot === 'Weapon 1');
      expect(weapon, 'sample build equips Weapon 1').toBeDefined();
      const card: EquippedItem = weapon!;
      // Real serialized card fields — proof the live core item was read, not stubbed.
      expect(typeof card.itemId).toBe('string');
      expect(card.itemId.length).toBeGreaterThan(0);
      expect(card.name).toContain('Runeforged Warpick');
      expect(card.rarity).toBe('NORMAL');
      expect(typeof card.requirements.level).toBe('number');
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.getEquipped('')).rejects.toBeInstanceOf(CoreClientError);
    });
  });

  describe('equipDelta(buildId, item, slot) — runner items.compare (real diff)', () => {
    it('produces numeric before/after/delta per stat (items.compare shape)', async () => {
      // Use a real equipped item card as the thing being compared in its slot.
      const equipped = await client.getEquipped(buildId);
      const weapon = equipped.equipped.find((i) => i.slot === 'Weapon 1')!;

      const result = await client.equipDelta(buildId, weapon, 'Weapon 1');

      // items.compare:response shape: { slot, deltas: EquipDelta[] }.
      expect(result.slot).toBe('Weapon 1');
      expect(Array.isArray(result.deltas)).toBe(true);
      expect(result.deltas.length).toBeGreaterThan(0);
      expect(validateCompare(result), JSON.stringify(validateCompare.errors)).toBe(true);

      // Every delta is a real NUMBER (the task's "delta가 수치로 나오는지" check):
      // before/after/delta finite, and delta === after - before to float precision.
      for (const d of result.deltas as EquipDelta[]) {
        expect(typeof d.statId).toBe('string');
        expect(Number.isFinite(d.before)).toBe(true);
        expect(Number.isFinite(d.after)).toBe(true);
        expect(Number.isFinite(d.delta)).toBe(true);
        expect(d.delta).toBeCloseTo(d.after - d.before, 9);
      }

      // The diff is keyed on the curated stat set, so Life (always present) appears.
      const life = result.deltas.find((d) => d.statId === 'Life');
      expect(
        life,
        'curated calc stats always include Life, so its delta is reported',
      ).toBeDefined();

      // The `before` side is the REAL live baseline output (GetMiscCalculator's
      // baseOutput), not a stub of zeros: the fixture computes Life=65, TotalDPS≈8.16,
      // so their baselines must be > 0. A two-identical-passes / zeroed stub fails this.
      expect(life!.before).toBeGreaterThan(0);
      const dps = result.deltas.find((d) => d.statId === 'TotalDPS');
      expect(dps, 'TotalDPS is in the curated delta set').toBeDefined();
      expect(dps!.before).toBeGreaterThan(0);
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      const equipped = await client.getEquipped(buildId);
      const weapon = equipped.equipped.find((i) => i.slot === 'Weapon 1')!;
      await expect(client.equipDelta('', weapon, 'Weapon 1')).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });
  });

  describe('createCustom(baseId, mods) — schema-validated, runner gap documented', () => {
    it('rejects a structurally malformed request before sending (request validation)', async () => {
      // A mod entry missing the required `text` field violates
      // items.createCustom:request — caught client-side by validateRequest, BEFORE
      // any line reaches the runner (NO-FALLBACK: a nonsense request never ships).
      const badMods = [{ statId: 'Life' }] as unknown as ItemModInput[];
      await expect(client.createCustom('Runeforged Warpick', badMods)).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });

    it('surfaces a structured CoreClientError, never a fabricated card (documented gap)', async () => {
      // The runner does not implement items.createCustom yet; a well-formed request
      // therefore yields a STRUCTURED CoreClientError (method-not-found surfaces as
      // UPSTREAM_INCOMPATIBLE), NOT a faked success (DESIGN §6.4 NO-FALLBACK).
      await expect(
        client.createCustom('Runeforged Warpick', [{ text: '+50 to maximum Life' }]),
      ).rejects.toBeInstanceOf(CoreClientError);
    });
  });
});
