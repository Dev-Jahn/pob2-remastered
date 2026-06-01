-- spec/print_stats_spec.lua
--
-- Tests for the `--print-stats` core-stat selection wired into
-- overlays/lua/headless_bootstrap.lua (task p0-print-stats-cli).
--
-- DESIGN.md context: §7.4 golden-test "핵심 stat" list and §18 Phase 0 ("CLI에서
-- sample build를 로드하고 주요 stat JSON 출력"). The Phase 0 'core-runner-boot' gate runs
--
--     lua overlays/lua/headless_bootstrap.lua --print-stats | node tools/dev-workflow/assert-stats.mjs
--
-- and must emit a NON-empty JSON object of {statId: value} drawn from the loaded
-- SAMPLE BUILD's mainOutput — not the empty default build, whose all-zero dump would
-- let a no-op stub false-pass assert-stats.mjs (which only checks "has >= 1 key").
--
-- This spec drives the pure selector M.selectCoreStats(mainOutput) against the REAL
-- sample build loaded through the wired loadBuildFromXML path, so it proves both that
-- the fixture flowed through the calc pipeline (Life == 65, a positive DPS) and that
-- the emitted set is a CURATED §7.4 subset, not the full 600+ key mainOutput dump.
--
-- IMPORTANT: the vendored core uses Lua 5.2+ `goto`, so this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/print_stats_spec.lua
--
-- (with the luarocks --local paths exported so lua-utf8 / lfs resolve).

local BOOTSTRAP = "overlays.lua.headless_bootstrap"
local LOADER = "overlays.lua.load_sample"

describe("headless_bootstrap --print-stats core-stat selection", function()
	local bootstrap
	local mainOutput

	setup(function()
		bootstrap = require(BOOTSTRAP)
		-- Load the deterministic sample build through the real wired loader so the
		-- selector runs against an actually-computed mainOutput.
		local loader = require(LOADER)
		local b = loader.load()
		mainOutput = b.calcsTab.mainOutput
	end)

	it("exposes a selectCoreStats(mainOutput) selector", function()
		assert.are.equal("function", type(bootstrap.selectCoreStats))
	end)

	describe("selectCoreStats(mainOutput)", function()
		local stats

		setup(function()
			stats = bootstrap.selectCoreStats(mainOutput)
		end)

		it("returns a non-empty table of {statId = value}", function()
			assert.are.equal("table", type(stats))
			local count = 0
			for _ in pairs(stats) do
				count = count + 1
			end
			assert.is_true(count >= 1, "selected core stats must be non-empty, got " .. count)
		end)

		it("emits a CURATED subset, not the full mainOutput dump", function()
			-- mainOutput has hundreds of keys; the §7.4 core-stat set is small. If the
			-- selector just returned mainOutput verbatim, an empty stub build would still
			-- false-pass the gate. Bound the curated set well below the full dump.
			local fullCount = 0
			for _ in pairs(mainOutput) do
				fullCount = fullCount + 1
			end
			local selCount = 0
			for _ in pairs(stats) do
				selCount = selCount + 1
			end
			assert.is_true(fullCount > 100, "sanity: full mainOutput should be large, got " .. fullCount)
			assert.is_true(
				selCount < fullCount,
				"selected set (" .. selCount .. ") must be a strict subset of mainOutput (" .. fullCount .. ")"
			)
			assert.is_true(selCount <= 40, "curated §7.4 core-stat set should be small, got " .. selCount)
		end)

		it("only selects stats that EXIST in mainOutput (no nil / null placeholders)", function()
			for id, value in pairs(stats) do
				assert.is_not_nil(value, "stat '" .. id .. "' must not be nil")
				assert.are.equal(
					"number",
					type(value),
					"core stat '" .. id .. "' must be a number, got " .. type(value)
				)
				assert.are.equal(
					value,
					mainOutput[id],
					"stat '" .. id .. "' value must match mainOutput verbatim"
				)
			end
		end)

		it("reflects the SAMPLE build, not the empty default (Life == 65)", function()
			-- The deterministic fixture's pools are fixed; this proves the sample build
			-- (not newBuild()) flowed through the calc pipeline into the dump.
			assert.are.equal(65, stats.Life)
			assert.are.equal(50, stats.Mana)
		end)

		it("includes the §7.4 core pools/offence that exist in this build", function()
			-- DESIGN §7.4 핵심 stat: life/mana/ES, total DPS, average hit, armour/evasion,
			-- max resistances. Assert the ones the sample build actually surfaces.
			assert.are.equal("number", type(stats.Life))
			assert.are.equal("number", type(stats.Mana))
			assert.are.equal("number", type(stats.EnergyShield))
			assert.are.equal("number", type(stats.TotalDPS))
			assert.is_true(stats.TotalDPS > 0, "sample build must have a positive TotalDPS")
			assert.are.equal("number", type(stats.Armour))
			-- The Ranger fixture has evasion; the real mainOutput key is `Evasion`.
			assert.are.equal("number", type(stats.Evasion))
			-- Resistances (all -50 at level 1 with no gear/tree res).
			assert.are.equal("number", type(stats.FireResist))
			assert.are.equal("number", type(stats.ColdResist))
			assert.are.equal("number", type(stats.LightningResist))
			assert.are.equal("number", type(stats.ChaosResist))
		end)
	end)
end)
