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

-- ============================================================================
-- Korean clipboard parsing MVP (DESIGN §8.6 / §8.7)
--
-- The upstream new("Item", raw) parser keys on ENGLISH structural anchors
-- ("Item Class:", "Rarity: <ascii>", "--------", "Requirements:", "Item Level",
-- "Corrupted", "Sockets:" ...) and resolves bases/uniques/mods against the
-- English game data (data.itemBases, data.itemMods, ...). A Korean-client copy
-- uses Korean section markers, Korean rarity words, and Korean base/mod strings,
-- so none of that matches as-is.
--
-- This layer does the §8.6 pipeline:
--   step 1 — estimate the clipboard locale (detectLocale);
--   step 2 — split sections by recognising the Korean section markers, which we
--            do implicitly by translating each Korean line to the English anchor
--            the upstream parser already understands;
--   step 3 — map Korean base/unique/mod strings to the internal (English) id the
--            core resolves (KO_LINE / KO_PREFIX tables);
--   step 4 — any Korean line with NO mapping is left verbatim, so the core marks
--            it `.extra` (UNSUPPORTED) and the original Korean text is preserved
--            in the unsupported list — never dropped.
--
-- Scope is the MVP curated set (the §8.7 "한국어 paste 성공률 70%+" target), NOT a
-- full localization dictionary (that is the Phase 6 PoE2DB importer, DESIGN §8.4).
-- ============================================================================

-- Whole-line Korean -> English translations. A line in the source whose trimmed
-- text matches a key is replaced by its value before being handed to the core.
-- Covers the structural markers, rarity words, requirement labels, base/unique
-- names, and the curated mod set the MVP recognises.
local KO_LINE = {
	-- Section / structural markers
	["타락함"] = "Corrupted",
	["요구사항:"] = "Requirements:",
	-- Rarity words (the core only matches `Rarity: <ascii letters>`)
	["희귀도: 일반"] = "Rarity: Normal",
	["희귀도: 마법"] = "Rarity: Magic",
	["희귀도: 희귀"] = "Rarity: Rare",
	["희귀도: 고유"] = "Rarity: Unique",
	-- Base / unique names (resolved against data.itemBases / unique data)
	["판금 철퇴"] = "Plated Mace",
	["비늘 갑옷"] = "Scale Mail",
	["파멸의 핏줄"] = "Brood Bane",
	["도리아니의 시제품"] = "Doryani's Prototype",
	-- Curated explicit mods (-> the exact English the core's mod parser matches)
	["힘 +15"] = "+15 to Strength",
	["물리 피해 54% 증가"] = "54% increased Physical Damage",
	["최대 생명력 +22"] = "+22 to maximum Life",
	["냉기 저항 +18%"] = "+18% to Cold Resistance",
	["방어도 70% 증가"] = "70% increased Armour",
	["최대 생명력 +72"] = "+72 to maximum Life",
	["방어도의 100%만큼 번개 피해에도 적용"] = "+100% of Armour also applies to Lightning Damage",
	["당신의 존재 범위 내 적의 번개 저항이 당신과 동일해짐"] = "Enemies in your Presence have Lightning Resistance equal to yours",
	["번개 저항은 받는 번개 피해에 영향을 주지 않음"] = "Lightning Resistance does not affect Lightning damage taken",
}

-- Korean line PREFIX -> English prefix translations for `label: value` spec lines
-- whose value (a number/range) carries over unchanged. Ordered, longest-first, so
-- a more specific prefix is tried before a shorter one it contains.
local KO_PREFIX = {
	{ ko = "아이템 종류: ", en = "Item Class: " },
	{ ko = "아이템 레벨: ", en = "Item Level: " },
	{ ko = "물리 피해: ", en = "Physical Damage: " },
	{ ko = "치명타 확률: ", en = "Critical Hit Chance: " },
	{ ko = "초당 공격: ", en = "Attacks per Second: " },
	{ ko = "방어도: ", en = "Armour: " },
	{ ko = "소켓: ", en = "Sockets: " },
	{ ko = "퀄리티: ", en = "Quality: " },
	{ ko = "레벨: ", en = "Level: " },
	{ ko = "힘: ", en = "Str: " },
	{ ko = "민첩: ", en = "Dex: " },
	{ ko = "지능: ", en = "Int: " },
}

-- §8.6 step 1: estimate the clipboard source locale. A Korean-client copy is
-- recognised by its Korean section markers ("희귀도:" rarity / "아이템 종류:" item
-- class) — the reliable structural signal, not just the presence of any Hangul
-- (which a fan-translated English item could also carry). Defaults to en-US.
local function detectLocale(text)
	if text:find("희귀도:", 1, true) or text:find("아이템 종류:", 1, true) then
		return "ko-KR"
	end
	return "en-US"
end

-- §8.6 steps 2-4: rewrite a Korean clipboard into the English form the upstream
-- parser understands. Each non-blank line is trimmed, then translated via the
-- whole-line table, else the prefix table; an untranslated line is emitted
-- VERBATIM so the core preserves it as unsupported (step 4, NO drop). Blank lines
-- and the "--------" separator pass through untouched.
--
-- Returns the translated text AND a `restore` map. The upstream parser runs every
-- line through sanitiseText (Common.lua:251), which replaces each non-ASCII byte
-- with "?" — so an untranslated Korean line survives parsing as an unsupported
-- line but with its Hangul mangled to "?"-runs. To honour §8.6 step 4 (preserve
-- the ORIGINAL unknown line, not a corrupted echo), `restore` maps each
-- untranslated line's sanitised form back to its original text, keyed by the
-- core's OWN sanitiseText so the key matches the value the core will report.
local function translateKoreanClipboard(text)
	local out = {}
	local restore = {}
	local sanitise = rawget(_G, "sanitiseText")
	for rawLine in text:gmatch("([^\n]*)\n?") do
		local line = rawLine:gsub("^%s+", ""):gsub("%s+$", "")
		if line == "" or line == "--------" then
			out[#out + 1] = rawLine
		else
			local translated = KO_LINE[line]
			if not translated then
				for _, entry in ipairs(KO_PREFIX) do
					if line:sub(1, #entry.ko) == entry.ko then
						translated = entry.en .. line:sub(#entry.ko + 1)
						break
					end
				end
			end
			if translated then
				out[#out + 1] = translated
			else
				-- Untranslated: pass verbatim, and remember how the core will mangle
				-- it so the original can be restored in the unsupported list.
				out[#out + 1] = rawLine
				if type(sanitise) == "function" then
					local key = sanitise(line)
					if type(key) == "string" then
						restore[key] = line
					end
				end
			end
		end
	end
	return table.concat(out, "\n"), restore
end

--- items.parseClipboard(text) -> { ok, locale, item, mods, unsupported } | CoreError.
--- Estimates the clipboard locale (§8.6 step 1) and, for a Korean-client copy,
--- rewrites it into the English form the upstream parser understands (§8.6 steps
--- 2-3) before driving new("Item", raw); an untranslated Korean line is left
--- verbatim so it is preserved as unsupported (§8.6 step 4). Returns the recognized
--- mods plus an EXPLICIT `unsupported` list of unrecognized lines — never silently
--- dropped. A line is unsupported exactly when the core marks the modLine with
--- `.extra` (the same signal the upstream UI uses to colour it UNSUPPORTED —
--- ItemsTab.lua:3324). The detected `locale` is returned so the client can fill the
--- §8.6 step-1 result without re-detecting.
function M.items.parseClipboard(text)
	if type(text) ~= "string" or text == "" then
		return err(ERR.UNKNOWN_MOD, "items.parseClipboard expects a non-empty clipboard string")
	end

	local okBoot, bootErr = pcall(bootstrap.boot)
	if not okBoot then
		return err(ERR.CORE_INIT_FAILED, bootErr)
	end

	-- §8.6 step 1: estimate locale from the ORIGINAL text, then (step 2-3) translate
	-- a Korean copy to the English anchors/ids the core parses. English text is
	-- detected as en-US and passed through unchanged (NO regression on that path).
	-- `restore` maps the core's sanitised echo of an untranslated Korean line back to
	-- its original text so step 4 preserves the ORIGINAL line, not a "?"-mangled one.
	local locale = detectLocale(text)
	local coreText = text
	local restore = nil
	if locale == "ko-KR" then
		coreText, restore = translateKoreanClipboard(text)
	end

	local okParse, itemOrErr = pcall(function()
		return new("Item", coreText)
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
					-- Unrecognized: preserve the original line (§8.6 step 4, NO drop).
					-- For a Korean copy, sanitiseText has replaced the line's Hangul
					-- with "?"; restore the original via the sanitised->original map so
					-- the unsupported list carries the real Korean, not a "?" echo.
					local line = modLine.line
					if restore and restore[line] then
						line = restore[line]
					end
					unsupported[#unsupported + 1] = line
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
		locale = locale,
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

-- Copy an item's requirements sub-table into a plain table of explicit scalars
-- (DESIGN.md §6.4). The live `item.requirements` is a core-populated table; only
-- the canonical attribute requirements the UI item card shows are copied out
-- (Item.lua:383-387, 602/819 — level/str/dex/int). Absent values default to 0 so
-- the card always has a complete, numeric requirement block.
local function copyRequirements(requirements)
	requirements = requirements or {}
	return {
		level = scalar(requirements.level) or 0,
		str = scalar(requirements.str) or 0,
		dex = scalar(requirements.dex) or 0,
		int = scalar(requirements.int) or 0,
	}
end

-- Split a live item's mod lines into recognized (summary) and unrecognized
-- (unsupported) human-readable line strings. Walks the same rune/enchant/implicit/
-- explicit/buff line lists the clipboard parser does; a line is unsupported exactly
-- when the core marked it `.extra` (the UNSUPPORTED signal — ItemsTab.lua:3324).
-- Recognized lines are NOT dropped or merged into unsupported (DESIGN.md §8.6).
local function splitItemModLines(item)
	local summaryMods = {}
	local unsupportedMods = {}
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
				local line = scalar(modLine.line)
				if line then
					if modLine.extra then
						unsupportedMods[#unsupportedMods + 1] = line
					else
						summaryMods[#summaryMods + 1] = line
					end
				end
			end
		end
	end
	return summaryMods, unsupportedMods
end

-- Build the plain item-card table for one equipped slot (DESIGN.md §6.4). Only the
-- explicit scalar fields + already-flattened sub-tables (requirements, mod-line
-- string lists) are copied — the live `item` (which carries a class metatable) and
-- its nested core tables never leave this module.
local function serializeEquippedItem(slotName, item)
	local summaryMods, unsupportedMods = splitItemModLines(item)
	return {
		slot = scalar(slotName),
		itemId = tostring(item.id),
		name = scalar(item.name),
		rarity = scalar(item.rarity),
		baseName = scalar(item.baseName),
		requirements = copyRequirements(item.requirements),
		summaryMods = summaryMods,
		unsupportedMods = unsupportedMods,
	}
end

--- items.getEquipped(buildId) -> { ok, equipped } | CoreError envelope.
--- Returns one plain item-card table per OCCUPIED equipped slot of the live build,
--- walking the core's `itemsTab.orderedSlots` (Weapon 1/2, Helmet, Body Armour,
--- Gloves, Boots, Amulet, Rings, Belt, Charms/Flasks, jewel sockets, ...). A slot is
--- occupied when its `selItemId` resolves to an entry in `itemsTab.items`
--- (ItemSlotControl.lua:84; ItemsTab.lua self.items). Empty slots are omitted (NO
--- null placeholders). No live core table leaks (DESIGN.md §6.4).
function M.items.getEquipped(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local itemsTab = b.itemsTab
	if type(itemsTab) ~= "table" or type(itemsTab.orderedSlots) ~= "table" or type(itemsTab.items) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "build.itemsTab has no item slots")
	end

	local equipped = {}
	for _, slot in ipairs(itemsTab.orderedSlots) do
		local selItemId = slot.selItemId
		if type(selItemId) == "number" and selItemId ~= 0 then
			local item = itemsTab.items[selItemId]
			if type(item) == "table" then
				equipped[#equipped + 1] = serializeEquippedItem(slot.slotName, item)
			end
		end
	end

	return { ok = true, equipped = equipped }
end

-- Resolve the caller-supplied itemId (a string id from serializeEquippedItem, e.g.
-- "1") back to the numeric key the core's itemsTab.items is indexed by, and return
-- the live item. The runner sends itemId as a string; itemsTab.items is keyed by the
-- numeric item.id (Item.lua self.id; ItemsTab.lua self.items[item.id]).
local function resolveItem(itemsTab, itemId)
	if type(itemId) ~= "string" or itemId == "" then
		return nil
	end
	local numericId = tonumber(itemId)
	if not numericId then
		return nil
	end
	local item = itemsTab.items[numericId]
	if type(item) == "table" then
		return item
	end
	return nil
end

--- items.compare(buildId, itemId, slot) -> { ok, slot, deltas } | CoreError envelope.
--- Computes the per-stat delta of equipping the item identified by `itemId` into
--- `slot`, against the build's CURRENT output (DESIGN.md §6.3 items.compare, §10.4
--- "+DPS / -EHP", §16.3 "item equip delta"). This drives the core's OWN non-mutating
--- comparison machinery — calcsTab:GetMiscCalculator() returns (calcFunc, baseOutput)
--- where calcFunc({ repSlotName, repItem }) recomputes the FULL output as if that item
--- occupied that slot, WITHOUT mutating the live build (Calcs.lua:123 getMiscCalculator,
--- the same path ItemsTab.lua:2148-2150 uses for its tooltip deltas). The delta is the
--- difference of the curated §7.4 stats between the with-item output and the baseline;
--- equipping the item already in that slot therefore yields a real measured 0 across
--- the set, while a different item yields the genuine non-zero change (NO-FALLBACK: the
--- before/after are two real calc passes, never an A-vs-A stub that is always 0).
function M.items.compare(buildId, itemId, slot)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	if type(slot) ~= "string" or slot == "" then
		return err(ERR.BUILD_PARSE_FAILED, "items.compare requires a non-empty slot")
	end

	local itemsTab = b.itemsTab
	if type(itemsTab) ~= "table" or type(itemsTab.items) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "build.itemsTab has no items")
	end

	local item = resolveItem(itemsTab, itemId)
	if not item then
		return err(ERR.BUILD_PARSE_FAILED, "unknown itemId '" .. tostring(itemId) .. "' (no such item in build)")
	end

	if type(b.calcsTab) ~= "table" or type(b.calcsTab.GetMiscCalculator) ~= "function" then
		return err(ERR.CALC_FAILED, "build.calcsTab has no misc calculator")
	end

	-- (calcFunc, baseOutput): calcFunc({override}) recomputes WITHOUT mutating the
	-- build; baseOutput is the current (no-override) output. Diff the with-item pass
	-- against it (DESIGN §6.4: only curated scalar stats leave this module).
	local okCalc, calcFunc, baseOutput = pcall(function()
		return b.calcsTab:GetMiscCalculator()
	end)
	if not okCalc or type(calcFunc) ~= "function" or type(baseOutput) ~= "table" then
		return err(ERR.CALC_FAILED, "could not obtain the misc calculator")
	end

	local okNew, newOutput = pcall(function()
		return calcFunc({ repSlotName = slot, repItem = item })
	end)
	if not okNew or type(newOutput) ~= "table" then
		return err(ERR.CALC_FAILED, "comparison calc pass failed")
	end

	local deltas = {}
	for _, def in ipairs(CORE_STATS) do
		local before = baseOutput[def.id]
		local after = newOutput[def.id]
		-- A stat is reported only when it is a real number in EITHER pass; a missing
		-- side counts as 0 (the stat contributed nothing there), so a stat that only
		-- appears after the swap still reports a genuine delta (NO fabricated null).
		if type(before) == "number" or type(after) == "number" then
			local b0 = type(before) == "number" and before or 0
			local a0 = type(after) == "number" and after or 0
			deltas[#deltas + 1] = { statId = def.id, before = b0, after = a0, delta = a0 - b0 }
		end
	end

	return { ok = true, slot = slot, deltas = deltas }
end

return M
