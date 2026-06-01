// First @pob2/ui test — its only job is to prove the test runner is wired
// (jsdom env, vitest, @testing-library/react) per the ui-scaffold task. It
// asserts the trivial UI_VERSION barrel export and that we are running in a DOM
// environment (so jsdom is actually loaded), which exercises the jsdom-backed
// vitest config without depending on any real component yet.
import { describe, it, expect } from 'vitest';
import { UI_VERSION } from '../src/index.js';

describe('@pob2/ui scaffold', () => {
  it('exports a semver-shaped UI_VERSION from the barrel', () => {
    expect(UI_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('runs under the jsdom environment (document is defined)', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement('div').tagName).toBe('DIV');
  });
});
