// Overview view-model test (DESIGN §10.3 Overview tab cards).
//
// `buildOverviewModel` is a pure, framework-free transform: it takes a calc.run
// result (a `CalcRunResponse` / `StatResult[]` from @pob2/schema) plus a
// `BuildSummary` and produces the Overview card model — an offence card, a
// defence card, and a resource card.
//
// The fixture below mirrors `tools/golden-tests/baselines/single-skill-mace.json`
// (a Warrior with one mace + a single Mace Strike), serialized as the curated
// `StatResult[]` the core's calc.run actually emits. Crucially that build emits
// NO crit / attack-cast-rate / reservation stats, so those fields must surface
// an explicit `missing` marker — NOT a fabricated `0` (the §10.3 + NO-FALLBACK
// requirement this suite exists to pin).
import { describe, it, expect } from 'vitest';
import type { CalcRunResponse, StatResult } from '@pob2/schema';
import { buildOverviewModel } from '../src/index.js';
import type { BuildSummary, OverviewField } from '../src/index.js';

// The single-skill-mace baseline values, as the {statId,value,label} entries the
// core emits via calc.run. Only the stats this build actually produces are
// present (NO-FALLBACK): no CritChance / CritMultiplier / Speed / *Reserved.
const SINGLE_SKILL_MACE_STATS: StatResult[] = [
  { statId: 'Life', value: 82, label: 'Life' },
  { statId: 'Mana', value: 50, label: 'Mana' },
  { statId: 'EnergyShield', value: 0, label: 'Energy Shield' },
  { statId: 'Spirit', value: 100, label: 'Spirit' },
  { statId: 'TotalDPS', value: 2.8933100625, label: 'Total DPS' },
  { statId: 'AverageDamage', value: 1.99538625, label: 'Average Damage' },
  { statId: 'Armour', value: 0, label: 'Armour' },
  { statId: 'Evasion', value: 7, label: 'Evasion' },
  { statId: 'TotalEHP', value: 60.248810219587, label: 'Effective Hit Pool' },
  { statId: 'FireResist', value: -50, label: 'Fire Resistance' },
  { statId: 'ColdResist', value: -50, label: 'Cold Resistance' },
  { statId: 'LightningResist', value: -50, label: 'Lightning Resistance' },
  { statId: 'ChaosResist', value: 0, label: 'Chaos Resistance' },
];

const CALC_RUN: CalcRunResponse = {
  buildId: 'single-skill-mace',
  stats: SINGLE_SKILL_MACE_STATS,
};

const SUMMARY: BuildSummary = {
  className: 'Warrior',
  level: 1,
  itemCount: 1,
};

// Locate the field with a given statId in a card's ordered field list.
function field(fields: OverviewField[], statId: string): OverviewField {
  const found = fields.find((f) => f.statId === statId);
  if (!found) throw new Error(`no field for statId ${statId}`);
  return found;
}

describe('buildOverviewModel', () => {
  const model = buildOverviewModel(CALC_RUN, SUMMARY);

  it('carries the build summary through unchanged', () => {
    expect(model.summary).toEqual(SUMMARY);
  });

  describe('offence card (§10.3: TotalDPS, AverageDamage, crit, attack/cast rate)', () => {
    const card = model.offence;

    it('maps present stats to their exact stat id + value', () => {
      const dps = field(card.fields, 'TotalDPS');
      expect(dps.present).toBe(true);
      expect(dps.value).toBe(2.8933100625);

      const avg = field(card.fields, 'AverageDamage');
      expect(avg.present).toBe(true);
      expect(avg.value).toBe(1.99538625);
    });

    it('surfaces crit as missing (not 0) when the build emits no crit stats', () => {
      const crit = field(card.fields, 'CritChance');
      expect(crit.present).toBe(false);
      expect(crit.missing).toBe(true);
      expect(crit.value).toBeUndefined();
    });

    it('surfaces attack/cast rate as missing (not 0) when absent', () => {
      const rate = field(card.fields, 'Speed');
      expect(rate.present).toBe(false);
      expect(rate.missing).toBe(true);
      expect(rate.value).toBeUndefined();
    });
  });

  describe('defence card (§10.3: Life/Mana/ES, Armour/Evasion, resists, EHP)', () => {
    const card = model.defence;

    it('maps the life/mana/ES pools to their exact ids + values', () => {
      expect(field(card.fields, 'Life').value).toBe(82);
      expect(field(card.fields, 'Mana').value).toBe(50);
      expect(field(card.fields, 'EnergyShield').value).toBe(0);
    });

    it('keeps a real 0 (EnergyShield, Armour) present — 0 is a value, not missing', () => {
      const es = field(card.fields, 'EnergyShield');
      expect(es.present).toBe(true);
      expect(es.missing).toBeUndefined();
      expect(field(card.fields, 'Armour').present).toBe(true);
    });

    it('maps armour/evasion and the four resistances', () => {
      expect(field(card.fields, 'Armour').value).toBe(0);
      expect(field(card.fields, 'Evasion').value).toBe(7);
      expect(field(card.fields, 'FireResist').value).toBe(-50);
      expect(field(card.fields, 'ColdResist').value).toBe(-50);
      expect(field(card.fields, 'LightningResist').value).toBe(-50);
      expect(field(card.fields, 'ChaosResist').value).toBe(0);
    });

    it('maps the total effective hit pool', () => {
      expect(field(card.fields, 'TotalEHP').value).toBe(60.248810219587);
    });
  });

  describe('resource card (§10.3: reserved/unreserved Spirit/Mana)', () => {
    const card = model.resource;

    it('maps Spirit (the only reservation stat this build emits)', () => {
      const spirit = field(card.fields, 'Spirit');
      expect(spirit.present).toBe(true);
      expect(spirit.value).toBe(100);
    });

    it('surfaces reserved/unreserved Spirit & Mana as missing when absent', () => {
      for (const id of ['SpiritReserved', 'ManaReserved', 'ManaUnreserved']) {
        const f = field(card.fields, id);
        expect(f.present).toBe(false);
        expect(f.missing).toBe(true);
        expect(f.value).toBeUndefined();
      }
    });
  });

  it('never fabricates a value for a missing stat across any card', () => {
    const allFields = [...model.offence.fields, ...model.defence.fields, ...model.resource.fields];
    for (const f of allFields) {
      if (!f.present) {
        expect(f.missing).toBe(true);
        expect(f.value).toBeUndefined();
      } else {
        expect(typeof f.value).toBe('number');
      }
    }
  });
});
