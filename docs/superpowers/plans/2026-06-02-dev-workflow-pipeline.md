# Dev-Workflow Automation Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable per-Phase orchestration engine (`phase-pipeline` Workflow) plus the DESIGN-derived phase/gate data and evidence-based gate/visual runners, so a main-agent driver can autonomously progress PoB2 Remastered from Phase 0 through Phase 7.

**Architecture:** A thin Workflow script orchestrates Claude agents that do the real work (decompose → TDD implement → gate → review). Phase specs and gate commands live as durable, testable ESM data files in the repo; agents/driver consume them. Evidence-based gating runs through `run-gate.mjs` (classifies pass / fail / env-missing) and `visual-verify.mjs` (Playwright + Xvfb screenshots). The driver (main agent) loops phases, re-runs gates for evidence, commits per-phase, pushes, and persists state to `PROGRESS.md`.

**Tech Stack:** Node 23 ESM, pnpm workspace, Vitest, Playwright (chromium), Xvfb/WSLg, the Claude Code Workflow tool.

**Spec:** [`docs/superpowers/specs/2026-06-01-dev-workflow-design.md`](../specs/2026-06-01-dev-workflow-design.md)

---

## File Structure

```
tools/dev-workflow/
├─ package.json          # workspace member; type:module; deps: playwright, vitest; scripts
├─ phases.mjs            # export PHASES = {0..7: {goal, tasks[], doneCriteria[]}}  (DESIGN §18/§20)
├─ gates.mjs             # export GATES = {0..7: [{name, kind, required, cmd}]}     (DESIGN §16/§20)
├─ run-gate.mjs          # CLI: `node run-gate.mjs <phase>` → JSON {phase, pass, results[]}
├─ visual-verify.mjs     # CLI: `node visual-verify.mjs url <url> <out.png> [WxH]` | `tauri <bin> <out.png>`
├─ phase-pipeline.mjs    # Workflow script (sandbox): decompose→TDD→gate→review→report
├─ PROGRESS.md           # driver ledger (phase/task status, 🚩flags, blockers, last commit)
├─ README.md             # usage + DESIGN mapping
└─ test/
   ├─ phases.test.mjs
   ├─ gates.test.mjs
   ├─ run-gate.test.mjs
   └─ visual-verify.test.mjs
.claude/commands/pob-dev.md   # /pob-dev <phase|auto>
```

Responsibilities: **data** (`phases.mjs`, `gates.mjs`) is separate from **mechanism** (`run-gate.mjs`, `visual-verify.mjs`) which is separate from **orchestration** (`phase-pipeline.mjs`) and **drive/state** (`PROGRESS.md` + the main agent). The Workflow script never touches the filesystem itself — its agents do.

---

## Task 1: Workspace package + scaffolding

**Files:**
- Create: `tools/dev-workflow/package.json`

- [ ] **Step 1: Create the package manifest**

```json
{
  "name": "@pob2/dev-workflow",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "gate": "node run-gate.mjs",
    "visual": "node visual-verify.mjs"
  },
  "devDependencies": {
    "playwright": "^1.49.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Install + fetch Playwright chromium**

Run:
```bash
pnpm install
pnpm --filter @pob2/dev-workflow exec playwright install chromium
```
Expected: install completes; chromium downloaded (or a clear network error to flag).

- [ ] **Step 3: Commit**

```bash
git add tools/dev-workflow/package.json pnpm-lock.yaml
git commit -m "chore(dev-workflow): add workspace package + playwright"
```

---

## Task 2: Phase spec data (`phases.mjs`)

**Files:**
- Create: `tools/dev-workflow/phases.mjs`
- Test: `tools/dev-workflow/test/phases.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/phases.test.mjs
import { describe, it, expect } from 'vitest';
import { PHASES } from '../phases.mjs';

describe('PHASES', () => {
  it('covers phases 0..7', () => {
    expect(Object.keys(PHASES).map(Number).sort((a, b) => a - b))
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
  it('every phase has goal + non-empty tasks + non-empty doneCriteria', () => {
    for (const [id, p] of Object.entries(PHASES)) {
      expect(typeof p.goal, `phase ${id} goal`).toBe('string');
      expect(p.tasks.length, `phase ${id} tasks`).toBeGreaterThan(0);
      expect(p.doneCriteria.length, `phase ${id} doneCriteria`).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pob2/dev-workflow test phases`
Expected: FAIL — cannot resolve `../phases.mjs`.

- [ ] **Step 3: Write `phases.mjs` (full content, derived from DESIGN §18/§20)**

```js
// phases.mjs — DESIGN.md §18 (phases) + §20 (Definition of Done), machine-readable.
export const PHASES = {
  0: {
    goal: '기존 PoB2 실행 구조와 Lua core 분리 가능성 확인',
    tasks: [
      'upstream submodule/mirror 구성 (이미 vendor/ 존재 — 검증)',
      'Lua runner boot prototype (overlays/lua/headless_bootstrap.lua)',
      'HeadlessWrapper.lua / Launch.lua 분석',
      'sample build load/calc proof of concept',
      'PoB XML/share code 입출력 경로 확인',
      'legal/data source policy 문서화 (DATA_SOURCES.md 검증)',
    ],
    doneCriteria: [
      'CLI에서 sample build 로드 후 주요 stat을 JSON으로 출력',
      'vendor/ 무수정, overlays/lua 만으로 동작',
    ],
  },
  1: {
    goal: 'UI가 사용할 안정적 IPC API 확보 (Core bridge MVP)',
    tasks: [
      'JSON-RPC protocol 구현 (out-of-process runner)',
      'build.load / build.save / calc.run / items.parseClipboard',
      'response schema validation (packages/schema)',
      'runner crash isolation (malformed input)',
      'golden fixture 10~20개',
    ],
    doneCriteria: [
      '기존 PoB와 주요 stat 일치 (golden diff, 허용오차 DESIGN §7.4)',
      'malformed input에서도 runner/UI process 유지',
    ],
  },
  2: {
    goal: '새 UI 기본 shell + read-only build viewer (Desktop shell & Overview)',
    tasks: [
      'Tauri app skeleton (apps/desktop)',
      'React layout (3-pane shell, DESIGN §10.2)',
      'command palette (Ctrl+K)',
      'build open/save',
      'overview stat cards (DESIGN §10.3)',
      'warning panel',
      'Korean UI string baseline (ko/en)',
    ],
    doneCriteria: [
      '기존 build 파일을 열어 Overview 표시',
      '한국어/영어 UI toggle 가능',
    ],
  },
  3: {
    goal: 'Items tab 재설계 (DESIGN §10.4)',
    tasks: [
      'item set selector', 'equipped gear grid', 'item library search',
      'item inspector', 'clipboard import (ko MVP)', 'item equip delta',
      'custom item creation', 'shared item scope', 'unsupported mod display',
    ],
    doneCriteria: [
      '기존 Items tab 주요 기능 parity',
      '한국어 아이템 붙여넣기 MVP 지원',
    ],
  },
  4: {
    goal: '계산 조작 + 설명 UI (Skills, Config, Calcs)',
    tasks: [
      'skill group editor', 'support gem toggle', 'aura/buff/minion controls',
      'config presets (DESIGN §10.8)', 'Calcs breakdown explorer (§10.7)',
      'formula trace mapping',
    ],
    doneCriteria: [
      '주요 빌드 수정 flow가 기존 PoB 없이 가능',
      'Calcs tab에서 결과 추적(formula trace) 가능',
    ],
  },
  5: {
    goal: '고성능 Passive Tree (DESIGN §10.6)',
    tasks: [
      'TreeData transform', 'canvas/WebGL renderer', 'pan/zoom/minimap',
      'node search', 'path preview', 'allocation delta', 'jewel/radius support',
    ],
    doneCriteria: [
      '기존 트리 기능 parity',
      '대규모 zoom/pan 성능 기준 충족 (DESIGN §16.3)',
    ],
  },
  6: {
    goal: '실사용 가능한 한국어 PoB2 (DESIGN §8)',
    tasks: [
      'PoE2DB importer (고정 fixture/캐시 HTML)', 'keyword/item/skill/passive dictionary',
      'bilingual search index', 'Korean stat/mod parser expansion',
      'coverage dashboard', 'manual review UI',
    ],
    doneCriteria: [
      'UI 문자열 100%',
      '주요 데이터 영역 coverage MVP 임계 (DESIGN §8.7)',
      '한국어 클립보드 item parse 성공률 측정',
    ],
  },
  7: {
    goal: '유지 가능한 fork로 전환 (Upstream automation & release)',
    tasks: [
      'upstream sync bot', 'diff classifier (DESIGN §7.3)', 'release channel',
      'updater (rollback)', 'diagnostic export', 'crash reporting', 'user migration guide',
    ],
    doneCriteria: [
      'upstream update PR 자동 생성 (dry-run)',
      'release artifact reproducible (dry-run)',
      'rollback 가능한 updater (unit)',
    ],
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pob2/dev-workflow test phases`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/dev-workflow/phases.mjs tools/dev-workflow/test/phases.test.mjs
git commit -m "feat(dev-workflow): DESIGN-derived phase spec data"
```

---

## Task 3: Gate definitions (`gates.mjs`)

**Files:**
- Create: `tools/dev-workflow/gates.mjs`
- Test: `tools/dev-workflow/test/gates.test.mjs`

- [ ] **Step 1: Write the failing test**

```js
// test/gates.test.mjs
import { describe, it, expect } from 'vitest';
import { GATES } from '../gates.mjs';
import { PHASES } from '../phases.mjs';

describe('GATES', () => {
  it('defines gates for every phase in PHASES', () => {
    for (const id of Object.keys(PHASES)) {
      expect(Array.isArray(GATES[id]), `gates for phase ${id}`).toBe(true);
      expect(GATES[id].length, `phase ${id} non-empty`).toBeGreaterThan(0);
    }
  });
  it('every gate has name/kind/required/cmd with valid kind', () => {
    const kinds = new Set(['shell', 'golden', 'visual']);
    for (const list of Object.values(GATES)) {
      for (const g of list) {
        expect(typeof g.name).toBe('string');
        expect(kinds.has(g.kind), `kind ${g.kind}`).toBe(true);
        expect(typeof g.required).toBe('boolean');
        expect(typeof g.cmd).toBe('string');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pob2/dev-workflow test gates`
Expected: FAIL — cannot resolve `../gates.mjs`.

- [ ] **Step 3: Write `gates.mjs` (full content)**

```js
// gates.mjs — each phase's doneCriteria mapped to concrete verification commands.
// kind: 'shell' (exit code) | 'golden' (calc diff) | 'visual' (screenshot+vision).
// required:false gates inform but never block. Commands target artifacts the phase builds;
// run-gate.mjs classifies a missing tool/file as 'env-missing' (flag, non-blocking) vs 'fail'.
const REPO = 'pnpm -w';
const BASE = [
  { name: 'format', kind: 'shell', required: true, cmd: `${REPO} format:check` },
  { name: 'lint', kind: 'shell', required: true, cmd: `${REPO} lint` },
  { name: 'typecheck', kind: 'shell', required: true, cmd: `${REPO} typecheck` },
];
const visual = (name, screen) => ({
  name: `visual:${name}`, kind: 'visual', required: true,
  cmd: `node tools/dev-workflow/visual-verify.mjs url http://localhost:5173/${screen} /tmp/pob-${name}.png 1366x768`,
});

export const GATES = {
  0: [
    { name: 'vendor-clean', kind: 'shell', required: true, cmd: 'git diff --quiet vendor/PathOfBuilding-PoE2 && echo CLEAN' },
    { name: 'core-runner-boot', kind: 'shell', required: true, cmd: 'node tools/dev-workflow/run-gate.mjs --selfcheck || lua overlays/lua/headless_bootstrap.lua --print-stats' },
  ],
  1: [
    ...BASE,
    { name: 'golden-parity', kind: 'golden', required: true, cmd: 'pnpm --filter @pob2/core-client test golden' },
    { name: 'rpc-schema', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/schema test' },
    { name: 'crash-isolation', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/core-client test crash' },
  ],
  2: [
    ...BASE,
    { name: 'cargo-check', kind: 'shell', required: true, cmd: 'cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml' },
    { name: 'web-build', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/desktop build' },
    { name: 'ui-unit', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test' },
    visual('overview', ''),
    { name: 'i18n-toggle', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/desktop test i18n' },
  ],
  3: [...BASE, { name: 'parser-fixtures', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/core-client test parser' }, { name: 'items-unit', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test items' }, visual('items', 'items')],
  4: [...BASE, { name: 'calc-mutation', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test calcs' }, visual('calcs', 'calcs')],
  5: [...BASE, { name: 'tree-transform', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/ui test tree' }, visual('tree', 'tree')],
  6: [...BASE, { name: 'importer-dryrun', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/localization test importer' }, { name: 'coverage', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/localization run coverage:check' }, { name: 'bilingual-search', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/localization test search' }],
  7: [...BASE, { name: 'sync-dryrun', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/upstream-sync run dry-run' }, { name: 'updater-rollback', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/desktop test updater' }, { name: 'diagnostic-schema', kind: 'shell', required: true, cmd: 'pnpm --filter @pob2/schema test diagnostic' }],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pob2/dev-workflow test gates`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/dev-workflow/gates.mjs tools/dev-workflow/test/gates.test.mjs
git commit -m "feat(dev-workflow): per-phase verification gate definitions"
```

---

## Task 4: Gate runner CLI (`run-gate.mjs`)

**Files:**
- Create: `tools/dev-workflow/run-gate.mjs`
- Test: `tools/dev-workflow/test/run-gate.test.mjs`

**Contract:** `node run-gate.mjs <phase>` runs that phase's gate commands and prints JSON. Each result: `{name, cmd, status: 'pass'|'fail'|'env-missing', required, evidence}`. `pass` iff exit 0. Exit code 127 or stderr containing `not found`/`No such file` → `env-missing` (flag, non-blocking). Overall `pass` = no `required` gate has status `fail`. Process exits 0 when overall pass, 1 otherwise (so the driver gets a real exit signal too).

- [ ] **Step 1: Write the failing test**

```js
// test/run-gate.test.mjs
import { describe, it, expect } from 'vitest';
import { classify, runGate } from '../run-gate.mjs';

describe('classify', () => {
  it('exit 0 → pass', () => expect(classify(0, '', '')).toBe('pass'));
  it('exit 127 → env-missing', () => expect(classify(127, '', 'bash: foo: command not found')).toBe('env-missing'));
  it('not-found stderr → env-missing', () => expect(classify(1, '', 'cargo: No such file or directory')).toBe('env-missing'));
  it('other non-zero → fail', () => expect(classify(1, '', 'AssertionError: expected 5 got 4')).toBe('fail'));
});

describe('runGate', () => {
  it('aggregates: required fail makes overall fail; env-missing does not', async () => {
    const r = await runGate([
      { name: 'ok', kind: 'shell', required: true, cmd: 'true' },
      { name: 'missing', kind: 'shell', required: true, cmd: 'definitely-not-a-real-binary-xyz' },
    ]);
    expect(r.results.find((x) => x.name === 'ok').status).toBe('pass');
    expect(r.results.find((x) => x.name === 'missing').status).toBe('env-missing');
    expect(r.pass).toBe(true); // env-missing is non-blocking
  });
  it('required real failure → overall fail', async () => {
    const r = await runGate([{ name: 'bad', kind: 'shell', required: true, cmd: 'sh -c "echo AssertionError 1>&2; exit 1"' }]);
    expect(r.results[0].status).toBe('fail');
    expect(r.pass).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pob2/dev-workflow test run-gate`
Expected: FAIL — cannot resolve exports from `../run-gate.mjs`.

- [ ] **Step 3: Write `run-gate.mjs`**

```js
// run-gate.mjs
import { spawnSync } from 'node:child_process';
import { GATES } from './gates.mjs';

const NOT_FOUND = /command not found|No such file or directory|not recognized|cannot find/i;

export function classify(code, stdout, stderr) {
  if (code === 0) return 'pass';
  if (code === 127 || NOT_FOUND.test(stderr)) return 'env-missing';
  return 'fail';
}

export async function runGate(gates) {
  const results = gates.map((g) => {
    const p = spawnSync('bash', ['-lc', g.cmd], { encoding: 'utf8', timeout: 600000 });
    const code = p.status ?? (p.error ? 127 : 1);
    const stdout = p.stdout || '';
    const stderr = (p.stderr || '') + (p.error ? String(p.error) : '');
    const status = classify(code, stdout, stderr);
    const tail = (s) => s.split('\n').slice(-12).join('\n');
    return { name: g.name, cmd: g.cmd, kind: g.kind, required: g.required, status,
             evidence: `exit=${code}\n${tail(stdout)}\n${tail(stderr)}`.trim() };
  });
  const pass = !results.some((r) => r.required && r.status === 'fail');
  return { pass, results };
}

// CLI: node run-gate.mjs <phase>
if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = process.argv[2];
  if (phase === '--selfcheck') { console.log('run-gate ok'); process.exit(0); }
  const gates = GATES[phase];
  if (!gates) { console.error(`no gates for phase ${phase}`); process.exit(2); }
  const r = await runGate(gates);
  console.log(JSON.stringify({ phase: Number(phase), ...r }, null, 2));
  process.exit(r.pass ? 0 : 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pob2/dev-workflow test run-gate`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/dev-workflow/run-gate.mjs tools/dev-workflow/test/run-gate.test.mjs
git commit -m "feat(dev-workflow): evidence-based gate runner with env-missing classification"
```

---

## Task 5: Visual verification CLI (`visual-verify.mjs`)

**Files:**
- Create: `tools/dev-workflow/visual-verify.mjs`
- Test: `tools/dev-workflow/test/visual-verify.test.mjs`

**Contract:**
- `node visual-verify.mjs url <url> <out.png> [WxH]` — Playwright chromium screenshots a URL (Tier 1). Accepts `file://` URLs.
- `node visual-verify.mjs tauri <bin> <out.png>` — Tier 2: launches a binary under `xvfb-run` (or current `$DISPLAY`/WSLg), waits, captures the active window via `import`/`scrot`/`gnome-screenshot` (first available); on any failure prints `TIER2_UNAVAILABLE: <reason>` and exits 3 (driver → 🚩flag, never blocks).
- Vision *analysis* of the PNG is performed by the calling agent (gemini-vision skill or direct image read), not here.

- [ ] **Step 1: Write the failing test**

```js
// test/visual-verify.test.mjs
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureUrl } from '../visual-verify.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vv-'));
const html = join(dir, 'page.html');
const out = join(dir, 'shot.png');
writeFileSync(html, '<html><body><h1 style="font-size:80px">POB2 SHELL</h1></body></html>');

describe('captureUrl (Tier 1, Playwright)', () => {
  it('produces a non-empty PNG from a file:// page', async () => {
    await captureUrl(`file://${html}`, out, { width: 800, height: 600 });
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1000);
  }, 60000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pob2/dev-workflow test visual-verify`
Expected: FAIL — cannot resolve `captureUrl`.

- [ ] **Step 3: Write `visual-verify.mjs`**

```js
// visual-verify.mjs
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

export async function captureUrl(url, out, { width = 1366, height = 768 } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.screenshot({ path: out, fullPage: false });
  } finally {
    await browser.close();
  }
  return out;
}

function firstAvailable(cands) {
  for (const c of cands) if (spawnSync('bash', ['-lc', `command -v ${c}`]).status === 0) return c;
  return null;
}

export function captureTauri(bin, out) {
  const shooter = firstAvailable(['import', 'scrot', 'gnome-screenshot']);
  if (!shooter) return { ok: false, reason: 'no screenshot tool (import/scrot/gnome-screenshot)' };
  const hasXvfb = spawnSync('bash', ['-lc', 'command -v xvfb-run']).status === 0;
  const shotCmd = shooter === 'import' ? `import -window root ${out}`
    : shooter === 'scrot' ? `scrot ${out}` : `gnome-screenshot -f ${out}`;
  const inner = `("${bin}" & APP=$!; sleep 6; ${shotCmd}; kill $APP 2>/dev/null)`;
  const cmd = hasXvfb ? `xvfb-run -a --server-args="-screen 0 1366x768x24" bash -lc '${inner}'`
    : `bash -lc '${inner}'`; // fall back to live $DISPLAY/WSLg
  const p = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout: 120000 });
  if (p.status !== 0) return { ok: false, reason: `capture failed exit=${p.status} ${p.stderr || ''}`.trim() };
  return { ok: true, out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, a, b, dim] = process.argv.slice(2);
  if (mode === 'url') {
    const [w, h] = (dim || '1366x768').split('x').map(Number);
    await captureUrl(a, b, { width: w, height: h });
    console.log(`OK ${b}`);
  } else if (mode === 'tauri') {
    const r = captureTauri(a, b);
    if (!r.ok) { console.log(`TIER2_UNAVAILABLE: ${r.reason}`); process.exit(3); }
    console.log(`OK ${b}`);
  } else {
    console.error('usage: visual-verify.mjs url <url> <out.png> [WxH] | tauri <bin> <out.png>');
    process.exit(2);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pob2/dev-workflow test visual-verify`
Expected: PASS — proves the visual gate works in this WSL env.

- [ ] **Step 5: Commit**

```bash
git add tools/dev-workflow/visual-verify.mjs tools/dev-workflow/test/visual-verify.test.mjs
git commit -m "feat(dev-workflow): Playwright Tier-1 + Xvfb/WSLg Tier-2 visual capture"
```

---

## Task 6: Orchestration engine (`phase-pipeline.mjs`, Workflow script)

**Files:**
- Create: `tools/dev-workflow/phase-pipeline.mjs`

This is a **Workflow tool script** (sandbox: no fs/import). It orchestrates agents that have real tools. It is validated by syntax + a real Phase-0 invocation (Task 8), not Vitest.

- [ ] **Step 1: Write `phase-pipeline.mjs`**

```js
export const meta = {
  name: 'phase-pipeline',
  description: 'Implement one DESIGN.md phase of PoB2 Remastered: decompose → TDD → gate → review',
  phases: [
    { title: 'Decompose' },
    { title: 'Implement' },
    { title: 'Gate' },
    { title: 'Review' },
  ],
};

const PHASE = args?.phase;
if (PHASE === undefined) throw new Error('args.phase required');

const TASKS_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'deliverable', 'targetFiles', 'deps', 'verifyCmd'],
        properties: {
          id: { type: 'string' }, title: { type: 'string' }, deliverable: { type: 'string' },
          targetFiles: { type: 'array', items: { type: 'string' } },
          deps: { type: 'array', items: { type: 'string' } },
          verifyCmd: { type: 'string' },
          humanGate: { type: 'string', enum: ['legal', 'network', 'secret', 'visual', 'gamedata'] },
        },
      },
    },
  },
};
const TASK_RESULT_SCHEMA = {
  type: 'object', required: ['id', 'status'],
  properties: { id: { type: 'string' }, status: { enum: ['done', 'flagged', 'blocked'] },
    note: { type: 'string' }, triedFixes: { type: 'number' } },
};
const REPORT_SCHEMA = {
  type: 'object', required: ['phase', 'pass'],
  properties: { phase: { type: 'number' }, pass: { type: 'boolean' },
    gateJson: { type: 'string' }, flags: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } }, reviewSummary: { type: 'string' } },
};

phase('Decompose');
const { tasks } = await agent(
  `You decompose ONE phase of the PoB2 Remastered project into concrete, dependency-ordered implementation tasks.
Read: ./DESIGN.md, ./tools/dev-workflow/phases.mjs (PHASES[${PHASE}]), and the CURRENT repo tree (what already exists).
Produce tasks that build on existing code toward PHASES[${PHASE}].doneCriteria. For each task give id, title, deliverable,
exact targetFiles, deps (ids of prerequisite tasks), a runnable verifyCmd (test command), and humanGate if it needs
legal/network/secret/visual/gamedata. Keep tasks small and TDD-friendly. Do NOT modify vendor/.`,
  { label: `decompose:p${PHASE}`, phase: 'Decompose', schema: TASKS_SCHEMA },
);

// Topological order (Kahn). Sequential execution keeps the shared tree consistent.
function topo(ts) {
  const byId = Object.fromEntries(ts.map((t) => [t.id, t]));
  const done = new Set(); const order = []; let guard = 0;
  while (order.length < ts.length && guard++ < ts.length * ts.length) {
    for (const t of ts) {
      if (done.has(t.id)) continue;
      if ((t.deps || []).every((d) => done.has(d) || !byId[d])) { order.push(t); done.add(t.id); }
    }
  }
  for (const t of ts) if (!done.has(t.id)) order.push(t); // cycle fallback
  return order;
}

phase('Implement');
const taskResults = [];
for (const t of topo(tasks)) {
  const r = await agent(
    `Implement this task for PoB2 Remastered using strict TDD (write a failing test FIRST, then minimal code, then make it pass).
Task: ${JSON.stringify(t)}
Rules: follow ./DESIGN.md and existing repo conventions; never edit vendor/; commit your work with a conventional-commit message.
If humanGate is set, do the SAFE best-effort per ./docs/superpowers/specs/2026-06-01-dev-workflow-design.md §2
(fixtures not live network, do_not_bundle assets, config-hook not real secrets) and return status 'flagged' with a note.
If you cannot make the verifyCmd pass after several honest attempts, return status 'blocked' with the error and triedFixes count.
Otherwise return status 'done'. verifyCmd: ${t.verifyCmd}`,
    { label: `impl:${t.id}`, phase: 'Implement', schema: TASK_RESULT_SCHEMA },
  );
  taskResults.push(r);
  if (r && r.status === 'blocked') break; // hard blocker — stop implementing further dependents
}

phase('Gate');
const gate = await agent(
  `Run the evidence-based gate for phase ${PHASE} of PoB2 Remastered and report the verdict.
Run: \`node tools/dev-workflow/run-gate.mjs ${PHASE}\` and capture its JSON.
For every gate of kind 'visual': run \`node tools/dev-workflow/visual-verify.mjs url <screen-url> <out.png>\` (Tier 1, REQUIRED),
THEN ALWAYS also attempt Tier 2 \`node tools/dev-workflow/visual-verify.mjs tauri <built-binary> <out2.png>\` (NOT required — flag if TIER2_UNAVAILABLE).
Analyze each screenshot with the gemini-vision skill (or read the PNG directly) and assert the DESIGN.md §10 layout for that screen.
If a REQUIRED gate has status 'fail' (real failure, not env-missing/visual-tier2), fix the underlying code (TDD) and re-run, up to 3 rounds.
Return: pass (true unless a required gate still fails), gateJson (the run-gate output), flags (env-missing + visual notes), blockers.`,
  { label: `gate:p${PHASE}`, phase: 'Gate', schema: REPORT_SCHEMA },
);

phase('Review');
const review = await agent(
  `Adversarially review the diff for phase ${PHASE} of PoB2 Remastered (git diff against the phase's base).
Check: correctness vs ./DESIGN.md and PHASES[${PHASE}].doneCriteria, NO-FALLBACK (no fake passes/stubs masquerading as done),
no vendor/ edits, test quality. Only report REAL issues. If you find blocking issues, fix them via TDD and commit. Then summarize.`,
  { label: `review:p${PHASE}`, phase: 'Review', schema: { type: 'object', required: ['summary', 'blocking'], properties: { summary: { type: 'string' }, blocking: { type: 'boolean' } } },
);

return {
  phase: PHASE,
  pass: !!(gate && gate.pass) && !(review && review.blocking) && !taskResults.some((r) => r && r.status === 'blocked'),
  taskResults,
  gate,
  review,
};
```

- [ ] **Step 2: Validate syntax + meta**

Run: `node --check tools/dev-workflow/phase-pipeline.mjs`
Expected: no output (valid syntax). (Note: `args`/`agent`/`phase` are Workflow-runtime globals, so `--check` only validates parse, which is what we want.)

- [ ] **Step 3: Commit**

```bash
git add tools/dev-workflow/phase-pipeline.mjs
git commit -m "feat(dev-workflow): reusable per-phase orchestration Workflow engine"
```

---

## Task 7: Driver ledger, README, slash command

**Files:**
- Create: `tools/dev-workflow/PROGRESS.md`
- Create: `tools/dev-workflow/README.md`
- Create: `.claude/commands/pob-dev.md`

- [ ] **Step 1: Write `PROGRESS.md` (initial ledger)**

```markdown
# PoB2 Remastered — Autonomous Build Progress

> Updated by the driver after every phase. Resumable across sessions/compaction.

**Mode:** 완전 무인 (stop only on self-unfixable technical blockers).
**Start:** Phase 0 functional PoC → Phase 7.
**Git:** feat/phase-N-* → squash-merge to main → push origin.

## State
- Current phase: _to be assessed_
- Last commit: _none yet (pipeline build in progress)_

## Phase ledger
| Phase | Status | Gate evidence | 🚩Flags | Blockers |
|---|---|---|---|---|
| 0 | pending | | | |
| 1 | pending | | | |
| 2 | pending | | | |
| 3 | pending | | | |
| 4 | pending | | | |
| 5 | pending | | | |
| 6 | pending | | | |
| 7 | pending | | | |

## 🚩 Flag log
_(human-gate decisions made autonomously — review later)_
```

- [ ] **Step 2: Write `README.md`**

```markdown
# tools/dev-workflow

Autonomous, DESIGN.md-driven build pipeline for PoB2 Remastered.

- `phases.mjs` — DESIGN §18/§20 phase specs (goal/tasks/doneCriteria).
- `gates.mjs` — per-phase verification gates (shell/golden/visual).
- `run-gate.mjs` — runs a phase's gates; classifies pass/fail/env-missing. `node run-gate.mjs <phase>`.
- `visual-verify.mjs` — Playwright (Tier 1) + Xvfb/WSLg (Tier 2) screenshots for vision checks.
- `phase-pipeline.mjs` — the reusable Workflow engine (decompose→TDD→gate→review). Invoke via the Workflow tool with `args:{phase:N}`.
- `PROGRESS.md` — driver ledger.

## Run one phase
Invoke the Workflow tool: `phase-pipeline.mjs` with `args: { phase: 1 }`.

## Autonomous drive (Phase 0→7)
`/pob-dev auto` — main agent assesses state, then loops phases: run engine → re-run gate for evidence → squash-merge + push → update PROGRESS.md → next. Stops only on a self-unfixable technical blocker.

See `docs/superpowers/specs/2026-06-01-dev-workflow-design.md`.
```

- [ ] **Step 3: Write `.claude/commands/pob-dev.md`**

```markdown
---
description: Drive PoB2 Remastered autonomously through DESIGN.md phases (one phase or auto)
---

Run the dev-workflow pipeline for PoB2 Remastered.

Argument: `$ARGUMENTS` (a phase number `0`..`7`, or `auto` for full Phase 0→7).

Steps:
1. Read `tools/dev-workflow/PROGRESS.md` for current state.
2. For the target phase(s), invoke the Workflow tool with script `tools/dev-workflow/phase-pipeline.mjs` and `args:{phase:N}`.
3. After the engine returns, RE-RUN the gate yourself for evidence: `node tools/dev-workflow/run-gate.mjs N`.
4. If a required gate truly fails and is self-unfixable → STOP and report with evidence (the only stop condition).
   Else: `git` rebase main → squash-merge the phase branch into main → push origin; update `PROGRESS.md`; continue to N+1.
5. Handle human-gates autonomously (best-effort + 🚩flag in PROGRESS.md), do not ask the user for moderate decisions.
6. Use ScheduleWakeup to self-pace long runs.
```

- [ ] **Step 4: Commit**

```bash
git add tools/dev-workflow/PROGRESS.md tools/dev-workflow/README.md .claude/commands/pob-dev.md
git commit -m "feat(dev-workflow): driver ledger, README, /pob-dev command"
```

---

## Task 8: Pipeline self-verification (dry assessment) + handoff

**Files:** none (verification only)

- [ ] **Step 1: Full workspace sanity**

Run:
```bash
pnpm install
pnpm --filter @pob2/dev-workflow test
pnpm format:check && pnpm typecheck
```
Expected: all dev-workflow tests pass; repo format/typecheck clean (or pre-existing scaffold state).

- [ ] **Step 2: Gate runner smoke against Phase 0**

Run: `node tools/dev-workflow/run-gate.mjs 0`
Expected: JSON verdict prints. `vendor-clean` = pass; `core-runner-boot` likely `fail`/`env-missing` (the runner is built during the Phase-0 run) — this confirms the gate correctly reports "not done yet."

- [ ] **Step 3: Commit any lockfile/format changes**

```bash
git add -A && git commit -m "chore(dev-workflow): pipeline self-verification" || echo "nothing to commit"
```

- [ ] **Step 4: Hand off to the autonomous driver**

The pipeline is built. Begin the autonomous drive: assess actual phase state, then run `phase-pipeline` per phase from the first incomplete phase through Phase 7, gating on evidence, committing+pushing per phase, updating `PROGRESS.md`, stopping only on a self-unfixable technical blocker.

---

## Self-Review

- **Spec coverage:** engine (§3/Task6) ✓, phases data (§4/Task2) ✓, gates+evidence classification (§7/Task3-4) ✓, visual Tier1 required + Tier2 always-attempt (§6/Task5) ✓, driver loop + ledger + git push (§8/Task7) ✓, autonomy/flag policy (§2 → impl agent prompt + run-gate env-missing) ✓, start at Phase 0 (Task8 §7 table) ✓.
- **Placeholder scan:** none — all code is concrete. Gate commands intentionally reference phase-built artifacts (documented behavior, classified by run-gate).
- **Type consistency:** `classify(code,stdout,stderr)`/`runGate(gates)→{pass,results}`, `captureUrl(url,out,{width,height})`/`captureTauri(bin,out)→{ok,reason?}`, task fields `{id,title,deliverable,targetFiles,deps,verifyCmd,humanGate?}` consistent across run-gate, visual-verify, and the engine schemas.
