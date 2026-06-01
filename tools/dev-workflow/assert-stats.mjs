// assert-stats.mjs — reads stdin, asserts it is non-empty JSON describing build stats.
// Used by gates so a no-op/stub core runner cannot false-pass (NO-FALLBACK).
import { readFileSync } from 'node:fs';

export function assertStats(text) {
  const s = (text || '').trim();
  if (!s) throw new Error('no stat output on stdin');
  let j;
  try {
    j = JSON.parse(s);
  } catch (e) {
    throw new Error(`stat output is not JSON: ${e.message}`);
  }
  const keys = j && typeof j === 'object' ? Object.keys(j) : [];
  if (keys.length < 1) throw new Error('stat JSON has no keys');
  return keys;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const keys = assertStats(readFileSync(0, 'utf8'));
    console.log(`OK ${keys.length} stat keys`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
