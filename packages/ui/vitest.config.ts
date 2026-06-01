import { defineConfig } from 'vitest/config';

// @pob2/ui scaffold gate: `pnpm --filter @pob2/ui test` runs `vitest run`, which
// loads every suite under test/. The UI package renders React components, so the
// suites run in the jsdom environment (a DOM is available to @testing-library/react
// and to component code) rather than the default node environment. Tests import
// the authored TS source in src/ directly, so no build step is required first.
// `.tsx` is included so component suites (App shell, §10.2) sit beside the
// pure-logic `.ts` suites under the same gate.
export default defineConfig({
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
