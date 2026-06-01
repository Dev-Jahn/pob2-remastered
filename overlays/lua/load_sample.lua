--- load_sample.lua
---
--- Loads the deterministic sample build fixture
--- (tools/golden-tests/fixtures/sample-build.xml) into the headless upstream PoB2
--- core and returns the resulting `build` object (task p0-sample-build-fixture).
---
--- This is the loader path referenced by the Phase 0 PoC: it reuses
--- headless_bootstrap.boot() to stand up the vendored core (no vendor edits —
--- DESIGN.md §6.2, §7.1), then drives the core's own, already-wired
--- `loadBuildFromXML` global (HeadlessWrapper.lua:211) so the fixture flows through
--- the real Build:LoadDB -> Build:Load -> {Skills,Items,Tree}:Load path and the calc
--- pipeline recomputes mainOutput. The fixture feeds the Phase 1 golden tests
--- (DESIGN.md §7.4, §18 "CLI에서 sample build를 로드하고 주요 stat JSON 출력").
---
--- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
--- PUC Lua 5.1 cannot parse. When invoked under PUC Lua 5.1 (no `jit`), the CLI entry
--- point re-execs the whole process under `luajit`. Booting in-process (e.g. from a
--- spec) must therefore happen under LuaJIT.

local bootstrap = require("overlays.lua.headless_bootstrap")

local M = {}

local SEP = package.config:sub(1, 1) -- "/" on POSIX, "\" on Windows

-- Absolute path to THIS file, resolved the same way the bootstrap does it, so a
-- relative invocation (or a later chdir inside boot()) cannot invalidate it.
local function thisFilePath()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		local cwd = os.getenv("PWD") or "."
		path = cwd .. SEP .. path
	end
	return path
end

local function dirname(path)
	local dir = path:match("^(.*)[/\\][^/\\]*$")
	return dir or "."
end

--- Resolve a fixture path argument to an absolute path. Relative paths are taken
--- against $PWD (the dir the CLI was launched from), NOT against any cwd the core
--- chdir'd into during boot — so the verifyCmd's relative
--- `tools/golden-tests/fixtures/sample-build.xml` keeps working even though boot()
--- chdirs into vendor/.../src.
local function resolveFixturePath(path)
	if path:sub(1, 1) == "/" or path:match("^%a:[/\\]") then
		return path -- already absolute
	end
	local cwd = os.getenv("PWD") or "."
	return cwd .. SEP .. path
end

-- Default fixture: tools/golden-tests/fixtures/sample-build.xml relative to repo root.
-- repo root = parent of overlays/ = dirname(dirname(overlayDir)).
local function defaultFixturePath()
	local overlayDir = dirname(thisFilePath()) -- .../overlays/lua
	local repoRoot = dirname(dirname(overlayDir)) -- .../<repo>
	return repoRoot .. SEP .. "tools" .. SEP .. "golden-tests" .. SEP .. "fixtures" .. SEP .. "sample-build.xml"
end

local function readFile(path)
	local fh, openErr = io.open(path, "r")
	if not fh then
		error("load_sample: cannot open fixture '" .. path .. "': " .. tostring(openErr))
	end
	local contents = fh:read("*a")
	fh:close()
	if not contents or contents == "" then
		error("load_sample: fixture '" .. path .. "' is empty")
	end
	return contents
end

--- Load the sample build fixture into the headless core.
--- @param fixturePath string|nil absolute or $PWD-relative path; defaults to the
---        repo's tools/golden-tests/fixtures/sample-build.xml.
--- @return table the `build` object (mainObject.main.modes.BUILD) with mainOutput populated.
--- Raises (does not silently return) if boot, file read, or XML load fails.
function M.load(fixturePath)
	local path = resolveFixturePath(fixturePath or defaultFixturePath())
	-- Read the fixture BEFORE booting: boot() chdirs into vendor src, so $PWD-relative
	-- paths must be resolved against the original cwd first (done above).
	local xmlText = readFile(path)

	-- Stand up the vendored core (idempotent process-global singleton).
	bootstrap.boot()

	-- Drive the wired global loader. SetMode("BUILD", ...) + OnFrame runs the calc
	-- pipeline; wrap so a parse failure becomes a clear, non-zero abort here.
	local okLoad, errLoad = pcall(function()
		loadBuildFromXML(xmlText, "sample-build")
	end)
	if not okLoad then
		error("load_sample: loadBuildFromXML failed for '" .. path .. "': " .. tostring(errLoad))
	end

	local b = rawget(_G, "build")
	if type(b) ~= "table" then
		error("load_sample: `build` global is not a table after loadBuildFromXML")
	end
	return b
end

-- CLI entry point -------------------------------------------------------------
--
-- Usage: lua overlays/lua/load_sample.lua [fixture.xml] --selftest
-- Prints `LOAD_OK: ...` on success (to stdout) and exits 0; exits non-zero with a
-- `LOAD_FAIL: ...` line on stderr otherwise. Only runs when this file is the
-- program's main script, never when `require`d (so specs drive M.load() in-process).

local function isMainScript()
	local invoked = arg and arg[0]
	if not invoked then
		return false
	end
	return invoked:match("load_sample%.lua$") ~= nil
end

-- Re-exec the whole process under LuaJIT when on PUC Lua 5.1 (which cannot parse the
-- vendored core's `goto`). No-op when already under LuaJIT or when luajit is absent.
local function reexecUnderLuaJITIfNeeded()
	if rawget(_G, "jit") then
		return false -- already on LuaJIT
	end
	local self = thisFilePath()
	local parts = { "luajit", "'" .. self .. "'" }
	for i = 1, #arg do
		parts[#parts + 1] = "'" .. tostring(arg[i]):gsub("'", "'\\''") .. "'"
	end
	local cmd = table.concat(parts, " ")
	local ok, _, code = os.execute(cmd)
	-- os.execute returns differ across runtimes: PUC 5.1 AND LuaJIT both return the
	-- raw wait() status (exitCode << 8, e.g. 1792 for exit 7), while PUC 5.2+ returns
	-- (bool, "exit", code). os.exit() truncates to the low 8 bits, so we must shift the
	-- raw status down by 8 first — otherwise a child exit of 1 (status 256) would map to
	-- parent exit 0 and a failed load would look like success to CI.
	local exitCode
	if type(ok) == "number" then
		exitCode = math.floor(ok / 256)
	else
		exitCode = code or (ok and 0 or 1)
	end
	os.exit(exitCode)
end

-- Capture the core's boot/load chatter (ConPrintf -> print, plus raw io.write) so the
-- CLI's stdout carries only our LOAD_OK line. Captured text is echoed to stderr.
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

-- Pick the DPS-family stat the fixture surfaces (mirrors the spec's contract).
local function findDpsKey(out)
	local dpsKeys = { "TotalDPS", "CombinedDPS", "FullDPS", "AverageDamage", "WithImpaleDPS" }
	for _, key in ipairs(dpsKeys) do
		if type(out[key]) == "number" then
			return key, out[key]
		end
	end
	return nil
end

local function selftest(fixturePath)
	local out = runQuietly(function()
		local b = M.load(fixturePath)
		return b.calcsTab and b.calcsTab.mainOutput
	end)
	if type(out) ~= "table" then
		io.stderr:write("LOAD_FAIL: build.calcsTab.mainOutput is not a table\n")
		os.exit(1)
	end
	if type(out.Life) ~= "number" or out.Life <= 0 then
		io.stderr:write("LOAD_FAIL: mainOutput.Life missing or non-positive (got " .. tostring(out.Life) .. ")\n")
		os.exit(1)
	end
	local dpsKey, dpsVal = findDpsKey(out)
	if not dpsKey then
		io.stderr:write("LOAD_FAIL: mainOutput has no DPS-family key (TotalDPS/CombinedDPS/FullDPS/...)\n")
		os.exit(1)
	end
	print(string.format("LOAD_OK: fixture loaded — Life=%s, %s=%s", tostring(out.Life), dpsKey, tostring(dpsVal)))
	os.exit(0)
end

if isMainScript() then
	reexecUnderLuaJITIfNeeded()

	-- First non-flag arg is the fixture path (optional; defaults to the repo fixture).
	local fixturePath = nil
	for _, a in ipairs(arg) do
		if a ~= "--selftest" and a:sub(1, 2) ~= "--" then
			fixturePath = a
			break
		end
	end

	selftest(fixturePath)
end

return M
