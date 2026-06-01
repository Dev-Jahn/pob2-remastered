# @pob2/desktop

Tauri + React desktop application shell (`DESIGN.md` §5, §10).

Will contain:

- `src/` — React/TypeScript frontend (app shell, command palette, tabs).
- `src-tauri/` — Rust host (IPC, Lua core runner lifecycle, SQLite FTS, updater).

Scaffolded in **Phase 2** (`DESIGN.md` §18). The Rust crate under `src-tauri/`
will be added to the Cargo workspace at that point.
