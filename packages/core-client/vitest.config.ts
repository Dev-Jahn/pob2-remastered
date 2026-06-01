import { defineConfig } from 'vitest/config';

// The per-suite gate commands resolve a single suite by passing its name as a
// positional filter to `vitest run`, e.g.
//   pnpm --filter @pob2/core-client test smoke   -> vitest run smoke
//   pnpm --filter @pob2/core-client test golden  -> vitest run golden
//   pnpm --filter @pob2/core-client test crash   -> vitest run crash
//   pnpm --filter @pob2/core-client test parser  -> vitest run parser
// (the bare `test` script is `vitest run`, see package.json). vitest treats the
// positional as a filename substring filter, so each suite lives in its own
// `test/<name>.test.ts` file.
//
// The smoke test spawns the real Lua runner subprocess (build.load -> calc.run),
// which boots the vendored core; that is well over the default 5s timeout, so the
// suite-level timeout is widened.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
