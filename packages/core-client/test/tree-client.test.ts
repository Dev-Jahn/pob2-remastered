// tree.* surface for @pob2/core-client (task p5-core-client-tree, DESIGN §6.3
// tree.getData / tree.previewAllocate / tree.applyAllocate, §6.4 serialization +
// schema-validation principles, §10.6 Passive Tree tab "allocation delta preview").
//
// This suite drives the REAL runner subprocess (createCoreClient), loads the
// sample fixture, and exercises the three tree methods the task adds to
// CoreClient:
//
//   getTreeData(buildId)                       -> tree.getData         (registry-validated)
//   previewAllocate(buildId, nodeIds)          -> tree.previewAllocate (registry-validated)
//   applyAllocate(buildId, nodeIds)            -> tree.applyAllocate   (registry-validated)
//
// What is genuinely runner-backed (and therefore asserted end to end), per the
// deterministic fixture (tools/golden-tests/fixtures/sample-build.xml — a Ranger
// with only the class-start node 50459 allocated; node 13828 is an "Evasion"
// notable adjacent to the start):
//   * getTreeData returns the active 0_5 tree's REAL node graph (thousands of
//     nodes, hundreds of groups, the start node 50459 allocated) as a schema-valid
//     TreeGetDataResponse (§10.6);
//   * previewAllocate(buildId, [13828]) returns the genuine before/after delta the
//     vendor calc produces — Evasion 7 -> 23 (delta 16) — WITHOUT mutating the
//     build (a subsequent getTreeData still reports only the start node) (§6.3, §7.4);
//   * applyAllocate(buildId, [13828]) ACTUALLY commits the node — a subsequent
//     getTreeData reports 13828 allocated and the delta is genuinely persisted
//     (NO A-vs-A stub — DESIGN §6.3 NO-FALLBACK).
//
// NO-FALLBACK (DESIGN §6.4): a runner CoreError (unknown build / unknown node) is
// surfaced as a STRUCTURED CoreClientError, never a faked success. The
// request-validation path and the honest-error path are both asserted.
//
// Gate command: pnpm --filter @pob2/core-client test tree
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

// The fixture's class-start node (RANGER ClassStart), the only node allocated on
// load — the same anchors the Lua tree spec uses (modern_api_tree_spec.lua).
const START_NODE_ID = 50459;
// An "Evasion" notable directly adjacent to the start (path length 1). Allocating
// it alone raises the curated Evasion stat from 7 -> 23 — a clean, deterministic
// delta touching a curated §7.4 stat.
const EVASION_NODE_ID = 13828;

const ajv = new Ajv2020({ allErrors: true, strict: false });
// Compile the registry response schemas the methods are validated against, so the
// suite proves the CLIENT output is schema-valid independently of the client's own
// internal validation (a second, external check on the same contract).
const validateGetData = ajv.compile(schemaRegistry['tree.getData'].responseSchema as object);
const validatePreview = ajv.compile(
  schemaRegistry['tree.previewAllocate'].responseSchema as object,
);
const validateApply = ajv.compile(schemaRegistry['tree.applyAllocate'].responseSchema as object);

describe('core-client tree.* (real runner, DESIGN §6.3/§6.4)', () => {
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

  describe('getTreeData(buildId)', () => {
    it('returns the active tree’s real node graph as a schema-valid response', async () => {
      const data = await client.getTreeData(buildId);

      // The whole response is valid against tree.getData:response.
      expect(validateGetData(data), JSON.stringify(validateGetData.errors)).toBe(true);

      // The fixture's Spec is treeVersion 0_5.
      expect(data.treeVersion).toBe('0_5');
      // The 0_5 tree is a genuine node graph: thousands of nodes, hundreds of groups.
      expect(data.nodes.length).toBeGreaterThan(1000);
      expect(data.groups.length).toBeGreaterThan(100);

      // The start node is serialized with its identity + orbit-derived coordinates.
      const start = data.nodes.find((n) => n.nodeId === START_NODE_ID);
      expect(start, 'the class-start node must be present in the node list').toBeDefined();
      expect(start!.name).toBe('RANGER');
      expect(start!.type).toBe('ClassStart');
      expect(typeof start!.x).toBe('number');
      expect(typeof start!.y).toBe('number');
      expect(typeof start!.group).toBe('number');
      expect(typeof start!.isAscendancy).toBe('boolean');

      // The Evasion notable we allocate in the later tests is present in the graph.
      const evasion = data.nodes.find((n) => n.nodeId === EVASION_NODE_ID);
      expect(evasion, 'the evasion notable must be present').toBeDefined();
      expect(typeof evasion!.name).toBe('string');

      // Each node carries its CONNECTIONS (the tree's edge graph) so the §10.6
      // renderer can paint connecting edges and the path-preview can walk the
      // graph. The Evasion node is path-length 1 from the start, so the two are
      // directly connected — connectivity round-trips both ways (the edge list the
      // §10.6 canvas draws is derived from exactly this).
      expect(Array.isArray(start!.connections)).toBe(true);
      expect(start!.connections.length).toBeGreaterThan(0);
      expect(evasion!.connections).toContain(START_NODE_ID);
      expect(start!.connections).toContain(EVASION_NODE_ID);

      // Layout constants: the Ranger fixture is DexClass; classes is a {name->id} map.
      expect(typeof data.constants.classes.DexClass).toBe('number');

      // On load only the class-start node is allocated.
      expect(data.allocatedNodeIds).toContain(START_NODE_ID);
      expect(data.allocatedNodeIds.length).toBe(1);
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.getTreeData('')).rejects.toBeInstanceOf(CoreClientError);
    });

    it('surfaces a structured CoreClientError for an unknown buildId (NO-FALLBACK)', async () => {
      await expect(client.getTreeData('nope-not-a-build')).rejects.toBeInstanceOf(CoreClientError);
    });
  });

  describe('previewAllocate(buildId, nodeIds)', () => {
    it('returns the genuine before/after Evasion delta without mutating the build', async () => {
      const preview = await client.previewAllocate(buildId, [EVASION_NODE_ID]);

      // The whole response is valid against tree.previewAllocate:response.
      expect(validatePreview(preview), JSON.stringify(validatePreview.errors)).toBe(true);

      // The deltas carry the curated before/after/delta the vendor calc produces.
      const evasion = preview.deltas.find((d) => d.statId === 'Evasion');
      expect(evasion, 'Evasion must appear in the preview deltas').toBeDefined();
      expect(evasion!.before).toBe(7);
      expect(evasion!.after).toBe(23);
      expect(evasion!.delta).toBe(16);

      // The preview must NOT commit the node: a subsequent getTreeData is unchanged.
      const after = await client.getTreeData(buildId);
      expect(after.allocatedNodeIds.length).toBe(1);
      expect(after.allocatedNodeIds).toContain(START_NODE_ID);
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.previewAllocate('', [EVASION_NODE_ID])).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });

    it('surfaces a structured CoreClientError for an unknown nodeId (NO-FALLBACK)', async () => {
      await expect(client.previewAllocate(buildId, [999_999_999])).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });
  });

  // applyAllocate REALLY mutates the live build (unlike previewAllocate's
  // non-mutating A-vs-B pass), so it runs last because it permanently changes the
  // shared build's allocation.
  describe('applyAllocate(buildId, nodeIds) (DESIGN §6.3 NO A-vs-A stub)', () => {
    it('commits the node: a subsequent getTreeData reports it allocated', async () => {
      const result = await client.applyAllocate(buildId, [EVASION_NODE_ID]);

      // The whole response is valid against tree.applyAllocate:response.
      expect(validateApply(result), JSON.stringify(validateApply.errors)).toBe(true);

      // The apply persisted: both the start node and the newly-allocated node appear.
      expect(result.allocatedNodeIds).toContain(START_NODE_ID);
      expect(result.allocatedNodeIds).toContain(EVASION_NODE_ID);

      // And it is reflected in a fresh getTreeData (the mutation is real).
      const data = await client.getTreeData(buildId);
      expect(data.allocatedNodeIds).toContain(EVASION_NODE_ID);
      expect(data.allocatedNodeIds).toContain(START_NODE_ID);
    });

    it('rejects an empty buildId before sending (request schema validation)', async () => {
      await expect(client.applyAllocate('', [EVASION_NODE_ID])).rejects.toBeInstanceOf(
        CoreClientError,
      );
    });
  });
});
