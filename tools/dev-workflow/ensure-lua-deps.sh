#!/usr/bin/env bash
# ensure-lua-deps.sh — Phase 0 boot prerequisite probe.
#
# AUDIT FINDING: booting the vendored upstream core fails at
#   vendor/PathOfBuilding-PoE2/src/Modules/Common.lua:29  require('lua-utf8')
# `lua-utf8` is a NATIVE C module (compiled .so). The vendored runtime/ ships only
# a Windows lua-utf8.dll, so under PUC `lua` 5.1 on Linux the module is absent and
# every later headless-boot task is blocked.
#
# This script probes whether `require('lua-utf8')` loads in the SAME interpreter the
# Phase 0 gate invokes. If it loads, it exits 0. If not, it exits non-zero and prints
# the documented, reproducible provisioning step (luarocks). It NEVER vendors a binary
# blob — see overlays/lua/README.md "Boot prerequisites".
set -euo pipefail

# The interpreter under test. Overridable so the test suite can inject a stub, and
# so callers can point at a specific PUC lua 5.1 build.
LUA="${LUA:-lua}"

probe() {
  # Returns 0 iff `require('lua-utf8')` succeeds in the given interpreter+env.
  "$LUA" -e "require('lua-utf8')" >/dev/null 2>&1
}

# 1) Try the interpreter's default search paths (this is exactly what the Phase 0
#    gate / verifyCmd's bare `lua -e "require('lua-utf8')"` will see).
if probe; then
  echo "lua-utf8 OK (loadable by '$LUA' on default package.cpath)"
  exit 0
fi

# 2) A `luarocks install --local luautf8` lands lua-utf8.so in the per-user tree,
#    which the bare interpreter does NOT search by default. Re-probe with the
#    luarocks paths injected so a --local install is correctly recognized.
if command -v luarocks >/dev/null 2>&1; then
  if eval "$(luarocks --local path 2>/dev/null)" && probe; then
    echo "lua-utf8 OK (found in the luarocks --local tree)."
    echo
    echo "NOTE: the bare '$LUA' interpreter does NOT add the luarocks --local tree to"
    echo "      package.cpath. Before invoking the Phase 0 gate, export the luarocks"
    echo "      paths into your shell:"
    echo
    echo "        eval \"\$(luarocks --local path)\""
    echo
    echo "      (or install into a default cpath dir; see the install guidance below)."
    exit 0
  fi
fi

# 3) Missing. Emit reproducible install guidance and fail.
cat >&2 <<'EOF'
[ensure-lua-deps] MISSING native module: lua-utf8

The headless boot path requires the native `lua-utf8` C module. The vendored
runtime/ ships only a Windows lua-utf8.dll, so it is absent under PUC lua 5.1 here.

Provision it with luarocks (do NOT vendor a binary blob into git):

  # per-user install -> ~/.luarocks/lib/lua/5.1/lua-utf8.so
  luarocks install --local luautf8

  # then export the luarocks paths so the bare `lua` interpreter finds it:
  eval "$(luarocks --local path)"

Alternatively, install where the default package.cpath already looks (needs a
C toolchain: cc/gcc):

  sudo luarocks install luautf8       # -> /usr/local/lib/lua/5.1/lua-utf8.so

Verify:

  lua -e "require('lua-utf8'); print('lua-utf8 OK')"

See overlays/lua/README.md -> "Boot prerequisites" for the full rationale.
EOF
exit 1
