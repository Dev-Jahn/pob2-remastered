// gates.mjs — each phase's doneCriteria mapped to concrete verification commands.
// kind: 'shell' (exit code) | 'golden' (calc diff). required:false gates inform but never block.
// Commands target artifacts the phase builds; run-gate.mjs classifies a missing tool/file as
// 'env-missing' (flag, non-blocking) vs 'fail'.
//
// Visual layout verification is NOT a run-gate shell gate: asserting "the screen matches DESIGN
// §10" needs a served app + an LLM (gemini-vision), which a headless exit-code gate cannot do.
// Those screens live in VISUAL (below) and are verified by the phase-pipeline gate-agent and the
// driver via serve → Playwright screenshot → gemini-vision (spec §6).
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
  ],
  4: [
    ...BASE,
    {
      name: 'calc-mutation',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/ui test calcs',
    },
  ],
  5: [
    ...BASE,
    {
      name: 'tree-transform',
      kind: 'shell',
      required: true,
      cmd: 'pnpm --filter @pob2/ui test tree',
    },
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

// Screens to verify visually per phase (DESIGN §10). The route is relative to the app's served
// root. Verified by gemini-vision (gate-agent + driver), NOT by run-gate. `assert` lists the
// concrete layout facts the screenshot must satisfy.
export const VISUAL = {
  2: [
    {
      name: 'overview',
      route: '/',
      assert: [
        '3-pane shell: left nav (Overview/Skills/Items/…), center workspace, right inspector (§10.2)',
        'Overview stat cards: offence (DPS/avg hit/crit) + defence (life/ES/res/EHP) + resource + warnings (§10.3)',
        'Korean labels visible with English aliases; ko/en toggle present (§8.1)',
      ],
    },
  ],
  3: [
    {
      name: 'items',
      route: '/items',
      assert: [
        'Items 3-region: equipped gear grid | item library search | inspector (§10.4)',
        'Item cards show rarity color, base type, and +DPS/-EHP delta chips',
      ],
    },
  ],
  4: [
    {
      name: 'calcs',
      route: '/calcs',
      assert: [
        'Calcs breakdown tree: Summary/Offence/Defence/Resource with source list + formula trace (§10.7)',
      ],
    },
  ],
  5: [
    {
      name: 'tree',
      route: '/tree',
      assert: [
        'Passive tree canvas renders nodes + edges; minimap present; node search box (§10.6)',
      ],
    },
  ],
};
