import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// @pob2/desktop build config (DESIGN §4.2 React/TypeScript frontend, §5.1 UI
// layer). `pnpm --filter @pob2/desktop build` runs `vite build`, which bundles
// src/main.tsx through index.html into dist/. The React plugin enables the
// automatic JSX runtime (matching tsconfig "jsx": "react-jsx") and Fast Refresh
// under `vite` dev. Workspace deps (@pob2/ui, @pob2/core-client, @pob2/schema)
// resolve through their package exports to the built dist/ and are bundled in.
export default defineConfig({
  plugins: [react()],
  // Pin the dev server port so the Tauri host's `devUrl` (src-tauri/tauri.conf.json)
  // resolves deterministically (DESIGN §5.1 Tauri shell). `strictPort` fails fast
  // instead of silently moving to another port the host would not be pointing at.
  server: { port: 5173, strictPort: true },
});
