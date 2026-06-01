-- spec/headless_bootstrap_spec.lua
--
-- Tests for overlays/lua/headless_bootstrap.lua: the real bootstrap that boots
-- the vendored upstream PoB2 Lua core headless, purely from the overlay, with no
-- edits to vendor/ (DESIGN.md §6.2, §7.1, §18 Phase 0).
--
-- The bootstrap's job (task p0-headless-bootstrap):
--   1. load compatibility_shims.lua first;
--   2. set package.path priority overlays/lua -> vendor/.../src -> runtime/lua so
--      the pure-Lua deps (xml, base64, sha1, dkjson) and upstream src resolve from
--      the working dir WITHOUT editing vendor;
--   3. chdir into vendor src so dofile('HeadlessWrapper.lua') and its relative
--      dofile('Launch.lua') resolve;
--   4. run OnInit/OnFrame and expose the `build` global (mainObject.main.modes.BUILD);
--   5. abort with a clear, non-zero error if the core fails to init rather than
--      silently producing empty output.
--
-- IMPORTANT: the vendored core uses Lua 5.2+ `goto` (e.g. Modules/Build.lua:83),
-- which PUC Lua 5.1 cannot even parse. Upstream itself runs the headless wrapper
-- under LuaJIT (docker-compose.yml `busted --lua=luajit`). So this spec must be run
-- under LuaJIT:
--
--     busted --lua=luajit spec/headless_bootstrap_spec.lua
--
-- (with the luarocks --local paths exported so lua-utf8 / lfs resolve).

local MODULE = "overlays.lua.headless_bootstrap"

local function loadBootstrapFresh()
	package.loaded[MODULE] = nil
	return require(MODULE)
end

describe("headless_bootstrap", function()
	local bootstrap

	setup(function()
		bootstrap = loadBootstrapFresh()
	end)

	it("returns a module exposing boot()", function()
		assert.are.equal("table", type(bootstrap))
		assert.are.equal("function", type(bootstrap.boot))
	end)

	describe("boot()", function()
		local result

		setup(function()
			-- boot() must be idempotent / safe to call once here and reuse below.
			result = bootstrap.boot()
		end)

		it("exposes the `build` global as a table", function()
			assert.are.equal("table", type(build))
		end)

		it("returns the build object from boot()", function()
			assert.are.equal("table", type(result))
			assert.are.equal(build, result)
		end)

		it("wires build to mainObject.main.modes.BUILD", function()
			assert.are.equal("table", type(build.calcsTab))
		end)

		it("populates build.calcsTab.mainOutput after a default newBuild", function()
			-- HeadlessWrapper exposes a global newBuild(); a fresh default build
			-- must run the calc pipeline and populate mainOutput.
			assert.are.equal("function", type(newBuild))
			newBuild()

			assert.are.equal("table", type(build.calcsTab.mainOutput))

			local count = 0
			for _ in pairs(build.calcsTab.mainOutput) do
				count = count + 1
			end
			assert.is_true(count > 0, "mainOutput must be a populated table, got " .. count .. " entries")

			-- A default level-1 character always has a positive Life pool; this is a
			-- concrete proof the calc layer actually ran, not just an empty stub table.
			assert.are.equal("number", type(build.calcsTab.mainOutput.Life))
			assert.is_true(build.calcsTab.mainOutput.Life > 0)
		end)
	end)
end)
