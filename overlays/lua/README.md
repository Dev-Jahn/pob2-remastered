# overlays/lua

Non-invasive Lua overlay for the vendored upstream core. The vendored sources in
`vendor/PathOfBuilding-PoE2` are **never edited**; everything we need to change or
add lives here (`DESIGN.md` §6, §7.1).

The headless runner sets Lua `package.path` priority so overlays win:

```
overlays/lua  ->  vendor/PathOfBuilding-PoE2/src
```

## Files (Phase 0 / Phase 1)

| File                      | Purpose                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| `headless_bootstrap.lua`  | Boot the core with UI globals stubbed; set package paths.                       |
| `modern_api.lua`          | Stable calc/build API the Rust host calls over IPC; serializes results to JSON. |
| `compatibility_shims.lua` | Shims for `src/Classes` / SimpleGraphic globals the calc layer touches.         |

These are scaffolding placeholders; implementation lands with the core-runner
prototype (`DESIGN.md` §18 Phase 0–1).
