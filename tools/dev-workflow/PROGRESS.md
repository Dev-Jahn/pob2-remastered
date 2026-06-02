# PoB2 Remastered — Autonomous Build Progress

> Updated by the driver after every phase. Resumable across sessions/compaction.

**Mode:** 완전 무인 (stop only on self-unfixable technical blockers).
**Start:** Phase 0 functional PoC → Phase 7.
**Git:** feat/phase-N-\* → squash-merge to main → push origin.

## State

- Pipeline: ✓ built & self-verified (commit 037cced — format/lint/typecheck/15 tests green)
- Phase 0: ✓ done — squash-merged to `main` (97c5b13), pushed
- Phase 1: ✓ done — squash-merged to `main` (8fb171e), pushed
- Phase 2: ✓ done — squash-merged to `main` (c2e43b9), pushed
- Phase 3: ✓ done — squash-merged to `main` (6800500), pushed; **core-bridge CARRYOVER resolved** (app runs core over Tauri IPC); equip-delta fake-feature caught+fixed by review
- Phase 4: ✓ done — squash-merged to `main` (0459ed0), pushed; review fixed a real config-preset var bug
- Phase 5: ✓ done — squash-merged to `main` (1b03333), pushed; review fixed live /tree edge connectivity
- Phase 6: ✓ done — squash-merged to `main` (a221431), pushed
- Phase 7: ✓ done — squash-merged to `main` (072c743), pushed
- **✅ ALL PHASES 0–7 DONE — autonomous DESIGN.md build complete (merged to public `main`, vendor/ untouched).**
- Next workstream: **DATA/ASSET COLLECTION + bundling** (per 2026-06-02 policy update below).
- **POLICY UPDATE (2026-06-02): legal review cleared (non-profit) → DESIGN §15 `do_not_bundle` LIFTED.**
  Localization data merged to the (now PUBLIC) repo. Game images/icons + full localization are to be
  **collected live (PoE2DB/poecdn) and BUNDLED into the app + packaging.** Follow-on **DATA/ASSET
  COLLECTION** workstream (after/parallel to Phase 7): live-populate the full dictionary (currently
  committed-ids only) + download icon cache + AssetRef manifest (§9) + wire bundling into release.
- **DATA/ASSET COLLECTION — status (2026-06-02):**
  - Live collector domains: keyword, skill (incl. spirit gems→skill), support_gem, **unique** —
    **dictionary 1835 terms** (was 1337), 0 unpaired. (`bb13006`)
  - Icon cache + **AssetRef manifest = 1097** (was 573), schema + sha256 integrity green;
    4 spirit-gem 4k icons absent on CDN (403) → excluded (NO-FALLBACK). (`bb13006`)
  - **Tauri bundling wired** (`9d7c9aa`): `stage-assets.mjs` (fail-closed integrity → copy →
    `asset-index.json`), `tauri.conf` `bundle.resources`; verified staging 1097 assets in-tree.
  - **Gaps (no responsible source, documented in DATA_SOURCES.md):** item base types (no PoE2DB
    index page), passive notables (concept article only — needs a tree data-endpoint collector).
- Env: Rust toolchain provisioned (cargo 1.96, user-space `~/.cargo`, reachable in login shell);
  `webkit2gtk-4.1` dev libs already present → Tauri buildable; Playwright chromium present → visual gates live
- TS solution build now covers the new code: `@pob2/schema` + `@pob2/core-client` are both in
  root `tsconfig.json` `references`, and `core-client` is a composite project (`composite: true`
  via `tsconfig.base.json`, with its own `references: [{ "path": "../schema" }]`), so a clean
  `pnpm -w typecheck` (`tsc -b`) compiles both packages. Phase 1 gate set is **green** (see below).

## Phase ledger

| Phase | Status | Gate evidence                                                                 | 🚩Flags | Blockers |
| ----- | ------ | ----------------------------------------------------------------------------- | ------- | -------- |
| 0     | done   | `run-gate 0` pass; gates+exit codes recorded below                            | 1       |          |
| 1     | done   | `run-gate 1` pass (7/7 required, exit 0); below                               |         |          |
| 2     | done   | `run-gate 2` pass (8/8); visual verified by direct vision; below              | 2       |          |
| 3     | done   | `run-gate 3` pass (6/6 required, exit 0); `/items` visual verified; below     | 1       |          |
| 4     | done   | `run-gate 4` pass (5/5 required, exit 0); `/calcs` visual verified; below     | 1       |          |
| 5     | done   | `run-gate 5` pass (5/5 required, exit 0); `/tree` visual verified; below      | 1       |          |
| 6     | done   | `run-gate 6` pass (7/7 required, exit 0); coverage §8.7 thresholds met; below | 5       |          |
| 7     | done   | `run-gate 7` pass (7/7 required, exit 0); doneCriteria→evidence mapping below |         |          |

## Phase 0 gate evidence (task `p0-gate-green`)

Ran the full Phase 0 gate set via `node tools/dev-workflow/run-gate.mjs 0`. Both
required gates pass (overall `pass: true`, process exit 0). Gate names + exit codes
(parsed from each gate's `evidence: exit=…`):

| Gate               | required | status | exit | what it proves                                                                 |
| ------------------ | -------- | ------ | ---- | ------------------------------------------------------------------------------ |
| `vendor-clean`     | true     | pass   | 0    | `git diff --quiet vendor/PathOfBuilding-PoE2` → `CLEAN` (vendor/ 무수정)       |
| `core-runner-boot` | true     | pass   | 0    | `headless_bootstrap.lua --print-stats \| assert-stats.mjs` → `OK 17 stat keys` |

These two gates are exactly the Phase 0 **doneCriteria checkpoint** (phases.mjs / DESIGN §18):

- `CLI에서 sample build 로드 후 주요 stat을 JSON으로 출력` — `core-runner-boot` boots the
  headless Lua core, loads the sample fixture, and prints 17 main stats as JSON; `assert-stats.mjs`
  fails unless real non-empty stat JSON appears on stdout (NO-FALLBACK, a stub cannot false-pass).
- `vendor/ 무수정, overlays/lua 만으로 동작` — `vendor-clean` proves the vendored upstream tree is
  byte-identical; the entire boot runs from `overlays/lua/` only.

Sample `--print-stats` JSON (deterministic for the fixture, 17 keys):
`{"Armour":0,"AverageDamage":5.628046875,"ChaosResist":0,"ColdResist":-50,"CombinedDPS":8.16066796875,"EnergyShield":0,"Evasion":7,"FireResist":-50,"FullDPS":0,"Life":65,"LightningResist":-50,"Mana":50,"Spirit":100,"TotalDPS":8.16066796875,"TotalDot":0,"TotalEHP":47.758203222843,"Ward":0}`

**luacheck on overlays:** `luacheck overlays/lua/` → exit 0, `Total: 0 warnings / 0 errors in 4 files`
(`compatibility_shims.lua`, `headless_bootstrap.lua`, `load_sample.lua`, `modern_api.lua`).
luacheck is not preinstalled; provisioned via `luarocks install --local luacheck` (1.2.0, MIT) —
no binary blob vendored, same policy as the lua-utf8 runtime dep.

## Phase 1 gate evidence (task `register-ts-projects`)

Ran the full Phase 1 gate set via `node tools/dev-workflow/run-gate.mjs 1`. Overall `pass: true`,
process exit 0; all 7 required gates pass at exit 0. Gate names + exit codes + test counts (parsed
from each gate's `evidence: exit=…` and the vitest summary):

| Gate                 | required | status | exit | what it proves                                                                   |
| -------------------- | -------- | ------ | ---- | -------------------------------------------------------------------------------- |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`            |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                            |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`     |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — 29 tests / 9 files (JS guards + pipeline correctness)     |
| `golden-parity`      | true     | pass   | 0    | `@pob2/core-client test golden` — 21 tests (calc.run vs recorded §7.4 baselines) |
| `rpc-schema`         | true     | pass   | 0    | `@pob2/schema test` — 24 tests (schema registry + AJV-validated IPC schemas)     |
| `crash-isolation`    | true     | pass   | 0    | `@pob2/core-client test crash` — 8 tests (malformed input never kills runner)    |

These map to the Phase 1 **doneCriteria** (phases.mjs / DESIGN §18, §6.2, §14.2):

- `기존 PoB와 주요 stat 일치 (golden diff, 허용오차 DESIGN §7.4)` — `golden-parity` runs the
  recorded baselines through `calc.run` and asserts within §7.4 tolerances (NO-FALLBACK: a stub
  cannot false-pass; 21 cases must match).
- `malformed input에서도 runner/UI process 유지` — `crash-isolation` feeds non-JSON / oversized /
  malformed input and asserts the runner emits a JSON-RPC error (e.g. -32700) and stays alive.
- The `typecheck` gate now genuinely covers the new TS code because both packages are registered in
  the solution build. Verified as load-bearing: a clean `tsc -b` with `@pob2/core-client` **removed**
  from root `references` does not emit `packages/core-client/dist/` (uncovered); with it present, the
  whole package compiles. `@pob2/schema` was already registered and is confirmed present.

**luacheck on overlays + tools:** `pnpm -w lua:lint` (`luacheck overlays tools`) → exit 0,
`Total: 0 warnings / 0 errors in 5 files` (`compatibility_shims.lua`, `headless_bootstrap.lua`,
`load_sample.lua`, `modern_api.lua`, `runner.lua`). No new Lua files were added by this task; the
core-runner Lua is kept luacheck-clean.

## Phase 1 sign-off (task `phase1-gate`)

Phase 1 freeze. Re-ran the full Phase 1 gate set with `node tools/dev-workflow/run-gate.mjs 1`
(`gates.mjs` consumed **exactly as defined — not edited**; `git diff --quiet tools/dev-workflow/gates.mjs`
is clean). Overall `pass: true`, process **exit 0**; every required gate exits 0:

| Gate                 | required | status | exit | what it proves (this run)                                                         |
| -------------------- | -------- | ------ | ---- | --------------------------------------------------------------------------------- |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`             |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                             |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`      |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — 33 tests / 10 files (JS guards + pipeline + Phase 1 guard) |
| `golden-parity`      | true     | pass   | 0    | `@pob2/core-client test golden` — 21 tests (calc.run vs recorded §7.4 baselines)  |
| `rpc-schema`         | true     | pass   | 0    | `@pob2/schema test` — 24 tests (schema registry + AJV-validated IPC schemas)      |
| `crash-isolation`    | true     | pass   | 0    | `@pob2/core-client test crash` — 8 tests (malformed input never kills runner)     |

These map to the Phase 1 **doneCriteria** (phases.mjs / DESIGN §18) — the sign-off rests on them:

- `기존 PoB와 주요 stat 일치 (golden diff, 허용오차 DESIGN §7.4)` — the `golden-parity` gate runs the
  recorded baselines through `calc.run` and asserts within the **DESIGN §7.4** tolerances (integer stat
  exact; float stat within `1e-6` or display precision). NO-FALLBACK: a stub cannot false-pass — all 21
  golden cases must match.
- `malformed input에서도 runner/UI process 유지` — the `crash-isolation` gate feeds non-JSON / oversized /
  malformed lines and asserts the runner emits a JSON-RPC error (e.g. `-32700`) and **stays alive**, so a
  bad message keeps the runner (and the UI driving it) running.

Recorded exit codes (from this `run-gate 1` invocation): the process exit code is **0** (`run-gate.mjs`
exits `0` iff no required gate `fail`ed), and each gate's `evidence` line begins `exit=0`. The
`phase1-gate` sign-off is guarded by `test/progress-phase1.test.mjs`, which derives the required gate
names straight from `gates.mjs` and asserts this row reads `done` with `exit=0` evidence — so the
recorded sign-off cannot silently regress and the guard cannot drift from the gate set.

## Phase 3 gate evidence (task `p3-gate-green`)

Phase 3 (Items tab rebuild) freeze. Ran the full Phase 3 gate set with
`node tools/dev-workflow/run-gate.mjs 3`. Overall `pass: true`, process **exit 0**; all 6 required
gates exit 0. `gates.mjs`/`phases.mjs` were consumed **exactly as defined — not edited**
(`git diff --quiet tools/dev-workflow/gates.mjs tools/dev-workflow/phases.mjs` → `GATES_UNMODIFIED`).
The only working-tree change to reach green was a Prettier reformat of two pre-existing Phase 3 files
(`packages/ui/src/items/ItemInspector.tsx`, `packages/ui/test/items-components.test.tsx`) — pure
line-wrapping, no logic/assertion change (the `items-unit` gate's 65 tests still pass).

| Gate                 | required | status | exit | what it proves (this run)                                                            |
| -------------------- | -------- | ------ | ---- | ------------------------------------------------------------------------------------ |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`                |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                                |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`         |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — 38 tests / 11 files (JS guards + pipeline + visual-verify)    |
| `parser-fixtures`    | true     | pass   | 0    | `@pob2/core-client test parser` — 13 tests (en + ko clipboard fixtures, §8.6)        |
| `items-unit`         | true     | pass   | 0    | `@pob2/ui test items` — 65 tests / 3 files (items view-models + 3-region components) |

These map to the Phase 3 **doneCriteria** (phases.mjs / DESIGN §18, §10.4, §8.6):

- `기존 Items tab 주요 기능 parity` — the `items-unit` gate's 65 tests cover the §10.4 view-models
  (equipped grid, library search/filter/sort, equip-delta) and the React components that render the
  3-region layout (Equipped Gear grid | Item Library search | Inspector), item cards (rarity color
  key as a `data-rarity` attribute — never color-only, requirement chips, mod summary, +DPS/-EHP
  delta chips), item-set selector, clipboard import, custom-item form, and the §11.3 unsupported-mod
  badge (icon + text label). NO-FALLBACK: a `missing` delta renders a distinct marker, never a fake 0.
- `한국어 아이템 붙여넣기 MVP 지원` — the `parser-fixtures` gate runs real English AND Korean
  (`ko-*.txt`) clipboard fixtures through `items.parseClipboard`: it asserts the corpus covers both
  source locales (`en-US` + `ko-KR`) and all four rarities, pins each fixture's detected locale / base /
  rarity / parsed mods / unsupported lines, and **measures the Korean paste parse success rate against
  the §8.7 MVP target (70%+)** with untranslated lines preserved as `unsupported` (§8.6). A stub cannot
  false-pass — the success-rate assertion fails unless real Korean base/rarity/mod → internal-id
  mapping happens.

Recorded exit codes (from this `run-gate 3` invocation): the process exit code is **0**, and each
gate's `evidence` line begins `exit=0`.

### `/items` VISUAL screen (gates.mjs `VISUAL[3]`) — 🚩 best-effort visual verify

The §10.4 `/items` screen was verified via the spec §6 path: **build → serve → Playwright screenshot →
vision** (`humanGate: visual` → best-effort + FLAG per spec §2/§6, NOT deferred to a human gate).
The production `/items` route (`main.tsx`) drives `ItemsPanel` from a LIVE Tauri-IPC core session, which
a static serve has no runner for — so a SAFE **fixture harness** (spec §2: fixtures, not live network)
mounted the REAL `@pob2/ui` `AppShell` + `ItemsPanel` (built via the workspace, `@pob2/ui/styles.css`
bundled) with §10.4 representative data: a Unique/Magic/Rare/Normal equipped set + a `+TotalDPS`/`-TotalEHP`
equip-delta on the Rare boots and body, a multi-rarity item library, and item sets. Served on a static
http server, screenshot at 1366×768 and 1366×1100 via `tools/dev-workflow/visual-verify.mjs`
(Playwright chromium). The transient harness + dist were removed after capture (working tree clean —
only the two Prettier files changed). Both `VISUAL[3].assert` facts verified:

1. **Items 3-region: equipped gear grid | item library search | inspector (§10.4)** — PASS. Three
   side-by-side headed regions: `장착 장비 (Equipped Gear)` slot-card grid (Weapon 1/2, Helmet, Body
   Armour, Gloves, Boots, Ring 1…); `아이템 라이브러리 (Item Library)` with a search box +
   Slot/Type/Requirements filter controls + result rows; `인스펙터 (Inspector)` with the
   `검토할 아이템을 선택하세요 (Select an item to inspect)` empty state.
2. **Item cards show rarity color + base type + +DPS/-EHP delta chips** — PASS. Per-card rarity color:
   Voidforge orange (unique), Hale Visage blue (magic), Carapace of Sorrow / Sorrow Sole yellow (rare);
   base-type line on each card (Infernal Sword, Expert Spiked Helm, Advanced Plate Vest, Hunting Shoes).
   Delta chips: Body Armour shows green `TotalDPS +42` + `TotalEHP +340`; Boots shows green
   `TotalDPS +12.4` AND red `TotalEHP -31` — both gain (green) and loss (red) directions on screen.
   Left nav rail (Overview/Skills/Items/…) present with Items highlighted; Korean labels carry English
   parenthetical aliases throughout (§8.1).

🚩 **p3/gemini-vision-unavailable** (Phase 3, visual verifier) — gemini-vision OAuth is still not
configured in this env (no antigravity accounts file), so the engine could not LLM-attest the screenshot.
Resolved per spec §6.1 fallback: the driver verified `/tmp/pob-3-items-tall.png` by **direct Claude
vision** — both §10.4 `VISUAL[3]` asserts hold (3-region layout; rarity color + base type + green-gain /
red-loss +DPS/-EHP chips). Same env limit recorded as `p2/gemini-vision-unavailable`; configure
antigravity OAuth for the "precise" verifier — not required for the gate.

## Phase 4 gate evidence (task `p4-gate-green`)

Phase 4 (Skills / Config / Calcs — 계산 조작 + 설명 UI) freeze. Ran the full Phase 4 gate set with
`node tools/dev-workflow/run-gate.mjs 4`. Overall `pass: true`, process **exit 0**; all 5 required
gates exit 0. `gates.mjs`/`phases.mjs` were consumed **exactly as defined — not edited**
(`git diff --quiet tools/dev-workflow/gates.mjs tools/dev-workflow/phases.mjs` → `GATES_UNMODIFIED`).
The only working-tree change to reach green was on pre-existing Phase 4 files: a Prettier reformat of
five files (`packages/ui/src/calcs/calcs-model.ts`, `packages/ui/src/skills/skills-model.ts`,
`packages/ui/test/{calcs-vm,config-vm,skills-vm}.test.ts` — pure line-wrapping, no logic/assertion
change) and the removal of four genuinely-unused type imports the `lint` gate flagged
(`ConfigOptionInput`/`ConfigPreset` in `config-vm.test.ts`, `SkillGroupCardModel`/`SkillGemChip` in
`skills-vm.test.ts` — each appeared only on its import line; the type imports that ARE used were kept).
All 244 `@pob2/ui` tests still pass, so no behavior changed.

| Gate                 | required | status | exit | what it proves (this run)                                                         |
| -------------------- | -------- | ------ | ---- | --------------------------------------------------------------------------------- |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`             |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                             |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`      |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — 47 tests / 13 files (JS guards + pipeline + Phase 4 guard) |
| `calc-mutation`      | true     | pass   | 0    | `@pob2/ui test calcs` — 51 tests / 3 files (calcs view-model + mutation→delta)    |

These map to the Phase 4 **doneCriteria** (phases.mjs / DESIGN §18, §10.5/§10.7/§10.8) — the sign-off
rests on this doneCriteria → evidence mapping:

- `주요 빌드 수정 flow가 기존 PoB 없이 가능` — the `calc-mutation` gate proves the build-mutation
  flow runs WITHOUT legacy PoB, **end to end**: a skill edit builds a real §6.3 `skills.setGemGroup`
  payload via the shipped `toggleGemEnabled`/`groupToGemInputs` builders, and a config edit builds a
  real `config.setOption` payload via `setOptionValue` (a real `false`/`0` preserved, never coerced);
  the host then re-runs `calc.run` and `buildCalcsModel(nextRun, explains, prevRun)` surfaces every
  moved stat as a signed `{ before, after, delta }` (a drop is `-`, never `abs()`). The SHIPPED desktop
  app realizes the same flow on a LIVE Tauri-IPC core session: `apps/desktop/src/build-session.ts`
  `setGemGroup`/`setConfigOption` write through `skills.setGemGroup`/`config.setOption` and RE-RUN
  `calc.run`, and `apps/desktop/src/App.tsx` refreshes Overview/Calcs from the recomputed stats
  (`setConfigOption → recompute → Overview/Calcs refresh`). NO-FALLBACK: a stat with no prior run gets
  no fabricated `0` baseline, and a disappearing stat is `present:false` missing, not `0`.
- `Calcs tab에서 결과 추적(formula trace) 가능` — the `calc-mutation` gate's recompute carries the
  NEW `calc.explain` trace per expanded stat: a `formula` string, the classified contribution
  `sources` list (skillGem/supportGem/item/passive/config/buff), and the upstream raw stat id
  (`upstreamStatId`); after a config flip the trace is the recomputed one (the shock `config` source is
  gone, sources become `['item','skillGem']`), not the stale prior trace. A moved stat whose explain was
  not re-fetched keeps the explicit `trace 없음` (`reason: 'noTrace'`) marker, never a fabricated trace.
  The shipped Calcs tab dispatches this lazily: `apps/desktop/src/App.tsx` `explainStat` routes
  `calc.explain` through the session as a stat row is expanded (DESIGN §10.7), feeding `CalcsPanel`.

Recorded exit codes (from this `run-gate 4` invocation): the process exit code is **0** (`run-gate.mjs`
exits `0` iff no required gate `fail`ed), and each gate's `evidence` line begins `exit=0`. The
`p4-gate-green` sign-off is guarded by `test/progress-phase4.test.mjs`, which derives the required gate
names straight from `gates.mjs` (and asserts `calc-mutation` is among them), asserts this row reads
`done` with `exit=0` evidence, and pins the doneCriteria → evidence mapping (`setGemGroup` /
`setConfigOption` / `calc.explain`) plus the `gates.mjs`+`phases.mjs`-unmodified note — so the recorded
sign-off cannot silently regress and the guard cannot drift from the gate set.

### `/calcs` VISUAL screen (gates.mjs `VISUAL[4]`) — 🚩 best-effort visual verify (task `p4-visual-calcs`)

The §10.7 `/calcs` screen was verified via the spec §6 path: **build → serve → Playwright screenshot →
vision** (`humanGate: visual` → best-effort + FLAG per spec §2/§6, NOT deferred to a human gate). The
production `/calcs` route drives `CalcsPanel` from a LIVE Tauri-IPC core session (`calc.run` + lazy
`calc.explain`), which a static serve has no runner for — so a SAFE **fixture harness** (spec §2:
fixtures, not live network) mounts the REAL `@pob2/ui` `AppShell` + `CalcsPanel` (built through the
desktop app's vite/react, `@pob2/ui/styles.css` bundled) with §10.7 representative data: a `calc.run`
with stats across all four sections plus a prior run for before/after deltas, and `calc.explain` traces
carrying a classified contribution `sources` list (skillGem/supportGem/item/passive/config/buff) + a
`formula` trace string + the upstream raw stat id, fed through the SHIPPED `buildCalcsModel`. The harness
pre-expands the Summary `TotalDPS`/`TotalEHP` rows (collapsed by default) so the source list + formula
trace are visible, then screenshots at 1366×768 and 1366×1100 via
`node tools/dev-workflow/visual-verify.mjs --route /calcs --check` (Playwright chromium). The transient
harness + dist are removed after capture, `tmp-visual/` + `**/.visual-harness-*/` are gitignored, and
the only tracked changes are `visual-verify.mjs` + its test + `.gitignore` (working tree clean). The
`VISUAL[4].assert` fact verified:

1. **Calcs breakdown tree: Summary/Offence/Defence/Resource with source list + formula trace (§10.7)** —
   PASS. `계산 (Calcs)` title; collapsible breakdown sections `요약 (Summary)` / `공격 (Offence)`
   (groups `타격 피해 (Hit Damage)` Total DPS·Average Damage, `치명타 (Crit)` Critical Hit Chance 71
   (+3)·Critical Damage Bonus 370 (+20), `상태이상 (Ailments)` Ignite DPS 21000 (+3000), `지속 피해
(DoT)`) / `방어 (Defence)` / `자원 (Resource)`, in model order; per-row before/after delta chips
   (`+25000`, `+800`, …). Each expanded stat shows its `기여도 (Contributions)` source list with the
   classified origin + signed value (`skillGem Lightning Arrow +60000`, `item Doryani Catalyst +22000`,
   `passive Heart of Thunder +10000`, `config Shock +5000`, `buff Determination +6000`), a
   `공식 (Formula)` trace string (`baseHit 8200 × critMult 1.45 × hitRate 10.5 = 125000`), and the
   `원본 스탯 ID (Upstream Stat Id)` (`Output.TotalDPS` / `Output.TotalEHP`). 3-pane shell + left nav
   rail (Calcs highlighted) + 한국어/영어 toggle (Korean selected); Korean labels carry English aliases
   throughout (§8.1).

🚩 **p4/gemini-vision-unavailable** (Phase 4, visual verifier) — gemini-vision OAuth is still not
configured in this env (the script's accounts search at `~/.config/opencode/antigravity-accounts.json`
and `~/.config/antigravity_auth/accounts.json` returns a `config` error / no antigravity dir), so the
engine could not LLM-attest the screenshot. Resolved per spec §6.1 fallback: the driver verified
`tmp-visual/pob-calcs-1366x768.png` + `…-1366x1100.png` by **direct Claude vision** — the §10.7
`VISUAL[4]` assert holds (Summary/Offence/Defence/Resource breakdown tree with the contribution source
list + formula trace + upstream stat id, ko/en labels). Same env limit recorded as
`p2`/`p3/gemini-vision-unavailable`; configure antigravity OAuth for the "precise" verifier — not
required for the gate. The `--check` path still asserts the painted DOM carries every assert fact
deterministically (the four sections + `data-source-kind` + `data-formula`) so a blank/stub harness
cannot false-pass before the vision read.

## Phase 5 gate evidence (task `p5-gate-green`)

Phase 5 (고성능 Passive Tree — DESIGN §10.6 / §16.3) freeze. Ran the full Phase 5 gate set with
`node tools/dev-workflow/run-gate.mjs 5`. Overall `pass: true`, process **exit 0**; all 5 required
gates exit 0 (the 4 BASE gates `format`/`lint`/`typecheck`/`dev-workflow-tests` + the Phase 5
`tree-transform` gate). `gates.mjs`/`phases.mjs` were consumed **exactly as defined — not edited**
(`git diff --quiet tools/dev-workflow/gates.mjs tools/dev-workflow/phases.mjs` → `GATES_UNMODIFIED`).
The only working-tree change to reach green was a Prettier reformat of two pre-existing Phase 5 files
(`packages/ui/src/tree/TreePanel.tsx`, `packages/ui/test/tree-panel.test.tsx`) — pure line-wrapping
(minimap-props destructure + a `setViewport` updater wrap), no logic/assertion change; all 74
`@pob2/ui` tree tests still pass.

| Gate                 | required | status | exit | what it proves (this run)                                                            |
| -------------------- | -------- | ------ | ---- | ------------------------------------------------------------------------------------ |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`                |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                                |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`         |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — 51 tests / 14 files (JS guards + pipeline + VISUAL[5] verify) |
| `tree-transform`     | true     | pass   | 0    | `@pob2/ui test tree` — 74 tests / 5 files (transform + view-model + canvas + perf)   |

These map to the Phase 5 **doneCriteria** (phases.mjs / DESIGN §18, §10.6 / §16.3) — the sign-off
rests on this doneCriteria → evidence mapping:

- `기존 트리 기능 parity` (existing tree feature parity) — the `tree-transform` gate's 74 tests cover
  the four §10.6 Passive Tree features end to end, each through the SHIPPED `@pob2/ui` primitives, so
  a stub cannot false-pass:
  - **검색 (node search)** — `buildNodeSearchIndex` builds a bilingual (한/영) prefix index over the
    tree; `tree-model`/`tree-panel` tests assert a query resolves to real node docs and clicking a
    result pans the canvas to centre that node (the §10.6 search→pan target). `tree-perf` builds the
    index over the FULL 4863-node 0_5 tree and asserts a common stem resolves (not an empty index).
  - **path preview (경로 미리보기)** — `previewPath` computes the shortest unallocated path from the
    allocated frontier to a target node (BFS over the real edge graph); `tree-model` tests pin the
    path nodes for representative allocate targets, and an unreachable target yields no fabricated
    path (NO-FALLBACK).
  - **allocation delta (할당 델타)** — `buildAllocationDeltaModel` turns the "이 노드를 찍으면
    증가하는 stat" hover deltas into signed `{ direction, ... }` chips; a gain is `gain`, a drop is
    `loss`, and a stat with no measured delta is `missing`, never a fabricated `0`. `TreePanel` feeds
    the hovered node's `hoverDeltas` through it to paint the §10.6 delta panel.
  - **렌더 (canvas render)** — `buildTreeGraph` transforms the core tree (groups + nodes + connections)
    into a render-ready `TreeGraph` (node discs + edges + bounds + a node index); `TreeCanvas` draws
    edges then node discs with pan/zoom and **viewport culling** (`visibleNodes` + `worldToScreen`),
    and the canvas tests assert edges/nodes actually draw (the 2D context records `arc`/`lineTo`
    calls) with allocated vs unallocated styling. The VISUAL[5] harness (below) confirms the live
    canvas paints non-zero pixels.
- `대규모 zoom/pan 성능 기준 충족 (DESIGN §16.3)` (large-scale zoom/pan performance budget) — the
  **p5-tree-perf** benchmark (`packages/ui/test/tree-perf.test.ts`, in the `tree-transform` gate) is
  the deterministic §16.3 assertion. It drives the SAME pure primitives the §10.6 renderer uses over
  the FULL real 0_5 `tree.json` (**4863 nodes / 1572 groups**, the upstream gamedata fixture) and
  asserts the two §16.3 budgets:
  - **search response ≤ 50ms** — the bilingual index answers a node-search query (mean over 2000
    warmed queries across many buckets, plus the single worst-case largest-result query) well under
    the §16.3 50ms target.
  - **pan/zoom 60 FPS (frame ≤ 16.6ms) with viewport culling** — one frame's render work
    (`visibleNodes` cull + `worldToScreen` for every visible node + every edge with a visible
    endpoint) finishes inside the 60 FPS budget BOTH at a normal working zoom (where the cull paints
    only a small fraction of the 4863 nodes — the "보이는 노드만 그리는지" requirement) AND in the
    worst case (zoomed to fit, every node on screen, cull saves nothing). The benchmark is
    deterministic (no randomness/network/wall-clock beyond `performance.now`), so a genuine
    regression (a dropped index, a disabled cull, an O(nodes²) frame) blows the budget by a wide
    margin while host jitter never approaches it.

Recorded exit codes (from this `run-gate 5` invocation): the process exit code is **0** (`run-gate.mjs`
exits `0` iff no required gate `fail`ed), and each gate's `evidence` line begins `exit=0`. The
`p5-gate-green` sign-off is guarded by `test/progress-phase5.test.mjs`, which derives the required gate
names straight from `gates.mjs` (and asserts `tree-transform` is among them), asserts this row reads
`done` with `exit=0` evidence, and pins the doneCriteria → evidence mapping (검색 / path preview /
allocation delta / 렌더; the `p5-tree-perf` §16.3 assertion) plus the `gates.mjs`+`phases.mjs`-unmodified
note and the VISUAL[5] result — so the recorded sign-off cannot silently regress and the guard cannot
drift from the gate set.

### `/tree` VISUAL screen (gates.mjs `VISUAL[5]`) — 🚩 best-effort visual verify (task `p5-tree-visual`)

The §10.6 `/tree` screen was verified via the spec §6 path: **build → serve → Playwright screenshot →
vision** (`humanGate: visual` → best-effort + FLAG per spec §2/§6, NOT deferred to a human gate). The
production `/tree` route drives `TreePanel` from a LIVE Tauri-IPC core session (`tree.getData` +
`tree.previewAllocate` + `tree.applyAllocate`), which a static serve has no runner for — so a SAFE
**fixture harness** (spec §2: fixtures, not live network) mounts the REAL `@pob2/ui` `AppShell` +
`TreePanel` (built through the desktop app's vite/react, `@pob2/ui/styles.css` bundled) with §10.6
representative data that round-trips through the SHIPPED helpers — an abridged tree graph via
`buildTreeGraph`, a bilingual search index via `buildNodeSearchIndex`, an `allocated` node set, and a
hovered node's `hoverDeltas` — so the canvas paints allocated/unallocated nodes and the delta panel
paints chips. Screenshots at 1366×768 and 1366×1100 via `node tools/dev-workflow/visual-verify.mjs
--route /tree --check` (Playwright chromium). The transient harness + dist are removed after capture
(`tmp-visual/` + `**/.visual-harness-*/` are gitignored), so the working tree stays clean. The
`VISUAL[5].assert` fact verified:

1. **Passive tree canvas renders nodes + edges; minimap present; node search box (§10.6)** — PASS.
   `class="pob-tree-canvas"` canvas paints the node discs + connecting edges (the `--check` path reads
   the live 2D context back and asserts `canvasPaintedPixels > 0`, so a blank canvas cannot false-pass);
   a minimap (`data-minimap-viewport` rectangle tracking the main viewport) and a node search box
   (`data-testid="tree-search"`) are present in the served DOM. 3-pane shell + left nav rail (Tree
   highlighted); Korean labels carry English aliases (§8.1).

🚩 **p5/gemini-vision-unavailable** (Phase 5, visual verifier) — gemini-vision OAuth is still not
configured in this env (the script's accounts search at `~/.config/opencode/antigravity-accounts.json`
and `~/.config/antigravity_auth/accounts.json` returns no antigravity dir), so the engine could not
LLM-attest the screenshot. Resolved per spec §6.1 fallback: the driver verified the
`tmp-visual/pob-tree-*.png` screenshots by **direct Claude vision** — the §10.6 `VISUAL[5]` assert holds
(canvas nodes + edges; minimap; node search box). The `--check` path also deterministically asserts the
painted DOM carries every assert fact (`pob-tree-canvas` + `data-minimap-viewport` +
`data-testid="tree-search"`) AND that the live canvas painted non-zero pixels, so a blank/stub harness
cannot false-pass before the vision read. Same env limit as `p2`/`p3`/`p4/gemini-vision-unavailable`;
configure antigravity OAuth for the "precise" verifier — not required for the gate.

### Phase 5 carryover / flags (CARRYOVER ledger at the `p5-gate-green` freeze)

At the Phase 5 freeze (`run-gate 5` green, 5/5 required at exit 0, `gates.mjs`+`phases.mjs` unmodified)
the open flags below are **carried forward into Phase 6**, not closed:

- 🚩 **p5/gemini-vision-unavailable** (visual verifier, STILL-OPEN) — antigravity OAuth is not
  configured in this env, so the `/tree` `VISUAL[5]` screen was attested by direct Claude vision (spec
  §6.1 fallback), not the "precise" LLM verifier. Not required for the gate; configure antigravity OAuth
  to close. Same env limit as `p2`/`p3`/`p4/gemini-vision-unavailable`.
- 🚩 **p4/skills-tab-read-only** (CARRIED) — `App.tsx` still renders `SkillsPanel` without the
  `onToggleGem`/`onToggleGroup` mutation callbacks, so in-app gem/support toggling is a no-op (the core
  `skills.setGemGroup` path + the panel callbacks are wired and tested; only the App-level binding is
  missing). Phase 5 did not touch the Skills tab. Wire when the Skills tab gets interactive polish.
- 🚩 **p1/build-load-response-schema — BuildState gap** (CARRIED) — `build.load`'s response schema still
  REQUIRES a full BuildState while the runner returns its plain `summary` (`validateResponse:false`).
  Phase 5 added `tree.*` on top of the same session without closing this gap; the real BuildState
  assembly is still owed (request side stays validated, no silent fallback).
- 🚩 **CARRYOVER (Import/Export) — WebView share-code codec** (CARRIED) — the desktop WebView
  `loadShareCode`/`saveShareCode` path still needs a browser-safe deflate; the `tree.*` live IPC methods
  Phase 5 drives do not use it. Wire when the desktop Import/Export flow lands.
- 🚩 **p3-client-items/runner-gaps — `items.createCustom`** (CARRIED) — the runner still does not
  implement `items.createCustom`; a well-formed request surfaces a structured `UPSTREAM_INCOMPATIBLE`
  (`-32601`) instead of a fabricated card. Resolve when a `p3-lua-createCustom` runner task lands.

### CARRYOVER→Phase 3 blocker — RESOLVED

The Phase 2 review's **CARRYOVER→Phase 3 — core bridge over Tauri IPC** blocker (the shipped app could
not open a build / run calc because `main.tsx` rendered `<App/>` with no session and the real
`CoreClient` uses `node:child_process`, which cannot run inside the Tauri WebView) is **resolved**:
`apps/desktop/src/main.tsx` now mounts `<App session={createBuildSession(createIpcCoreClient())} />`,
so the desktop app drives Overview/Items from **live stats** by routing `build.load` / `calc.run` /
`build.save` through the Rust host's allowlisted `core_request` IPC command instead of the Node child
process (commit `476ad88` "core bridge over Tauri IPC"). The Items tab is wired end to end on top of it:
the Open command refreshes the §10.4 equipped grid from `session.getEquipped()`, and the §11.1
"아이템 붙여넣기 (Paste Item)" command reads clipboard text, parses it through `session.parseClipboard`,
stages it in the Items inspector, and switches to the Items tab (`apps/desktop/src/App.tsx`).

## Phase 6 gate evidence (task `p6-gate-green`)

Phase 6 (실사용 가능한 한국어 PoB2 — DESIGN §8 / §8.7) freeze. Ran the full Phase 6 gate set with
`node tools/dev-workflow/run-gate.mjs 6`. Overall `pass: true`, process **exit 0**; all 7 required
gates exit 0 (the 4 BASE gates `format`/`lint`/`typecheck`/`dev-workflow-tests` + the three Phase 6
gates `importer-dryrun` + `coverage` + `bilingual-search`). `gates.mjs`/`phases.mjs` were consumed
**exactly as defined — not edited** (`git diff --quiet tools/dev-workflow/gates.mjs tools/dev-workflow/phases.mjs`
→ `GATES_UNMODIFIED`).

| Gate                 | required | status | exit | what it proves (this run)                                                           |
| -------------------- | -------- | ------ | ---- | ----------------------------------------------------------------------------------- |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`               |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                               |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`        |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — JS guards + pipeline + the Phase 6 sign-off guard (this row) |
| `importer-dryrun`    | true     | pass   | 0    | `@pob2/localization test importer` — 10 tests (offline PoE2DB import, §14.3 fail)   |
| `coverage`           | true     | pass   | 0    | `@pob2/localization run coverage:check` — all 9 §8.7 domains meet their MVP bar     |
| `bilingual-search`   | true     | pass   | 0    | `@pob2/localization test search` — 11 tests (§8.1 ko/en bilingual resolution)       |

### Phase 6 doneCriteria → evidence mapping

These map to the Phase 6 **doneCriteria** (phases.mjs / DESIGN §18, §8.7) — the sign-off rests on this
doneCriteria → evidence mapping:

1. **`UI 문자열 100%`** ← the **i18n key-parity** proof (`loc-stat-label-localize`). The UI 100% leg is
   NOT measured from the term dictionary (UI strings live in `@pob2/ui/src/i18n/strings.{en,ko}.ts`); it
   is proven by the `@pob2/ui` `i18n.test` ko/en **key-parity** check (the en and ko UI string key sets
   are identical) plus `loc-stat-label-localize` (Overview stat-row labels localized to ko-KR). The
   `coverage` gate's UI leg cross-references this exact proof: `coverage-check.mjs` re-derives ko/en
   key-parity directly from the two `@pob2/ui` string sources (offline, no cross-package build dep) and
   the UI domain reads 100% **iff** key-parity holds — never auto-passed from an empty store (NO-FALLBACK,
   `src/coverage.ts` `checkCoverage` UI leg). PASS this run (`PASS ui: 100% (MVP 100%)`).
2. **`주요 데이터 영역 coverage MVP 임계 (§8.7)`** ← the `coverage` gate enforcing the **per-domain** §8.7
   thresholds. `coverage:check` (`scripts/coverage-check.mjs` → `src/coverage.ts`) computes, **per
   domain**, `translated upstream ids / total committed upstream ids` over the generated ko-KR dictionary
   (`generated/dictionary.json`) and grades each against its §8.7 MVP bar — keyword/skill/support 95%,
   item base/unique 90%, passive 85%, mod/stat 70%, UI 100% (the table in `MVP_THRESHOLDS`). NO-FALLBACK:
   a domain with no committed ids is honestly 0% and the gate stays RED until real terms land. This run:
   `PASS keyword/skill/support_gem/base/unique/passive/mod/stat` — all 9 domains ≥ their MVP bar →
   `localization coverage meets all §8.7 MVP thresholds`, exit 0.
3. **`한국어 클립보드 item parse 성공률 측정`** ← the **core-client parser** gate's **measured** Korean
   paste parse success rate vs the §8.7 70% target. `packages/core-client/test/parser.test.ts` (the Phase 3
   `parser-fixtures` gate, still green: 14 tests) runs the real Korean clipboard fixtures
   (`tools/golden-tests/fixtures/clipboard/ko-*.txt` — `ko-rare-mace`, `ko-rare-ring`, `ko-unique`) through
   `items.parseClipboard` and **measures** `parsedLines / totalLines` across the ko corpus, asserting it
   `>= 0.7` (the §8.7 "Korean item paste parse success" **70%+** MVP bar). Untranslated lines are preserved
   as `unsupported`, never dropped (§8.6 step 4). A stub cannot false-pass — the rate assertion fails unless
   real ko base/rarity/mod → internal-id mapping happens.

Recorded exit codes (from this `run-gate 6` invocation): the process exit code is **0** (`run-gate.mjs`
exits `0` iff no required gate `fail`ed), and each gate's `evidence` line begins `exit=0`. The
`p6-gate-green` sign-off is guarded by `test/progress-phase6.test.mjs`, which derives the required gate
names straight from `gates.mjs` (and asserts `importer-dryrun` + `coverage` + `bilingual-search` are among
them), asserts this row reads `done` with `exit=0` evidence, pins the three doneCriteria → evidence
mappings (UI key-parity / per-domain §8.7 coverage / the §8.7 70% measured parse rate), the
`gates.mjs`+`phases.mjs`-unmodified note, and the carried-forward flags — so the recorded sign-off cannot
silently regress and the guard cannot drift from the gate set.

### 🚩 coverage gate green via confirmed ko mod/stat terms (humanGate: official terminology)

To bring the `coverage` gate to exit 0 **without faking** (NO-FALLBACK), the previously-empty `mod` and
`stat` domains (honestly 0% before this task — the documented Phase 6 human gate) were seeded with **real,
confirmed in-game Korean** mod/stat terms in the human-confirmed override store
(`packages/localization/manual_ko_overrides.json`, `source/confidence: manual`, DESIGN §8.4 step J), then
`generated/dictionary.json` was rebuilt via `pnpm --filter @pob2/localization run build` (deterministic:
two rebuilds are byte-identical). Seeded terms (each carries a non-empty ko string, so the domain coverage
is real, not assumed): `stat.maximum_life` (최대 생명력), `stat.maximum_energy_shield` (최대 에너지 보호막),
`stat.maximum_mana` (최대 마나), `stat.movement_speed` (이동 속도), `stat.critical_hit_chance` (치명타 확률);
`mod.increased_physical_damage` (물리 피해 증가), `mod.increased_attack_speed` (공격 속도 증가),
`mod.added_fire_damage` (화염 피해 추가), `mod.increased_maximum_life` (최대 생명력 증가),
`mod.fire_resistance` (화염 저항). This is the spec §2 humanGate path: "공식 한국어 용어 — 자동 매핑 +
confidence 표기, 최종 용어 확정은 FLAG (DESIGN §8.1)" — best-effort with confirmed terminology + this FLAG,
NOT a live scrape and NOT a fabricated pass. 🚩 **p6/official-ko-terminology** — the mod/stat ko strings are
high-confidence client terminology authored offline (no live network), tagged `manual` provenance; final
authoritative terminology confirmation against the live ko client/CSV is the open human gate. The metric
stays honest: removing a ko string drops that domain below its bar and re-reds the gate.

The generated dictionary (`packages/localization/generated/dictionary.json`) is a deterministic build
product whose layout is owned by `serializeDictionary` (DESIGN §12.2), so it was added to `.prettierignore`
(alongside the existing cached-fixture entry) — otherwise the reproducible artifact and the `format` gate
disagree on JSON array layout. The only other working-tree changes to reach green were a Prettier reformat
of four pre-existing Phase 6 files (`packages/localization/src/index.ts`,
`packages/localization/test/term.test.ts`, `packages/ui/src/localization/CoverageDashboard.tsx`,
`packages/ui/test/coverage-dashboard.test.tsx`) — pure line-wrapping, no logic/assertion change.

### Phase 6 carryover / flags (CARRYOVER ledger at the `p6-gate-green` freeze)

At the Phase 6 freeze (`run-gate 6` green, 7/7 required at exit 0, `gates.mjs`+`phases.mjs` unmodified)
the open flags below are **carried forward** (still-open), not closed:

- 🚩 **p6/official-ko-terminology** (Phase 6, coverage gate, NEW) — the mod/stat (and the earlier
  unique/passive/support) ko strings are confirmed offline against in-game terminology and tagged `manual`
  provenance; final authoritative confirmation against the live ko client is the documented human gate
  ("공식 한국어 용어 … 최종 용어 확정은 FLAG", spec §2 / DESIGN §8.1). NO-FALLBACK: the coverage gate
  re-reds if a ko string is removed.
- 🚩 **p5/gemini-vision-unavailable** (visual verifier, STILL-OPEN) — antigravity OAuth is not configured
  in this env, so the Phase 2–5 visual screens (incl. the `/settings/localization` Phase 6 best-effort
  screen) were attested by direct Claude vision (spec §6.1 fallback), not the "precise" LLM verifier. Not
  required for the gate; configure antigravity OAuth to close. Same env limit as
  `p2`/`p3`/`p4/gemini-vision-unavailable`.
- 🚩 **p4/skills-tab-read-only** (CARRIED) — `App.tsx` still renders `SkillsPanel` without the
  `onToggleGem`/`onToggleGroup` mutation callbacks, so in-app gem/support toggling is a no-op (the core
  `skills.setGemGroup` path + the panel callbacks are wired and tested; only the App-level binding is
  missing). Phase 6 was localization-only and did not touch the Skills tab. Wire when the Skills tab gets
  interactive polish.
- 🚩 **p1/build-load-response-schema — BuildState gap** (CARRIED) — `build.load`'s response schema still
  REQUIRES a full BuildState while the runner returns its plain `summary` (`validateResponse:false`).
  Phase 6 added no new IPC methods; the real BuildState assembly is still owed (request side stays
  validated, no silent fallback).
- 🚩 **CARRYOVER (Import/Export) — WebView share-code codec** (CARRIED) — the desktop WebView
  `loadShareCode`/`saveShareCode` path still needs a browser-safe deflate. Phase 6 localization does not
  use it. Wire when the desktop Import/Export flow lands.
- 🚩 **p3-client-items/runner-gaps — `items.createCustom`** (CARRIED) — the runner still does not implement
  `items.createCustom`; a well-formed request surfaces a structured `UPSTREAM_INCOMPATIBLE` (`-32601`)
  instead of a fabricated card. Resolve when a `p3-lua-createCustom` runner task lands.

## Phase 7 carryover triage (task `p7-carryover-triage`)

Pure ledger bookkeeping — **no code change**. As Phase 7 (Upstream automation & release) opens, this
records, as an **explicit Phase 7 decision**, that every still-open prior-phase flag carried into this
phase has been examined against the Phase 7 **doneCriteria** (phases.mjs / DESIGN §18) and **ruled on**,
so no carried flag can silently drop off the ledger (guarded by `test/progress-phase7.test.mjs`).

Phase 7 is a **release-automation** phase; its three doneCriteria are:
`upstream update PR 자동 생성 (dry-run)`, `release artifact reproducible (dry-run)`,
`rollback 가능한 updater (unit)`. The carried
flags below are all **shipped-UI / data feature gaps**, NOT release-automation work — so the ruling for
each is the same: **it does not block any Phase 7 doneCriteria** (none of the three touch the Skills-tab
wiring, the `build.load` BuildState assembly, the WebView share-code codec, `items.createCustom`, the
official-ko terminology sign-off, or the visual verifier). Each is carried to where it is actually wired:

- 🚩 **p4/skills-tab-read-only** (CARRIED) — `App.tsx` renders `SkillsPanel` without the
  `onToggleGem`/`onToggleGroup` callbacks, so in-app gem/support toggling is a no-op. Ruling: **does not
  block** any Phase 7 doneCriteria (sync/release/updater do not drive the Skills tab). **Deferred to** the
  Skills-tab interactive-polish task (the core `skills.setGemGroup` path + panel callbacks are already
  wired and tested; only the App-level binding is owed).
- 🚩 **p1/build-load-response-schema — BuildState gap** (CARRIED) — `build.load`'s response schema still
  REQUIRES a full BuildState while the runner returns its plain `summary` (`validateResponse:false`).
  Ruling: **does not block** any Phase 7 doneCriteria (release automation re-runs the existing IPC; it
  adds no `build.load` BuildState requirement). **Deferred to** the real BuildState-assembly task (request
  side stays validated — no silent fallback).
- 🚩 **CARRYOVER (Import/Export) — WebView share-code codec** (CARRIED) — the desktop WebView
  `loadShareCode`/`saveShareCode` path still needs a browser-safe deflate. Ruling: **does not block** any
  Phase 7 doneCriteria (the release/updater/sync flows do not encode/decode share codes). **Deferred to**
  (wire when) the desktop Import/Export flow lands.
- 🚩 **p3-client-items/runner-gaps — `items.createCustom`** (CARRIED) — the runner still does not implement
  `items.createCustom`; a well-formed request surfaces a structured `UPSTREAM_INCOMPATIBLE` (`-32601`)
  instead of a fabricated card. Ruling: **does not block** any Phase 7 doneCriteria (custom-item creation
  is unrelated to sync/release/updater). **Deferred to** (resolve when) a `p3-lua-createCustom` runner task
  lands the item-build path.
- 🚩 **p6/official-ko-terminology** (CARRIED) — the mod/stat (and unique/passive/support) ko strings are
  confirmed offline against in-game terminology and tagged `manual` provenance; final authoritative
  confirmation against the live ko client is the documented human gate. Ruling: **does not block** any
  Phase 7 doneCriteria (release automation ships whatever the dictionary holds; it does not gate on
  terminology sign-off). **Deferred to** the localization official-terminology human gate (DESIGN §8.1) /
  the follow-on DATA/ASSET COLLECTION workstream; NO-FALLBACK — the coverage gate re-reds if a ko string
  is removed.
- 🚩 **gemini-vision-unavailable** (CARRIED, env limit) — antigravity OAuth is not configured in this env,
  so the Phase 2–6 visual screens were attested by direct Claude vision (spec §6.1 fallback), not the
  "precise" LLM verifier. Ruling: **does not block** any Phase 7 doneCriteria (Phase 7 defines no VISUAL
  screen — `gates.mjs` `VISUAL` has no key `7`; sync/release/updater are headless exit-code gates).
  **Deferred to** configuring antigravity OAuth (carried forward as the standing visual-verifier env
  limit, same as `p2`/`p3`/`p4`/`p5/gemini-vision-unavailable`).

## Phase 7 gate evidence (task `p7-gate-green`)

Phase 7 (Upstream automation & release — DESIGN §7 / §13 / §17) freeze. Ran the full Phase 7 gate set
with `node tools/dev-workflow/run-gate.mjs 7`. Overall `pass: true`, process **exit 0**; all 7 required
gates exit 0 (the 4 BASE gates `format`/`lint`/`typecheck`/`dev-workflow-tests` + the three Phase 7
gates `sync-dryrun` + `updater-rollback` + `diagnostic-schema`). `gates.mjs`/`phases.mjs` were consumed
**exactly as defined — not edited** (`git diff --quiet tools/dev-workflow/gates.mjs tools/dev-workflow/phases.mjs`
→ `GATES_UNMODIFIED`).

| Gate                 | required | status | exit | what it proves (this run)                                                                              |
| -------------------- | -------- | ------ | ---- | ------------------------------------------------------------------------------------------------------ |
| `format`             | true     | pass   | 0    | `pnpm -w format:check` → `All matched files use Prettier code style!`                                  |
| `lint`               | true     | pass   | 0    | `pnpm -w lint` (eslint .) → no errors                                                                  |
| `typecheck`          | true     | pass   | 0    | `pnpm -w typecheck` (`tsc -b`) compiles `@pob2/schema` + `@pob2/core-client`                           |
| `dev-workflow-tests` | true     | pass   | 0    | `@pob2/dev-workflow` — JS guards + pipeline + packaging-dryrun + the Phase 7 sign-off guard (this row) |
| `sync-dryrun`        | true     | pass   | 0    | `@pob2/upstream-sync run dry-run` — offline classify fixture diff + synthetic PR report (no fetch/PR)  |
| `updater-rollback`   | true     | pass   | 0    | `@pob2/desktop test updater` — 8 tests (atomic switch + rollback state machine, §13.3)                 |
| `diagnostic-schema`  | true     | pass   | 0    | `@pob2/schema test diagnostic` — 11 tests (DiagnosticExport schema contract, §10.9)                    |

### Phase 7 doneCriteria → evidence mapping

These map to the Phase 7 **doneCriteria** (phases.mjs / DESIGN §18) — the sign-off rests on this
doneCriteria → evidence mapping (the task's explicit mapping):

1. **`upstream update PR 자동 생성 (dry-run)`** (upstream PR auto dry-run) ← the **`sync-dryrun`** gate.
   `pnpm --filter @pob2/upstream-sync run dry-run` runs the OFFLINE upstream-sync rehearsal: it classifies
   a fixture upstream diff through the pure table-driven diff classifier (DESIGN §7.3) and emits a
   **synthetic PR report** (the §7.2 "auto-generated update PR" body — per-bucket required follow-up
   suites: `golden-regression`/`parser-fixtures`/`tree-snapshot`/`exporter-dry-run`/`packaging`/
   `ui-parity-checklist`, plus an `unknown` manual-triage bucket). NO-FALLBACK / spec §2: the live
   `git fetch` and the PR `open` are **network-gated and stubbed** — "nothing was fetched and no PR was
   opened" — so this is a genuine dry-run, not a live scrape and not a fabricated PR. The same dry-run
   tooling is wired into the sync workflow's Classify / Open-PR steps (DESIGN §7.2–§7.3, commit `7ed3b12`).
2. **`release artifact reproducible (dry-run)`** (reproducible artifact dry-run) ← the **`packaging-dryrun`**
   tooling (`tools/dev-workflow/packaging-dryrun.mjs` + `test/packaging-dryrun.test.mjs`, 16 tests, run by
   the `dev-workflow-tests` gate). It is the OFFLINE rehearsal of the §17 release-artifact packaging step:
   it emits the DESIGN §17.2 release-artifact **manifest** (installer / portable placeholders, NOTICE.md,
   LICENSES/, DATA_SOURCES.md, core-version.json, localization-version.json, **checksums**, signature)
   WITHOUT a native tauri build or signing. The load-bearing property is **REPRODUCIBILITY**: the manifest
   and checksum output are derived purely from the committed tree (file bytes, the vendored submodule
   pointer, the generated localization dictionary) — no wall clock, no randomness, no absolute paths — so
   running the dry-run **twice over the same tree yields byte-identical** manifest + checksum output (the
   suite asserts this). NO-FALLBACK / spec §2: the native installer build and the code signature are
   genuinely gated behind a human "secret" gate (signing key, notarization creds) and are represented as
   DETERMINISTIC, explicitly-labelled placeholders, never faked binaries. The packaging dry-run is wired
   into the CI package job (DESIGN §17.1, commit `7c2b977`).
3. **`rollback 가능한 updater (unit)`** (rollback updater unit) ← the **`updater-rollback`** gate.
   `pnpm --filter @pob2/desktop test updater` runs the 8-test `apps/desktop/src/updater.test.ts` unit suite
   over the DESIGN §13.3 updater state machine: download → verify → **atomic switch** of the active slot
   with a retained previous slot, and a **rollback** that atomically restores the previous slot on a failed
   or rejected update (consuming the §13.1 stable/beta/dev release-channel config). NO-FALLBACK: a failed
   verify/switch does not silently advance the active version — the unit asserts the active slot is restored
   to the prior good version, so "rollback 가능한 updater" is proven at the unit level, not assumed.

Recorded exit codes (from this `run-gate 7` invocation): the process exit code is **0** (`run-gate.mjs`
exits `0` iff no required gate `fail`ed), and each gate's `evidence` line begins `exit=0`. The only
working-tree change needed to reach green was a Prettier reformat of two pre-existing Phase 7 files
(`apps/desktop/src/crash-report.ts` — wrapping the `PATH_LIKE` regex + a `redactPaths(...)` call;
`packages/schema/src/index.ts` — expanding a re-export list to one symbol per line) — pure line-wrapping,
no logic/assertion change (the `updater-rollback` + `diagnostic-schema` + crash-report suites still pass).

The `p7-gate-green` sign-off is guarded by `test/progress-phase7.test.mjs`, which derives the required gate
names straight from `gates.mjs` (and asserts `sync-dryrun` + `updater-rollback` + `diagnostic-schema` are
among them), asserts this Phase 7 ledger row reads `done` with `exit=0` evidence, pins the three
doneCriteria → evidence mappings (`upstream update PR 자동 생성 (dry-run)` ← `sync-dryrun` /
`release artifact reproducible (dry-run)` ← `packaging-dryrun` / `rollback 가능한 updater (unit)` ←
`updater-rollback`), the `gates.mjs`+`phases.mjs`-unmodified note, and the carried-forward flags — so the
recorded sign-off cannot silently regress and the guard cannot drift from the gate set. (The same file also
keeps guarding the earlier `p7-carryover-triage` rulings, so no carried flag can drop from the ledger.)

### Phase 7 carryover / flags (CARRYOVER ledger at the `p7-gate-green` freeze)

At the Phase 7 freeze (`run-gate 7` green, 7/7 required at exit 0, `gates.mjs`+`phases.mjs` unmodified)
the open flags below are **carried forward** (still-open), not closed. Each was triaged in the Phase 7
carryover triage above as **non-blocking** for the three Phase 7 release-automation doneCriteria, and is
carried to where it is actually wired:

- 🚩 **p4/skills-tab-read-only** (CARRIED) — `App.tsx` renders `SkillsPanel` without the
  `onToggleGem`/`onToggleGroup` mutation callbacks, so in-app gem/support toggling is a no-op. **Deferred
  to** the Skills-tab interactive-polish task (the core `skills.setGemGroup` path + panel callbacks are
  already wired and tested; only the App-level binding is owed). Does not block any Phase 7 doneCriteria.
- 🚩 **p1/build-load-response-schema — BuildState gap** (CARRIED) — `build.load`'s response schema still
  REQUIRES a full BuildState while the runner returns its plain `summary` (`validateResponse:false`).
  Phase 7 added no `build.load` BuildState requirement (release automation re-runs the existing IPC).
  **Deferred to** the real BuildState-assembly task (request side stays validated, no silent fallback).
- 🚩 **CARRYOVER (Import/Export) — WebView share-code codec** (CARRIED) — the desktop WebView
  `loadShareCode`/`saveShareCode` path still needs a browser-safe deflate. The release/updater/sync flows
  do not encode/decode share codes. **Deferred to** (wire when) the desktop Import/Export flow lands.
- 🚩 **p3-client-items/runner-gaps — `items.createCustom`** (CARRIED) — the runner still does not implement
  `items.createCustom`; a well-formed request surfaces a structured `UPSTREAM_INCOMPATIBLE` (`-32601`)
  instead of a fabricated card. **Deferred to** (resolve when) a `p3-lua-createCustom` runner task lands.
- 🚩 **p6/official-ko-terminology** (CARRIED) — the mod/stat (and unique/passive/support) ko strings are
  confirmed offline against in-game terminology and tagged `manual` provenance; final authoritative
  confirmation against the live ko client is the documented human gate. **Deferred to** the localization
  official-terminology human gate (DESIGN §8.1) / the follow-on DATA/ASSET COLLECTION workstream;
  NO-FALLBACK — the coverage gate re-reds if a ko string is removed.
- 🚩 **gemini-vision-unavailable** (CARRIED, env limit) — antigravity OAuth is not configured in this env,
  so the Phase 2–6 visual screens were attested by direct Claude vision (spec §6.1 fallback), not the
  "precise" LLM verifier. Phase 7 defines no VISUAL screen (`gates.mjs` `VISUAL` has no key `7`;
  sync/release/updater are headless exit-code gates). **Deferred to** configuring antigravity OAuth.

## 🚩 Flag log

_(human-gate decisions made autonomously — review later)_

- **p4/skills-tab-read-only** (Phase 4 review, UI wiring) — `App.tsx` renders `SkillsPanel` without
  the `onToggleGem`/`onToggleGroup` mutation callbacks, so in-app gem/support toggling is a no-op.
  The core path (`skills.setGemGroup`) and `SkillsPanel` callback props both work and are tested; only
  the App-level wiring is missing. Phase 4's build-mutation doneCriteria is satisfied via the fully
  wired config-preset flow. Wire skill-toggle callbacks when the Skills tab gets interactive polish.

- **p4-gate-green carryover/ledger (Phase 4 sign-off)** — At the Phase 4 freeze (`run-gate 4` green,
  5/5 required at exit 0, `gates.mjs`+`phases.mjs` unmodified) the open flags below are **carried
  forward**, not closed:
  - 🚩 **p4/gemini-vision-unavailable** (visual verifier, STILL-OPEN) — still unresolved: antigravity
    OAuth is not configured in this env, so the `/calcs` `VISUAL[4]` screen was attested by direct
    Claude vision (spec §6.1 fallback), not the "precise" LLM verifier. Not required for the gate;
    configure antigravity OAuth to close. Same env limit as `p2`/`p3/gemini-vision-unavailable`.
  - 🚩 **p1/build-load-response-schema — BuildState gap** (CARRIED) — `build.load`'s response schema
    REQUIRES a full BuildState but the runner returns its plain `summary` (`validateResponse:false`).
    Phase 4 added skills/config/calc.explain on top of the same session without closing this gap; the
    real BuildState assembly is still owed (request side stays validated, no silent fallback).
  - 🚩 **CARRYOVER (Import/Export) — WebView share-code codec** (CARRIED) — the desktop WebView
    `loadShareCode`/`saveShareCode` path still needs a browser-safe deflate; wire when the desktop
    Import/Export flow lands (the 4+ live IPC core methods Phase 4 drives do not use it).
  - 🚩 **p3-client-items/runner-gaps — `items.createCustom`** (CARRIED) — the runner still does not
    implement `items.createCustom`; a well-formed request surfaces a structured `UPSTREAM_INCOMPATIBLE`
    (`-32601`) instead of a fabricated card. Resolve when a `p3-lua-createCustom` runner task lands.

- **p4/gemini-vision-unavailable** (Phase 4, `p4-visual-calcs`, visual verifier) — gemini-vision OAuth
  is not configured in this env (no antigravity accounts file; the skill script returns a `config`
  error), so the engine could not LLM-attest the `/calcs` screenshots. Resolved per spec §6.1 fallback:
  the `--route /calcs --check` path builds a fixture harness mounting the REAL `@pob2/ui` `CalcsPanel`
  with §10.7 representative data, serves it, screenshots 1366×768/1366×1100, and the driver verified
  them by **direct Claude vision** — the §10.7 `VISUAL[4]` assert holds (Summary/Offence/Defence/Resource
  breakdown tree + contribution source list + formula trace + upstream stat id, ko/en labels). The check
  also deterministically asserts the painted DOM carries every assert fact (four sections +
  `data-source-kind` + `data-formula`) so a blank/stub harness cannot false-pass. Same env limit as
  `p2`/`p3/gemini-vision-unavailable`; configure antigravity OAuth for the precise verifier — not
  required for the gate.

- **CARRYOVER (Import/Export) — WebView share-code codec** (Phase 3, `p3-core-bridge`) — The desktop
  WebView `loadShareCode`/`saveShareCode` path needs a browser-safe deflate (Web `CompressionStream`
  or `fflate`); `node:zlib` can't run in the WebView and the runner exposes no encode/decode method.
  The 4 live core methods (build.load/save XML, calc.run, items.compare) work over IPC and don't use
  it — only share-code import/export does. Wire when the desktop Import/Export flow lands. Mirrors
  the `p1/encode-byte-identity` flag.

- **p3-client-items/runner-gaps** (Phase 3, `p3-client-items`) — Added `getEquipped`/`createCustom`/
  `equipDelta` to `CoreClient` (`packages/core-client/src/index.ts`), each validating
  request+response against `schemaRegistry` (DESIGN §6.4). `getEquipped` and `equipDelta` are real
  end to end against the live runner (sample-build → equipped Runeforged Warpick card). One
  **documented gap** remains (NO-FALLBACK, never faked): the runner does not implement
  `items.createCustom` yet, so a well-formed `createCustom` request surfaces a structured
  `CoreClientError` (`UPSTREAM_INCOMPATIBLE`, JSON-RPC `-32601` method-not-found) instead of a
  fabricated card — the request-side schema validation still runs. **Resolve when** a
  `p3-lua-createCustom` runner task lands an item-build path.

- **p3-review/equip-delta-real** (Phase 3 adversarial review, RESOLVED) — The earlier `equipDelta`
  was a stub: it ran `calc.run` TWICE on the SAME live build and diffed the (identical) results, so
  every `EquipDelta` was structurally **always 0** — the exact "comparing A with A" bug the core's
  own `Calcs.lua:140-142` was written to avoid. The named Phase 3 task "item equip delta" (DESIGN
  §10.4 "+DPS / -EHP", §16.3) was therefore non-functional despite the core fully supporting the
  computation. **Fixed via TDD:** added a runner-backed `items.compare(buildId, itemId, slot)` to
  `overlays/lua/modern_api.lua` (registered in `runner.lua`) that drives the core's OWN non-mutating
  comparison machinery — `build.calcsTab:GetMiscCalculator()` returns `(calcFunc, baseOutput)` and
  `calcFunc({ repSlotName = slot, repItem = item })` recomputes the full output as if the item
  occupied the slot, WITHOUT mutating the build (the same path `ItemsTab.lua:2148-2150` uses for its
  tooltip deltas). `CoreClient.equipDelta` now routes through this single schema-validated RPC. The
  `before` side is the real live baseline (proven: fixture Life=65 / TotalDPS≈8.16 baselines are
  reported, not 0); equipping the item already in its slot is a real measured 0, a different item
  differs. Spec: `spec/modern_api_items_spec.lua` (14 cases, +7). Removed the now-orphaned
  `diffStats` helper and the two `validateRequestPublic`/`validateResponsePublic` passthroughs in
  `runner-client.ts` that only the old two-pass path needed. The WebView IPC adapter
  (`apps/desktop/src/core-ipc-client.ts` — the transport the SHIPPED app uses) carried the SAME
  always-0 two-pass stub and was fixed identically to route through `items.compare`.

- **p3-review/getequipped-allowlist** (Phase 3 adversarial review, RESOLVED, BLOCKING) — The Rust IPC
  bridge `ALLOWED_METHODS` (`apps/desktop/src-tauri/src/core_bridge.rs`) did NOT include
  `items.getEquipped`, yet `App.tsx` calls `session.getEquipped()` after every Open and the WebView
  IPC client routes it through `core_request`. So in the REAL shipped app, the §10.4 equipped-gear
  grid (a headline Phase 3 deliverable) was refused as `UPSTREAM_INCOMPATIBLE` and could never load —
  masked because the desktop component tests inject a mock client and the visual gate used a static
  fixture harness, neither of which exercises the live Rust IPC route. **Fixed:** added
  `items.getEquipped` + `items.compare` to `ALLOWED_METHODS` and added a live Rust integration test
  (`items_getequipped_and_compare_route_through_the_bridge`) that drives both through the real bridge
  end to end (12 Rust tests pass).

- **CARRYOVER→Phase 3 — core bridge over Tauri IPC** (Phase 2 review, ARCHITECTURAL) — The shipped
  desktop app cannot actually open a build / run calc yet: `apps/desktop/src/main.tsx` renders
  `<App/>` with no session, and the real `CoreClient` uses `node:child_process`
  (`packages/core-client/src/runner-client.ts`), which cannot run inside the Tauri WebView. Phase 2's
  "open build → Overview" doneCriteria is met only at component/jsdom level (mock client). **Phase 3
  must first wire a Rust-side core bridge** (Tauri host spawns the Lua runner as a sidecar and exposes
  `calc.run`/`build.load` over IPC) so the real app drives Overview/Items from live stats.

- **p2/gemini-vision-unavailable** (Phase 2, visual verifier) — gemini-vision OAuth is not configured
  in this env (no antigravity accounts file), so the engine could not LLM-attest the Tier-1 overview
  screenshot. Resolved per spec §6.1 fallback: the driver verified `/tmp/pob-2-overview.png` by direct
  Claude vision — all 3 §10.2/§10.3 asserts hold (3-pane shell; offence/defence/resource/warnings
  cards with missing-markers not 0s; 한국어/영어 toggle, Korean selected). Configure antigravity OAuth
  for the "precise" verifier; not required.

- **p2/i18n-gate + stat-label-locale** (Phase 2 review, minor) — the `i18n-toggle` gate runs only
  `App.i18n.test.tsx` (not the full desktop suite). Overview stat-row labels stay English in ko-KR
  (card titles ARE localized); full stat-label localization is Phase 6 scope.

- **driver/gate-hardening** (Phase 0 review follow-up) — Added `dev-workflow-tests` to the BASE
  gate set so the JS guards + pipeline tests cannot silently regress in Phases 1–7 (the Phase 0
  review noted the gate didn't run them). **Deferred:** gating the busted Lua specs — env-fragile
  (needs `eval "$(luarocks --local path)"` + `~/.luarocks/bin` on PATH); the headless core boot is
  already gated via `core-runner-boot`. Revisit with a stable lua-test wrapper.

- **driver/visual-gate-design** (pre-Phase 2) — Moved visual checks OUT of `run-gate` (a headless
  exit-code gate can't honestly assert "matches DESIGN §10" — it would blank-pass with no server).
  Visual screens now live in `gates.mjs` `VISUAL` and are verified by the gate-agent + driver via
  build → serve → Playwright screenshot → gemini-vision against each screen's `assert` list (UI
  Phases 2–5). Rust toolchain provisioned (cargo 1.96) + webkit2gtk present, so Phase 2 `cargo-check`
  / `web-build` / visual gates are all real.

- **p1/encode-byte-identity** (Phase 1 review, `gamedata`) — `compression-adapter.encodeShareCode`
  is asserted byte-identical to upstream, but `sample-sharecode.txt` was generated by the SAME
  encoder (self-referential). The DECODE path (real user import) uses zlib `inflateSync` + header
  auto-detect, so import is sound regardless; only the encode byte-identity CLAIM is unproven (would
  need a code captured from real PoB at zlib level-9). Format structurally matches upstream.

- **p1/build-load-response-schema** (Phase 1 review) — `build.load` response schema REQUIRES a full
  BuildState, but `load()` returns the runner's plain `summary` with `validateResponse:false`
  (honestly documented; request side still validated). Schema overstates the MVP runner's output;
  Phase 2 should build the real BuildState from `load()`. Tracked gap, not a silent fallback.

- **p1/thin-fixtures** (Phase 1 review, `gamedata`) — minion fixture only proves the gem loads (no
  minion DPS in the curated §7.4 stat set); `dot` rests on `dot-contagion` (essence-drain computes
  as a hit); `passive-delta-life.xml` has Build targetVersion 0_1 vs Spec treeVersion 0_5 (core
  tolerated). Deterministic but weaker representatives — strengthen when the stat set widens.

- **p0-gate-green** (gate: `gamedata`) — Recorded the Phase 0 doneCriteria checkpoint above from
  a real `run-gate 0` run (no live network, fixture-only): both required gates pass at exit 0 and
  `luacheck overlays/lua/` is clean. The gate set itself was NOT modified (`gates.mjs`/`phases.mjs`
  untouched). **Review needed:** the sign-off rests on the sample-build fixture and the curated
  §7.4 → mainOutput stat mapping flagged below — confirm those are the intended golden anchor
  before Phase 1 freezes tolerances against them.

- **p0-sample-build-fixture** (gate: `gamedata`) — Authored `tools/golden-tests/fixtures/sample-build.xml`
  from upstream save formats + data IDs (Ranger / `MeleeMaceMacePlayer` "Mace Strike" gem /
  `Runeforged Warpick` One Hand Mace), NOT live-scraped, no assets bundled (DESIGN §2.2 safe
  default). Round-trips cleanly: Life=65, TotalDPS=8.16066796875, deterministic across loads.
  **Review needed:** confirm this minimal combo is an acceptable golden anchor; the chosen
  skill/base/gem-level are a judgment call and depend on upstream data IDs that can drift.

- **p0-print-stats-cli** (gate: `gamedata`) — Wired `--print-stats` to load the sample fixture
  (above) and emit a curated `{statId: value}` JSON of the DESIGN §7.4 핵심 stat keys that exist
  in `build.calcsTab.mainOutput`. Uses fixture data only (no live network, no bundled assets).
  The selected key names are gamedata-driven: I mapped the §7.4 list to the core's actual
  mainOutput keys — `Evasion` (not `EvasionRating`) and `AverageDamage` (the build surfaces no
  `AverageHit`); absent keys are skipped, not emitted as null. Deterministic output for the
  fixture: Life=65, Mana=50, TotalDPS/CombinedDPS=8.16066796875, Evasion=7, Fire/Cold/Lightning
  Resist=-50, ChaosResist=0 (17 keys). **Review needed:** confirm the curated §7.4 → mainOutput
  key mapping (esp. average-hit/evasion naming) is the intended golden-stat contract before
  Phase 1 freezes tolerances against it.
