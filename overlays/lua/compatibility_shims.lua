--- compatibility_shims.lua
---
--- Boot-time shims so the vendored upstream entrypoint can load under a plain
--- PUC Lua 5.1 interpreter (no LuaJIT, no SimpleGraphic). Load this BEFORE
--- `vendor/PathOfBuilding-PoE2/src/Launch.lua` (DESIGN.md §6.2, §19).
---
--- Audit finding: `Launch.lua:17` runs `jit.opt.start('maxtrace=4000', ...)`.
--- Under LuaJIT `jit` is a built-in table; under PUC Lua 5.1 it is absent, so
--- that line raises "attempt to index global 'jit' (a nil value)" and aborts
--- boot. We install a no-op `jit` table that satisfies the calls the upstream
--- entrypoint makes (`jit.opt.start`, `jit.version`, `jit.status`).
---
--- Kept deliberately minimal and explicit (DESIGN.md §6.2): the SimpleGraphic
--- UI/IO globals (`GetTime`, `LoadModule`, `ConPrintf`, ...) are provided by the
--- headless wrapper, not here. This module's sole job is the `jit` shim.
---
--- Idempotent and a no-op when a real `jit` already exists: if any global `jit`
--- is present (real LuaJIT, or a previously installed shim) it is left intact,
--- so loading this module twice — or under LuaJIT — changes nothing.

-- Under the `luajit` std `jit` is a read-only built-in; here we intentionally
-- define it when it is missing, so declare it writable for this file only.
-- luacheck: globals jit

if not jit then
	jit = {
		opt = {
			-- LuaJIT tuning entry point; a no-op without the JIT compiler.
			start = function() end,
		},
		-- Identifies this as the PUC-Lua compatibility shim, not real LuaJIT.
		version = "PoB2-compat shim (PUC Lua 5.1, no JIT)",
		-- LuaJIT `jit.status()` reports JIT on/off; here the JIT is never on.
		status = function()
			return false
		end,
	}
end

return jit
