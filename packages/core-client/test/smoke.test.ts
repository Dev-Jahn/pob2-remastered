// Smoke test for @pob2/core-client — the Node client that spawns and drives the
// out-of-process Lua runner (overlays/lua/runner.lua) over newline-delimited
// JSON-RPC (DESIGN §5.1 "JSON-RPC schema validation", §6.2 out-of-process runner).
//
// This is the gate the task names: spawn -> core.version handshake -> load the
// sample fixture -> calc.run returns numeric stats. It drives the REAL runner
// subprocess end to end (no mock), so it proves the client framing, the ready
// handshake, and the schema-validated request/response hop all work against the
// live core.
//
// Gate command: pnpm --filter @pob2/core-client test smoke -> vitest run smoke
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createCoreClient, type CoreClient } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
// repo root is four levels up: packages/core-client/test -> repo
const repoRoot = resolve(here, '..', '..', '..');
const fixturePath = resolve(repoRoot, 'tools/golden-tests/fixtures/sample-build.xml');
const sampleXml = readFileSync(fixturePath, 'utf8');

describe('core-client smoke (spawn -> core.version -> load -> calc.run)', () => {
  let client: CoreClient | undefined;

  afterEach(async () => {
    await client?.dispose();
    client = undefined;
  });

  it('spawns the runner and completes the core.version ready handshake', async () => {
    client = await createCoreClient();
    // create() resolves only after the ready handshake on core.version succeeds.
    const version = await client.version();
    expect(typeof version.version).toBe('string');
    expect(version.version.length).toBeGreaterThan(0);
  });

  it('loads the sample fixture and calc.run returns numeric stats', async () => {
    client = await createCoreClient();

    const loaded = await client.load(sampleXml);
    expect(typeof loaded.buildId).toBe('string');
    expect(loaded.buildId.length).toBeGreaterThan(0);

    const calc = await client.calcRun(loaded.buildId);
    // calc.run is validated against @pob2/schema's calc.run:response schema.
    expect(calc.buildId).toBe(loaded.buildId);
    expect(Array.isArray(calc.stats)).toBe(true);
    expect(calc.stats.length).toBeGreaterThan(0);

    for (const stat of calc.stats) {
      expect(typeof stat.statId).toBe('string');
      expect(typeof stat.label).toBe('string');
      expect(typeof stat.value).toBe('number');
      expect(Number.isFinite(stat.value)).toBe(true);
    }

    // Life is always present and positive on a real build — proof the calc layer
    // actually ran behind the protocol, not a stubbed echo.
    const life = calc.stats.find((s) => s.statId === 'Life');
    expect(life, 'curated stats must include Life').toBeDefined();
    expect(life!.value).toBeGreaterThan(0);
  });
});
