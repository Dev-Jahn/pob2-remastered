/**
 * core-ipc-client test (task p3-core-bridge) — the WebView-side CoreClient
 * adapter that drives the Rust host's allowlisted `core_request` IPC command
 * instead of spawning a Lua subprocess (DESIGN §5.1 Rust host owns the runner,
 * §6.2 out-of-process, §14.1 allowlisted command). It lets `build-session` run
 * inside the Tauri WebView (which cannot host `node:child_process`).
 *
 * The real adapter calls Tauri `invoke('core_request', { method, params })`; that
 * `invoke` is INJECTED here so the test exercises the adapter's wiring + wire-shape
 * assembly WITHOUT a Tauri runtime. A mock `invoke` records every call and returns
 * the runner's plain wire shapes (the same `{buildId, summary}` / `{stats}` /
 * `{xml}` the Rust bridge passes through), so we assert:
 *   - load(xml) -> core_request('build.load', {xml}) -> {buildId, summary}
 *   - calcRun(id) -> core_request('calc.run', {buildId}) -> {buildId, stats}
 *   - save(id) -> core_request('build.save', {buildId}) -> {format:'xml', data}
 *   - loadShareCode/saveShareCode route the share-code codec then build.load/save
 *   - a CoreError rejection from invoke surfaces as a thrown CoreError (NO-FALLBACK)
 *
 * The adapter satisfies build-session's BuildClient interface structurally, so the
 * SAME build-session works over either transport. @pob2/core-client is NOT imported
 * (it pulls node-only modules); the adapter is self-contained + browser-safe.
 */
import { describe, it, expect } from 'vitest';
import type { CoreError } from '@pob2/schema';
import { createBuildSession } from './build-session.js';
import { createIpcCoreClient, type CoreInvoke, type ShareCodeCodec } from './core-ipc-client.js';

/** A recording mock `invoke`: returns canned runner wire shapes per method. */
function mockInvoke(
  responses: Record<string, unknown>,
): CoreInvoke & { calls: Array<{ method: string; params: unknown }> } {
  const calls: Array<{ method: string; params: unknown }> = [];
  const fn = (async (command: string, args: { method: string; params: unknown }) => {
    expect(command).toBe('core_request');
    calls.push({ method: args.method, params: args.params });
    if (!(args.method in responses)) {
      throw new Error(`mock invoke: no canned response for ${args.method}`);
    }
    return responses[args.method];
  }) as CoreInvoke & { calls: Array<{ method: string; params: unknown }> };
  fn.calls = calls;
  return fn;
}

/** A deterministic share-code codec stub (no node:zlib in the WebView). */
const stubCodec: ShareCodeCodec = {
  decode: (code) => `<xml-for:${code}>`,
  encode: (xml) => `code-for:${xml}`,
};

const SUMMARY = { className: 'Ranger', level: 1, itemCount: 1 };
const STATS_WIRE = {
  stats: [
    { statId: 'TotalDPS', value: 1234.5, label: 'Total DPS' },
    { statId: 'Life', value: 65, label: 'Life' },
  ],
};

describe('core-ipc-client — routes the Core API over the core_request IPC command', () => {
  it('load(xml) calls core_request("build.load", {xml}) and returns {buildId, summary}', async () => {
    const invoke = mockInvoke({ 'build.load': { buildId: 'build-1', summary: SUMMARY } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const loaded = await client.load('<Build/>');

    expect(invoke.calls).toEqual([{ method: 'build.load', params: { xml: '<Build/>' } }]);
    expect(loaded).toEqual({ buildId: 'build-1', summary: SUMMARY });
  });

  it('calcRun(id) calls core_request("calc.run", {buildId}) and injects the buildId', async () => {
    const invoke = mockInvoke({ 'calc.run': STATS_WIRE });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.calcRun('build-1');

    expect(invoke.calls).toEqual([{ method: 'calc.run', params: { buildId: 'build-1' } }]);
    // The runner returns {stats}; the adapter owns the buildId, so the typed
    // CalcRunResponse is {buildId, stats}.
    expect(result).toEqual({ buildId: 'build-1', stats: STATS_WIRE.stats });
  });

  it('save(id) calls core_request("build.save", {buildId}) and lifts {xml} to {format,data}', async () => {
    const invoke = mockInvoke({ 'build.save': { xml: '<Saved/>' } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const saved = await client.save('build-1');

    expect(invoke.calls).toEqual([{ method: 'build.save', params: { buildId: 'build-1' } }]);
    expect(saved).toEqual({ format: 'xml', data: '<Saved/>' });
  });

  it('loadShareCode decodes the code to XML, then loads via build.load', async () => {
    const invoke = mockInvoke({ 'build.load': { buildId: 'build-9', summary: SUMMARY } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const loaded = await client.loadShareCode('eNcOdEd');

    // The codec turns the code into XML; build.load receives that XML, not the code.
    expect(invoke.calls).toEqual([{ method: 'build.load', params: { xml: '<xml-for:eNcOdEd>' } }]);
    expect(loaded.buildId).toBe('build-9');
  });

  it('saveShareCode saves XML then encodes it with the codec', async () => {
    const invoke = mockInvoke({ 'build.save': { xml: '<Saved/>' } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const saved = await client.saveShareCode('build-1');

    expect(invoke.calls).toEqual([{ method: 'build.save', params: { buildId: 'build-1' } }]);
    expect(saved).toEqual({ format: 'shareCode', data: 'code-for:<Saved/>' });
  });
});

describe('core-ipc-client — NO-FALLBACK error propagation (DESIGN §14.2)', () => {
  it('surfaces a CoreError rejection from core_request as a thrown CoreError', async () => {
    const coreError: CoreError = { code: 'BUILD_PARSE_FAILED', message: 'bad XML' };
    const invoke = (async () => {
      // Tauri rejects the invoke Promise with the command's Err payload (the
      // serialized CoreError envelope).
      throw coreError;
    }) as CoreInvoke;
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    await expect(client.load('<bad/>')).rejects.toMatchObject({
      code: 'BUILD_PARSE_FAILED',
      message: 'bad XML',
    });
  });

  it('throws when build.load returns no buildId (never fabricates one)', async () => {
    const invoke = mockInvoke({ 'build.load': { summary: SUMMARY } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    await expect(client.load('<Build/>')).rejects.toThrow();
  });
});

describe('core-ipc-client — Items Core API over core_request (DESIGN §6.3, §10.4)', () => {
  const BOOTS = {
    slot: 'Boots',
    itemId: 'item-boots-1',
    name: 'Sorrow Sole',
    rarity: 'Rare',
    baseName: 'Hunting Shoes',
    requirements: { level: 33, str: 0, dex: 62, int: 0 },
    summaryMods: ['25% increased Movement Speed'],
    unsupportedMods: [],
  };

  it('getEquipped(id) calls core_request("items.getEquipped", {buildId}) and lifts {equipped}', async () => {
    const invoke = mockInvoke({ 'items.getEquipped': { equipped: [BOOTS] } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.getEquipped('build-1');

    expect(invoke.calls).toEqual([{ method: 'items.getEquipped', params: { buildId: 'build-1' } }]);
    expect(result).toEqual({ equipped: [BOOTS] });
  });

  it('getEquipped(id) returns an empty grid when the runner reports no gear (no fabricated card)', async () => {
    const invoke = mockInvoke({ 'items.getEquipped': {} });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    expect(await client.getEquipped('build-1')).toEqual({ equipped: [] });
  });

  it('parseClipboard(text) calls core_request("items.parseClipboard", {text, localeHint})', async () => {
    const parsed = {
      locale: 'ko-KR',
      baseId: 'Hunting Shoes',
      rarity: 'Rare',
      name: 'Sorrow Sole',
      mods: [{ raw: '이동 속도 25% 증가', status: 'parsed', statId: 'move_speed' }],
      unsupported: [],
    };
    const invoke = mockInvoke({ 'items.parseClipboard': parsed });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.parseClipboard('붙여넣기', 'ko-KR');

    expect(invoke.calls).toEqual([
      { method: 'items.parseClipboard', params: { text: '붙여넣기', localeHint: 'ko-KR' } },
    ]);
    expect(result).toEqual(parsed);
  });

  it('equipDelta(...) routes through items.compare and passes the runner deltas through', async () => {
    // The runner does the real GetMiscCalculator diff and serializes the
    // { slot, deltas } envelope; the adapter must forward {buildId, itemId, slot}
    // and pass the deltas through verbatim (no local two-pass diffing).
    const compareWire = {
      slot: 'Boots',
      deltas: [
        { statId: 'TotalDPS', before: 1234.5, after: 1276.5, delta: 42 },
        { statId: 'Life', before: 65, after: 65, delta: 0 },
      ],
    };
    const invoke = mockInvoke({ 'items.compare': compareWire });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.equipDelta('build-1', BOOTS, 'Boots');

    // ONE items.compare call carrying the comparison subject (buildId/itemId/slot),
    // NOT two calc.run passes.
    expect(invoke.calls).toEqual([
      {
        method: 'items.compare',
        params: { buildId: 'build-1', itemId: 'item-boots-1', slot: 'Boots' },
      },
    ]);
    expect(result.slot).toBe('Boots');
    // The runner's real (non-zero-capable) deltas pass through unchanged.
    expect(result.deltas).toEqual(compareWire.deltas);
  });

  it('equipDelta(...) returns an empty diff when the runner reports no deltas (no fabrication)', async () => {
    const invoke = mockInvoke({ 'items.compare': { slot: 'Boots' } });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });

    const result = await client.equipDelta('build-1', BOOTS, 'Boots');

    expect(result).toEqual({ slot: 'Boots', deltas: [] });
  });
});

describe('core-ipc-client — drives build-session over the IPC transport', () => {
  it('an IPC client satisfies BuildClient so the same build-session opens a build', async () => {
    const invoke = mockInvoke({
      'build.load': { buildId: 'build-1', summary: SUMMARY },
      'calc.run': STATS_WIRE,
    });
    const client = createIpcCoreClient({ invoke, codec: stubCodec });
    const session = createBuildSession(client);

    const { summary, stats } = await session.open({ xml: '<Build/>' });

    // build-session routed through the IPC client's load + calcRun.
    expect(invoke.calls).toEqual([
      { method: 'build.load', params: { xml: '<Build/>' } },
      { method: 'calc.run', params: { buildId: 'build-1' } },
    ]);
    expect(summary).toEqual(SUMMARY);
    expect(stats).toEqual({ buildId: 'build-1', stats: STATS_WIRE.stats });
  });
});
