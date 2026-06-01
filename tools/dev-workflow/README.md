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
