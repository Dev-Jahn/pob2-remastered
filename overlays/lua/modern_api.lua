--- modern_api.lua
---
--- Stable, UI-agnostic API surface over the upstream calc/build/items core. This is
--- the in-process Lua API the Rust host's runner dispatches to (DESIGN.md §6.3
--- CoreRequestMap: build.*, calc.*, items.*). It reuses headless_bootstrap.boot()
--- to stand up the vendored core with NO vendor edits (DESIGN.md §6.2, §7.1) and
--- drives the core's own wired entrypoints (loadBuildFromXML, build:SaveDB("xml"),
--- new("Item", raw)).
---
--- Serialization contract (DESIGN.md §6.4):
---   * Every public fn returns PLAIN Lua tables only — no live core table (which
---     carries a class metatable) ever leaks to the caller.
---   * Every public fn returns a result envelope:
---         success -> { ok = true,  <payload fields...> }
---         failure -> { ok = false, error = { code, message } }
---     where `code` is one of the CoreError union (DESIGN.md §6.4). Core errors are
---     caught (pcall) and converted to this shape — a caller never sees a raw Lua
---     traceback.
---
--- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
--- PUC Lua 5.1 cannot parse. Booting in-process (boot()) must therefore happen
--- under LuaJIT (`busted --lua=luajit`).

local bootstrap = require("overlays.lua.headless_bootstrap")

local M = {}
M.build = {}
M.calc = {}
M.items = {}

-- CoreError union (DESIGN.md §6.4). Kept as named constants so every error site
-- references the same canonical code string.
local ERR = {
	CORE_INIT_FAILED = "CORE_INIT_FAILED",
	BUILD_PARSE_FAILED = "BUILD_PARSE_FAILED",
	UNKNOWN_MOD = "UNKNOWN_MOD",
	CALC_FAILED = "CALC_FAILED",
}

-- Build a {ok=false, error={code,message}} envelope (DESIGN.md §6.4).
local function err(code, message)
	return { ok = false, error = { code = code, message = tostring(message) } }
end

-- Coerce a value coming from the core to a serializable scalar. Tables (live core
-- objects, mod lists, etc.) are NOT passed through verbatim — callers only ever
-- receive the explicit plain fields each builder below copies out (DESIGN.md §6.4).
local function scalar(value)
	local t = type(value)
	if t == "number" or t == "string" or t == "boolean" then
		return value
	end
	return nil
end

-- The single live build the headless core hosts. The upstream core is a
-- process-global singleton — `build` = mainObject.main.modes.BUILD (DESIGN.md §6.2;
-- headless_bootstrap boot() comment). There is no multi-build store yet, so we track
-- the id of the currently-loaded build and reject any other id with a CoreError
-- rather than silently operating on the wrong (or a stale) build.
local activeBuildId = nil
local buildCounter = 0

local function nextBuildId()
	buildCounter = buildCounter + 1
	return "build-" .. tostring(buildCounter)
end

-- Resolve a caller-supplied buildId to the live core build object, or return a
-- CoreError envelope if it is not the active build. The boolean second return marks
-- success so callers can branch without re-checking the table shape.
local function resolveBuild(buildId)
	if type(buildId) ~= "string" or buildId == "" then
		return err(ERR.BUILD_PARSE_FAILED, "buildId must be a non-empty string"), false
	end
	if buildId ~= activeBuildId then
		return err(ERR.BUILD_PARSE_FAILED, "unknown buildId '" .. buildId .. "' (no such loaded build)"), false
	end
	local b = rawget(_G, "build")
	if type(b) ~= "table" then
		return err(ERR.CORE_INIT_FAILED, "core build object is not available"), false
	end
	return b, true
end

-- The DESIGN §7.4 "핵심 stat" set, as {statId -> human label}. The statId is the
-- machine-readable mainOutput key (the stable contract); the label is the display
-- string the UI shows (DESIGN.md §6.4 "표시용 localized label과 기계 판독용 stat id를 분리").
-- Curated and ordered deliberately — this mirrors headless_bootstrap.CORE_STAT_KEYS,
-- not the full 600+ key dump. Stats absent from a given build are simply not emitted.
local CORE_STATS = {
	{ id = "Life", label = "Life" },
	{ id = "Mana", label = "Mana" },
	{ id = "EnergyShield", label = "Energy Shield" },
	{ id = "Ward", label = "Ward" },
	{ id = "Spirit", label = "Spirit" },
	{ id = "TotalDPS", label = "Total DPS" },
	{ id = "CombinedDPS", label = "Combined DPS" },
	{ id = "FullDPS", label = "Full DPS" },
	{ id = "AverageHit", label = "Average Hit" },
	{ id = "AverageDamage", label = "Average Damage" },
	{ id = "WithDotDPS", label = "DPS with DoT" },
	{ id = "TotalDot", label = "Total DoT DPS" },
	{ id = "Armour", label = "Armour" },
	{ id = "Evasion", label = "Evasion" },
	{ id = "EvasionRating", label = "Evasion Rating" },
	{ id = "TotalEHP", label = "Effective Hit Pool" },
	{ id = "FireResist", label = "Fire Resistance" },
	{ id = "ColdResist", label = "Cold Resistance" },
	{ id = "LightningResist", label = "Lightning Resistance" },
	{ id = "ChaosResist", label = "Chaos Resistance" },
}

-- Build the curated §7.4 stat list as {statId, value, label} entries, including only
-- the CORE_STATS that exist as numbers in mainOutput (NO-FALLBACK: real stats only,
-- never null placeholders).
local function curateStats(mainOutput)
	local stats = {}
	for _, def in ipairs(CORE_STATS) do
		local value = mainOutput[def.id]
		if type(value) == "number" then
			stats[#stats + 1] = { statId = def.id, value = value, label = def.label }
		end
	end
	return stats
end

-- Extract a plain, serializable summary from the live build object (DESIGN.md §6.4).
-- Only explicit scalar fields are copied — the live `build`, `build.spec`,
-- `build.itemsTab` etc. never leave this module.
local function summarizeBuild(b)
	local itemCount = 0
	if type(b.itemsTab) == "table" and type(b.itemsTab.items) == "table" then
		for _ in pairs(b.itemsTab.items) do
			itemCount = itemCount + 1
		end
	end
	return {
		className = scalar(b.spec and b.spec.curClassName),
		ascendancyName = scalar(b.spec and b.spec.curAscendClassName),
		level = scalar(b.characterLevel) or scalar(b.level) or 0,
		itemCount = itemCount,
	}
end

--- build.load(xml) -> { ok, buildId, summary } | CoreError envelope.
--- Boots the core (idempotent) and drives the wired `loadBuildFromXML` global so the
--- XML flows through the real Build:LoadDB -> {Skills,Items,Tree}:Load + calc path.
function M.build.load(xml)
	if type(xml) ~= "string" or xml == "" then
		return err(ERR.BUILD_PARSE_FAILED, "build.load expects a non-empty XML string")
	end

	local okBoot, bootErr = pcall(bootstrap.boot)
	if not okBoot then
		return err(ERR.CORE_INIT_FAILED, bootErr)
	end

	-- The core does NOT raise on malformed XML: Build:LoadDB validates the document
	-- and on failure (XML parse error, or a root element other than PathOfBuilding2)
	-- calls launch:ShowErrMsg, which sets launch.promptMsg — leaving a half-built
	-- (un-saveable) default build behind. promptMsg is the core's own authoritative
	-- "this load failed" signal (Build.lua:2371-2383, Launch.lua ShowErrMsg). It is
	-- also STICKY (ShowErrMsg only sets it `if not self.promptMsg`), so we clear it
	-- before the load to read *this* load's outcome and to keep one bad load from
	-- poisoning the next.
	local launch = rawget(_G, "launch")
	if type(launch) == "table" then
		launch.promptMsg = nil
	end

	local id = nextBuildId()
	local okLoad, loadErr = pcall(function()
		loadBuildFromXML(xml, id)
	end)
	if not okLoad then
		return err(ERR.BUILD_PARSE_FAILED, loadErr)
	end

	-- A set promptMsg means LoadDB rejected the XML (or OnFrame errored on the broken
	-- build it produced) — report a parse failure rather than handing back the phantom
	-- build (NO silent success on malformed input — DESIGN §6.4).
	if type(launch) == "table" and launch.promptMsg then
		return err(ERR.BUILD_PARSE_FAILED, "supplied XML is not a valid PoB2 build: " .. tostring(launch.promptMsg))
	end

	local b = rawget(_G, "build")
	if type(b) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "core did not produce a build from the supplied XML")
	end

	activeBuildId = id
	return { ok = true, buildId = id, summary = summarizeBuild(b) }
end

--- build.save(buildId) -> { ok, xml } | CoreError envelope.
--- Re-exports the live build as PoB XML via the upstream build:SaveDB("xml")
--- (Modules/Build.lua) — the round-trip-compatible save format.
function M.build.save(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	local okSave, xmlOrErr = pcall(function()
		return b:SaveDB("xml")
	end)
	if not okSave then
		return err(ERR.BUILD_PARSE_FAILED, xmlOrErr)
	end
	if type(xmlOrErr) ~= "string" or xmlOrErr == "" then
		return err(ERR.BUILD_PARSE_FAILED, "build:SaveDB('xml') produced empty output")
	end
	return { ok = true, xml = xmlOrErr }
end

--- calc.run(buildId) -> { ok, stats } | CoreError envelope.
--- Returns the curated DESIGN §7.4 mainOutput as a {statId, value, label} list. The
--- calc pipeline already ran on load; this reads the computed build.calcsTab.mainOutput.
function M.calc.run(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	local mainOutput = b.calcsTab and b.calcsTab.mainOutput
	if type(mainOutput) ~= "table" then
		return err(ERR.CALC_FAILED, "build.calcsTab.mainOutput is not available")
	end
	local stats = curateStats(mainOutput)
	if #stats == 0 then
		return err(ERR.CALC_FAILED, "no curated core stats were produced")
	end
	return { ok = true, stats = stats }
end

-- Serialize one recognized mod entry from a parsed modLine.modList into a plain
-- table (DESIGN.md §6.4). Only the stable scalar fields are copied.
local function serializeMod(mod)
	return {
		name = scalar(mod.name),
		type = scalar(mod.type),
		value = scalar(mod.value),
	}
end

--- items.parseClipboard(text) -> { ok, item, mods, unsupported } | CoreError envelope.
--- Drives the upstream new("Item", raw) parser and returns the recognized mods plus
--- an EXPLICIT `unsupported` list of unrecognized lines — preserved, never silently
--- dropped (DESIGN.md §8.6). A line is unsupported exactly when the core marks the
--- modLine with `.extra` (the same signal the upstream UI uses to colour it
--- UNSUPPORTED — ItemsTab.lua:3324).
function M.items.parseClipboard(text)
	if type(text) ~= "string" or text == "" then
		return err(ERR.UNKNOWN_MOD, "items.parseClipboard expects a non-empty clipboard string")
	end

	local okBoot, bootErr = pcall(bootstrap.boot)
	if not okBoot then
		return err(ERR.CORE_INIT_FAILED, bootErr)
	end

	local okParse, itemOrErr = pcall(function()
		return new("Item", text)
	end)
	if not okParse then
		return err(ERR.UNKNOWN_MOD, itemOrErr)
	end
	local item = itemOrErr
	if type(item) ~= "table" then
		return err(ERR.UNKNOWN_MOD, "core did not produce an item from the clipboard text")
	end

	local mods = {}
	local unsupported = {}
	-- The core splits parsed mods across rune/enchant/implicit/explicit/buff line
	-- lists; walk them all so no recognized OR unrecognized line is missed.
	local lineGroups = {
		item.runeModLines,
		item.enchantModLines,
		item.implicitModLines,
		item.explicitModLines,
		item.buffModLines,
	}
	for _, group in ipairs(lineGroups) do
		if type(group) == "table" then
			for _, modLine in ipairs(group) do
				if modLine.extra then
					-- Unrecognized: preserve the original line verbatim (§8.6, NO drop).
					unsupported[#unsupported + 1] = modLine.line
				else
					local entry = { line = scalar(modLine.line), mods = {} }
					if type(modLine.modList) == "table" then
						for _, mod in ipairs(modLine.modList) do
							entry.mods[#entry.mods + 1] = serializeMod(mod)
						end
					end
					mods[#mods + 1] = entry
				end
			end
		end
	end

	return {
		ok = true,
		item = {
			name = scalar(item.name),
			rarity = scalar(item.rarity),
			baseName = scalar(item.baseName),
			itemType = scalar(item.type),
		},
		mods = mods,
		unsupported = unsupported,
	}
end

return M
