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
