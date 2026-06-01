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

## Boot prerequisites

The headless boot path loads native Lua C modules that the vendored upstream
expects. One of them blocks the very first boot:

`vendor/PathOfBuilding-PoE2/src/Modules/Common.lua:29` runs
`local utf8 = require('lua-utf8')`. **`lua-utf8` is a native `.so` C module**, and
the vendored `runtime/` ships only a Windows `lua-utf8.dll`. So under PUC `lua` 5.1
on Linux (the interpreter the Phase 0 gate invokes) the module is absent and boot
fails. This is the environment prerequisite that unblocks every later boot task.

We do **not** vendor GGG/binary blobs into git (`DESIGN.md` §2.2, §15). Instead the
module is provisioned reproducibly via luarocks.

### Provision `lua-utf8`

```bash
# per-user install -> ~/.luarocks/lib/lua/5.1/lua-utf8.so
luarocks install --local luautf8

# the bare `lua` interpreter does NOT search the luarocks --local tree by default,
# so export the luarocks paths into the shell that runs the boot/gate:
eval "$(luarocks --local path)"
```

Alternatively install into a directory already on the default `package.cpath`
(needs a C toolchain — `cc`/`gcc`):

```bash
sudo luarocks install luautf8        # -> /usr/local/lib/lua/5.1/lua-utf8.so
```

### Verify

```bash
bash tools/dev-workflow/ensure-lua-deps.sh
lua -e "require('lua-utf8'); print('lua-utf8 OK')"
```

`tools/dev-workflow/ensure-lua-deps.sh` is the checked-in probe: it tries
`require('lua-utf8')` in the same interpreter the gate uses, and when the module is
missing it exits non-zero and prints the install guidance above (it also re-probes
with the luarocks `--local` paths injected, so a `--local` install is recognized).
