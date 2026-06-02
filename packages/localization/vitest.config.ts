import { defineConfig } from 'vitest/config';

// The Phase 6 per-suite gates resolve a single suite by passing its name as a
// positional filter to `vitest run`, e.g.
//   pnpm --filter @pob2/localization test importer -> vitest run importer
//   pnpm --filter @pob2/localization test search   -> vitest run search
// (the bare `test` script is `vitest run`, see package.json). vitest treats the
// positional as a filename substring filter, so each suite lives in its own
// `test/<name>.test.ts` file. Tests import the authored TS source in src/ directly,
// so no build step is required before the gate runs.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
