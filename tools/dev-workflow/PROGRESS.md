# PoB2 Remastered — Autonomous Build Progress

> Updated by the driver after every phase. Resumable across sessions/compaction.

**Mode:** 완전 무인 (stop only on self-unfixable technical blockers).
**Start:** Phase 0 functional PoC → Phase 7.
**Git:** feat/phase-N-\* → squash-merge to main → push origin.

## State

- Pipeline: ✓ built & self-verified (commit 037cced — format/lint/typecheck/15 tests green)
- Phase 0: ✓ done — squash-merged to `main` (97c5b13), pushed
- Current phase: **1** (Core bridge MVP) — **done / signed off** on `feat/phase-1-core-bridge`
- Note: upstream `HeadlessWrapper.lua` present; share-code deflate is a Phase 1 dependency
- TS solution build now covers the new code: `@pob2/schema` + `@pob2/core-client` are both in
  root `tsconfig.json` `references`, and `core-client` is a composite project (`composite: true`
  via `tsconfig.base.json`, with its own `references: [{ "path": "../schema" }]`), so a clean
  `pnpm -w typecheck` (`tsc -b`) compiles both packages. Phase 1 gate set is **green** (see below).

## Phase ledger

| Phase | Status  | Gate evidence                                      | 🚩Flags | Blockers |
| ----- | ------- | -------------------------------------------------- | ------- | -------- |
| 0     | done    | `run-gate 0` pass; gates+exit codes recorded below | 1       |          |
| 1     | done    | `run-gate 1` pass (7/7 required, exit 0); below    |         |          |
| 2     | pending |                                                    |         |          |
| 3     | pending |                                                    |         |          |
| 4     | pending |                                                    |         |          |
| 5     | pending |                                                    |         |          |
| 6     | pending |                                                    |         |          |
| 7     | pending |                                                    |         |          |

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

## 🚩 Flag log

_(human-gate decisions made autonomously — review later)_

- **driver/gate-hardening** (Phase 0 review follow-up) — Added `dev-workflow-tests` to the BASE
  gate set so the JS guards + pipeline tests cannot silently regress in Phases 1–7 (the Phase 0
  review noted the gate didn't run them). **Deferred:** gating the busted Lua specs — env-fragile
  (needs `eval "$(luarocks --local path)"` + `~/.luarocks/bin` on PATH); the headless core boot is
  already gated via `core-runner-boot`. Revisit with a stable lua-test wrapper.

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
