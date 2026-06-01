// Warning view-model test (DESIGN §10.3 warning card, §8.6 step 4, §10.4
// unsupported badge).
//
// `buildWarningModel` is a pure, framework-free transform: it takes a calc.run
// result (a `CalcRunResponse` / `StatResult[]` from @pob2/schema) and the
// `unsupported[]` lines from `items.parseClipboard`, and produces the Overview
// warning-card list of DESIGN §10.3:
//   - resistance-below-cap warnings (FireResist/ColdResist/LightningResist below
//     their max cap), and
//   - a passthrough channel for unsupported-modifier / parse-failed lines, echoed
//     verbatim (§8.6 step 4 "unknown line은 보존").
//
// Each warning carries a STABLE code, a severity, and an i18n key (a `StringKey`
// resolved via the package `t` resolver — never hardcoded Korean). This suite
// pins the three behaviours the task names: capped resistances produce no
// warning, a -50 resist produces one resist warning, and unsupported lines are
// echoed verbatim.
import { describe, it, expect } from 'vitest';
import type { CalcRunResponse, StatResult } from '@pob2/schema';
import { buildWarningModel, t } from '../src/index.js';
import type { Warning, StringKey } from '../src/index.js';

// A build whose three elemental resistances all sit exactly at the default game
// max (75): there is nothing below cap, so no resist warning must be emitted.
const CAPPED_STATS: StatResult[] = [
  { statId: 'FireResist', value: 75, label: 'Fire Resistance' },
  { statId: 'ColdResist', value: 75, label: 'Cold Resistance' },
  { statId: 'LightningResist', value: 75, label: 'Lightning Resistance' },
  { statId: 'ChaosResist', value: 0, label: 'Chaos Resistance' },
];

// The single-skill-mace baseline: every elemental resist is -50 (well below the
// 75 cap), so each produces a resist warning.
const UNCAPPED_STATS: StatResult[] = [
  { statId: 'FireResist', value: -50, label: 'Fire Resistance' },
  { statId: 'ColdResist', value: -50, label: 'Cold Resistance' },
  { statId: 'LightningResist', value: -50, label: 'Lightning Resistance' },
  { statId: 'ChaosResist', value: 0, label: 'Chaos Resistance' },
];

function calc(stats: StatResult[]): CalcRunResponse {
  return { buildId: 'b', stats };
}

function codes(warnings: Warning[]): string[] {
  return warnings.map((w) => w.code);
}

describe('buildWarningModel', () => {
  describe('resistance-below-cap (§10.3 저항 부족)', () => {
    it('produces NO warning when all resistances sit at the cap', () => {
      const model = buildWarningModel({ calc: calc(CAPPED_STATS), unsupported: [] });
      expect(model.warnings).toEqual([]);
    });

    it('produces one resist warning per element below cap', () => {
      const model = buildWarningModel({ calc: calc(UNCAPPED_STATS), unsupported: [] });
      const resistWarnings = model.warnings.filter((w) => w.code.startsWith('resist-below-cap'));
      expect(resistWarnings).toHaveLength(3);
    });

    it('produces a single resist warning for one -50 resist (others capped)', () => {
      const stats: StatResult[] = [
        { statId: 'FireResist', value: -50, label: 'Fire Resistance' },
        { statId: 'ColdResist', value: 75, label: 'Cold Resistance' },
        { statId: 'LightningResist', value: 75, label: 'Lightning Resistance' },
      ];
      const model = buildWarningModel({ calc: calc(stats), unsupported: [] });
      const resistWarnings = model.warnings.filter((w) => w.code.startsWith('resist-below-cap'));
      expect(resistWarnings).toHaveLength(1);

      const fire = resistWarnings[0];
      // Stable, element-scoped code; the deficit detail carries the real value
      // and the cap it fell short of (no fabricated numbers).
      expect(fire.code).toBe('resist-below-cap:FireResist');
      expect(fire.severity).toBe('warning');
      expect(fire.statId).toBe('FireResist');
      expect(fire.value).toBe(-50);
      expect(fire.cap).toBe(75);
    });

    it('labels every resist warning via the i18n key (resolver, not hardcoded Korean)', () => {
      const model = buildWarningModel({ calc: calc(UNCAPPED_STATS), unsupported: [] });
      for (const w of model.warnings) {
        const key: StringKey = w.i18nKey;
        expect(key).toBe('warning.resistanceLow');
        // The key resolves through the real resolver in both locales (the model
        // never carries pre-rendered Korean text).
        expect(t('ko-KR', key)).toContain('저항');
        expect(t('en-US', key)).toBe('Resistance Below Cap');
      }
    });

    it('honours a raised max resistance: a value at the build max is not below cap', () => {
      const stats: StatResult[] = [{ statId: 'FireResist', value: 78, label: 'Fire Resistance' }];
      const model = buildWarningModel({
        calc: calc(stats),
        unsupported: [],
        maxResists: { FireResist: 78 },
      });
      expect(model.warnings).toEqual([]);
    });

    it('does not warn for a resistance the core never emitted (NO-FALLBACK)', () => {
      // No FireResist stat at all -> no fabricated -60 default, hence no warning.
      const model = buildWarningModel({
        calc: calc([{ statId: 'ColdResist', value: 75, label: 'Cold Resistance' }]),
        unsupported: [],
      });
      expect(model.warnings).toEqual([]);
    });
  });

  describe('unsupported / parse-failed passthrough (§8.6 step 4, §10.4 badge)', () => {
    const LINES = ['+13 to Dexterity (fractured)', '괴상한 미지원 라인'];

    it('echoes each unsupported line verbatim as one warning', () => {
      const model = buildWarningModel({ calc: calc(CAPPED_STATS), unsupported: LINES });
      const passthrough = model.warnings.filter((w) => w.code.startsWith('unsupported-line'));
      expect(passthrough).toHaveLength(LINES.length);
      // The original source line is preserved exactly (§8.6 "unknown line은 보존").
      expect(passthrough.map((w) => w.detail)).toEqual(LINES);
    });

    it('tags passthrough warnings with the unsupported-modifier i18n key + info severity', () => {
      const model = buildWarningModel({ calc: calc(CAPPED_STATS), unsupported: LINES });
      const passthrough = model.warnings.filter((w) => w.code.startsWith('unsupported-line'));
      for (const w of passthrough) {
        expect(w.severity).toBe('info');
        expect(w.i18nKey).toBe('warning.unsupportedModifier');
        expect(t('en-US', w.i18nKey)).toBe('Unsupported Modifier');
      }
    });

    it('gives each unsupported line a stable, index-scoped code', () => {
      const model = buildWarningModel({ calc: calc(CAPPED_STATS), unsupported: LINES });
      const passthrough = model.warnings.filter((w) => w.code.startsWith('unsupported-line'));
      expect(codes(passthrough)).toEqual(['unsupported-line:0', 'unsupported-line:1']);
    });

    it('emits no passthrough warnings when there are no unsupported lines', () => {
      const model = buildWarningModel({ calc: calc(CAPPED_STATS), unsupported: [] });
      expect(model.warnings).toEqual([]);
    });
  });

  it('combines resist + unsupported warnings into one ordered list', () => {
    const model = buildWarningModel({
      calc: calc(UNCAPPED_STATS),
      unsupported: ['some unparsed mod'],
    });
    // Resist warnings (the calc-derived block) come first, then the passthrough
    // block — a stable, deterministic order for the renderer.
    expect(codes(model.warnings)).toEqual([
      'resist-below-cap:FireResist',
      'resist-below-cap:ColdResist',
      'resist-below-cap:LightningResist',
      'unsupported-line:0',
    ]);
  });
});
