import { describe, it, expect } from 'vitest';
import type { TreeGetDataResponse } from '@pob2/schema';
import { treeResponseToGraph } from './build-session.js';

const emptyResponse: TreeGetDataResponse = {
  treeVersion: '0_5',
  nodes: [],
  groups: [],
  constants: { classes: {}, orbitAnglesByOrbit: [], orbitRadii: [], skillsPerOrbit: [] },
  allocatedNodeIds: [],
};

describe('treeResponseToGraph — empty tree bounds (P2 guard)', () => {
  it('returns a finite zero rect (not Infinity/NaN) when there are no nodes', () => {
    const { graph } = treeResponseToGraph(emptyResponse);
    expect(graph.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
    // The §10.6 minimap fit computes maxX - minX; that must be finite for an empty tree.
    expect(Number.isFinite(graph.bounds.maxX - graph.bounds.minX)).toBe(true);
    expect(Number.isFinite(graph.bounds.maxY - graph.bounds.minY)).toBe(true);
  });
});
