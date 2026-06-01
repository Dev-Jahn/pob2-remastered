import { describe, it, expect } from 'vitest';
import { GATES } from '../gates.mjs';
import { PHASES } from '../phases.mjs';

describe('GATES', () => {
  it('defines gates for every phase in PHASES', () => {
    for (const id of Object.keys(PHASES)) {
      expect(Array.isArray(GATES[id]), `gates for phase ${id}`).toBe(true);
      expect(GATES[id].length, `phase ${id} non-empty`).toBeGreaterThan(0);
    }
  });
  it('every gate has name/kind/required/cmd with valid kind', () => {
    const kinds = new Set(['shell', 'golden', 'visual']);
    for (const list of Object.values(GATES)) {
      for (const g of list) {
        expect(typeof g.name).toBe('string');
        expect(kinds.has(g.kind), `kind ${g.kind}`).toBe(true);
        expect(typeof g.required).toBe('boolean');
        expect(typeof g.cmd).toBe('string');
      }
    }
  });
});
