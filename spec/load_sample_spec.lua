-- spec/load_sample_spec.lua
--
-- Tests for overlays/lua/load_sample.lua: the helper that loads the deterministic
-- sample build fixture (tools/golden-tests/fixtures/sample-build.xml) into the
-- headless upstream core via the wired `loadBuildFromXML` global, and returns the
-- resulting `build` object (task p0-sample-build-fixture).
--
-- DESIGN.md context: §7.4 golden-test fixtures, §18 Phase 0 ("CLI에서 sample build를
-- 로드하고 주요 stat JSON 출력"). This fixture feeds the Phase 1 golden tests, so it
-- must load WITHOUT error and yield a populated mainOutput.
--
-- IMPORTANT: like the headless bootstrap, the vendored core uses Lua 5.2+ `goto`, so
-- this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/load_sample_spec.lua
--
-- (with the luarocks --local paths exported so lua-utf8 / lfs resolve).

local MODULE = "overlays.lua.load_sample"

-- Absolute path to the fixture, resolved from this spec file's location so the test
-- is independent of the busted process's working directory.
local function fixturePath()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		path = (os.getenv("PWD") or ".") .. "/" .. path
	end
	-- spec/load_sample_spec.lua -> repo root -> fixtures
	local specDir = path:match("^(.*)[/\\][^/\\]*$")
	local repoRoot = specDir:match("^(.*)[/\\][^/\\]*$")
	return repoRoot .. "/tools/golden-tests/fixtures/sample-build.xml"
end

local function loadModuleFresh()
	package.loaded[MODULE] = nil
	return require(MODULE)
end

describe("load_sample", function()
	local loader

	setup(function()
		loader = loadModuleFresh()
	end)

	it("returns a module exposing load()", function()
		assert.are.equal("table", type(loader))
		assert.are.equal("function", type(loader.load))
	end)

	describe("load(fixturePath)", function()
		local result

		setup(function()
			result = loader.load(fixturePath())
		end)

		it("loads the fixture without error and returns the build object", function()
			assert.are.equal("table", type(result))
			-- The headless core wires the loaded build to the `build` global.
			assert.are.equal(build, result)
		end)

		it("yields a populated mainOutput (the calc pipeline actually ran)", function()
			assert.are.equal("table", type(build.calcsTab))
			assert.are.equal("table", type(build.calcsTab.mainOutput))
			local count = 0
			for _ in pairs(build.calcsTab.mainOutput) do
				count = count + 1
			end
			assert.is_true(count > 0, "mainOutput must be populated, got " .. count .. " entries")
		end)

		it("mainOutput contains Life", function()
			local out = build.calcsTab.mainOutput
			assert.are.equal("number", type(out.Life))
			assert.is_true(out.Life > 0, "Life must be a positive pool, got " .. tostring(out.Life))
		end)

		it("mainOutput contains a DPS-family key", function()
			local out = build.calcsTab.mainOutput
			-- A build with a default skill must produce at least one DPS-family stat.
			-- The core emits TotalDPS / CombinedDPS / FullDPS depending on the skill;
			-- the fixture only needs to surface at least one of them.
			local dpsKeys = { "TotalDPS", "CombinedDPS", "FullDPS", "AverageDamage", "WithImpaleDPS" }
			local found = nil
			for _, key in ipairs(dpsKeys) do
				if type(out[key]) == "number" then
					found = key
					break
				end
			end
			assert.is_not_nil(
				found,
				"mainOutput must contain at least one DPS-family key "
					.. "(TotalDPS/CombinedDPS/FullDPS/AverageDamage/WithImpaleDPS)"
			)
		end)
	end)
end)
