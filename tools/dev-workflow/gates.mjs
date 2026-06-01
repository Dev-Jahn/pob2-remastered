// gates.mjs — each phase's doneCriteria mapped to concrete verification commands.
// kind: 'shell' (exit code) | 'golden' (calc diff) | 'visual' (screenshot+vision).
// required:false gates inform but never block. Commands target artifacts the phase builds;
// run-gate.mjs classifies a missing tool/file as 'env-missing' (flag, non-blocking) vs 'fail'.
const REPO = 'pnpm -w';
const BASE = [
  { name: 'format', kind: 'shell', required: true, cmd: `${REPO} format:check` },
  { name: 'lint', kind: 'shell', required: true, cmd: `${REPO} lint` },
  { name: 'typecheck', kind: 'shell', required: true, cmd: `${REPO} typecheck` },
  // Guards + pipeline correctness must not regress in any later phase (Phase 0 review §).
  {
    name: 'dev-workflow-tests',
    kind: 'shell',
    required: true,
    cmd: 'pnpm --filter @pob2/dev-workflow test',
  },
];
const visual = (name, screen) => ({
  name: `visual:${name}`,
  kind: 'visual',
  required: true,
  cmd: `node tools/dev-workflow/visual-verify.mjs url http://localhost:5173/${screen} /tmp/pob-${name}.png 1366x768`,
});

export const GATES = {
  0: [
    {
      name: 'vendor-clean',
      kind: 'shell',
      required: true,
      cmd: 'git diff --quiet vendor/PathOfBuilding-PoE2 && echo CLEAN',
    },
    {
      name: 'core-runner-boot',
      kind: 'shell',
      required: true,
      // Boots the headless Lua core, loads a sample build, prints main stats as JSON.
      // assert-stats fails unless real stat JSON appears on stdout — so the comment-only
      // stub cannot false-pass. Honest "not done yet" until Phase 0 implements it.
      cmd: 'lua overlays/lua/headless_bootstrap.lua --print-stats | node tools/dev-workflow/assert-stats.mjs',
    },
  ],
  1: [
    ...BASE,
    {
      name: 'golden-parity',
      kind: 'golden',
      required: true,
      cmd: 'pnpm --filter @pob2/core-client test golden',
    },
    { name: 'rpc-schema', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/schema test' },
    {
      name: 'crash-isolation',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/core-client test crash',
    },
  ],
  2: [
    ...BASE,
    {
      name: 'cargo-check',
      kind: 'shell',
      required: true,
      cmd: 'cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml',
    },
    { name: 'web-build', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/desktop build' },
    { name: 'ui-unit', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test' },
    visual('overview', ''),
    {
      name: 'i18n-toggle',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/desktop test i18n',
    },
  ],
  3: [
    ...BASE,
    {
      name: 'parser-fixtures',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/core-client test parser',
    },
    { name: 'items-unit', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test items' },
    visual('items', 'items'),
  ],
  4: [
    ...BASE,
    {
      name: 'calc-mutation',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/ui test calcs',
    },
    visual('calcs', 'calcs'),
  ],
  5: [
    ...BASE,
    {
      name: 'tree-transform',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/ui test tree',
    },
    visual('tree', 'tree'),
  ],
  6: [
    ...BASE,
    {
      name: 'importer-dryrun',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/localization test importer',
    },
    {
      name: 'coverage',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/localization run coverage:check',
    },
    {
      name: 'bilingual-search',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/localization test search',
    },
  ],
  7: [
    ...BASE,
    {
      name: 'sync-dryrun',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/upstream-sync run dry-run',
    },
    {
      name: 'updater-rollback',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/desktop test updater',
    },
    {
      name: 'diagnostic-schema',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/schema test diagnostic',
    },
  ],
};
