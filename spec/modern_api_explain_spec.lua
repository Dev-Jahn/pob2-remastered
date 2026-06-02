-- spec/modern_api_explain_spec.lua
--
-- Tests for overlays/lua/modern_api.lua calc.explain(buildId, statId, activeSkillId?):
-- the formula-trace / breakdown extraction RPC the Rust host dispatches to (task
-- p4-explain-lua, DESIGN.md §6.4 "계산 결과에는 sourceTrace를 포함", §10.7 Calcs tab
-- breakdown). This is the CORE-side basis of the Phase 4 doneCriteria "Calcs tab에서
-- 결과 추적(formula trace) 가능".
--
-- calc.explain drives the core's OWN breakdown machine — `calcs.breakdownModule =
-- "Modules/CalcBreakdown"` populates `env.player.breakdown[statId]` during the CALCS
-- mode pass of BuildOutput (CalcsTab:BuildOutput sets `self.calcsEnv =
-- calcs.buildOutput(build, "CALCS")`). calc.explain reads that live breakdown table
-- for `statId` and serializes its §10.7 shape FLAT:
--
--   { ok = true,
--     statId,                 -- the requested stat id (echoed)
--     upstreamRawStatId,      -- the upstream raw mainOutput key (= statId)
--     finalValue,             -- env.player.output[statId] (the computed value)
--     label,                  -- human display label (escapes stripped)
--     trace      = { "...", ... },   -- formula trace lines (the breakdown array part)
--     sources    = { { kind, source, value, ... }, ... } }  -- contribution source list
--
-- Each contribution source carries the core source string (mod.source / slot.source)
-- and its value, classified into item / passive / skillGem / supportGem / config /
-- buff by the source-string prefix the core stamps (Item: / Tree: / Skill: / Config /
-- ...). Contributions come from the breakdown's pre-built `modList` (DESIGN §10.7
-- "기여 source 목록") and, for slot-style defence breakdowns (armour/evasion/ES), its
-- `slots` list.
--
-- NO-FALLBACK (the defining contract): a stat that has NO breakdown is NOT fabricated.
-- Either a structural CALC_FAILED CoreError is returned, or — for a stat whose
-- breakdown exists but carries no contribution mods — an explicit EMPTY `sources` list
-- (never an invented source). The serialization contract (DESIGN §6.4) also holds: no
-- live core table (which carries a class metatable) ever leaks — every returned table
-- is a fresh plain table of explicitly-copied scalars.
--
-- The deterministic fixture (tools/golden-tests/fixtures/sample-build.xml) is a level-1
-- Ranger whose Life resolves to a stable 65 via a multiChain breakdown (62 base x 1.05),
-- and whose Evasion has a single Global slot contribution — both stable across runs.
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which PUC
-- Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_explain_spec.lua

local MODULE = "overlays.lua.modern_api"

-- A stat that ALWAYS has a multiChain formula-trace breakdown on the fixture: Life is
-- 62 base x 1.05 increased = 65, a stable several-line trace.
local LIFE_STAT = "Life"

-- A stat whose breakdown carries a slot-style contribution list (defence totals): the
-- fixture's Evasion has a single Global base slot (7), so its `sources` is non-empty.
local EVASION_STAT = "Evasion"

-- A real upstream output key that the core computes but does NOT generate a breakdown
-- table for — used to prove the NO-FALLBACK CALC_FAILED path for a value-without-trace.
-- (Resistances/pools/Life all DO have breakdowns; a plain scalar like the character
-- level requirement-less ReqStr-adjacent keys often don't. We assert structurally:
-- whichever stat lacks a breakdown must error, never fabricate.)
local NO_BREAKDOWN_STAT = "__definitely_not_a_real_stat__"

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

describe("modern_api calc.explain(buildId, statId)", function()
	local api
	-- Positive-path snapshots captured ONCE before any negative case runs, so a
	-- malformed call can never affect the captured result (mirrors the sibling specs).
	local buildId, lifeResult, evasionResult

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		lifeResult = api.calc.explain(buildId, LIFE_STAT)
		evasionResult = api.calc.explain(buildId, EVASION_STAT)
	end)

	it("exposes calc.explain on the calc namespace", function()
		assert.are.equal("table", type(api.calc))
		assert.are.equal("function", type(api.calc.explain))
	end)

	it("returns a plain envelope with the flat breakdown shape", function()
		assertPlain(lifeResult, "explain result")
		assert.is_true(lifeResult.ok, "explain must succeed for a stat that has a breakdown")
		-- The requested stat id is echoed, and the upstream raw stat id is surfaced.
		assert.are.equal(LIFE_STAT, lifeResult.statId)
		assert.are.equal(LIFE_STAT, lifeResult.upstreamRawStatId)
		-- finalValue is the computed output value (65 on the fixture).
		assert.are.equal("number", type(lifeResult.finalValue))
		assert.are.equal(65, lifeResult.finalValue)
		-- label is a non-empty human display string.
		assert.are.equal("string", type(lifeResult.label))
		assert.is_true(#lifeResult.label > 0, "label must be non-empty")
	end)

	it("serializes the formula trace as plain escape-stripped strings", function()
		assertPlain(lifeResult.trace, "trace")
		assert.is_true(#lifeResult.trace >= 1, "Life has a multiChain formula trace")
		for _, line in ipairs(lifeResult.trace) do
			assert.are.equal("string", type(line))
			-- color escapes (^8 / ^xRRGGBB) must be stripped from the display trace.
			assert.is_nil(line:find("%^"), "trace line must have color escapes stripped: " .. line)
		end
		-- The trace reflects the real multiChain: a base line and the final total.
		local joined = table.concat(lifeResult.trace, "\n")
		assert.is_true(joined:find("base", 1, true) ~= nil, "trace shows the base contribution")
		assert.is_true(joined:find("65", 1, true) ~= nil, "trace shows the computed total")
	end)

	it("returns an explicit (possibly empty) plain sources list for a trace-only stat", function()
		-- Life's breakdown is a pure formula trace (no pre-built modList / slots), so its
		-- `sources` is an EXPLICIT empty list — never a fabricated source (NO-FALLBACK).
		assertPlain(lifeResult.sources, "sources")
		assert.are.equal(0, #lifeResult.sources, "a trace-only stat exposes zero fabricated sources")
	end)

	it("serializes slot-style contribution sources with classification + value", function()
		assert.is_true(evasionResult.ok, "Evasion has a slot-style breakdown")
		assertPlain(evasionResult.sources, "evasion sources")
		assert.is_true(#evasionResult.sources >= 1, "Evasion has at least one slot contribution")
		local src = evasionResult.sources[1]
		assertPlain(src, "evasion source entry")
		-- Every contribution carries the core source string, a value, and a `kind`
		-- classification (item / passive / skillGem / supportGem / config / buff).
		assert.are.equal("string", type(src.source))
		assert.are.equal("number", type(src.value))
		assert.are.equal("string", type(src.kind))
		-- The fixture's single Evasion slot is a Global base contribution -> classified
		-- as a non-item/passive/skill source (a "buff"/other bucket), value 7.
		assert.are.equal("buff", src.kind)
		assert.are.equal(7, src.value)
	end)

	describe("source classification (DESIGN §10.7 item/passive/skillGem/config/buff)", function()
		-- classifySource is exposed for table-driven verification: the source-string
		-- prefix the core stamps -> the stable kind bucket.
		it("maps each core source prefix to its kind bucket", function()
			assert.are.equal("function", type(api.calc.classifySource))
			assert.are.equal("item", api.calc.classifySource("Item:1:Plated Mace"))
			assert.are.equal("passive", api.calc.classifySource("Tree:50459"))
			assert.are.equal("skillGem", api.calc.classifySource("Skill:MaceStrike"))
			assert.are.equal("config", api.calc.classifySource("Config"))
			-- Anything the core does not stamp as item/passive/skill/config falls into the
			-- catch-all buff/other bucket (Base, Quest:, Strength, ...): never invented.
			assert.are.equal("buff", api.calc.classifySource("Base"))
			assert.are.equal("buff", api.calc.classifySource("Quest:Act 1: Ogham Manor"))
			assert.are.equal("buff", api.calc.classifySource("Strength"))
		end)
	end)

	describe("NO-FALLBACK: a stat with no breakdown is not fabricated", function()
		it("returns a structural CALC_FAILED for a stat that has no breakdown", function()
			local bad = api.calc.explain(buildId, NO_BREAKDOWN_STAT)
			assertPlain(bad, "no-breakdown result")
			assert.is_false(bad.ok, "a stat with no breakdown must not be fabricated")
			assertPlain(bad.error, "no-breakdown error")
			assert.are.equal("CALC_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError, not a raise", function()
			local bad = api.calc.explain("nope-not-a-build", LIFE_STAT)
			assertPlain(bad, "explain error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "explain error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("rejects a non-string buildId with a CoreError", function()
			local bad = api.calc.explain(nil, LIFE_STAT)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects a missing / non-string statId with a CoreError", function()
			local bad = api.calc.explain(buildId, nil)
			assert.is_false(bad.ok)
			-- a malformed statId request is a CALC_FAILED (we cannot explain "no stat").
			assert.are.equal("CALC_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)
	end)
end)

-- runner.lua METHODS registration: calc.explain must be dispatchable over JSON-RPC so
-- the Rust host can drive the Calcs-tab trace (task p4-explain-lua "runner.lua METHODS에
-- calc.explain을 등록한다").
describe("runner calc.explain dispatch", function()
	local runner, buildId

	setup(function()
		runner = require("overlays.lua.runner")
		local api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
	end)

	it("registers calc.explain and returns the breakdown over JSON-RPC", function()
		local response = runner.dispatch({
			jsonrpc = "2.0",
			id = 7,
			method = "calc.explain",
			params = { buildId = buildId, statId = LIFE_STAT },
		})
		assert.are.equal(7, response.id)
		assert.is_nil(response.error, "calc.explain must be a registered method (not -32601)")
		assert.are.equal("table", type(response.result))
		assert.are.equal(LIFE_STAT, response.result.statId)
		assert.are.equal("table", type(response.result.trace))
		assert.are.equal("table", type(response.result.sources))
	end)

	it("propagates a CoreError as a JSON-RPC application error", function()
		local response = runner.dispatch({
			jsonrpc = "2.0",
			id = 8,
			method = "calc.explain",
			params = { buildId = "nope", statId = LIFE_STAT },
		})
		assert.are.equal(8, response.id)
		assert.are.equal("table", type(response.error))
		-- the CoreError code survives the hop in error.data.code (runner fromEnvelope).
		assert.are.equal("BUILD_PARSE_FAILED", response.error.data.code)
	end)
end)
