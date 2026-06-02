// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/target/**',
      'vendor/**',
      '**/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Node-side scripts (dev-workflow CLIs, tooling, config) run under Node, not the browser.
    files: ['tools/**/*.{mjs,cjs,js}', '**/*.config.{mjs,cjs,js}'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // visual-verify.mjs is Node-side, but its Playwright `page.evaluate` callbacks
    // are serialized and run in the chromium page, where the browser DOM globals
    // (document, HTMLCanvasElement) are legitimately defined.
    files: ['tools/dev-workflow/visual-verify.mjs'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    // phase-pipeline.mjs is a Claude Code Workflow script: it runs in the Workflow
    // runtime, which injects these globals and wraps the body in an async fn.
    files: ['tools/dev-workflow/phase-pipeline.mjs'],
    languageOptions: {
      globals: {
        agent: 'readonly',
        phase: 'readonly',
        parallel: 'readonly',
        pipeline: 'readonly',
        log: 'readonly',
        args: 'readonly',
        budget: 'readonly',
        workflow: 'readonly',
      },
    },
  },
);
