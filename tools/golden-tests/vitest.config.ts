import { defineConfig } from 'vitest/config';

// The golden corpus boots the vendored Lua core once per fixture through the real
// runner subprocess (build.load -> calc.run), which is well over the default 5s
// timeout, so the suite-level timeout is widened (mirrors @pob2/core-client).
export default defineConfig({
  test: {
    include: ['test/**/*.test.mjs'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
