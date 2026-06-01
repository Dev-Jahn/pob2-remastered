// items.parseClipboard fixture gate for @pob2/core-client — the Phase 1 deliverable
// that proves the clipboard round-trip path AND the unsupported-line preservation
// contract (DESIGN §8.6: unrecognized lines are surfaced in an EXPLICIT `unsupported`
// list, never silently dropped). The Phase 3 `parser-fixtures` gate wires this suite
// in gates.mjs; the parseClipboard method itself is Phase 1, so this is the test that
// keeps the API contract honest.
//
// Every fixture is a REAL English PoE2 client clipboard copy (normal / magic / rare /
// unique, with implicits + explicits, sockets/runes, corrupted/quality) under
// tools/golden-tests/fixtures/clipboard/<name>.txt, and a sibling manifest.json pins
// the expected base / rarity / name / parsed mods / unsupported lines. Korean parsing
// is OUT of scope for Phase 1 (that is Phase 6 §8.6) — this MVP is English only.
//
// The suite drives the REAL runner subprocess (createCoreClient -> parseClipboard,
// the same schema-validated JSON-RPC path the Rust host uses); no mock. A fixture with
// no manifest entry (or an orphan manifest entry with no fixture) FAILS the suite, so
// the corpus and its expectations cannot silently drift apart.
//
// Gate command: pnpm --filter @pob2/core-client test parser -> vitest run parser
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createCoreClient, type CoreClient } from '../src/index.js';
import type { ItemsParseClipboardResponse } from '@pob2/schema';

const here = dirname(fileURLToPath(import.meta.url));
// packages/core-client/test -> repo root
const repoRoot = resolve(here, '..', '..', '..');
const clipboardDir = resolve(repoRoot, 'tools/golden-tests/fixtures/clipboard');

/** One fixture's expected parse outcome, pinned in manifest.json. */
interface Expectation {
  /** Human-readable intent of the fixture (which §8.6 path it exercises). */
  intent: string;
  /** Expected resolved item base, or null when the base is deliberately absent. */
  baseId: string | null;
  /** Expected upstream rarity tag (NORMAL/MAGIC/RARE/UNIQUE). */
  rarity: string;
  /** Expected item display name. */
  name: string;
  /** Mod lines (verbatim) that MUST parse — every one present with status 'parsed'. */
  parsedMods: string[];
  /** Lines (verbatim) that MUST be surfaced as unsupported — never dropped (§8.6). */
  unsupported: string[];
}

type Manifest = Record<string, Expectation>;

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(resolve(clipboardDir, 'manifest.json'), 'utf8')) as Manifest;
}

/** Discover the .txt clipboard fixtures (everything but the manifest). */
function discoverFixtures(): string[] {
  return readdirSync(clipboardDir)
    .filter((f) => f.endsWith('.txt'))
    .map((f) => f.replace(/\.txt$/, ''))
    .sort();
}

const manifest = loadManifest();
const fixtures = discoverFixtures();

describe('items.parseClipboard fixtures (English MVP, §8.6 round-trip + unsupported)', () => {
  let client: CoreClient;

  beforeAll(async () => {
    client = await createCoreClient();
  });

  afterAll(async () => {
    await client?.dispose();
  });

  it('corpus covers normal / magic / rare / unique rarities', () => {
    const rarities = new Set(Object.values(manifest).map((e) => e.rarity));
    for (const expected of ['NORMAL', 'MAGIC', 'RARE', 'UNIQUE']) {
      expect(rarities, `corpus must include a ${expected} item`).toContain(expected);
    }
  });

  it('every fixture .txt has a manifest entry and vice versa (no silent drift)', () => {
    expect(fixtures.length).toBeGreaterThan(0);
    expect([...fixtures].sort()).toEqual(Object.keys(manifest).sort());
  });

  for (const name of fixtures) {
    const expected = manifest[name];

    it(`parses '${name}' (${expected?.intent ?? 'no manifest entry'})`, async () => {
      expect(expected, `fixture '${name}' has no manifest entry`).toBeDefined();

      const text = readFileSync(resolve(clipboardDir, `${name}.txt`), 'utf8');
      const result: ItemsParseClipboardResponse = await client.parseClipboard(text);

      // English MVP: locale is en-US (no Korean detection in Phase 1).
      expect(result.locale).toBe('en-US');

      // Base / rarity / name round-trip.
      if (expected.baseId === null) {
        expect(result.baseId, 'base should be absent for this fixture').toBeUndefined();
      } else {
        expect(result.baseId).toBe(expected.baseId);
      }
      expect(result.rarity).toBe(expected.rarity);
      expect(result.name).toBe(expected.name);

      // Every expected mod line is present AND marked parsed.
      const parsedRaw = result.mods.filter((m) => m.status === 'parsed').map((m) => m.raw);
      for (const line of expected.parsedMods) {
        expect(parsedRaw, `expected mod '${line}' to parse`).toContain(line);
      }

      // Unsupported contract (§8.6): the explicit list matches exactly — no line is
      // silently dropped, and no recognized line is wrongly flagged unsupported.
      expect([...result.unsupported].sort()).toEqual([...expected.unsupported].sort());

      // Every unsupported line is ALSO mirrored in the mods array with status
      // 'unsupported' (the client lifts both views; §8.6 preservation).
      const unsupportedRaw = result.mods
        .filter((m) => m.status === 'unsupported')
        .map((m) => m.raw)
        .sort();
      expect(unsupportedRaw).toEqual([...expected.unsupported].sort());

      // No line is ever dropped: every expected line appears somewhere in mods.
      const allRaw = new Set(result.mods.map((m) => m.raw));
      for (const line of [...expected.parsedMods, ...expected.unsupported]) {
        expect(allRaw, `line '${line}' must be preserved, never dropped`).toContain(line);
      }
    });
  }
});
