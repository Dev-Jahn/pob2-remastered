# PoB2 Remastered — Autonomous Build Progress

> Updated by the driver after every phase. Resumable across sessions/compaction.

**Mode:** 완전 무인 (stop only on self-unfixable technical blockers).
**Start:** Phase 0 functional PoC → Phase 7.
**Git:** feat/phase-N-\* → squash-merge to main → push origin.

## State

- Pipeline: ✓ built & self-verified (commit 037cced — format/lint/typecheck/15 tests green)
- Phase 0: ✓ done — squash-merged to `main` (97c5b13), pushed
- Current phase: **1** (Core bridge MVP) — in progress on `feat/phase-1-core-bridge`
- Note: upstream `HeadlessWrapper.lua` present; share-code deflate is a Phase 1 dependency

## Phase ledger

| Phase | Status      | Gate evidence                                      | 🚩Flags | Blockers |
| ----- | ----------- | -------------------------------------------------- | ------- | -------- |
| 0     | done        | `run-gate 0` pass; gates+exit codes recorded below | 1       |          |
| 1     | in progress |                                                    |         |          |
| 2     | pending     |                                                    |         |          |
| 3     | pending     |                                                    |         |          |
| 4     | pending     |                                                    |         |          |
| 5     | pending     |                                                    |         |          |
| 6     | pending     |                                                    |         |          |
| 7     | pending     |                                                    |         |          |

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
