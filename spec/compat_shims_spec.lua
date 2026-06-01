-- spec/compat_shims_spec.lua
--
-- Tests for overlays/lua/compatibility_shims.lua: the boot shim that lets the
-- vendored upstream Launch.lua run under PUC Lua 5.1 (no LuaJIT), where the
-- audit found `Launch.lua:17 jit.opt.start(...)` crashes because `jit` is nil.
--
-- Run with: busted (PUC Lua 5.1). See repo-root .busted config.

local MODULE = "overlays.lua.compatibility_shims"

-- Load the shim fresh, the way a boot path would (clears require cache so each
-- example exercises a genuine load rather than a cached return value).
local function loadShimFresh()
	package.loaded[MODULE] = nil
	return require(MODULE)
end

describe("compatibility_shims", function()
	local savedJit

	before_each(function()
		savedJit = jit
	end)

	after_each(function()
		jit = savedJit
		package.loaded[MODULE] = nil
	end)

	describe("under PUC Lua 5.1 (no real jit)", function()
		before_each(function()
			jit = nil
		end)

		it("defines a global jit table", function()
			loadShimFresh()
			assert.are.equal("table", type(jit))
		end)

		it("makes jit.opt.start callable without erroring (Launch.lua:17)", function()
			loadShimFresh()
			assert.are.equal("table", type(jit.opt))
			assert.are.equal("function", type(jit.opt.start))
			assert.has_no.errors(function()
				jit.opt.start("maxtrace=4000", "maxmcode=8192")
			end)
		end)

		it("provides jit.version and a callable jit.status", function()
			loadShimFresh()
			assert.are.equal("string", type(jit.version))
			assert.are.equal("function", type(jit.status))
			assert.has_no.errors(function()
				jit.status()
			end)
		end)

		it("is idempotent: loading the shim twice is safe", function()
			loadShimFresh()
			local firstJit = jit
			assert.has_no.errors(function()
				loadShimFresh()
			end)
			-- A second load must keep a working jit.opt.start and not blow away state.
			assert.are.equal("function", type(jit.opt.start))
			assert.has_no.errors(function()
				jit.opt.start("maxtrace=4000")
			end)
			-- Idempotent: the already-installed shim table is reused, not replaced.
			assert.are.equal(firstJit, jit)
		end)
	end)

	describe("under real LuaJIT (jit already exists)", function()
		it("is a no-op: does not overwrite the real jit table", function()
			-- Simulate a real LuaJIT jit so we can prove the shim leaves it untouched.
			local realJit = {
				opt = { start = function() end },
				version = "LuaJIT 2.1.0-real",
				status = function()
					return true
				end,
			}
			jit = realJit
			loadShimFresh()
			assert.are.equal(realJit, jit)
			assert.are.equal("LuaJIT 2.1.0-real", jit.version)
		end)
	end)
end)
