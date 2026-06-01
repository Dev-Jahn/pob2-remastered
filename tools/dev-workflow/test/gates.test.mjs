import { describe, it, expect } from 'vitest';
import { GATES, VISUAL } from '../gates.mjs';
import { PHASES } from '../phases.mjs';

describe('GATES', () => {
  it('defines gates for every phase in PHASES', () => {
    for (const id of Object.keys(PHASES)) {
      expect(Array.isArray(GATES[id]), `gates for phase ${id}`).toBe(true);
      expect(GATES[id].length, `phase ${id} non-empty`).toBeGreaterThan(0);
    }
  });
  it('every gate has name/kind/required/cmd with valid kind', () => {
    // Visual layout is verified by gemini-vision, not run-gate, so GATES holds only shell/golden.
    const kinds = new Set(['shell', 'golden']);
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

describe('VISUAL', () => {
  it('every visual screen has name, route, and non-empty assert list', () => {
    for (const [phase, screens] of Object.entries(VISUAL)) {
      expect(Array.isArray(screens), `VISUAL[${phase}] is array`).toBe(true);
      for (const s of screens) {
        expect(typeof s.name, `${phase} name`).toBe('string');
        expect(s.route.startsWith('/'), `${phase}/${s.name} route is absolute`).toBe(true);
        expect(Array.isArray(s.assert) && s.assert.length > 0, `${phase}/${s.name} asserts`).toBe(
          true,
        );
      }
    }
  });
  it('UI phases 2–5 each define at least one visual screen', () => {
    for (const phase of [2, 3, 4, 5]) {
      expect(VISUAL[phase]?.length, `phase ${phase} visual screens`).toBeGreaterThan(0);
    }
  });
});
