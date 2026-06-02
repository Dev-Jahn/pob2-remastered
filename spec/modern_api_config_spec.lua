-- spec/modern_api_config_spec.lua
--
-- Tests for overlays/lua/modern_api.lua config.getOptions(buildId) and
-- config.setOption(buildId, optionId, value): the config-preset RPCs the Rust host
-- dispatches to (task p4-config-lua, DESIGN.md §6.3 config.setOption, §10.8 Config tab).
--
-- config.getOptions(buildId) serializes the core's ConfigOptions definitions joined
-- with the live build.configTab.input current values into a FLAT list of plain
-- option cards (DESIGN §6.3 ConfigOptionCard):
--
--   { optionId, type ("check"|"count"|"list"|...), label, value,
--     list  = { { val, label }, ... }   -- only for list-type options
--     ifSkillData = { ... }, ifEnemyCond = { ... }  -- dependency hints (DESIGN §10.8) }
--
-- The defining contract (DESIGN.md §6.4) is that NO live core table ever leaks: the
-- core's varData / configTab tables carry references into the live build, so every
-- returned card — and its nested `list` / dependency tables — must be a plain table
-- holding only explicitly-copied scalar fields. `optionId` is the option `var` (the
-- stable machine handle); `label` is the cleaned display string (color escapes stripped).
--
-- config.setOption(buildId, optionId, value) writes the value into the live
-- configTab.input, re-drives the core calc (BuildModList + build OnFrame) so
-- mainOutput is refreshed, and returns a success envelope. This ACTUALLY mutates the
-- live build, so the test proves that toggling ONE real option (enemy Shocked)
-- measurably changes the calc.run target stat — both reads run through the SAME
-- recalc path, so the only variable is the config option (NO-FALLBACK, NO A-vs-A stub
-- — DESIGN §6.3, §10.8).
--
-- The deterministic fixture (tools/golden-tests/fixtures/sample-build.xml) is a level-1
-- mace build whose basic attack deals real Lightning-free physical damage; setting the
-- enemy Shocked raises the damage the enemy takes, so TotalDPS rises from a stable
-- 8.16... to a stable 9.79..., and clears back when Shock is removed — the genuine,
-- reversible recalc the task requires.
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which PUC
-- Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_config_spec.lua

local MODULE = "overlays.lua.modern_api"

-- The single config option the genuine-recalc test toggles. On the fixture this is an
-- always-eligible enemy condition whose `apply` raises the damage the enemy takes, so
-- flipping it measurably and reversibly changes TotalDPS.
local SHOCK_OPTION = "conditionEnemyShocked"

-- A list-type option with a fixed { val, label } choice list — used to assert the
-- `list` serialization. enemyIsBoss is the canonical four-choice boss selector.
local BOSS_OPTION = "enemyIsBoss"

-- Absolute path to the sample fixture, resolved from this spec file's location so the
-- test is independent of the busted process's working directory.
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

-- Assert a value is a plain Lua table with no metatable (the core's live objects carry
-- class metatables; serializable results must not — DESIGN.md §6.4).
local function assertPlain(value, label)
	assert.are.equal("table", type(value), (label or "value") .. " must be a table")
	assert.is_nil(getmetatable(value), (label or "value") .. " must be a plain table (no live core metatable)")
end

-- Find one option card by its optionId in a getOptions result.
local function findOption(optionsResult, optionId)
	for _, card in ipairs(optionsResult.options) do
		if card.optionId == optionId then
			return card
		end
	end
	return nil
end

describe("modern_api config.getOptions(buildId)", function()
	local api
	-- Positive-path snapshot captured ONCE before any negative case runs, so a
	-- malformed call can never affect the captured result (mirrors modern_api_skills_spec).
	local buildId, optionsResult

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		optionsResult = api.config.getOptions(buildId)
	end)

	it("exposes the config namespace with getOptions / setOption", function()
		assert.are.equal("table", type(api.config))
		assert.are.equal("function", type(api.config.getOptions))
		assert.are.equal("function", type(api.config.setOption))
	end)

	it("returns a plain envelope with a flat option list", function()
		assertPlain(optionsResult, "getOptions result")
		assert.is_true(optionsResult.ok, "getOptions must succeed on the sample fixture")
		assert.are.equal("table", type(optionsResult.options))
		assert.is_true(#optionsResult.options >= 1, "the core defines at least one config option")
	end)

	it("serializes a check option's scalar fields (no live core tables, no section headers)", function()
		local card = findOption(optionsResult, SHOCK_OPTION)
		assert.is_not_nil(card, "conditionEnemyShocked must appear as an option card")
		assertPlain(card, "shock option card")
		-- optionId is the stable string handle the client passes back to setOption.
		assert.are.equal(SHOCK_OPTION, card.optionId)
		assert.are.equal("check", card.type)
		-- label is the cleaned display string: color escapes (^xADAA47) are stripped.
		assert.are.equal("string", type(card.label))
		assert.is_true(#card.label > 0, "label must be non-empty")
		assert.is_nil(card.label:find("%^"), "label must have color escapes stripped")
		-- a check option's current value is a boolean; the fixture leaves shock off.
		assert.is_false(card.value == nil, "a config option card must carry its current value")
	end)

	it("flattens section headers OUT (every card has a non-empty optionId)", function()
		for _, card in ipairs(optionsResult.options) do
			assert.are.equal("string", type(card.optionId))
			assert.is_true(#card.optionId > 0, "every option card must have a non-empty optionId (no section headers)")
			assert.are.equal("string", type(card.type))
		end
	end)

	it("serializes a list option's { val, label } choices as plain tables", function()
		local card = findOption(optionsResult, BOSS_OPTION)
		assert.is_not_nil(card, "enemyIsBoss must appear as an option card")
		assert.are.equal("list", card.type)
		assertPlain(card.list, "list-option choices")
		assert.is_true(#card.list >= 2, "enemyIsBoss has multiple boss choices")
		local choice = card.list[1]
		assertPlain(choice, "list choice")
		assert.are.equal("string", type(choice.val))
		assert.are.equal("string", type(choice.label))
		-- the live current value matches one of the listed choice vals (defaultIndex=3 -> "Pinnacle").
		assert.are.equal("string", type(card.value))
	end)

	it("carries dependency hints (ifSkillData / ifEnemyCond) as plain string lists", function()
		-- Find any card that declares an ifSkillData or ifEnemyCond dependency and assert
		-- it serialized as a plain list of strings (DESIGN §10.8 dependent-modifier link).
		local withSkillData, withEnemyCond
		for _, card in ipairs(optionsResult.options) do
			if card.ifSkillData and not withSkillData then
				withSkillData = card
			end
			if card.ifEnemyCond and not withEnemyCond then
				withEnemyCond = card
			end
		end
		assert.is_not_nil(withSkillData, "at least one option declares an ifSkillData dependency")
		assertPlain(withSkillData.ifSkillData, "ifSkillData hint")
		assert.are.equal("string", type(withSkillData.ifSkillData[1]))

		assert.is_not_nil(withEnemyCond, "at least one option declares an ifEnemyCond dependency")
		assertPlain(withEnemyCond.ifEnemyCond, "ifEnemyCond hint")
		assert.are.equal("string", type(withEnemyCond.ifEnemyCond[1]))
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError, not a raise", function()
			local bad = api.config.getOptions("nope-not-a-build")
			assertPlain(bad, "getOptions error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "getOptions error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("rejects a non-string buildId with a CoreError", function()
			local bad = api.config.getOptions(nil)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)

-- config.setOption(buildId, optionId, value): REALLY mutates the live build's
-- configTab.input and re-drives the core calc. The whole point (DESIGN §6.3, §10.8) is
-- that this is NOT a non-mutating compare — it changes build state, so calc.run with
-- the option ON vs OFF must observe a genuine difference in the target stat.
describe("modern_api config.setOption(buildId, optionId, value)", function()
	local api, buildId, offDps, onDps, setOffResult, setOnResult

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

		-- Baseline: explicitly set the option OFF and recalc, so BOTH reads run through
		-- the SAME setOption recalc path — the only variable between them is the option.
		setOffResult = api.config.setOption(buildId, SHOCK_OPTION, false)
		offDps = dpsOf(api.calc.run(buildId))

		-- Turn the option ON and recalc.
		setOnResult = api.config.setOption(buildId, SHOCK_OPTION, true)
		onDps = dpsOf(api.calc.run(buildId))
	end)

	it("returns a plain success envelope echoing the optionId", function()
		assertPlain(setOnResult, "setOption result")
		assert.is_true(setOnResult.ok, "setOption must succeed for a real option")
		assert.are.equal(SHOCK_OPTION, setOnResult.optionId)
		assert.is_true(setOffResult.ok)
	end)

	it("REALLY changes the calc: target stat with the option ON vs OFF genuinely differ (NO-FALLBACK)", function()
		assert.are.equal("number", type(offDps))
		assert.are.equal("number", type(onDps))
		assert.is_true(offDps > 0, "baseline (no shock) DPS is the live non-zero value")
		assert.is_true(onDps > 0, "shocked DPS is the live non-zero value")
		assert.is_not.equal(offDps, onDps, "toggling enemy Shocked must measurably change TotalDPS")
		-- Shock raises damage taken by the enemy, so ON must be strictly higher.
		assert.is_true(onDps > offDps, "an enemy that is Shocked takes more damage -> higher TotalDPS")
	end)

	it("the new value is reflected in a subsequent getOptions (the mutation persisted)", function()
		local card = findOption(api.config.getOptions(buildId), SHOCK_OPTION)
		assert.are.equal(true, card.value, "the live option now reads back ON")
	end)

	it("is reversible: turning the option back OFF restores the baseline stat", function()
		local result = api.config.setOption(buildId, SHOCK_OPTION, false)
		assert.is_true(result.ok)
		local backDps = dpsOf(api.calc.run(buildId))
		assert.are.equal(offDps, backDps, "removing shock restores the exact baseline TotalDPS")
	end)

	it("sets a list-option value and round-trips it through getOptions", function()
		local result = api.config.setOption(buildId, BOSS_OPTION, "Pinnacle")
		assert.is_true(result.ok)
		local card = findOption(api.config.getOptions(buildId), BOSS_OPTION)
		assert.are.equal("Pinnacle", card.value, "the list-option selection must round-trip")
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError", function()
			local bad = api.config.setOption("nope", SHOCK_OPTION, true)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an unknown optionId with a CoreError", function()
			local bad = api.config.setOption(buildId, "no-such-config-option", true)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects a non-string optionId with a CoreError", function()
			local bad = api.config.setOption(buildId, nil, true)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)
