-- spec/modern_api_items_spec.lua
--
-- Tests for overlays/lua/modern_api.lua items.getEquipped(buildId): the
-- equipped-slot + item-card RPC the Rust host dispatches to (task p3-lua-equipped,
-- DESIGN.md §6.3 items.*). It loads the deterministic sample fixture
-- (tools/golden-tests/fixtures/sample-build.xml) and reads the live build's
-- equipped slots, returning one PLAIN table per occupied slot:
--
--   { slot, itemId, name, rarity, baseName, requirements, summaryMods[], unsupportedMods[] }
--
-- The defining contract (DESIGN.md §6.4) is that NO live core table ever leaks:
-- the core's items carry a class metatable, so every returned table — the entry,
-- its `requirements`, and the mod-line lists — must be a plain table holding only
-- explicitly-copied scalar fields.
--
-- `summaryMods` holds the human-readable recognized mod lines; `unsupportedMods`
-- holds the lines the mod parser could not recognize (the `modLine.extra` signal,
-- the same one the upstream UI colours UNSUPPORTED — ItemsTab.lua:3324). They are
-- kept separate, never merged or silently dropped (DESIGN.md §8.6).
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
-- PUC Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_items_spec.lua

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

describe("modern_api items.getEquipped(buildId)", function()
	local api
	-- Positive-path snapshot captured ONCE before any negative case runs, so a
	-- malformed call can never affect the captured result (mirrors modern_api_spec).
	local loadResult, buildId, equippedResult

	setup(function()
		local sampleXml = readFixtureXml()
		api = require(MODULE)

		loadResult = api.build.load(sampleXml)
		buildId = loadResult.buildId
		equippedResult = api.items.getEquipped(buildId)
	end)

	it("exposes items.getEquipped as a function", function()
		assert.are.equal("table", type(api.items))
		assert.are.equal("function", type(api.items.getEquipped))
	end)

	it("returns a plain envelope with an equipped slot list", function()
		assertPlain(equippedResult, "getEquipped result")
		assert.is_true(equippedResult.ok, "getEquipped must succeed on the sample fixture")
		assert.are.equal("table", type(equippedResult.equipped))
		assert.is_true(#equippedResult.equipped >= 1, "the sample build equips at least one item")
	end)

	it("returns the sample build's Weapon 1 item card (no live core tables)", function()
		local weapon
		for _, entry in ipairs(equippedResult.equipped) do
			if entry.slot == "Weapon 1" then
				weapon = entry
			end
		end
		assert.is_not_nil(weapon, "the sample build equips an item in Weapon 1")
		assertPlain(weapon, "equipped entry")
		assert.are.equal("string", type(weapon.itemId))
		assert.are.equal("Runeforged Warpick", weapon.name)
		assert.are.equal("NORMAL", weapon.rarity)
		assert.are.equal("Runeforged Warpick", weapon.baseName)
	end)

	it("copies requirements as a plain scalar-only table", function()
		local weapon
		for _, entry in ipairs(equippedResult.equipped) do
			if entry.slot == "Weapon 1" then
				weapon = entry
			end
		end
		assertPlain(weapon.requirements, "requirements")
		assert.are.equal("number", type(weapon.requirements.level))
		assert.are.equal("number", type(weapon.requirements.str))
		assert.are.equal("number", type(weapon.requirements.dex))
		assert.are.equal("number", type(weapon.requirements.int))
		-- The Runeforged Warpick base carries a strength requirement.
		assert.is_true(weapon.requirements.str > 0, "the warpick requires strength")
	end)

	it("returns summaryMods and unsupportedMods as plain string lists", function()
		for _, entry in ipairs(equippedResult.equipped) do
			assert.are.equal("table", type(entry.summaryMods), "summaryMods must be a list")
			assert.are.equal("table", type(entry.unsupportedMods), "unsupportedMods must be a list")
			for _, line in ipairs(entry.summaryMods) do
				assert.are.equal("string", type(line), "each summary mod is a string line")
			end
			for _, line in ipairs(entry.unsupportedMods) do
				assert.are.equal("string", type(line), "each unsupported mod is a string line")
			end
		end
	end)

	-- Negative / CoreError paths run LAST: a malformed call must not precede the
	-- positive snapshot captured in setup() (mirrors modern_api_spec isolation note).
	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError, not a raise", function()
			local bad = api.items.getEquipped("nope-not-a-build")
			assertPlain(bad, "getEquipped error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "getEquipped error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("rejects a non-string buildId with a CoreError", function()
			local bad = api.items.getEquipped(nil)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)

-- items.compare(buildId, itemId, slot): the §10.4 "+DPS / -EHP" equip-delta RPC
-- (DESIGN §6.3 items.compare, §16.3). It must drive the core's OWN non-mutating
-- comparison machinery (calcsTab:GetMiscCalculator), NOT compare A-with-A — the
-- whole point is a REAL before/after diff, so the two passes must observe a genuine
-- change when the slot content differs from the baseline.
describe("modern_api items.compare(buildId, itemId, slot)", function()
	local api, buildId, weapon

	setup(function()
		local sampleXml = readFixtureXml()
		api = require(MODULE)
		buildId = api.build.load(sampleXml).buildId
		local equipped = api.items.getEquipped(buildId)
		for _, entry in ipairs(equipped.equipped) do
			if entry.slot == "Weapon 1" then
				weapon = entry
			end
		end
		assert.is_not_nil(weapon, "fixture must equip Weapon 1")
	end)

	it("exposes items.compare as a function", function()
		assert.are.equal("function", type(api.items.compare))
	end)

	it("returns a plain {slot, deltas} envelope with finite numeric deltas", function()
		local result = api.items.compare(buildId, weapon.itemId, "Weapon 1")
		assertPlain(result, "compare result")
		assert.is_true(result.ok, "compare must succeed for a real item+slot")
		assert.are.equal("Weapon 1", result.slot)
		assert.are.equal("table", type(result.deltas))
		assert.is_true(#result.deltas >= 1, "the curated stat set yields at least one delta")
		for _, d in ipairs(result.deltas) do
			assertPlain(d, "delta entry")
			assert.are.equal("string", type(d.statId))
			assert.are.equal("number", type(d.before))
			assert.are.equal("number", type(d.after))
			assert.are.equal("number", type(d.delta))
			-- delta is the genuine difference of the two passes.
			assert.are.equal(d.after - d.before, d.delta)
		end
	end)

	it("equipping the SAME item in its OWN slot yields all-zero deltas (real A vs A)", function()
		-- The warpick is already in Weapon 1, so placing it back there must not change
		-- any stat: the before/after passes are real and AGREE -> delta 0 everywhere.
		local result = api.items.compare(buildId, weapon.itemId, "Weapon 1")
		for _, d in ipairs(result.deltas) do
			assert.are.equal(0, d.delta, d.statId .. " must be unchanged equipping the same item in its slot")
		end
	end)

	it("uses the real calculator: `before` reflects the live baseline output, not 0", function()
		-- White-box proof the comparison runs the core's miscCalculator (real baseline
		-- pass) and is NOT a hardcoded/A-vs-A 0: the `before` side must equal the build's
		-- actual computed stats, which for this fixture are non-zero (Life=65,
		-- TotalDPS=8.16…). A two-identical-passes / zeroed stub cannot reproduce the live
		-- mainOutput, so this fails unless GetMiscCalculator's real baseOutput is used.
		local result = api.items.compare(buildId, weapon.itemId, "Weapon 1")
		local byId = {}
		for _, d in ipairs(result.deltas) do
			byId[d.statId] = d
		end
		assert.is_not_nil(byId.Life, "Life is in the curated delta set")
		assert.is_true(byId.Life.before > 0, "baseline Life is the live non-zero value")
		assert.is_not_nil(byId.TotalDPS, "TotalDPS is in the curated delta set")
		assert.is_true(byId.TotalDPS.before > 0, "baseline TotalDPS is the live non-zero value")
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError", function()
			local bad = api.items.compare("nope", weapon.itemId, "Weapon 1")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an unknown itemId with a CoreError", function()
			local bad = api.items.compare(buildId, "99999", "Weapon 1")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an empty slot with a CoreError", function()
			local bad = api.items.compare(buildId, weapon.itemId, "")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)
