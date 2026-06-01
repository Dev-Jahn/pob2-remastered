import { describe, it, expect } from 'vitest';
import { assertStats } from '../assert-stats.mjs';

describe('assertStats', () => {
  it('accepts non-empty JSON object', () => {
    expect(assertStats('{"TotalDPS": 1234, "Life": 5000}')).toContain('TotalDPS');
  });
  it('rejects empty stdin', () => expect(() => assertStats('')).toThrow(/no stat output/));
  it('rejects non-JSON', () => expect(() => assertStats('boot ok')).toThrow(/not JSON/));
  it('rejects empty object', () => expect(() => assertStats('{}')).toThrow(/no keys/));
});
