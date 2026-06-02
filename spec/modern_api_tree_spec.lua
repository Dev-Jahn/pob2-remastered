-- spec/modern_api_tree_spec.lua
--
-- Tests for overlays/lua/modern_api.lua tree.getData / tree.previewAllocate /
-- tree.applyAllocate: the passive-tree query/allocation RPCs the Rust host
-- dispatches to (task p5-tree-runner-api, DESIGN.md §6.3 tree.previewAllocate /
-- tree.applyAllocate, §10.6 Passive Tree tab "allocation delta preview").
--
-- tree.getData(buildId) serializes the ACTIVE build.spec (its current tree version)
-- into PLAIN tables (DESIGN.md §6.4 serialization rule — plain table only, NO
-- metatable leak):
--
--   { ok, treeVersion,
--     nodes  = { { nodeId, name, type, x, y, orbit, orbitIndex, group, isAscendancy }, ... },
--     groups = { { groupId, x, y }, ... },
--     constants = { classes = {<name>=<id>,...}, orbitAnglesByOrbit, orbitRadii, skillsPerOrbit },
--     allocatedNodeIds = { <id>, ... } }
--
-- The defining contract (DESIGN.md §6.4) is that NO live core table ever leaks: the
-- core's PassiveSpec / node / group / constants tables carry class metatables and
-- references into the live build, so every returned table — the result, each node,
-- each group, and the constants — must be a plain table holding only explicitly-
-- copied scalars (or nested plain tables).
--
-- tree.previewAllocate(buildId, nodeIds[]) computes the calc delta of allocating a
-- node SET WITHOUT mutating the build, via the vendor PassiveSpec/CalcSetup
-- non-destructive path: build.calcsTab:GetMiscCalculator() returns
-- (calcFunc, baseOutput) where calcFunc({ addNodes = <set keyed by node object> })
-- recomputes the FULL output as if those nodes (and the shortest path to reach them)
-- were also allocated — the SAME mechanism items.compare uses for repItem. The delta
-- is the per-stat before/after across the curated §7.4 stats. The build's live
-- allocation is NOT changed (a subsequent getData reports the same allocatedNodeIds).
--
-- tree.applyAllocate(buildId, nodeIds[]) ACTUALLY mutates the live spec via
-- PassiveSpec:AllocNode + re-runs the core calc, so a subsequent getData shows the
-- new node in allocatedNodeIds and calc.run observes the genuine change.
--
-- NO-FALLBACK (DESIGN.md §6.4): when the vendored core does not expose the
-- non-destructive override path (no GetMiscCalculator / no addNodes support) the API
-- surfaces a structured UPSTREAM_INCOMPATIBLE CoreError — it never fabricates a delta.
--
-- The deterministic fixture (tools/golden-tests/fixtures/sample-build.xml) is a
-- Ranger (class-start node 50459 only allocated). Node 13828 is an "Evasion" notable
-- directly adjacent to the start (path length 1): allocating it raises Evasion from 7
-- to 23 — the genuine, reproducible delta these tests assert.
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which PUC
-- Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/modern_api_tree_spec.lua

local MODULE = "overlays.lua.modern_api"

-- The fixture's class-start node (RANGER ClassStart), the only node allocated on load.
local START_NODE_ID = 50459
-- An "Evasion" notable directly adjacent to the start (path length 1). Allocating it
-- (alone, no other nodes) raises the curated Evasion stat from 7 -> 23 — a clean,
-- minimal, deterministic delta that touches a curated §7.4 stat.
local EVASION_NODE_ID = 13828

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

-- Assert a value is a plain Lua table with no metatable (the core's live objects
-- carry class metatables; serializable results must not — DESIGN.md §6.4).
local function assertPlain(value, label)
	assert.are.equal("table", type(value), (label or "value") .. " must be a table")
	assert.is_nil(getmetatable(value), (label or "value") .. " must be a plain table (no live core metatable)")
end

-- Find a serialized node by its nodeId in a getData node list.
local function findNode(nodes, nodeId)
	for _, n in ipairs(nodes) do
		if n.nodeId == nodeId then
			return n
		end
	end
	return nil
end

-- Read a stat's delta entry from a previewAllocate / curated delta list.
local function deltaOf(deltas, statId)
	for _, d in ipairs(deltas) do
		if d.statId == statId then
			return d
		end
	end
	return nil
end

describe("modern_api tree.getData(buildId)", function()
	local api
	-- Positive-path snapshot captured ONCE before any negative case runs, so a
	-- malformed call can never affect the captured result (mirrors the other specs).
	local buildId, data

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		data = api.tree.getData(buildId)
	end)

	it("exposes the tree namespace with getData / previewAllocate / applyAllocate", function()
		assert.are.equal("table", type(api.tree))
		assert.are.equal("function", type(api.tree.getData))
		assert.are.equal("function", type(api.tree.previewAllocate))
		assert.are.equal("function", type(api.tree.applyAllocate))
	end)

	it("returns a plain envelope with the active tree version, nodes, groups, constants", function()
		assertPlain(data, "getData result")
		assert.is_true(data.ok, "getData must succeed on the sample fixture")
		-- The fixture's Spec is treeVersion 0_5.
		assert.are.equal("0_5", data.treeVersion)
		assert.are.equal("table", type(data.nodes))
		assert.are.equal("table", type(data.groups))
		assert.are.equal("table", type(data.constants))
		assert.is_true(#data.nodes > 1000, "the 0_5 tree has thousands of nodes")
		assert.is_true(#data.groups > 100, "the 0_5 tree has hundreds of groups")
	end)

	it("serializes the start node's coordinates and identity (no live core tables)", function()
		local node = findNode(data.nodes, START_NODE_ID)
		assert.is_not_nil(node, "the start node must be present in the node list")
		assertPlain(node, "start node entry")
		-- The class-start node is named RANGER, type ClassStart.
		assert.are.equal("RANGER", node.name)
		assert.are.equal("ClassStart", node.type)
		-- Real numeric coordinates derived from the orbit math (PassiveTree:ProcessNode).
		assert.are.equal("number", type(node.x))
		assert.are.equal("number", type(node.y))
		assert.are.equal("number", type(node.orbit))
		assert.are.equal("number", type(node.orbitIndex))
		assert.are.equal("number", type(node.group))
		assert.are.equal("boolean", type(node.isAscendancy))
		-- connections is the node's edge graph (node.linkedId) — the renderer derives
		-- the connecting edges from it; the start node links to at least one neighbour.
		assert.are.equal("table", type(node.connections))
		assert.is_true(#node.connections > 0, "the start node must list its connections")
	end)

	it("serializes node connections both ways (the start <-> evasion edge)", function()
		local start = findNode(data.nodes, START_NODE_ID)
		local evasion = findNode(data.nodes, EVASION_NODE_ID)
		assert.is_not_nil(start)
		assert.is_not_nil(evasion)
		-- The Evasion notable is path-length 1 from the start, so the two are directly
		-- connected — connectivity round-trips both ways (the edge list is derived from it).
		local function contains(list, id)
			for _, v in ipairs(list) do
				if v == id then
					return true
				end
			end
			return false
		end
		assert.is_true(contains(start.connections, EVASION_NODE_ID), "start must link to the evasion node")
		assert.is_true(contains(evasion.connections, START_NODE_ID), "evasion must link back to the start")
	end)

	it("serializes the Evasion node we use for the allocation tests", function()
		local node = findNode(data.nodes, EVASION_NODE_ID)
		assert.is_not_nil(node, "the evasion notable must be present")
		assertPlain(node, "evasion node entry")
		assert.are.equal("string", type(node.name))
		-- It belongs to a real group, with finite coordinates.
		assert.are.equal("number", type(node.x))
		assert.are.equal("number", type(node.y))
	end)

	it("serializes groups as plain {groupId, x, y}", function()
		local group = data.groups[1]
		assertPlain(group, "group entry")
		assert.is_not_nil(group.groupId, "group must carry an id")
		assert.are.equal("number", type(group.x))
		assert.are.equal("number", type(group.y))
	end)

	it("serializes constants (classes / orbitAnglesByOrbit) as plain nested tables", function()
		assertPlain(data.constants, "constants")
		assertPlain(data.constants.classes, "constants.classes")
		-- The Ranger fixture is DexClass; the classes map is a {name -> id} table.
		assert.are.equal("number", type(data.constants.classes.DexClass))
		assertPlain(data.constants.orbitAnglesByOrbit, "orbitAnglesByOrbit")
		-- orbitAnglesByOrbit is a per-orbit list of angle lists; orbit 1 has angles.
		assert.are.equal("table", type(data.constants.orbitAnglesByOrbit[1]))
		assert.are.equal("table", type(data.constants.orbitRadii))
		assert.are.equal("table", type(data.constants.skillsPerOrbit))
	end)

	it("reports the currently-allocated node ids (the fixture start node)", function()
		assert.are.equal("table", type(data.allocatedNodeIds))
		local hasStart = false
		for _, id in ipairs(data.allocatedNodeIds) do
			if id == START_NODE_ID then
				hasStart = true
			end
		end
		assert.is_true(hasStart, "the class-start node must be reported as allocated")
		assert.are.equal(1, #data.allocatedNodeIds, "only the class-start node is allocated on load")
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError, not a raise", function()
			local bad = api.tree.getData("nope-not-a-build")
			assertPlain(bad, "getData error result")
			assert.is_false(bad.ok)
			assertPlain(bad.error, "getData error")
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
			assert.are.equal("string", type(bad.error.message))
		end)

		it("rejects a non-string buildId with a CoreError", function()
			local bad = api.tree.getData(nil)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)

-- tree.previewAllocate(buildId, nodeIds[]): NON-destructive delta. Uses the vendor
-- PassiveSpec/CalcSetup addNodes override (via GetMiscCalculator), so the live build's
-- allocation is NEVER changed — the whole point (DESIGN §10.6 "allocation delta
-- preview") is a hover-time delta that does not commit the node.
describe("modern_api tree.previewAllocate(buildId, nodeIds[])", function()
	local api, buildId, preview

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		preview = api.tree.previewAllocate(buildId, { EVASION_NODE_ID })
	end)

	it("returns a plain envelope with a curated before/after/delta stat list", function()
		assertPlain(preview, "previewAllocate result")
		assert.is_true(preview.ok, "previewAllocate must succeed for a reachable node")
		assert.are.equal("table", type(preview.deltas))
		local d = preview.deltas[1]
		assertPlain(d, "delta entry")
		assert.are.equal("string", type(d.statId))
		assert.are.equal("number", type(d.before))
		assert.are.equal("number", type(d.after))
		assert.are.equal("number", type(d.delta))
	end)

	it("reports the genuine Evasion delta (7 -> 23) the vendor calc produces", function()
		local ev = deltaOf(preview.deltas, "Evasion")
		assert.is_not_nil(ev, "Evasion must appear in the preview deltas")
		assert.are.equal(7, ev.before)
		assert.are.equal(23, ev.after)
		assert.are.equal(16, ev.delta)
	end)

	it("does NOT mutate the live build: allocation is unchanged after preview", function()
		local data = api.tree.getData(buildId)
		assert.are.equal(1, #data.allocatedNodeIds, "preview must not commit the node")
		assert.are.equal(START_NODE_ID, data.allocatedNodeIds[1])
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError", function()
			local bad = api.tree.previewAllocate("nope", { EVASION_NODE_ID })
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects a non-table nodeIds argument with a CoreError", function()
			local bad = api.tree.previewAllocate(buildId, "not a list")
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an unknown nodeId with a CoreError (no such node in the tree)", function()
			local bad = api.tree.previewAllocate(buildId, { 999999999 })
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)

-- tree.applyAllocate(buildId, nodeIds[]): REALLY mutates the live spec and re-drives
-- the core calc. Unlike previewAllocate (a non-mutating A-vs-B pass), this commits the
-- node — so a subsequent getData shows it allocated and calc.run observes the change.
describe("modern_api tree.applyAllocate(buildId, nodeIds[])", function()
	local api, buildId, beforeEvasion, applyResult, afterEvasion

	-- Read a curated stat value out of a calc.run result's stat list.
	local function statOf(calcResult, statId)
		for _, stat in ipairs(calcResult.stats) do
			if stat.statId == statId then
				return stat.value
			end
		end
		return nil
	end

	setup(function()
		api = require(MODULE)
		buildId = api.build.load(readFixtureXml()).buildId
		beforeEvasion = statOf(api.calc.run(buildId), "Evasion")
		applyResult = api.tree.applyAllocate(buildId, { EVASION_NODE_ID })
		afterEvasion = statOf(api.calc.run(buildId), "Evasion")
	end)

	it("returns a plain success envelope", function()
		assertPlain(applyResult, "applyAllocate result")
		assert.is_true(applyResult.ok, "applyAllocate must succeed for a reachable node")
	end)

	it("REALLY mutates the build: calc.run before vs after genuinely differ", function()
		assert.are.equal("number", type(beforeEvasion))
		assert.are.equal("number", type(afterEvasion))
		assert.are.equal(7, beforeEvasion)
		assert.are.equal(23, afterEvasion)
	end)

	it("the node is reflected in a subsequent getData (the mutation persisted)", function()
		local data = api.tree.getData(buildId)
		local allocated = {}
		for _, id in ipairs(data.allocatedNodeIds) do
			allocated[id] = true
		end
		assert.is_true(allocated[EVASION_NODE_ID], "the allocated node must appear in allocatedNodeIds")
		assert.is_true(allocated[START_NODE_ID], "the start node remains allocated")
	end)

	describe("CoreError handling (DESIGN §6.4)", function()
		it("rejects an unknown buildId with a CoreError", function()
			local bad = api.tree.applyAllocate("nope", { EVASION_NODE_ID })
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects a non-table nodeIds argument with a CoreError", function()
			local bad = api.tree.applyAllocate(buildId, 42)
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)

		it("rejects an unknown nodeId with a CoreError", function()
			local bad = api.tree.applyAllocate(buildId, { 999999999 })
			assert.is_false(bad.ok)
			assert.are.equal("BUILD_PARSE_FAILED", bad.error.code)
		end)
	end)
end)
