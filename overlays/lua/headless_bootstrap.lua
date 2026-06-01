--- headless_bootstrap.lua
---
--- Boots the vendored upstream PoB2 Lua core in a headless (no-UI) context,
--- entirely from this overlay, with NO edits to `vendor/` (DESIGN.md §6.2, §7.1).
---
--- Responsibilities (task p0-headless-bootstrap):
---   1. Load `compatibility_shims.lua` first (the LuaJIT `jit` boot shim).
---   2. Set `package.path` priority
---          overlays/lua -> vendor/.../src -> vendor/.../runtime/lua
---      so the upstream `src` modules and the pure-Lua deps it `require`s
---      (`xml`, `base64`, `sha1`, `dkjson`) resolve from the working dir without
---      touching vendor. AUDIT: those deps live in `runtime/lua/`; `lcurl.safe`
---      is already short-circuited by HeadlessWrapper's `require` override.
---   3. chdir into vendor `src` so `dofile('HeadlessWrapper.lua')` and its relative
---      `dofile('Launch.lua')` resolve.
---   4. Run OnInit/OnFrame (done inside HeadlessWrapper) and expose the `build`
---      global (= `mainObject.main.modes.BUILD`).
---   5. Abort with a clear, non-zero error if the core fails to init, rather than
---      silently producing empty output.
---
--- INTERPRETER: the vendored core uses Lua 5.2+ `goto` (e.g. Modules/Build.lua:83),
--- which PUC Lua 5.1 cannot even parse. Upstream itself runs the headless wrapper
--- under LuaJIT (docker-compose.yml: `busted --lua=luajit`; CI: `luajit
--- HeadlessWrapper.lua`). The `lua51.dll` PoB ships on Windows is in fact LuaJIT.
--- So when this script is invoked under PUC Lua 5.1 (no `jit`), the CLI entry point
--- below re-execs itself under `luajit`. Booting in-process (e.g. from a spec) must
--- therefore happen under LuaJIT.

local M = {}

-- Directory separator + path helpers (POSIX/Windows tolerant) -----------------

local SEP = package.config:sub(1, 1) -- "/" on POSIX, "\" on Windows

local function dirname(path)
	-- Strip the trailing component; return "." when there is no directory part.
	local dir = path:match("^(.*)[/\\][^/\\]*$")
	return dir or "."
end

-- The boot path needs two NATIVE C modules — `lfs` (chdir) and, transitively,
-- `lua-utf8` (Common.lua) — that the bare interpreter does NOT find on its default
-- package.cpath. The documented, reproducible home for them is the per-user luarocks
-- tree (overlays/lua/README.md "Boot prerequisites"; tools/dev-workflow/ensure-lua-deps.sh).
-- We add that tree to package.{c,}path ourselves so this bootstrap is self-sufficient:
-- the verifyCmd `lua headless_bootstrap.lua` works without the caller first running
-- `eval "$(luarocks --local path)"`. No binary blob is vendored.
local function injectLuarocksLocalTree()
	local home = os.getenv("HOME")
	if not home then
		return
	end
	local lib = home .. SEP .. ".luarocks" .. SEP .. "lib" .. SEP .. "lua" .. SEP .. "5.1"
	local share = home .. SEP .. ".luarocks" .. SEP .. "share" .. SEP .. "lua" .. SEP .. "5.1"
	package.cpath = lib .. SEP .. "?.so;" .. package.cpath
	package.path = table.concat({
		share .. SEP .. "?.lua",
		share .. SEP .. "?" .. SEP .. "init.lua",
		package.path,
	}, ";")
end

-- Absolute path to THIS file, resolved the same way whether we were `require`d
-- (busted) or run directly (`lua headless_bootstrap.lua`). `arg[0]` points at the
-- busted binary under `require`, so we use the debug source of this chunk instead.
local function thisFilePath()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	-- Make relative paths (e.g. "./overlays/lua/headless_bootstrap.lua" under
	-- `require`) absolute against the current working directory so a later chdir
	-- cannot invalidate the derived repo root. Use $PWD (every POSIX shell sets it)
	-- rather than `lfs`, since this runs before any native module is available.
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		local cwd = os.getenv("PWD") or "."
		path = cwd .. SEP .. path
	end
	return path
end

-- Cached boot result. boot() is idempotent: the upstream core is a process-global
-- singleton (the `build`/`mainObject`/`launch` globals), so re-booting it in the
-- same interpreter is neither possible nor desired.
local booted = nil

--- Boot the headless core. Returns the `build` object (mainObject.main.modes.BUILD).
--- Raises (does not silently return) if the core fails to initialise.
function M.boot()
	if booted then
		return booted
	end

	-- Make the native boot deps (lfs, lua-utf8) resolvable from the per-user
	-- luarocks tree without the caller pre-exporting luarocks paths.
	injectLuarocksLocalTree()

	local overlayDir = dirname(thisFilePath()) -- .../overlays/lua
	local repoRoot = dirname(dirname(overlayDir)) -- .../<repo>
	local vendorSrc = repoRoot .. SEP .. "vendor" .. SEP .. "PathOfBuilding-PoE2" .. SEP .. "src"
	local runtimeLua = repoRoot .. SEP .. "vendor" .. SEP .. "PathOfBuilding-PoE2" .. SEP .. "runtime" .. SEP .. "lua"

	-- (2) package.path priority: overlays/lua -> src -> runtime/lua. The upstream
	-- src uses relative `require("Modules/...")`-style paths resolved from cwd=src,
	-- but its pure-Lua deps (xml/base64/sha1/dkjson) live in runtime/lua and must be
	-- on package.path. sha1 ships as a package directory (runtime/lua/sha1/init.lua),
	-- hence the `?/init.lua` patterns. repoRoot is added so the dotted overlay module
	-- name `overlays.lua.compatibility_shims` resolves independent of the cwd.
	package.path = table.concat({
		overlayDir .. SEP .. "?.lua",
		overlayDir .. SEP .. "?" .. SEP .. "init.lua",
		repoRoot .. SEP .. "?.lua",
		repoRoot .. SEP .. "?" .. SEP .. "init.lua",
		vendorSrc .. SEP .. "?.lua",
		vendorSrc .. SEP .. "?" .. SEP .. "init.lua",
		runtimeLua .. SEP .. "?.lua",
		runtimeLua .. SEP .. "?" .. SEP .. "init.lua",
		package.path,
	}, ";")

	-- (1) compatibility shims first: installs the no-op `jit` table that
	-- Launch.lua:17 (`jit.opt.start(...)`) needs under non-LuaJIT, and is a no-op
	-- under real LuaJIT.
	require("overlays.lua.compatibility_shims")

	-- LuaJIT exposes `bit` as a built-in global (Common.lua:18 does `bit.rshift`
	-- against the GLOBAL, not require("bit")). Under a bare interpreter without that
	-- global, provide it from the `bit`/`bit32`/LuaBitOp module if available. Under
	-- LuaJIT this branch is skipped because `bit` already exists.
	if not rawget(_G, "bit") then
		local ok, bitlib = pcall(require, "bit")
		if ok then
			_G.bit = bitlib
		end
	end

	-- (3) chdir into vendor src so HeadlessWrapper's relative dofile("Launch.lua")
	-- and Launch.lua's relative LoadModule("Modules/Main") resolve.
	local lfs = require("lfs")
	local okChdir, errChdir = lfs.chdir(vendorSrc)
	if not okChdir then
		error("headless_bootstrap: cannot chdir into vendor src '" .. vendorSrc .. "': " .. tostring(errChdir))
	end

	-- (4) boot: HeadlessWrapper dofiles Launch.lua, runs OnInit + OnFrame, and sets
	-- the `build` global. Wrap in pcall so a parse/init failure becomes a clear,
	-- non-zero abort here instead of an opaque crash.
	local okBoot, errBoot = pcall(function()
		dofile(vendorSrc .. SEP .. "HeadlessWrapper.lua")
	end)
	if not okBoot then
		error("headless_bootstrap: core failed to boot HeadlessWrapper.lua: " .. tostring(errBoot))
	end

	-- (5) HeadlessWrapper sets mainObject.promptMsg and `return`s early WITHOUT
	-- defining `build` when startup errors (Launch.lua ShowErrMsg path). Detect that
	-- and abort loudly rather than letting callers see empty output.
	if rawget(_G, "build") == nil then
		error(
			"headless_bootstrap: core did not initialise — `build` global is nil after boot "
				.. "(the upstream core hit a startup error)"
		)
	end

	booted = rawget(_G, "build")
	return booted
end

-- The DESIGN §7.4 "핵심 stat" set, mapped to the concrete `build.calcsTab.mainOutput`
-- keys the core actually emits. Ordered/curated deliberately: this is the small,
-- stable contract the Phase 0 gate (and Phase 1 golden tests) compare against — NOT
-- the full 600+ key mainOutput dump. Keys absent from a given build (e.g. AverageHit
-- on a build the core reports as AverageDamage, EvasionRating which the core names
-- Evasion) are simply not selected; see selectCoreStats's "exists" filter below.
local CORE_STAT_KEYS = {
	-- life/mana/ES pools
	"Life",
	"Mana",
	"EnergyShield",
	"Ward",
	"Spirit",
	-- offence: total DPS + average hit (the core surfaces these under several names
	-- depending on the skill; we emit whichever exist)
	"TotalDPS",
	"CombinedDPS",
	"FullDPS",
	"AverageHit",
	"AverageDamage",
	"WithDotDPS",
	"TotalDot",
	-- defences: armour / evasion (mainOutput names evasion `Evasion`, not EvasionRating)
	"Armour",
	"Evasion",
	"EvasionRating",
	-- effective hit pool
	"TotalEHP",
	-- max resistances
	"FireResist",
	"ColdResist",
	"LightningResist",
	"ChaosResist",
}

--- Select the DESIGN §7.4 core stats that exist in a computed mainOutput.
--- @param mainOutput table the `build.calcsTab.mainOutput` table after a calc run.
--- @return table a curated {statId = value} map containing only the CORE_STAT_KEYS
---         that are present (non-nil numbers) in mainOutput. Absent keys are skipped
---         rather than emitted as null (NO-FALLBACK: we report real stats only).
function M.selectCoreStats(mainOutput)
	if type(mainOutput) ~= "table" then
		error("selectCoreStats: mainOutput must be a table, got " .. type(mainOutput))
	end
	local stats = {}
	for _, key in ipairs(CORE_STAT_KEYS) do
		local value = mainOutput[key]
		if type(value) == "number" then
			stats[key] = value
		end
	end
	return stats
end

-- CLI entry point -------------------------------------------------------------
--
-- Only runs when this file is the program's main script (`lua headless_bootstrap.lua`),
-- never when `require`d as a module (so specs can drive M.boot() in-process).

local function isMainScript()
	-- `arg` is the script-arg table only for the top-level script. Under `require`
	-- (busted) `arg[0]` is the busted binary, not this file.
	local invoked = arg and arg[0]
	if not invoked then
		return false
	end
	return invoked:match("headless_bootstrap%.lua$") ~= nil
end

-- Re-exec the whole process under LuaJIT when we are on PUC Lua 5.1, which cannot
-- parse the vendored core's `goto`. Returns without booting; the re-exec replaces
-- this process. No-op (returns false) when already under LuaJIT or when luajit is
-- unavailable.
local function reexecUnderLuaJITIfNeeded()
	if rawget(_G, "jit") then
		return false -- already on LuaJIT
	end
	-- Build the luajit command: luajit <thisfile> <original args...>
	local self = thisFilePath()
	local parts = { "luajit", "'" .. self .. "'" }
	for i = 1, #arg do
		parts[#parts + 1] = "'" .. tostring(arg[i]):gsub("'", "'\\''") .. "'"
	end
	local cmd = table.concat(parts, " ")
	local ok, _, code = os.execute(cmd)
	-- os.execute returns differ across 5.1 (number) vs 5.2+ (bool, str, code).
	local exitCode
	if type(ok) == "number" then
		exitCode = ok
	else
		exitCode = code or (ok and 0 or 1)
	end
	os.exit(exitCode)
end

-- The upstream core narrates its boot via ConPrintf -> print (and a few raw
-- io.write calls) on stdout. For machine-readable CLI modes we capture that chatter
-- so stdout carries ONLY our intended output (BOOT_OK line / clean stat JSON), then
-- restore the originals. Captured text is echoed to stderr so nothing is lost.
local function runQuietly(fn)
	local realPrint = print
	local realWrite = io.write
	local captured = {}
	print = function(...) -- luacheck: ignore
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring((select(i, ...)))
		end
		captured[#captured + 1] = table.concat(parts, "\t") .. "\n"
	end
	io.write = function(...) -- luacheck: ignore
		for i = 1, select("#", ...) do
			captured[#captured + 1] = tostring((select(i, ...)))
		end
		return io.stdout
	end
	local ok, result = pcall(fn)
	print = realPrint -- luacheck: ignore
	io.write = realWrite -- luacheck: ignore
	if #captured > 0 then
		io.stderr:write(table.concat(captured))
	end
	if not ok then
		error(result, 0)
	end
	return result
end

local function selftest()
	local build = runQuietly(function()
		local b = M.boot()
		newBuild() -- global from HeadlessWrapper
		return b
	end)
	if type(build) ~= "table" then
		io.stderr:write("BOOT_FAIL: build is not a table\n")
		os.exit(1)
	end
	local out = build.calcsTab and build.calcsTab.mainOutput
	if type(out) ~= "table" then
		io.stderr:write("BOOT_FAIL: build.calcsTab.mainOutput is not a table\n")
		os.exit(1)
	end
	local count = 0
	for _ in pairs(out) do
		count = count + 1
	end
	if count == 0 then
		io.stderr:write("BOOT_FAIL: build.calcsTab.mainOutput is empty\n")
		os.exit(1)
	end
	print(string.format("BOOT_OK: mainOutput populated (%d entries), Life=%s", count, tostring(out.Life)))
	os.exit(0)
end

if isMainScript() then
	-- PUC Lua 5.1 can't parse the core; hop to LuaJIT and re-run there.
	reexecUnderLuaJITIfNeeded()

	-- When run as the main script this chunk executes via `dofile`, so it is NOT in
	-- package.loaded. The --print-stats path below requires load_sample, which in turn
	-- requires THIS module — a cycle that would otherwise re-run this main chunk and
	-- abort with "loop or previous error". Register ourselves first so that nested
	-- require resolves to this same M instead of reloading the file.
	package.loaded["overlays.lua.headless_bootstrap"] = M

	local mode
	for _, a in ipairs(arg) do
		if a == "--selftest" or a == "--print-stats" then
			mode = a
		end
	end

	if mode == "--print-stats" then
		-- The Phase 0 'core-runner-boot' gate runs this and pipes stdout into
		-- assert-stats.mjs. Load the deterministic SAMPLE build (not the empty default
		-- newBuild(), whose all-zero dump would let a no-op stub false-pass), then emit
		-- only the curated DESIGN §7.4 core stats as {statId: value} JSON. The core's
		-- boot/load chatter (ConPrintf -> print, raw io.write) must NOT reach stdout,
		-- so the whole load runs inside runQuietly().
		local stats = runQuietly(function()
			-- load_sample reuses M.boot() then drives the wired loadBuildFromXML global,
			-- so the fixture flows through the real calc pipeline into mainOutput.
			local sample = require("overlays.lua.load_sample")
			local build = sample.load()
			return M.selectCoreStats(build.calcsTab.mainOutput)
		end)
		if next(stats) == nil then
			io.stderr:write("PRINT_STATS_FAIL: no core stats selected from mainOutput\n")
			os.exit(1)
		end
		local json = require("dkjson")
		print(json.encode(stats, { indent = false }))
		os.exit(0)
	else
		-- Default and --selftest both run the boot self-check.
		selftest()
	end
end

return M
