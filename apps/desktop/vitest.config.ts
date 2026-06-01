import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// @pob2/desktop test gate: `pnpm --filter @pob2/desktop test` runs `vitest run`,
// which loads every suite under test/ as well as App-colocated suites under src/
// (e.g. src/App.i18n.test.tsx — the integration test the `test i18n` gate
// selects). App.tsx mounts React components from @pob2/ui, so the suites run in
// the jsdom environment (a DOM is available to @testing-library/react). The React
// plugin gives the suites the same JSX transform the app build uses, so .tsx test
// files compile identically.
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.test.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
