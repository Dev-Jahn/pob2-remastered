-- spec/build_io_spec.lua
--
-- Phase 0 path-verification spec for the PoB XML / share-code import-export
-- round-trip (task p0-xml-sharecode-io).
--
-- DESIGN.md context: §18 Phase 0 "PoB XML/share code 입출력 경로 확인" and §12.3
-- Round-trip 원칙. SCOPE = PATH VERIFICATION ONLY. This does not golden-compare
-- stat values (that is Phase 1, §7.4); it only proves the upstream save/load and
-- share-code (export/import) entrypoints are REACHABLE headless and that a build
-- re-materializes after a round-trip (same class + item count).
--
-- The two upstream entrypoints exercised, through the wired headless core
-- (HeadlessWrapper.lua) with NO vendor edits (DESIGN §6.2, §7.1):
--
--   XML        export: build:SaveDB("xml")     (Modules/Build.lua:2426)
--              import: loadBuildFromXML(xml)    (HeadlessWrapper.lua:211)
--
--   share code export: base64.encode(Deflate(build:SaveDB("code")))  -- ImportTab.lua:132
--              import: Inflate(base64.decode(code))                   -- ImportTab.lua:259
--
-- KNOWN PHASE 0 BOUNDARY (documented xfail, NOT faked):
--   HeadlessWrapper.lua stubs Deflate()/Inflate() to return "" (lines 95-102).
--   So the share-code export collapses to an EMPTY code and the import side has no
--   XML to re-materialize from — the share-code round-trip is UNAVAILABLE headless.
--   Per the task ("document that explicitly ... xfail with reason ... rather than
--   faking success"), the share-code case is a `pending` spec that records the
--   boundary, plus a guard test that PROVES the deflate stub is the cause.
--
-- INTERPRETER: the vendored core uses Lua 5.2+ `goto`, which PUC Lua 5.1 cannot
-- even parse. Upstream runs the headless wrapper under LuaJIT. So this spec must
-- run under LuaJIT. The verifyCmd is
--
--     busted spec/build_io_spec.lua 2>/dev/null || lua spec/build_io_spec.lua
--
-- i.e. it does NOT pass `--lua=luajit`. To stay green regardless, the guard below
-- re-execs the whole spec under `busted --lua=luajit` when it detects it is running
-- on a non-LuaJIT interpreter (mirroring overlays/lua/*.lua's reexec pattern).

-- ---------------------------------------------------------------------------
-- Re-exec under LuaJIT when not already on it (PUC Lua 5.1 can't parse the core).
-- ---------------------------------------------------------------------------
do
	if not rawget(_G, "jit") then
		local SEP = package.config:sub(1, 1)
		-- Absolute path to THIS spec file (independent of cwd / how we were invoked).
		local source = debug.getinfo(1, "S").source
		local self = source:sub(1, 1) == "@" and source:sub(2) or source
		if self:sub(1, 1) ~= "/" and not self:match("^%a:[/\\]") then
			self = (os.getenv("PWD") or ".") .. SEP .. self
		end
		-- Prefer the per-user luarocks busted (the same one the gates use); fall back
		-- to a busted on PATH.
		local home = os.getenv("HOME")
		local busted = (home and (home .. "/.luarocks/bin/busted")) or "busted"
		local f = home and io.open(busted, "r")
		if f then
			f:close()
		else
			busted = "busted"
		end
		local cmd = busted .. " --lua=luajit '" .. self .. "'"
		local ok, _, code = os.execute(cmd)
		local exitCode
		if type(ok) == "number" then
			-- PUC 5.1 / LuaJIT return the raw wait() status (exit << 8).
			exitCode = math.floor(ok / 256)
		else
			exitCode = code or (ok and 0 or 1)
		end
		os.exit(exitCode)
	end
end

local LOADER = "overlays.lua.load_sample"

-- Globals the vendored core installs once booted. Pulled through _G so luacheck
-- does not flag them as undeclared (they are core API, not overlay-declared).
local G = _G

-- Count keys in a (possibly keyed) table.
local function count(tbl)
	local n = 0
	for _ in pairs(tbl) do
		n = n + 1
	end
	return n
end

describe("build I/O round-trip path (Phase 0 reachability)", function()
	local build

	setup(function()
		-- Load the deterministic sample fixture through the real wired loader so the
		-- core is booted and a populated build exists to export.
		local loader = require(LOADER)
		build = loader.load()
	end)

	it("the sample fixture materialized a known class + item count", function()
		-- Baseline the two round-trip invariants we will re-assert after import.
		assert.are.equal("table", type(build.spec))
		assert.are.equal("Ranger", build.spec.curClassName)
		assert.are.equal("table", type(build.itemsTab))
		assert.are.equal("table", type(build.itemsTab.items))
		assert.are.equal(1, count(build.itemsTab.items))
	end)

	describe("XML export/import (reachable headless)", function()
		local xml

		it("build:SaveDB('xml') exports non-empty PoB XML", function()
			assert.are.equal("function", type(build.SaveDB))
			xml = build:SaveDB("xml")
			assert.are.equal("string", type(xml))
			assert.is_true(#xml > 0, "exported XML must be non-empty")
			assert.is_truthy(xml:find("PathOfBuilding2", 1, true), "exported XML must be a PoB2 document")
		end)

		it("loadBuildFromXML re-imports the exported XML and re-materializes the build", function()
			assert.are.equal("function", type(G.loadBuildFromXML))
			-- Re-import the JUST-exported XML; this drives the real SetMode("BUILD", xml)
			-- -> Build:LoadDB -> {Skills,Items,Tree}:Load path and recomputes outputs.
			G.loadBuildFromXML(xml, "roundtrip-xml")
			local reimported = rawget(G, "build")
			assert.are.equal("table", type(reimported))

			-- Round-trip invariants: same class and same item count survive XML I/O.
			assert.are.equal("Ranger", reimported.spec.curClassName)
			assert.are.equal(1, count(reimported.itemsTab.items))
			-- The calc pipeline re-ran on import (proves the build is live, not a shell).
			assert.are.equal("table", type(reimported.calcsTab.mainOutput))
			assert.is_true(reimported.calcsTab.mainOutput.Life > 0)
		end)
	end)

	describe("share-code export/import", function()
		-- The share-code path is base64(Deflate(SaveDB('code'))) on export and
		-- Inflate(base64.decode(code)) on import (ImportTab.lua:132 / :259). Both the
		-- raw payload and the base64/common plumbing ARE reachable headless...
		it("the share-code plumbing (SaveDB('code') + base64) is reachable headless", function()
			local raw = build:SaveDB("code")
			assert.are.equal("string", type(raw))
			assert.is_true(#raw > 0, "SaveDB('code') raw payload must be non-empty")
			assert.are.equal("table", type(G.common), "core `common` table must be available")
			assert.are.equal("table", type(G.common.base64), "common.base64 must be available")
			assert.are.equal("function", type(G.common.base64.encode))
		end)

		-- ...but the round-trip itself is BLOCKED because HeadlessWrapper stubs the
		-- compression. This guard PROVES the boundary (so the xfail is honest, not a
		-- guess): with Deflate() -> "" the produced code is empty and Inflate() of any
		-- input is "" — there is no XML to re-import.
		it("PROVES the deflate stub is the boundary: Deflate/Inflate are no-ops headless", function()
			local raw = build:SaveDB("code")
			assert.are.equal("function", type(G.Deflate))
			assert.are.equal("function", type(G.Inflate))
			-- HeadlessWrapper.lua:95-102 stub both to return "".
			local shareCode = G.common.base64.encode(G.Deflate(raw)):gsub("+", "-"):gsub("/", "_")
			assert.are.equal("", shareCode, "deflate stub collapses the share code to empty headless")
			local decoded = G.common.base64.decode(shareCode:gsub("-", "+"):gsub("_", "/"))
			assert.are.equal("", G.Inflate(decoded), "inflate stub yields no XML to re-import headless")
		end)

		-- Documented Phase 0 boundary: the full share-code round-trip cannot be
		-- verified headless until a real Deflate/Inflate is provided (Phase 1 Rust
		-- host adapter, DESIGN §5.1 "build share code import/export adapter"). Marked
		-- pending (xfail) WITH REASON rather than faked.
		pending(
			"FULL share-code round-trip is UNAVAILABLE headless — HeadlessWrapper stubs "
				.. "Deflate/Inflate to \"\" (HeadlessWrapper.lua:95-102); a real compression "
				.. "adapter (DESIGN §5.1) is a Phase 1 dependency"
		)
	end)
end)
