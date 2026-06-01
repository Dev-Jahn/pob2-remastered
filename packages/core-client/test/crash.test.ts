// Crash-isolation suite for @pob2/core-client — the Phase 1 `crash-isolation`
// gate, proving done-criterion 2 (malformed input에서도 runner/UI process 유지;
// DESIGN §6.2 "Lua panic/crash가 UI process를 죽이지 않도록 격리", §14.2
// "malformed input은 core crash로 이어지지 않게 runner process 격리").
//
// Each test feeds the live runner one malformed / hostile input and asserts TWO
// things:
//   1. the input yields a STRUCTURED error — a typed CoreError
//      (BUILD_PARSE_FAILED / CALC_FAILED) or a protocol-level JSON-RPC fault
//      (-32700 parse error / -32601 method not found) — never a raw Lua traceback
//      and never a hang;
//   2. the SAME runner PROCESS survives and immediately serves a valid request
//      (core.version + a real load->calc) afterwards.
//
// To prove (2) literally, every hostile input is sent to ONE long-lived runner
// shared across the whole suite; we pin its OS pid up front and re-assert that
// exact pid is still alive after each abuse, so a silent respawn cannot mask a
// crash. The hostile inputs cover the DESIGN §14.2 surface: non-JSON line,
// truncated frame, oversized share code (size limit), garbage XML to build.load,
// item text that throws in the core, and an unknown method.
//
// Gate command: pnpm --filter @pob2/core-client test crash -> vitest run crash
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CoreClient, CoreClientError } from '../src/index.js';
import { RunnerClient, RAW_REQUEST_MAX_BYTES, SHARE_CODE_MAX_BYTES } from '../src/runner-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const sampleXml = readFileSync(
  resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml'),
  'utf8',
);

// One runner, shared across every hostile input, so "the process survived" is a
// claim about THIS exact pid rather than a freshly respawned one.
let client: CoreClient;
let runner: RunnerClient;
let pid: number;

/** Re-assert the shared runner is the SAME live process and still serves work. */
async function expectRunnerStillAliveAndUsable(): Promise<void> {
  // Same OS process (no silent respawn).
  expect(runner.pid).toBe(pid);
  expect(runner.pid).toBeGreaterThan(0);
  // Cheap protocol round-trip: the dispatch loop is still reading lines.
  const version = await client.version();
  expect(typeof version.version).toBe('string');
  expect(version.version.length).toBeGreaterThan(0);
  // And the heavy path still works end to end on the same process.
  const loaded = await client.load(sampleXml);
  const calc = await client.calcRun(loaded.buildId);
  const life = calc.stats.find((s) => s.statId === 'Life');
  expect(life, 'a valid build must still calc Life on the survived runner').toBeDefined();
  expect(life!.value).toBeGreaterThan(0);
}

describe('runner crash isolation (DESIGN §6.2, §14.2)', () => {
  beforeAll(async () => {
    client = new CoreClient();
    await client.start();
    runner = client.runnerForTesting;
    expect(runner.pid).toBeGreaterThan(0);
    pid = runner.pid;
  });

  afterAll(async () => {
    await client?.dispose();
  });

  it('a non-JSON line yields a JSON-RPC parse error (-32700) and keeps the runner alive', async () => {
    await expect(runner.sendRaw('this is definitely not json')).rejects.toMatchObject({
      jsonRpcCode: -32700,
    });
    await expectRunnerStillAliveAndUsable();
  });

  it('a truncated JSON frame yields a parse error (-32700) and keeps the runner alive', async () => {
    await expect(
      runner.sendRaw('{"jsonrpc":"2.0","id":99,"method":"core.version"'),
    ).rejects.toMatchObject({ jsonRpcCode: -32700 });
    await expectRunnerStillAliveAndUsable();
  });

  it('an input frame beyond the runner size limit is rejected without booting the core', async () => {
    // A single line larger than the runner's input cap (DESIGN §14.2 size limit):
    // it must be refused as a protocol fault, not JSON-decoded or buffered whole.
    const oversized = 'x'.repeat(RAW_REQUEST_MAX_BYTES + 1024);
    await expect(runner.sendRaw(oversized)).rejects.toMatchObject({ jsonRpcCode: -32700 });
    await expectRunnerStillAliveAndUsable();
  });

  it('an oversized share code is rejected with BUILD_PARSE_FAILED before decode (§14.2 size limit)', async () => {
    // Beyond the share-code size limit: must be refused BEFORE inflate, so a hostile
    // (e.g. zip-bomb-shaped) code can never reach the decompressor.
    const oversizedCode = 'A'.repeat(SHARE_CODE_MAX_BYTES + 1);
    await expect(client.loadShareCode(oversizedCode)).rejects.toMatchObject({
      code: 'BUILD_PARSE_FAILED',
    });
    await expectRunnerStillAliveAndUsable();
  });

  it('garbage XML to build.load yields BUILD_PARSE_FAILED and keeps the runner alive', async () => {
    // Garbage XML produces a HALF-BUILT build in the core singleton; the load must
    // reject with the typed BUILD_PARSE_FAILED CoreError (never a raw traceback),
    // and — the crux of crash isolation — must NOT poison the next load: the
    // immediately-following valid load in expectRunnerStillAliveAndUsable() proves
    // the core recovered (one bad load can no longer corrupt the next).
    const garbage = '<not-a-pob-build><<<garbage>>></not-a-pob-build>';
    await expect(client.load(garbage)).rejects.toMatchObject({ code: 'BUILD_PARSE_FAILED' });
    await expectRunnerStillAliveAndUsable();
    // A second, differently-shaped garbage XML — also rejected, also non-poisoning.
    await expect(client.load('<<<>>>')).rejects.toMatchObject({ code: 'BUILD_PARSE_FAILED' });
    await expectRunnerStillAliveAndUsable();
  });

  it('item text the core rejects yields a structured CoreError, not a crash', async () => {
    // An empty clipboard string has no item to parse: the core surface rejects it
    // with a typed CoreError envelope rather than raising. The error must be
    // structured (a CoreClientError carrying a closed-set code), never a hang.
    await expect(client.parseClipboard('')).rejects.toMatchObject({
      code: expect.any(String) as unknown as string,
    });
    const empty = await client.parseClipboard('').catch((e: CoreClientError) => e);
    expect(empty).toBeInstanceOf(CoreClientError);
    await expectRunnerStillAliveAndUsable();
  });

  it('hostile clipboard text parses to a structured result without crashing the runner', async () => {
    // The upstream item parser is deliberately resilient: hostile bytes (NULs,
    // unbalanced braces, control chars) parse to an all-unsupported item rather than
    // throwing. The contract under test is liveness + structure — the runner must
    // return a well-formed parse result (unrecognized lines preserved in
    // `unsupported`, DESIGN §8.6) and stay alive, never tear down on hostile input.
    const result = await client.parseClipboard('\0\0\0 Rarity: \x01\x02 \n}}}{{{ throw');
    expect(Array.isArray(result.mods)).toBe(true);
    expect(Array.isArray(result.unsupported)).toBe(true);
    await expectRunnerStillAliveAndUsable();
  });

  it('an unknown method yields JSON-RPC -32601 and keeps the runner alive', async () => {
    await expect(runner.call('totally.bogus.method', {}, 10_000)).rejects.toMatchObject({
      jsonRpcCode: -32601,
    });
    await expectRunnerStillAliveAndUsable();
  });
});
