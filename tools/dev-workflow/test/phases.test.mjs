import { describe, it, expect } from 'vitest';
import { PHASES } from '../phases.mjs';

describe('PHASES', () => {
  it('covers phases 0..7', () => {
    expect(Object.keys(PHASES).map(Number).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('every phase has goal + non-empty tasks + non-empty doneCriteria', () => {
    for (const [id, p] of Object.entries(PHASES)) {
      expect(typeof p.goal, `phase ${id} goal`).toBe('string');
      expect(p.tasks.length, `phase ${id} tasks`).toBeGreaterThan(0);
      expect(p.doneCriteria.length, `phase ${id} doneCriteria`).toBeGreaterThan(0);
    }
  });
});
