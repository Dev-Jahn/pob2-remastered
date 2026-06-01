# tools/upstream-sync

Automated upstream tracking (`DESIGN.md` §7.2–§7.3).

- Scheduled fetch of `upstream/dev` in `vendor/PathOfBuilding-PoE2`.
- **Diff classifier:** routes changes by area (`src/Data`, `src/Modules/Calc*`,
  `ModParser.lua`, `src/TreeData`, `src/Export`, `manifest.cfg`, `src/Classes`)
  to the right verification (golden tests, i18n coverage, tree snapshots, ...).
- Opens an auto PR that bumps the submodule pointer with a test report.

Scaffolded in **Phase 7** (`DESIGN.md` §18).
