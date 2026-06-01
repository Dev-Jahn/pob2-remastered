-- spec/modern_api_spec.lua
--
-- Tests for overlays/lua/modern_api.lua: the UI-agnostic build/calc/items API the
-- Rust host dispatches to over IPC (task lua-modern-api). It reuses
-- headless_bootstrap.boot() (NO vendor edits — DESIGN.md §6.2, §7.1) and exposes
-- build.*, calc.* and items.* as stable functions that return PLAIN Lua tables
-- only (no live core tables leak — DESIGN.md §6.4) and convert core errors into the
-- {code, message} CoreError shape (DESIGN.md §6.4).
--
-- This spec proves the DOCUMENTED SHAPE of every public method against the
-- deterministic sample fixture (tools/golden-tests/fixtures/sample-build.xml):
--
--   build.load(xml)            -> { ok, buildId, summary={ className, level, ... } }
--   build.save(buildId)        -> { ok, xml }                  (build:SaveDB("xml"))
--   calc.run(buildId)          -> { ok, stats = { {statId, value, label}, ... } }   (§7.4)
--   items.parseClipboard(text) -> { ok, item, mods, unsupported }   (§8.6 NO silent drop)
--
-- and that errors come back as { ok=false, error={ code, message } } with a code
-- from the CoreError union (DESIGN.md §6.4), NOT a raw Lua error/traceback.
--
-- IN-PROCESS ISOLATION BOUNDARY: the upstream core is a process-global singleton
-- (DESIGN.md §6.2). A malformed build.load corrupts that singleton (the core's
-- Build:Init bails out before wiring `savers`, so a later SaveDB inside OnFrame
-- crashes — DESIGN §14.2 documents that malformed input must be isolated at the
-- RUNNER PROCESS level, not recovered in-process). So this spec captures every
-- POSITIVE-path result up front in one setup (busted runs it once, before any `it`),
-- then exercises the malformed/negative cases LAST so their poisoning of the shared
-- singleton cannot affect the already-captured positive snapshots.
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
-- PUC Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_spec.lua

local MODULE = "overlays.lua.modern_api"

-- Absolute path to the sample fixture, resolved from this spec file's location so
-- the test is independent of the busted process's working directory.
local function fixturePath()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		path = (os.getenv("PWD") or ".") .. "/" .. path
	end
	local specDir = path:match("^(.*)[/\\][^/\\]*$")
	local repoRoot = specDir:match("^(.*)[/\\][^/\\]*$")
	return repoRoot .. "/tools/golden-tests/fixtures/sample-build.xml"
end

local function readFixtureXml()
	local fh = assert(io.open(fixturePath(), "r"))
	local xml = fh:read("*a")
	fh:close()
	return xml
end

-- Assert a value is a plain Lua table with no metatable (the core's live objects
-- carry class metatables; serializable results must not — DESIGN.md §6.4).
local function assertPlain(value, label)
	assert.are.equal("table", type(value), (label or "value") .. " must be a table")
	assert.is_nil(getmetatable(value), (label or "value") .. " must be a plain table (no live core metatable)")
end

-- A rare item with one recognized mod and one deliberately-bogus line the mod parser
-- cannot recognize. Per DESIGN §8.6 the unknown line must be PRESERVED in
-- `unsupported`, never silently dropped.
local CLIPBOARD = table.concat({
	"Rarity: RARE",
	"Doom Grip",
	"Iron Greaves",
	"--------",
	"+25 to maximum Life",
	"Glorbflax surges with unknowable cosmic power",
}, "\n")

describe("modern_api", function()
	local api
	-- Positive-path snapshots, captured ONCE before any negative/malformed case runs
	-- (see the isolation-boundary note in the file header).
	local loadResult, buildId, saveResult, calcResult, parseResult

	setup(function()
		local sampleXml = readFixtureXml()
		api = require(MODULE)

		loadResult = api.build.load(sampleXml)
		buildId = loadResult.buildId
		saveResult = api.build.save(buildId)
		calcResult = api.calc.run(buildId)
		parseResult = api.items.parseClipboard(CLIPBOARD)
	end)

	it("exposes the build / calc / items namespaces", function()
		assert.are.equal("table", type(api))
		assert.are.equal("table", type(api.build))
		assert.are.equal("function", type(api.build.load))
		assert.are.equal("function", type(api.build.save))
		assert.are.equal("table", type(api.calc))
		assert.are.equal("function", type(api.calc.run))
		assert.are.equal("table", type(api.items))
		assert.are.equal("function", type(api.items.parseClipboard))
	end)

	describe("build.load(xml)", function()
		it("returns a plain serializable result envelope", function()
			assertPlain(loadResult, "build.load result")
			assert.is_true(loadResult.ok, "build.load must succeed on the sample fixture")
		end)

		it("returns a non-empty buildId", function()
			assert.are.equal("string", type(loadResult.buildId))
			assert.is_true(#loadResult.buildId > 0, "buildId must be non-empty")
		end)

		it("returns a serializable build summary (no live core tables)", function()
			assertPlain(loadResult.summary, "build summary")
			assert.are.equal("Ranger", loadResult.summary.className)
			assert.are.equal("number", type(loadResult.summary.level))
			assert.are.equal("number", type(loadResult.summary.itemCount))
			assert.are.equal(1, loadResult.summary.itemCount)
		end)
	end)

	describe("build.save(buildId)", function()
		it("returns the build re-exported as PoB XML", function()
			assertPlain(saveResult, "build.save result")
			assert.is_true(saveResult.ok)
			assert.are.equal("string", type(saveResult.xml))
			assert.is_true(#saveResult.xml > 0, "exported XML must be non-empty")
			assert.is_truthy(saveResult.xml:find("PathOfBuilding2", 1, true), "must be a PoB2 document")
		end)
	end)

	describe("calc.run(buildId)", function()
		it("returns a plain envelope with a curated §7.4 stat list", function()
			assertPlain(calcResult, "calc.run result")
			assert.is_true(calcResult.ok)
			assert.are.equal("table", type(calcResult.stats))
			assert.is_true(#calcResult.stats > 0, "calc.run must return curated core stats")
		end)

		it("each stat is {statId, value, label} with a plain scalar value", function()
			for _, stat in ipairs(calcResult.stats) do
				assertPlain(stat, "stat entry")
				assert.are.equal("string", type(stat.statId))
				assert.are.equal("number", type(stat.value))
				assert.are.equal("string", type(stat.label))
			end
		end)

		it("includes the core Life pool stat (§7.4 life pool)", function()
			local life
			for _, stat in ipairs(calcResult.stats) do
				if stat.statId == "Life" then
					life = stat
				end
			end
			assert.is_not_nil(life, "curated stats must include Life")
			assert.is_true(life.value > 0, "Life must be a positive pool")
		end)
	end)

	describe("items.parseClipboard(text)", function()
		it("returns a plain envelope describing the parsed item", function()
			assertPlain(parseResult, "parseClipboard result")
			assert.is_true(parseResult.ok)
			assertPlain(parseResult.item, "parsed item")
			assert.are.equal("RARE", parseResult.item.rarity)
			assert.are.equal("Iron Greaves", parseResult.item.baseName)
		end)

		it("returns the recognized mods as plain tables", function()
			assert.are.equal("table", type(parseResult.mods))
			assert.is_true(#parseResult.mods >= 1, "the +25 Life line must parse into a mod")
			local foundLife
			for _, mod in ipairs(parseResult.mods) do
				assertPlain(mod, "parsed mod")
				assert.are.equal("string", type(mod.line))
				if mod.line:find("maximum Life", 1, true) then
					foundLife = mod
				end
			end
			assert.is_not_nil(foundLife, "the maximum Life line must be among the parsed mods")
		end)

		it("preserves unrecognized lines in `unsupported` (NO silent drop — §8.6)", function()
			assert.are.equal("table", type(parseResult.unsupported))
			assert.are.equal(1, #parseResult.unsupported, "exactly one line was unrecognized")
			assert.are.equal("Glorbflax surges with unknowable cosmic power", parseResult.unsupported[1])
		end)

		it("does not classify the recognized Life line as unsupported", function()
			for _, line in ipairs(parseResult.unsupported) do
				assert.is_falsy(line:find("maximum Life", 1, true), "recognized lines must not appear in unsupported")
			end
		end)
	end)

	-- Negative / CoreError paths. These run LAST: a malformed build.load corrupts the
	-- process-global core singleton (see the isolation-boundary note in the header),
	-- so they must not precede the positive snapshots captured in setup().
	describe("CoreError handling (DESIGN §6.4)", function()
		it("build.load rejects a non-string argument with a CoreError, not a raise", function()
			local bad = api.build.load(nil)
			assertPlain(bad, "build.load error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "build.load error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("build.save rejects an unknown buildId with a CoreError", function()
			local bad = api.build.save("nope-not-a-build")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "build.save error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("calc.run rejects an unknown buildId with a CoreError", function()
			local bad = api.calc.run("nope-not-a-build")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("items.parseClipboard rejects a non-string argument with a CoreError", function()
			local bad = api.items.parseClipboard(nil)
			assert.is_false(bad.ok)
			assertPlain(bad.error, "parseClipboard error")
			assert.are.equal("UNKNOWN_MOD", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		-- Malformed XML must surface as BUILD_PARSE_FAILED, not a raw Lua traceback.
		-- LAST of all: this load poisons the shared core singleton in-process.
		it("build.load rejects malformed XML with a CoreError instead of raising", function()
			local bad = api.build.load("<not a build/>")
			assertPlain(bad, "build.load malformed result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "build.load malformed error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)
	end)
end)
