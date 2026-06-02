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
M.skills = {}
M.config = {}
M.tree = {}

-- CoreError union (DESIGN.md §6.4). Kept as named constants so every error site
-- references the same canonical code string.
local ERR = {
	CORE_INIT_FAILED = "CORE_INIT_FAILED",
	BUILD_PARSE_FAILED = "BUILD_PARSE_FAILED",
	UNKNOWN_MOD = "UNKNOWN_MOD",
	CALC_FAILED = "CALC_FAILED",
	UPSTREAM_INCOMPATIBLE = "UPSTREAM_INCOMPATIBLE",
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

-- ============================================================================
-- calc.explain: formula-trace / breakdown extraction (DESIGN §6.4 sourceTrace,
-- §10.7 Calcs tab breakdown; task p4-explain-lua).
--
-- The core's OWN breakdown machine (`calcs.breakdownModule = "Modules/CalcBreakdown"`)
-- populates `env.player.breakdown[statId]` during the CALCS-mode pass of BuildOutput
-- (CalcsTab:BuildOutput sets `self.calcsEnv = calcs.buildOutput(build, "CALCS")`). Each
-- entry is the §10.7 breakdown for one stat, in one of a few shapes:
--   * its ARRAY part (breakdown[1..#breakdown]) is the formula-trace line list
--     (multiChain / simple / effMult etc. push display strings into it);
--   * `.modList` is a pre-built contribution mod list (each { value, mod } the same
--     shape ModList:Tabulate yields, where mod.source is the source string);
--   * `.slots` is the per-source slot list defence totals use (armour/evasion/ES),
--     each { base, total, source, sourceName, ... }.
-- The breakdown table ALSO carries the breakdown generator FUNCTIONS (multiChain,
-- effMult, slot, ...) under string keys — those are the machine, not data, so the
-- serializers below only read the array part + the known data sub-tables.
--
-- NO-FALLBACK: a stat with no breakdown table is NOT fabricated — it returns a
-- structural CALC_FAILED. A stat whose breakdown exists but holds no contribution
-- mods returns an EXPLICIT empty `sources` list (never an invented source).
-- ============================================================================

-- Strip the core's color/escape codes (^xRRGGBB, ^8, ^N) from a display string
-- (DESIGN §6.4 "표시용 localized label"). Uses the core's own StripEscapes when
-- available so the result matches what the upstream Calcs tab renders.
local function stripEscapes(text)
	if type(text) ~= "string" then
		return nil
	end
	local strip = rawget(_G, "StripEscapes")
	if type(strip) == "function" then
		local ok, cleaned = pcall(strip, text)
		if ok and type(cleaned) == "string" then
			return cleaned
		end
	end
	return text
end

-- Source-string PREFIX (the part before the first ":") -> contribution `kind` bucket.
-- The core stamps every mod's `source` with one of these prefixes (Item.lua modSource
-- "Item:<id>:<name>", CalcSetup "Tree:<nodeId>", granted-effect "Skill:<id>",
-- ConfigOptions "Config"). Anything else (Base, Quest:, Strength/Dexterity/Intelligence,
-- Pantheon:, Spectre:, Many Sources:, slot "Global", ...) is NOT one of the discrete
-- item/passive/skill/config sources, so it falls into the catch-all buff/other bucket —
-- we never invent a finer classification the core does not provide.
local SOURCE_KIND = {
	Item = "item",
	Tree = "passive",
	Skill = "skillGem",
	Config = "config",
}

--- calc.classifySource(source) -> kind string.
--- Classify a core source string into the DESIGN §10.7 contribution bucket
--- (item / passive / skillGem / config / buff). The prefix before the first ":" is
--- the discriminator the core itself uses (CalcBreakdownControl:AddModSection); an
--- unprefixed or unrecognised source is the catch-all "buff" bucket (NO-FALLBACK:
--- never invent supportGem/skillGem from a source the core did not mark as such).
function M.calc.classifySource(source)
	if type(source) ~= "string" then
		return "buff"
	end
	local prefix = source:match("^[^:]+") or source
	return SOURCE_KIND[prefix] or "buff"
end

-- Serialize one breakdown `.modList` contribution row ({ value, mod }) into a plain
-- source entry (DESIGN §6.4). Only stable scalars leave this module; the live mod
-- table never does. `kind` is the §10.7 classification of mod.source.
local function serializeContribMod(row)
	local mod = row.mod or {}
	local source = scalar(mod.source)
	return {
		kind = M.calc.classifySource(source),
		source = source,
		value = scalar(row.value),
		name = scalar(mod.name),
		modType = scalar(mod.type),
	}
end

-- Serialize one breakdown `.slots` contribution row into a plain source entry. A slot
-- carries `source` (the slot/source name) and `base` (its base contribution); `total`
-- is the post-inc/more figure as a formatted string. The classified value is the
-- numeric base contribution (DESIGN §10.7 contribution value).
local function serializeContribSlot(slot)
	local source = scalar(slot.source)
	return {
		kind = M.calc.classifySource(source),
		source = source,
		value = scalar(slot.base),
		total = scalar(slot.total),
		sourceName = scalar(slot.sourceName),
	}
end

-- Build the flat contribution-source list from a breakdown table (DESIGN §10.7 "기여
-- source 목록"). Sources come from the pre-built `.modList` rows and the `.slots` rows;
-- when the breakdown has neither, the list is EXPLICITLY empty (NO fabricated source).
local function collectSources(breakdown)
	local sources = {}
	if type(breakdown.modList) == "table" then
		for _, row in ipairs(breakdown.modList) do
			if type(row) == "table" and type(row.mod) == "table" then
				sources[#sources + 1] = serializeContribMod(row)
			end
		end
	end
	if type(breakdown.slots) == "table" then
		for _, slot in ipairs(breakdown.slots) do
			if type(slot) == "table" then
				sources[#sources + 1] = serializeContribSlot(slot)
			end
		end
	end
	return sources
end

-- Build the formula-trace line list from a breakdown table's ARRAY part (DESIGN §10.7
-- formula trace). Each entry is a display string the breakdown generators pushed; only
-- string lines are kept, with color escapes stripped (the sub-tables under string keys
-- are NOT trace lines and are skipped by reading only the array part).
local function collectTrace(breakdown)
	local trace = {}
	for i = 1, #breakdown do
		local line = breakdown[i]
		if type(line) == "string" then
			trace[#trace + 1] = stripEscapes(line)
		end
	end
	return trace
end

--- calc.explain(buildId, statId, activeSkillId?) -> { ok, statId, upstreamRawStatId,
---     finalValue, label, trace, sources } | CoreError envelope.
--- Drives the core breakdown machine: reads the live CALCS-mode breakdown table
--- `build.calcsTab.calcsEnv.player.breakdown[statId]` and serializes its §10.7 shape
--- flat — the formula trace (the breakdown array part), the contribution source list
--- (the breakdown `.modList` / `.slots`, each classified item/passive/skillGem/config/
--- buff), and finalValue/label/upstreamRawStatId. A stat that has NO breakdown table is
--- NOT fabricated: a structural CALC_FAILED is returned (NO-FALLBACK — DESIGN §6.4).
--- `activeSkillId` is accepted for API parity (DESIGN §6.3) but the breakdown is read
--- against the build's currently-selected main skill, which is what the live CALCS env
--- already computed.
function M.calc.explain(buildId, statId, activeSkillId) -- luacheck: ignore activeSkillId
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	if type(statId) ~= "string" or statId == "" then
		return err(ERR.CALC_FAILED, "calc.explain requires a non-empty statId")
	end

	-- The CALCS-mode env is the one whose breakdown table is populated (the MAIN-mode
	-- pass does not fill breakdowns). CalcsTab:BuildOutput stores it as calcsEnv.
	local calcsEnv = b.calcsTab and b.calcsTab.calcsEnv
	local player = calcsEnv and calcsEnv.player
	if type(player) ~= "table" or type(player.breakdown) ~= "table" then
		return err(ERR.CALC_FAILED, "build.calcsTab.calcsEnv.player.breakdown is not available")
	end

	local breakdown = player.breakdown[statId]
	-- NO-FALLBACK: a stat with no breakdown table is not fabricated. A breakdown stored
	-- as a generator FUNCTION (the breakdown machine's own helpers, e.g. effMult/slot)
	-- is not a stat breakdown either, so it is rejected the same way.
	if type(breakdown) ~= "table" then
		return err(ERR.CALC_FAILED, "no breakdown is available for stat '" .. statId .. "'")
	end

	local output = type(player.output) == "table" and player.output or {}

	return {
		ok = true,
		statId = statId,
		upstreamRawStatId = statId,
		finalValue = scalar(output[statId]),
		label = stripEscapes(scalar(breakdown.label)) or statId,
		trace = collectTrace(breakdown),
		sources = collectSources(breakdown),
	}
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
	-- Item-class line (cosmetic for parsing — the base line drives type resolution —
	-- but kept ASCII so the class anchor is the real English term, not a "?" echo).
	["아이템 종류: 반지"] = "Item Class: Rings",
	-- Base / unique names (resolved against data.itemBases / unique data)
	["판금 철퇴"] = "Plated Mace",
	["비늘 갑옷"] = "Scale Mail",
	["사파이어 반지"] = "Sapphire Ring",
	-- Custom/unique display names (the title line the core keeps verbatim as the
	-- item's name; a rare's name does NOT have to resolve against data, but it must
	-- be ASCII so the core does not sanitise its Hangul to "?").
	["파멸의 핏줄"] = "Brood Bane",
	["도리아니의 시제품"] = "Doryani's Prototype",
	["타오르는 고리"] = "Searing Loop",
	-- Behavioural / multi-clause mods that carry no numeric roll, so they cannot be
	-- expressed as a numeric-roll pattern and stay as whole-line translations.
	["방어도의 100%만큼 번개 피해에도 적용"] = "+100% of Armour also applies to Lightning Damage",
	["당신의 존재 범위 내 적의 번개 저항이 당신과 동일해짐"] = "Enemies in your Presence have Lightning Resistance equal to yours",
	["번개 저항은 받는 번개 피해에 영향을 주지 않음"] = "Lightning Resistance does not affect Lightning damage taken",
}

-- Korean element words shared by the resistance / added-damage affix families, so a
-- single pattern family covers every element instead of one literal per roll value.
local KO_ELEMENT = {
	["화염"] = "Fire",
	["냉기"] = "Cold",
	["번개"] = "Lightning",
	["혼돈"] = "Chaos",
}

-- Korean attribute words (the `+N <attribute>` affix family).
local KO_ATTRIBUTE = {
	["힘"] = "Strength",
	["민첩"] = "Dexterity",
	["지능"] = "Intelligence",
}

-- §8.5 "normalized description pattern" mapping: numeric-roll affix patterns. Each
-- entry is a `match(line) -> englishLine | nil` translator. Unlike the whole-line
-- KO_LINE table (which pins one literal per roll value), these recognise a Korean
-- affix TEMPLATE and carry ITS numeric roll(s) into the English the core's mod
-- parser matches — so any roll value of a covered affix translates, not just the
-- few literals a curated corpus happened to contain. Hangul bytes are all >= 0x80,
-- so they never collide with the ASCII pattern metacharacters in the number/sign
-- captures; the templates byte-match the UTF-8 source directly.
local KO_AFFIX = {
	-- "<element> 저항 +N%"  ->  "+N% to <Element> Resistance"
	function(line)
		local element, sign, num = line:match("^(.+) 저항 ([%+%-]?)(%d+)%%$")
		if element and KO_ELEMENT[element] then
			return ("%s%s%% to %s Resistance"):format(sign, num, KO_ELEMENT[element])
		end
	end,
	-- "<attribute> +N"  ->  "+N to <Attribute>"
	function(line)
		local attr, sign, num = line:match("^(.+) ([%+%-]?)(%d+)$")
		if attr and KO_ATTRIBUTE[attr] then
			return ("%s%s to %s"):format(sign, num, KO_ATTRIBUTE[attr])
		end
	end,
	-- "최대 생명력 +N"  ->  "+N to maximum Life"
	function(line)
		local sign, num = line:match("^최대 생명력 ([%+%-]?)(%d+)$")
		if num then
			return ("%s%s to maximum Life"):format(sign, num)
		end
	end,
	-- "최대 마나 +N"  ->  "+N to maximum Mana"
	function(line)
		local sign, num = line:match("^최대 마나 ([%+%-]?)(%d+)$")
		if num then
			return ("%s%s to maximum Mana"):format(sign, num)
		end
	end,
	-- "물리 피해 N% 증가"  ->  "N% increased Physical Damage"
	function(line)
		local num = line:match("^물리 피해 (%d+)%% 증가$")
		if num then
			return ("%s%% increased Physical Damage"):format(num)
		end
	end,
	-- "방어도 N% 증가"  ->  "N% increased Armour"
	function(line)
		local num = line:match("^방어도 (%d+)%% 증가$")
		if num then
			return ("%s%% increased Armour"):format(num)
		end
	end,
	-- "공격 속도 N% 증가"  ->  "N% increased Attack Speed"
	function(line)
		local num = line:match("^공격 속도 (%d+)%% 증가$")
		if num then
			return ("%s%% increased Attack Speed"):format(num)
		end
	end,
	-- "이동 속도 N% 증가"  ->  "N% increased Movement Speed"
	function(line)
		local num = line:match("^이동 속도 (%d+)%% 증가$")
		if num then
			return ("%s%% increased Movement Speed"):format(num)
		end
	end,
}

-- Translate one trimmed Korean mod line via the numeric-roll affix patterns
-- (§8.5). Returns the English line the core parses, or nil if no pattern matches
-- (so the caller falls back to leaving it verbatim -> unsupported, §8.6 step 4).
-- A trailing Korean implicit marker "(암시적)" is rewritten to the English
-- "(implicit)" the core uses to slot the mod into implicitModLines.
local function translateKoreanAffix(line)
	local implicit = ""
	local body = line:match("^(.-)%s*%(암시적%)$")
	if body then
		line = body
		implicit = " (implicit)"
	end
	for _, match in ipairs(KO_AFFIX) do
		local en = match(line)
		if en then
			return en .. implicit
		end
	end
	return nil
end

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
			-- §8.5 numeric-roll affix patterns: a Korean mod line with no whole-line /
			-- prefix translation may still be a known affix template carrying a roll.
			if not translated then
				translated = translateKoreanAffix(line)
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

-- ============================================================================
-- Skills: socket-group editing (DESIGN §6.3 skills.setGemGroup, §10.5 Skills tab)
--
-- The live build's skill gems live in build.skillsTab.socketGroupList — an ordered
-- array of socketGroups, each carrying a gemList (one gemInstance per slotted gem).
-- The gemInstance is the SAME shape SkillsTab:LoadSkill builds from XML (nameSpec /
-- gemId / level / quality / enabled, plus the resolved gemData ProcessSocketGroup
-- attaches). We address a group by its 1-based position in that array, surfaced as a
-- string `groupId` ("1", "2", ...) so the client has a stable handle to pass back.
-- ============================================================================

-- Resolve a caller-supplied groupId (a string position from serializeGroup, e.g. "1")
-- to the live socketGroup at that index. Returns the group + the live skillsTab, or
-- nil. groupId is the 1-based index of the group in socketGroupList as a string.
local function resolveGroup(skillsTab, groupId)
	if type(groupId) ~= "string" or groupId == "" then
		return nil
	end
	local index = tonumber(groupId)
	if not index or index < 1 then
		return nil
	end
	local group = skillsTab.socketGroupList[index]
	if type(group) == "table" then
		return group
	end
	return nil
end

-- Whether a resolved gemInstance grants a SUPPORT effect (vs an active skill). After
-- ProcessSocketGroup the gem's resolved data hangs off `gemData`; the granted effect's
-- `.support` flag is the core's own active/support discriminator (SkillsTab.lua:1543).
-- An unresolved gem (no gemData) defaults to false — it grants no support.
local function gemIsSupport(gemInstance)
	local gemData = gemInstance.gemData
	local grantedEffect = gemData and gemData.grantedEffect
	return (grantedEffect and grantedEffect.support) and true or false
end

-- Serialize one live gemInstance into a plain table (DESIGN §6.4). Only the stable
-- scalar fields the UI gem chip shows are copied — the live gemInstance (which holds
-- references into the resolved gem data) never leaves this module.
local function serializeGem(gemInstance)
	return {
		gemId = scalar(gemInstance.gemId),
		nameSpec = scalar(gemInstance.nameSpec) or "",
		level = scalar(gemInstance.level) or 0,
		quality = scalar(gemInstance.quality) or 0,
		enabled = gemInstance.enabled and true or false,
		isSupport = gemIsSupport(gemInstance),
	}
end

-- Build the build-wide spirit + reservation summary from the curated mainOutput
-- (DESIGN §10.5 "reservation / spirit cost를 즉시 표시"). These are build-level pool
-- figures (CalcDefence doActorLifeManaSpirit), the same for every group; copied as
-- plain numeric scalars (absent -> 0, NO null placeholders).
local function reservationSummary(mainOutput)
	local function pool(name)
		return {
			reserved = scalar(mainOutput[name .. "Reserved"]) or 0,
			unreserved = scalar(mainOutput[name .. "Unreserved"]) or 0,
		}
	end
	return {
		spirit = {
			total = scalar(mainOutput.Spirit) or 0,
			reserved = scalar(mainOutput.SpiritReserved) or 0,
			unreserved = scalar(mainOutput.SpiritUnreserved) or 0,
		},
		reservation = {
			mana = pool("Mana"),
			life = pool("Life"),
		},
	}
end

-- Serialize one live socketGroup into a flat plain table (DESIGN §6.4). `index` is the
-- group's 1-based position, surfaced as the string `groupId` handle. The shared
-- build-wide spirit/reservation summary is copied into each group entry.
local function serializeGroup(group, index, summary)
	local gems = {}
	if type(group.gemList) == "table" then
		for _, gemInstance in ipairs(group.gemList) do
			gems[#gems + 1] = serializeGem(gemInstance)
		end
	end
	return {
		groupId = tostring(index),
		label = scalar(group.label) or "",
		enabled = group.enabled and true or false,
		mainActiveSkill = scalar(group.mainActiveSkill) or 1,
		gems = gems,
		spirit = summary.spirit,
		reservation = summary.reservation,
	}
end

--- skills.getGroups(buildId) -> { ok, groups } | CoreError envelope.
--- Serializes build.skillsTab.socketGroupList into a flat list of plain group tables
--- (groupId, label, enabled, mainActiveSkill, gems[], spirit/reservation summary). No
--- live core table leaks (DESIGN §6.4): every group, gem, and summary is a fresh plain
--- table of explicitly-copied scalars.
function M.skills.getGroups(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local skillsTab = b.skillsTab
	if type(skillsTab) ~= "table" or type(skillsTab.socketGroupList) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "build.skillsTab has no socket groups")
	end

	local mainOutput = b.calcsTab and b.calcsTab.mainOutput
	if type(mainOutput) ~= "table" then
		return err(ERR.CALC_FAILED, "build.calcsTab.mainOutput is not available")
	end
	local summary = reservationSummary(mainOutput)

	local groups = {}
	for index, group in ipairs(skillsTab.socketGroupList) do
		groups[#groups + 1] = serializeGroup(group, index, summary)
	end

	return { ok = true, groups = groups }
end

-- Convert one caller-supplied gem input into a fresh live gemInstance ProcessSocketGroup
-- can resolve. The input carries the editable fields (gemId / nameSpec / level / quality
-- / enabled); the rest of the gemInstance shape ProcessSocketGroup fills in. `count`
-- defaults to 1 (a single gem) — ProcessSocketGroup / the calc setup expect it present.
local function gemInstanceFromInput(input)
	return {
		gemId = scalar(input.gemId),
		skillId = scalar(input.skillId),
		nameSpec = scalar(input.nameSpec) or "",
		level = scalar(input.level) or 1,
		quality = scalar(input.quality) or 0,
		enabled = input.enabled ~= false, -- default-enabled; only an explicit false disables
		count = 1,
	}
end

--- skills.setGemGroup(buildId, groupId, gems) -> { ok, groupId } | CoreError envelope.
--- REPLACES the target socketGroup's gemList with the supplied gems, re-resolves it via
--- skillsTab:ProcessSocketGroup, then re-drives the core calc (build.buildFlag = true +
--- the wired OnFrame callback) so build.calcsTab.mainOutput is recomputed against the new
--- gem set. Unlike items.compare (which uses GetMiscCalculator for a NON-mutating A-vs-B
--- pass), this ACTUALLY mutates the live build — so a subsequent calc.run observes the
--- genuine change (NO A-vs-A stub — DESIGN §6.3).
function M.skills.setGemGroup(buildId, groupId, gems)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	if type(gems) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "skills.setGemGroup requires a gems list (table)")
	end

	local skillsTab = b.skillsTab
	if type(skillsTab) ~= "table" or type(skillsTab.socketGroupList) ~= "table" then
		return err(ERR.BUILD_PARSE_FAILED, "build.skillsTab has no socket groups")
	end

	local group = resolveGroup(skillsTab, groupId)
	if not group then
		return err(ERR.BUILD_PARSE_FAILED, "unknown groupId '" .. tostring(groupId) .. "' (no such socket group)")
	end

	-- Build the replacement gemList from the inputs, then swap it in and re-resolve.
	local newGemList = {}
	for _, input in ipairs(gems) do
		if type(input) == "table" then
			newGemList[#newGemList + 1] = gemInstanceFromInput(input)
		end
	end
	group.gemList = newGemList

	-- ProcessSocketGroup re-resolves each gemInstance against the game data (gemData /
	-- grantedEffect / level validation). build.buildFlag = true marks the calc dirty;
	-- the wired OnFrame callback (HeadlessWrapper) then runs calcsTab:BuildOutput(),
	-- refreshing mainOutput against the new gem set (Build.lua:1320-1328).
	local okCalc, calcErr = pcall(function()
		skillsTab:ProcessSocketGroup(group)
		b.buildFlag = true
		runCallback("OnFrame")
	end)
	if not okCalc then
		return err(ERR.CALC_FAILED, calcErr)
	end

	return { ok = true, groupId = groupId }
end

-- ============================================================================
-- Config: scenario-preset editing (DESIGN §6.3 config.setOption, §10.8 Config tab)
--
-- The build's config options are DEFINED by the core's ConfigOptions module (a flat
-- `varList` of varData entries: section headers + one entry per option) and their
-- CURRENT values live in build.configTab.input (= the active config set's input map,
-- keyed by each option's `var`). config.getOptions joins the two into a flat list of
-- plain option cards; config.setOption writes one value into that input map and
-- re-drives the core calc so mainOutput reflects the new scenario.
--
-- The ConfigOptions varList is loaded once via the core's own LoadModule global (the
-- same call ConfigTab makes internally) — a pure data list, NO live build reference,
-- so it is safe to read directly. A section header (varData.section, no .var) is NOT
-- an editable option, so it is skipped: getOptions returns only real options.
-- ============================================================================

-- The dependency-hint fields of a varData we surface on each card (DESIGN §10.8 "각
-- config option은 dependent modifier와 연결"). Each is either a single id or a list of
-- ids in the core; we always normalise to a plain string list so the client has one
-- shape. ifSkillData / ifEnemyCond are called out by the task; the sibling ifCond /
-- ifOption gates are the other conditional dependencies the Config tab evaluates.
local CONFIG_DEPENDENCY_FIELDS = { "ifSkillData", "ifEnemyCond", "ifCond", "ifOption" }

-- Load the core's ConfigOptions varList (the option DEFINITIONS). Returns the raw
-- list or nil if the core global is unavailable. This is a pure data table the core
-- itself caches (LoadModule memoises), so reading it does not touch the live build.
local function configVarList()
	local loadModule = rawget(_G, "LoadModule")
	if type(loadModule) ~= "function" then
		return nil
	end
	local ok, varList = pcall(loadModule, "Modules/ConfigOptions")
	if not ok or type(varList) ~= "table" then
		return nil
	end
	return varList
end

-- Clean a core display label for the UI: strip the color/escape codes (^xRRGGBB,
-- ^N) the core embeds (DESIGN §6.4 "표시용 localized label"). Uses the core's own
-- StripEscapes when available so the result matches what the upstream UI renders.
local function cleanLabel(label)
	if type(label) ~= "string" then
		return ""
	end
	local strip = rawget(_G, "StripEscapes")
	if type(strip) == "function" then
		local ok, cleaned = pcall(strip, label)
		if ok and type(cleaned) == "string" then
			return cleaned
		end
	end
	return label
end

-- Normalise a varData dependency field (a single id OR a list of ids) into a plain
-- string list, or nil when absent. Non-string ids are dropped — the hint is advisory.
local function dependencyList(value)
	if type(value) == "string" then
		return { value }
	end
	if type(value) ~= "table" then
		return nil
	end
	local out = {}
	for _, id in ipairs(value) do
		if type(id) == "string" then
			out[#out + 1] = id
		end
	end
	if #out == 0 then
		return nil
	end
	return out
end

-- Copy a list-type option's choice list into a plain { val, label } array (DESIGN
-- §6.4). The live varData.list holds {val,label} entries; only those scalars leave
-- this module, with the label cleaned of escapes.
local function copyChoiceList(list)
	local out = {}
	for _, choice in ipairs(list) do
		if type(choice) == "table" then
			out[#out + 1] = { val = scalar(choice.val), label = cleanLabel(choice.label) }
		end
	end
	return out
end

-- The EFFECTIVE current value of an option: its explicit input value, or — when the
-- option was never set (input is nil) — the core's OWN default-state resolution
-- (configTab:GetDefaultState), the same value BuildModList / Save treat as current for
-- an unset option (ConfigTab:GetDefaultState; a check defaults false, a list its
-- defaultIndex val, a count 0). This is NOT a fabricated fallback — it is the authentic
-- value the calc uses for that option, so the card always carries a real scalar.
local function currentValue(configTab, varData)
	local set = configTab.input[varData.var]
	if set ~= nil then
		return scalar(set)
	end
	local ok, def = pcall(function()
		return configTab:GetDefaultState(varData.var, varData.type == "check" and "boolean" or "string")
	end)
	if ok then
		return scalar(def)
	end
	return nil
end

-- Serialize one varData option DEFINITION + its live current value into a plain card
-- (DESIGN §6.3 ConfigOptionCard). `configTab` is the live tab, read only for the
-- effective current value (never referenced into the result). Returns nil for a
-- section header (no .var), so getOptions emits real options only.
local function serializeOption(configTab, varData)
	if not varData.var then
		return nil
	end
	local card = {
		optionId = varData.var,
		type = scalar(varData.type) or "",
		label = cleanLabel(varData.label),
		value = currentValue(configTab, varData),
	}
	-- list-type options carry their fixed { val, label } choices.
	if varData.type == "list" and type(varData.list) == "table" then
		card.list = copyChoiceList(varData.list)
	end
	-- Dependency hints (DESIGN §10.8): ifSkillData / ifEnemyCond / ifCond / ifOption.
	for _, field in ipairs(CONFIG_DEPENDENCY_FIELDS) do
		local hint = dependencyList(varData[field])
		if hint then
			card[field] = hint
		end
	end
	return card
end

-- Resolve the live configTab + its active input map off a build, or a CoreError. The
-- input map is configSets[activeConfigSetId].input — the same table ConfigTab keeps
-- in sync as `configTab.input` (ConfigTab:SetActiveConfigSet), keyed by option var.
local function resolveConfig(b)
	local configTab = b.configTab
	if type(configTab) ~= "table" or type(configTab.input) ~= "table" then
		return nil, err(ERR.BUILD_PARSE_FAILED, "build.configTab has no input map")
	end
	return configTab, nil
end

--- config.getOptions(buildId) -> { ok, options } | CoreError envelope.
--- Joins the core's ConfigOptions DEFINITIONS with the live configTab.input current
--- values into a flat list of plain option cards (optionId/var, type, label, value,
--- list choices, ifSkillData/ifEnemyCond/ifCond/ifOption dependency hints). Section
--- headers are skipped (only real options are returned). No live core table leaks
--- (DESIGN §6.4): every card and its nested list/hint tables are fresh plain tables.
function M.config.getOptions(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local configTab, cfgErr = resolveConfig(b)
	if not configTab then
		return cfgErr
	end

	local varList = configVarList()
	if not varList then
		return err(ERR.CORE_INIT_FAILED, "core ConfigOptions definitions are not available")
	end

	local options = {}
	for _, varData in ipairs(varList) do
		local card = serializeOption(configTab, varData)
		if card then
			options[#options + 1] = card
		end
	end
	if #options == 0 then
		return err(ERR.BUILD_PARSE_FAILED, "no config options were produced")
	end

	return { ok = true, options = options }
end

--- config.setOption(buildId, optionId, value) -> { ok, optionId } | CoreError envelope.
--- WRITES `value` into the live configTab.input under `optionId`, then re-drives the
--- core calc (configTab:BuildModList rebuilds the config mod lists, build.buildFlag +
--- the wired OnFrame callback recompute mainOutput) so a subsequent calc.run observes
--- the new scenario. This ACTUALLY mutates the live build (unlike items.compare's
--- non-mutating A-vs-B pass), so toggling one option genuinely changes the calc
--- (NO-FALLBACK — DESIGN §6.3, §10.8). optionId must be a real ConfigOptions `var`.
function M.config.setOption(buildId, optionId, value)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end
	if type(optionId) ~= "string" or optionId == "" then
		return err(ERR.BUILD_PARSE_FAILED, "config.setOption requires a non-empty optionId")
	end

	local configTab, cfgErr = resolveConfig(b)
	if not configTab then
		return cfgErr
	end

	-- Reject an optionId the core does not define (NO silent no-op on a typo — the
	-- caller must learn it set nothing). A real option is one with a matching `var` in
	-- the ConfigOptions definitions.
	local varList = configVarList()
	if not varList then
		return err(ERR.CORE_INIT_FAILED, "core ConfigOptions definitions are not available")
	end
	local known = false
	for _, varData in ipairs(varList) do
		if varData.var == optionId then
			known = true
			break
		end
	end
	if not known then
		return err(ERR.BUILD_PARSE_FAILED, "unknown optionId '" .. optionId .. "' (no such config option)")
	end

	-- Write the value, rebuild the config mod lists, mark the calc dirty, and run a
	-- frame so calcsTab:BuildOutput recomputes mainOutput against the new option set.
	local okCalc, calcErr = pcall(function()
		configTab.input[optionId] = value
		configTab:BuildModList()
		b.buildFlag = true
		runCallback("OnFrame")
	end)
	if not okCalc then
		return err(ERR.CALC_FAILED, calcErr)
	end

	return { ok = true, optionId = optionId }
end

-- ============================================================================
-- Passive tree: query + allocation (DESIGN §6.3 tree.previewAllocate /
-- tree.applyAllocate, §10.6 Passive Tree tab; task p5-tree-runner-api).
--
-- The live build's active passive tree is build.spec (= the selected PassiveSpec in
-- build.treeTab.specList). A PassiveSpec carries:
--   * spec.nodes      — the per-spec node table (each a setmetatable'd copy of the
--                       tree node; .id/.dn/.name/.type/.x/.y/.o/.oidx/.g/.group/.alloc),
--   * spec.allocNodes — the currently-allocated node id -> node map,
--   * spec.tree       — the shared PassiveTree (groups + constants),
--   * spec.treeVersion— the tree-data version string ("0_5").
--
-- tree.getData serializes that into PLAIN tables (DESIGN §6.4): no node/group/spec/
-- constants table — all of which carry class metatables or live references — ever
-- leaves this module.
--
-- tree.previewAllocate is the NON-destructive delta path the task mandates. The vendor
-- PassiveSpec/CalcSetup already supports computing the calc "as if" extra nodes were
-- allocated WITHOUT mutating the spec: calcs.getMiscCalculator (wrapped by
-- build.calcsTab:GetMiscCalculator) returns (calcFunc, baseOutput) where
-- calcFunc({ addNodes = <set keyed by node OBJECT> }) re-runs the full calc with those
-- nodes folded into env.allocNodes (CalcSetup.lua:717-768) — env.spec.allocNodes is
-- left untouched. This is the SAME machinery items.compare uses for repItem. We add the
-- requested nodes plus their shortest-path nodes (node.path, the vendor's reachability
-- path) so the previewed allocation is connected, exactly as the live AllocNode would.
--
-- tree.applyAllocate COMMITS the change: PassiveSpec:AllocNode mutates spec.allocNodes
-- and re-runs BuildAllDependsAndPaths, then the wired OnFrame recomputes mainOutput.
--
-- NO-FALLBACK (DESIGN §6.4): if the vendored core does not expose the non-destructive
-- override path (no GetMiscCalculator) or the live spec/tree is missing, the API
-- surfaces a structured UPSTREAM_INCOMPATIBLE CoreError — it never fabricates a delta.
-- ============================================================================

-- Resolve the live PassiveSpec off a build, or a CoreError. spec is the ACTIVE spec
-- (build.spec, kept in sync with treeTab.specList[activeSpec] — TreeTab:SetActiveSpec).
local function resolveSpec(b)
	local spec = b.spec
	if type(spec) ~= "table" or type(spec.nodes) ~= "table" or type(spec.allocNodes) ~= "table" then
		return nil, err(ERR.UPSTREAM_INCOMPATIBLE, "build.spec is not a usable PassiveSpec")
	end
	if type(spec.tree) ~= "table" then
		return nil, err(ERR.UPSTREAM_INCOMPATIBLE, "build.spec.tree is not available")
	end
	return spec, nil
end

-- Copy a node's connectivity (node.linkedId — the ids of every node it connects to)
-- into a plain numeric list (DESIGN §6.4). This is the tree's EDGE graph: the §10.6
-- renderer derives the connecting edges, and the path-preview walks it. Each spec node
-- inherits linkedId from its underlying tree node via the metatable __index
-- (PassiveTree:ProcessNode populates node.linkedId; PassiveSpec setmetatable's each
-- spec node on it). Only numeric ids leave this module — no live node reference.
local function copyConnections(node)
	local out = {}
	local linkedId = node.linkedId
	if type(linkedId) == "table" then
		for _, id in ipairs(linkedId) do
			local n = scalar(id)
			if type(n) == "number" then
				out[#out + 1] = n
			end
		end
	end
	return out
end

-- Serialize one live spec node into a plain card (DESIGN §6.4). Only the stable scalar
-- identity + coordinate fields the UI tree renderer needs are copied; the live node
-- (which carries the tree-node metatable + linked/path references) never leaves here.
-- node.dn is the display name (node.name for class/ascendancy starts); node.x/y are the
-- orbit-derived coordinates (PassiveTree:ProcessNode), node.o/oidx the orbit position,
-- node.g the owning group id; node.connections is the plain id list of its tree edges.
local function serializeNode(node)
	return {
		nodeId = scalar(node.id),
		name = scalar(node.dn) or scalar(node.name),
		type = scalar(node.type),
		x = scalar(node.x),
		y = scalar(node.y),
		orbit = scalar(node.o),
		orbitIndex = scalar(node.oidx),
		group = scalar(node.g),
		isAscendancy = node.ascendancyName ~= nil,
		connections = copyConnections(node),
	}
end

-- Serialize one live tree group into a plain {groupId, x, y} card (DESIGN §6.4). The
-- group id is the key in spec.tree.groups; only its layout coordinates are copied.
local function serializeTreeGroup(groupId, group)
	return {
		groupId = scalar(groupId),
		x = scalar(group.x),
		y = scalar(group.y),
	}
end

-- Deep-copy a plain data table (the tree constants: classes map, orbitAnglesByOrbit,
-- orbitRadii, skillsPerOrbit) into a fresh metatable-free table (DESIGN §6.4 — no live
-- core table leaks). The constants are pure data (loaded from the tree-data file), but
-- the live table is shared with the core, so a defensive deep copy is returned. Only
-- scalar leaves are kept; any function value (none expected here) is dropped.
local function plainCopy(value)
	if type(value) ~= "table" then
		return scalar(value)
	end
	local out = {}
	for k, v in pairs(value) do
		if type(k) == "string" or type(k) == "number" then
			local cv = plainCopy(v)
			if cv ~= nil then
				out[k] = cv
			end
		end
	end
	return out
end

-- Build the plain constants block from the tree's constants (DESIGN §6.4 — the §6.4
-- "constants(orbitAnglesByOrbit, classes 등)"). Each sub-table is deep-copied so no live
-- tree table leaks.
local function serializeConstants(constants)
	return {
		classes = plainCopy(constants.classes) or {},
		orbitAnglesByOrbit = plainCopy(constants.orbitAnglesByOrbit) or {},
		orbitRadii = plainCopy(constants.orbitRadii) or {},
		skillsPerOrbit = plainCopy(constants.skillsPerOrbit) or {},
	}
end

--- tree.getData(buildId) -> { ok, treeVersion, nodes, groups, constants, allocatedNodeIds }
---     | CoreError envelope.
--- Serializes the ACTIVE build.spec (its current tree version) into plain tables: the
--- node list (nodeId/name/type/x/y/orbit/orbitIndex/group/isAscendancy), the group list
--- ({groupId,x,y}), the tree constants (classes / orbitAnglesByOrbit / orbitRadii /
--- skillsPerOrbit), and the currently-allocated node id list. No live core table leaks
--- (DESIGN §6.4): every entry is a fresh plain table of explicitly-copied scalars.
function M.tree.getData(buildId)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local spec, specErr = resolveSpec(b)
	if not spec then
		return specErr
	end

	local nodes = {}
	for _, node in pairs(spec.nodes) do
		if type(node) == "table" and node.id ~= nil then
			nodes[#nodes + 1] = serializeNode(node)
		end
	end

	local groups = {}
	if type(spec.tree.groups) == "table" then
		for groupId, group in pairs(spec.tree.groups) do
			if type(group) == "table" then
				groups[#groups + 1] = serializeTreeGroup(groupId, group)
			end
		end
	end

	if type(spec.tree.constants) ~= "table" then
		return err(ERR.UPSTREAM_INCOMPATIBLE, "build.spec.tree.constants is not available")
	end

	local allocatedNodeIds = {}
	for id in pairs(spec.allocNodes) do
		allocatedNodeIds[#allocatedNodeIds + 1] = scalar(id)
	end

	return {
		ok = true,
		treeVersion = scalar(spec.treeVersion),
		nodes = nodes,
		groups = groups,
		constants = serializeConstants(spec.tree.constants),
		allocatedNodeIds = allocatedNodeIds,
	}
end

-- Resolve a caller-supplied nodeIds list into the live spec node objects, or an error
-- string. Each id must be a real node in spec.nodes (NO silent skip of a typo'd id —
-- the caller must learn the set was invalid). A node already allocated is allowed (it
-- simply contributes nothing new to the preview/apply). Returns the node-object list.
local function resolveNodeList(spec, nodeIds)
	if type(nodeIds) ~= "table" then
		return nil, "nodeIds must be a list (table) of node ids"
	end
	local nodes = {}
	for _, id in ipairs(nodeIds) do
		local node = spec.nodes[id] or (type(id) == "string" and spec.nodes[tonumber(id)])
		if type(node) ~= "table" then
			return nil, "unknown nodeId '" .. tostring(id) .. "' (no such node in the active tree)"
		end
		nodes[#nodes + 1] = node
	end
	return nodes, nil
end

--- tree.previewAllocate(buildId, nodeIds) -> { ok, deltas } | CoreError envelope.
--- Computes the per-stat calc delta of allocating the given node set WITHOUT mutating
--- the build (DESIGN §6.3 tree.previewAllocate, §10.6 "allocation delta preview"). Drives
--- the vendor non-destructive override path: build.calcsTab:GetMiscCalculator() yields
--- (calcFunc, baseOutput) where calcFunc({ addNodes = <set keyed by node object> })
--- re-runs the full calc with those nodes (plus their shortest-path nodes, so the
--- allocation is connected) folded into env.allocNodes — env.spec.allocNodes is left
--- untouched (CalcSetup.lua:717-768; the same machinery items.compare uses). The delta is
--- the difference of the curated §7.4 stats between the with-nodes output and the
--- baseline. A missing GetMiscCalculator surfaces UPSTREAM_INCOMPATIBLE (NO fabricated
--- delta — DESIGN §6.4).
function M.tree.previewAllocate(buildId, nodeIds)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local spec, specErr = resolveSpec(b)
	if not spec then
		return specErr
	end

	local nodes, listErr = resolveNodeList(spec, nodeIds)
	if not nodes then
		return err(ERR.BUILD_PARSE_FAILED, listErr)
	end

	if type(b.calcsTab) ~= "table" or type(b.calcsTab.GetMiscCalculator) ~= "function" then
		return err(ERR.UPSTREAM_INCOMPATIBLE, "build.calcsTab has no non-destructive misc calculator")
	end

	-- (calcFunc, baseOutput): calcFunc({addNodes}) recomputes WITHOUT mutating the spec;
	-- baseOutput is the current (no-override) output.
	local okCalc, calcFunc, baseOutput = pcall(function()
		return b.calcsTab:GetMiscCalculator()
	end)
	if not okCalc or type(calcFunc) ~= "function" or type(baseOutput) ~= "table" then
		return err(ERR.UPSTREAM_INCOMPATIBLE, "could not obtain the non-destructive misc calculator")
	end

	-- The addNodes override is a set keyed by the node OBJECT (CalcSetup walks
	-- `for node in pairs(override.addNodes)`). Include each requested node AND its
	-- shortest-path nodes (node.path, the vendor's reachability path) so the previewed
	-- allocation is connected to the tree — matching what AllocNode would commit.
	local addNodes = {}
	for _, node in ipairs(nodes) do
		addNodes[node] = true
		if type(node.path) == "table" then
			for _, pathNode in ipairs(node.path) do
				addNodes[pathNode] = true
			end
		end
	end

	local okNew, newOutput = pcall(function()
		return calcFunc({ addNodes = addNodes })
	end)
	if not okNew or type(newOutput) ~= "table" then
		return err(ERR.CALC_FAILED, "preview allocation calc pass failed")
	end

	local deltas = {}
	for _, def in ipairs(CORE_STATS) do
		local before = baseOutput[def.id]
		local after = newOutput[def.id]
		-- A stat is reported only when it is a real number in EITHER pass; a missing side
		-- counts as 0 (the stat contributed nothing there), so a stat that only appears
		-- after allocation still reports a genuine delta (NO fabricated null).
		if type(before) == "number" or type(after) == "number" then
			local b0 = type(before) == "number" and before or 0
			local a0 = type(after) == "number" and after or 0
			deltas[#deltas + 1] = { statId = def.id, before = b0, after = a0, delta = a0 - b0 }
		end
	end

	return { ok = true, deltas = deltas }
end

--- tree.applyAllocate(buildId, nodeIds) -> { ok, allocatedNodeIds } | CoreError envelope.
--- COMMITS the allocation of the given node set: drives PassiveSpec:AllocNode for each
--- requested node (which allocates the node plus its connecting path and re-runs
--- BuildAllDependsAndPaths), then re-drives the core calc (build.buildFlag + the wired
--- OnFrame) so build.calcsTab.mainOutput reflects the new tree. Unlike previewAllocate
--- (a non-mutating A-vs-B pass), this ACTUALLY mutates the live spec — so a subsequent
--- getData reports the new node in allocatedNodeIds and calc.run observes the genuine
--- change (NO-FALLBACK — DESIGN §6.3).
function M.tree.applyAllocate(buildId, nodeIds)
	local b, ok = resolveBuild(buildId)
	if not ok then
		return b -- already a CoreError envelope
	end

	local spec, specErr = resolveSpec(b)
	if not spec then
		return specErr
	end

	local nodes, listErr = resolveNodeList(spec, nodeIds)
	if not nodes then
		return err(ERR.BUILD_PARSE_FAILED, listErr)
	end

	if type(spec.AllocNode) ~= "function" then
		return err(ERR.UPSTREAM_INCOMPATIBLE, "build.spec has no AllocNode method")
	end

	-- AllocNode allocates the node plus its connecting path and rebuilds depends/paths.
	-- build.buildFlag = true marks the calc dirty; the wired OnFrame callback then runs
	-- calcsTab:BuildOutput(), refreshing mainOutput against the new tree (Build.lua).
	local okCalc, calcErr = pcall(function()
		for _, node in ipairs(nodes) do
			spec:AllocNode(node, nil)
		end
		b.buildFlag = true
		runCallback("OnFrame")
	end)
	if not okCalc then
		return err(ERR.CALC_FAILED, calcErr)
	end

	local allocatedNodeIds = {}
	for id in pairs(spec.allocNodes) do
		allocatedNodeIds[#allocatedNodeIds + 1] = scalar(id)
	end

	return { ok = true, allocatedNodeIds = allocatedNodeIds }
end

return M
