import { defineConfig } from 'vitest/config';

// rpc-schema gate (Phase 1): `pnpm --filter @pob2/schema test` runs `vitest run`,
// which loads every suite under test/ — the registry contract and the AJV-backed
// schema validation suite. Tests import the authored TS source in src/ directly,
// so no build step is required before the gate runs.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
