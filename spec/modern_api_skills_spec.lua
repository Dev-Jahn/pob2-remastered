-- spec/modern_api_skills_spec.lua
--
-- Tests for overlays/lua/modern_api.lua skills.getGroups(buildId) and
-- skills.setGemGroup(buildId, groupId, gems[]): the socket-group editing RPCs the
-- Rust host dispatches to (task p4-skills-lua, DESIGN.md §6.3 skills.setGemGroup).
--
-- skills.getGroups(buildId) serializes build.skillsTab.socketGroupList into a FLAT
-- list of plain tables:
--
--   { groupId, label, enabled, mainActiveSkill,
--     gems = { { gemId, nameSpec, level, quality, enabled, isSupport }, ... },
--     spirit      = { total, reserved, unreserved },
--     reservation = { mana = { reserved, unreserved }, life = { reserved, unreserved } } }
--
-- The defining contract (DESIGN.md §6.4) is that NO live core table ever leaks: the
-- core's socketGroup / gemInstance tables carry references into the live build, so
-- every returned table — the group entry, its `gems`, and the spirit/reservation
-- summaries — must be a plain table holding only explicitly-copied scalar fields.
--
-- skills.setGemGroup(buildId, groupId, gems[]) REPLACES the target socketGroup's
-- gemList with the supplied gems, re-drives the core calc (ProcessSocketGroup +
-- build OnFrame) so mainOutput is refreshed, and returns a success envelope. This
-- ACTUALLY mutates the live build (unlike items.compare, which uses
-- GetMiscCalculator for a non-mutating A-vs-B pass), so the test proves the
-- before/after calc.run genuinely DIFFER (NO A-vs-A stub — DESIGN §6.3).
--
-- The deterministic fixture (tools/golden-tests/fixtures/sample-build.xml) ships an
-- UNRESOLVED "Mace Strike" gem, so its main skill falls back to the default unarmed
-- "Punch" attack (TotalDPS 8.16). Setting the group to a real, resolving melee gem
-- (Boneshatter) therefore measurably changes TotalDPS — the genuine recalc the task
-- requires.
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which PUC
-- Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_skills_spec.lua

local MODULE = "overlays.lua.modern_api"

-- A real, clean-resolving melee active skill gem id (from the vendored data.gems).
-- Unlike the fixture's ambiguous "Mace Strike", this resolves to a real granted
-- effect, so equipping it replaces the default "Punch" attack and changes TotalDPS.
local BONESHATTER_GEM_ID = "Metadata/Items/Gems/SkillGemBoneshatter"

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

describe("modern_api skills.getGroups(buildId)", function()
	local api
	-- Positive-path snapshot captured ONCE before any negative case runs, so a
	-- malformed call can never affect the captured result (mirrors modern_api_spec).
	local buildId, groupsResult

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		groupsResult = api.skills.getGroups(buildId)
	end)

	it("exposes the skills namespace with getGroups / setGemGroup", function()
		assert.are.equal("table", type(api.skills))
		assert.are.equal("function", type(api.skills.getGroups))
		assert.are.equal("function", type(api.skills.setGemGroup))
	end)

	it("returns a plain envelope with a flat socket-group list", function()
		assertPlain(groupsResult, "getGroups result")
		assert.is_true(groupsResult.ok, "getGroups must succeed on the sample fixture")
		assert.are.equal("table", type(groupsResult.groups))
		assert.is_true(#groupsResult.groups >= 1, "the sample build has at least one socket group")
	end)

	it("serializes the first group's scalar fields (no live core tables)", function()
		local group = groupsResult.groups[1]
		assertPlain(group, "group entry")
		-- groupId is a stable string handle the client passes back to setGemGroup.
		assert.are.equal("string", type(group.groupId))
		assert.is_true(#group.groupId > 0, "groupId must be non-empty")
		assert.are.equal("boolean", type(group.enabled))
		assert.are.equal("number", type(group.mainActiveSkill))
		-- label is a string (the fixture group has an empty label, still a string).
		assert.are.equal("string", type(group.label))
	end)

	it("serializes the group's gems as plain {gemId, nameSpec, level, quality, enabled, isSupport}", function()
		local group = groupsResult.groups[1]
		assert.are.equal("table", type(group.gems))
		assert.is_true(#group.gems >= 1, "the fixture group has at least one gem")
		local gem = group.gems[1]
		assertPlain(gem, "gem entry")
		-- nameSpec/level/quality/enabled/isSupport are always present scalars.
		assert.are.equal("string", type(gem.nameSpec))
		assert.are.equal("Mace Strike", gem.nameSpec)
		assert.are.equal("number", type(gem.level))
		assert.are.equal(20, gem.level)
		assert.are.equal("number", type(gem.quality))
		assert.are.equal("boolean", type(gem.enabled))
		assert.are.equal("boolean", type(gem.isSupport))
	end)

	it("includes a plain spirit/reservation summary (DESIGN §10.5)", function()
		local group = groupsResult.groups[1]
		assertPlain(group.spirit, "spirit summary")
		assert.are.equal("number", type(group.spirit.total))
		assert.are.equal("number", type(group.spirit.reserved))
		assert.are.equal("number", type(group.spirit.unreserved))
		-- The fixture has 100 Spirit and reserves none.
		assert.are.equal(100, group.spirit.total)
		assert.are.equal(0, group.spirit.reserved)

		assertPlain(group.reservation, "reservation summary")
		assertPlain(group.reservation.mana, "mana reservation")
		assert.are.equal("number", type(group.reservation.mana.reserved))
		assert.are.equal("number", type(group.reservation.mana.unreserved))
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError, not a raise", function()
			local bad = api.skills.getGroups("nope-not-a-build")
			assertPlain(bad, "getGroups error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "getGroups error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("rejects a non-string buildId with a CoreError", function()
			local bad = api.skills.getGroups(nil)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)

-- skills.setGemGroup(buildId, groupId, gems[]): REALLY mutates the live build's
-- socketGroup gemList and re-drives the core calc. The whole point (DESIGN §6.3) is
-- that this is NOT a non-mutating A-vs-B compare like items.compare — it changes
-- build state, so calc.run BEFORE and AFTER must observe a genuine difference.
describe("modern_api skills.setGemGroup(buildId, groupId, gems[])", function()
	local api, buildId, groupId, beforeDps, setResult, afterDps

	-- Read TotalDPS out of a calc.run result's curated stat list.
	local function dpsOf(calcResult)
		for _, stat in ipairs(calcResult.stats) do
			if stat.statId == "TotalDPS" then
				return stat.value
			end
		end
		return nil
	end

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		groupId = api.skills.getGroups(buildId).groups[1].groupId

		-- Baseline DPS with the fixture's (unresolved) gem -> default Punch attack.
		beforeDps = dpsOf(api.calc.run(buildId))

		-- Replace the group with a real, resolving melee gem and recalc.
		setResult = api.skills.setGemGroup(buildId, groupId, {
			{ gemId = BONESHATTER_GEM_ID, nameSpec = "", level = 20, quality = 0, enabled = true },
		})

		-- DPS AFTER the real mutation + recalc.
		afterDps = dpsOf(api.calc.run(buildId))
	end)

	it("returns a plain success envelope", function()
		assertPlain(setResult, "setGemGroup result")
		assert.is_true(setResult.ok, "setGemGroup must succeed for a real group + gem")
		assert.are.equal(groupId, setResult.groupId)
	end)

	it("REALLY mutates the build: calc.run before vs after genuinely differ (NO A-vs-A stub)", function()
		assert.are.equal("number", type(beforeDps))
		assert.are.equal("number", type(afterDps))
		assert.is_true(beforeDps > 0, "baseline (default Punch) DPS is the live non-zero value")
		assert.is_true(afterDps > 0, "post-mutation DPS is the live non-zero value")
		assert.is_not.equal(beforeDps, afterDps, "the gem swap must measurably change TotalDPS")
	end)

	it("the new gem is reflected in a subsequent getGroups (the mutation persisted)", function()
		local group = api.skills.getGroups(buildId).groups[1]
		assert.are.equal(1, #group.gems, "the group now holds exactly the one supplied gem")
		assert.are.equal("Boneshatter", group.gems[1].nameSpec)
		assert.are.equal(20, group.gems[1].level)
		assert.is_true(group.gems[1].enabled)
		assert.is_false(group.gems[1].isSupport, "Boneshatter is an active skill, not a support")
	end)

	it("toggling the supplied gem disabled is honoured on the next set", function()
		-- Replace again, this time with the gem disabled: the contract must carry the
		-- caller's `enabled` flag through to the live gem instance.
		local result = api.skills.setGemGroup(buildId, groupId, {
			{ gemId = BONESHATTER_GEM_ID, nameSpec = "", level = 20, quality = 0, enabled = false },
		})
		assert.is_true(result.ok)
		local group = api.skills.getGroups(buildId).groups[1]
		assert.is_false(group.gems[1].enabled, "the disabled flag must round-trip into the live gem")
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError", function()
			local bad = api.skills.setGemGroup("nope", groupId, {})
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an unknown groupId with a CoreError", function()
			local bad = api.skills.setGemGroup(buildId, "no-such-group", {
				{ gemId = BONESHATTER_GEM_ID, nameSpec = "", level = 20, quality = 0, enabled = true },
			})
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects a non-table gems argument with a CoreError", function()
			local bad = api.skills.setGemGroup(buildId, groupId, "not a list")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)
