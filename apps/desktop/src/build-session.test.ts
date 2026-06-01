/**
 * build-session test (build-open-save task) — the thin async data layer that
 * wires the read-only Overview viewer to @pob2/core-client (DESIGN §18 Phase 2
 * doneCriteria "기존 build 파일을 열어 Overview 표시", §6.3 load/save/share-code,
 * §12.3 round-trip).
 *
 * The real CoreClient spawns an out-of-process Lua runner (overlays/lua/runner.lua)
 * which jsdom/vitest cannot host, so the data layer takes the client as an
 * INJECTABLE dependency (DESIGN §5.1: host owns the runner, UI/data layer is pure).
 * These tests inject a MOCK client that records calls and returns canned
 * {buildId, summary} / {buildId, stats} / {format, data} shapes — exactly the
 * @pob2/core-client method results — so we assert the data layer's wiring without
 * a live runner. @pob2/core-client internals are NOT touched.
 *
 * Coverage:
 *   - open({ xml }) routes through client.load + client.calcRun and returns
 *     { summary, stats } where `stats` is a CalcRunResponse that drives the
 *     buildOverviewModel (the Overview view-model from @pob2/ui).
 *   - open({ shareCode }) routes through client.loadShareCode (not load).
 *   - save() round-trips: save({ format: 'xml' }) -> client.save, and
 *     save({ format: 'shareCode' }) -> client.saveShareCode, returning the
 *     client's {format, data} verbatim. Saving before open is rejected.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { buildOverviewModel } from '@pob2/ui';
import type { CalcRunResponse, EquippedItem, ItemsParseClipboardResponse } from '@pob2/schema';
import { createBuildSession, type BuildClient } from './build-session.js';

const here = dirname(fileURLToPath(import.meta.url));
// apps/desktop/src -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

/** Curated stats a real calc.run returns for the sample build (DESIGN §10.3). */
const SAMPLE_STATS: CalcRunResponse = {
  buildId: 'build-1',
  stats: [
    { statId: 'TotalDPS', value: 1234.5, label: 'Total DPS' },
    { statId: 'Life', value: 50, label: 'Life' },
    { statId: 'Mana', value: 40, label: 'Mana' },
  ],
};

/** The build's equipped boots an items.getEquipped pass returns (DESIGN §6.3). */
const SAMPLE_BOOTS: EquippedItem = {
  slot: 'Boots',
  itemId: 'item-boots-1',
  name: 'Sorrow Sole',
  rarity: 'Rare',
  baseName: 'Hunting Shoes',
  requirements: { level: 33, str: 0, dex: 62, int: 0 },
  summaryMods: ['25% increased Movement Speed'],
  unsupportedMods: ['Mirror something the parser cannot read'],
};

/** A clipboard parse with one recognised mod, one unrecognised line (DESIGN §8.6). */
const SAMPLE_PARSE: ItemsParseClipboardResponse = {
  locale: 'en-US',
  baseId: 'Hunting Shoes',
  rarity: 'Rare',
  name: 'Sorrow Sole',
  mods: [{ raw: '25% increased Movement Speed', status: 'parsed', statId: 'move_speed' }],
  unsupported: ['Mirror something the parser cannot read'],
};

/**
 * A recording mock CoreClient: structurally a {@link BuildClient}, returns canned
 * @pob2/core-client shapes and logs every call so the wiring can be asserted. No
 * Lua runner is spawned (DESIGN §5.1 injectable client).
 */
function mockClient(): BuildClient & {
  calls: Array<{ method: string; arg: unknown }>;
} {
  const calls: Array<{ method: string; arg: unknown }> = [];
  return {
    calls,
    async load(xml: string) {
      calls.push({ method: 'load', arg: xml });
      return { buildId: 'build-1', summary: { className: 'Ranger', level: 1, itemCount: 1 } };
    },
    async loadShareCode(code: string) {
      calls.push({ method: 'loadShareCode', arg: code });
      return { buildId: 'build-1', summary: { className: 'Ranger', level: 1, itemCount: 1 } };
    },
    async calcRun(buildId: string) {
      calls.push({ method: 'calcRun', arg: buildId });
      return SAMPLE_STATS;
    },
    async save(buildId: string) {
      calls.push({ method: 'save', arg: buildId });
      return { format: 'xml', data: sampleXml };
    },
    async saveShareCode(buildId: string) {
      calls.push({ method: 'saveShareCode', arg: buildId });
      return { format: 'shareCode', data: 'eNcOdEd' };
    },
    async getEquipped(buildId: string) {
      calls.push({ method: 'getEquipped', arg: buildId });
      return { equipped: [SAMPLE_BOOTS] };
    },
    async parseClipboard(text: string, localeHint?) {
      calls.push({ method: 'parseClipboard', arg: { text, localeHint } });
      return SAMPLE_PARSE;
    },
    async createCustom(baseId: string, mods) {
      calls.push({ method: 'createCustom', arg: { baseId, mods } });
      return { itemId: 'custom-1', item: { ...SAMPLE_BOOTS, itemId: 'custom-1' } };
    },
    async equipDelta(buildId: string, item, slot) {
      calls.push({ method: 'equipDelta', arg: { buildId, itemId: item.itemId, slot } });
      return { slot, deltas: [] };
    },
  };
}

describe('build-session — open()', () => {
  it('loads the sample-build XML via client.load + client.calcRun and yields { summary, stats }', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    const result = await session.open({ xml: sampleXml });

    // Routed through load (with the XML) then calcRun (with the returned buildId).
    expect(client.calls).toEqual([
      { method: 'load', arg: sampleXml },
      { method: 'calcRun', arg: 'build-1' },
    ]);

    // Shaped for the Overview view-model: a BuildSummary plus a CalcRunResponse.
    expect(result.summary).toEqual({ className: 'Ranger', level: 1, itemCount: 1 });
    expect(result.stats).toBe(SAMPLE_STATS);
  });

  it('yields stats that drive the Overview view-model (offence Total DPS present)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    const { summary, stats } = await session.open({ xml: sampleXml });
    const model = buildOverviewModel(stats, summary);

    // The summary header flows through unchanged.
    expect(model.summary.className).toBe('Ranger');

    // Total DPS is the first offence field and resolves to the real calc value.
    const totalDps = model.offence.fields.find((f) => f.statId === 'TotalDPS');
    expect(totalDps?.present).toBe(true);
    expect(totalDps?.present && totalDps.value).toBe(1234.5);

    // A stat the calc did not emit (Energy Shield) stays missing, never a 0.
    const es = model.defence.fields.find((f) => f.statId === 'EnergyShield');
    expect(es?.present).toBe(false);
  });

  it('routes a share code through client.loadShareCode (not client.load)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ shareCode: 'eNcOdEd' });

    expect(client.calls).toEqual([
      { method: 'loadShareCode', arg: 'eNcOdEd' },
      { method: 'calcRun', arg: 'build-1' },
    ]);
  });
});

describe('build-session — save() round-trip', () => {
  it('exports XML through client.save after a build is open', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const saved = await session.save({ format: 'xml' });

    expect(saved).toEqual({ format: 'xml', data: sampleXml });
    expect(client.calls.at(-1)).toEqual({ method: 'save', arg: 'build-1' });
  });

  it('exports a share code through client.saveShareCode after a build is open', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const saved = await session.save({ format: 'shareCode' });

    expect(saved).toEqual({ format: 'shareCode', data: 'eNcOdEd' });
    expect(client.calls.at(-1)).toEqual({ method: 'saveShareCode', arg: 'build-1' });
  });

  it('rejects save() when no build has been opened (no buildId to round-trip)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.save({ format: 'xml' })).rejects.toThrow();
    // Nothing was sent to the client.
    expect(client.calls).toEqual([]);
  });
});

describe('build-session — Items tab paths (DESIGN §10.4, §6.3)', () => {
  it('getEquipped() routes to client.getEquipped with the open buildId', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await session.open({ xml: sampleXml });
    const equipped = await session.getEquipped();

    // Returns the build's real equipped gear, routed with the open build id.
    expect(equipped.equipped).toHaveLength(1);
    expect(equipped.equipped.at(0)?.name).toBe('Sorrow Sole');
    expect(client.calls.at(-1)).toEqual({ method: 'getEquipped', arg: 'build-1' });
  });

  it('rejects getEquipped() before a build is opened (no buildId to query)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    await expect(session.getEquipped()).rejects.toThrow();
    // Nothing was sent to the client (NO-FALLBACK — no fabricated empty grid).
    expect(client.calls).toEqual([]);
  });

  it('parseClipboard() shapes the parse into an inspector item (parsed/unsupported split)', async () => {
    const client = mockClient();
    const session = createBuildSession(client);

    // No open build required — pasting an item is independent of the loaded build.
    const { item, locale } = await session.parseClipboard('Sorrow Sole\nHunting Shoes');

    expect(client.calls).toEqual([
      {
        method: 'parseClipboard',
        arg: { text: 'Sorrow Sole\nHunting Shoes', localeHint: undefined },
      },
    ]);
    // The recognised mod is parsed; the unrecognised line stays separate (§8.6).
    expect(item.name).toBe('Sorrow Sole');
    expect(item.baseType).toBe('Hunting Shoes');
    expect(item.parsedMods).toEqual(['25% increased Movement Speed']);
    expect(item.unsupportedMods).toEqual(['Mirror something the parser cannot read']);
    // The detected source locale is surfaced for the §8.6 import indicator.
    expect(locale).toBe('en-US');
  });
});
