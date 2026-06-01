import { describe, it, expect } from 'vitest';
import { classify, runGate } from '../run-gate.mjs';

describe('classify', () => {
  it('exit 0 → pass', () => expect(classify(0, '', '')).toBe('pass'));
  it('exit 127 → env-missing', () =>
    expect(classify(127, '', 'bash: foo: command not found')).toBe('env-missing'));
  it('not-found stderr → env-missing', () =>
    expect(classify(1, '', 'cargo: No such file or directory')).toBe('env-missing'));
  it('other non-zero → fail', () =>
    expect(classify(1, '', 'AssertionError: expected 5 got 4')).toBe('fail'));
});

describe('runGate', () => {
  it('aggregates: required fail makes overall fail; env-missing does not', async () => {
    const r = await runGate([
      { name: 'ok', kind: 'shell', required: true, cmd: 'true' },
      { name: 'missing', kind: 'shell', required: true, cmd: 'definitely-not-a-real-binary-xyz' },
    ]);
    expect(r.results.find((x) => x.name === 'ok').status).toBe('pass');
    expect(r.results.find((x) => x.name === 'missing').status).toBe('env-missing');
    expect(r.pass).toBe(true); // env-missing is non-blocking
  });
  it('required real failure → overall fail', async () => {
    const r = await runGate([
      {
        name: 'bad',
        kind: 'shell',
        required: true,
        cmd: 'sh -c "echo AssertionError 1>&2; exit 1"',
      },
    ]);
    expect(r.results[0].status).toBe('fail');
    expect(r.pass).toBe(false);
  });
});
