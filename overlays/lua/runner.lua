--- runner.lua
---
--- Out-of-process JSON-RPC core runner (task runner-protocol; DESIGN §5.1 "Lua
--- core runner", §6.2 "out-of-process Lua runner", §14.2 crash isolation).
---
--- A long-lived process that speaks newline-delimited JSON-RPC 2.0 over
--- stdin/stdout: it reads ONE request per line, dispatches by `method` to the
--- stable `modern_api` surface (build.load / build.save / calc.run /
--- items.parseClipboard), encodes the response with dkjson, and writes EXACTLY
--- one JSON line back per request. Unknown methods -> JSON-RPC error -32601
--- (Method not found). This is the foundation the Rust host's crash isolation
--- builds on: one malformed request can poison the in-process core singleton, so
--- the host runs each build in its own runner and restarts it on a crash — the
--- runner itself just has to keep the protocol stream well-formed.
---
--- STDOUT IS PROTOCOL-ONLY. The vendored core narrates its boot/calc over
--- ConPrintf -> print and a few raw io.write calls (the "Processing tree... /
--- Uniques loaded" chatter). That MUST NOT corrupt the JSON-RPC stream, so every
--- dispatch runs inside the runQuietly pattern (reused from headless_bootstrap):
--- print/io.write are redirected into a buffer that is flushed to STDERR, leaving
--- stdout carrying only response frames.
---
--- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
--- PUC Lua 5.1 cannot even parse, so modern_api/boot must run under LuaJIT. When
--- invoked under PUC 5.1 the CLI entry point below re-execs the whole process
--- under `luajit` (same pattern as headless_bootstrap).

local SEP = package.config:sub(1, 1) -- "/" on POSIX, "\" on Windows

local function dirname(path)
	local dir = path:match("^(.*)[/\\][^/\\]*$")
	return dir or "."
end

-- Absolute path to THIS file, resolved whether we were `require`d (busted) or run
-- directly (`luajit runner.lua`). Mirrors headless_bootstrap.thisFilePath().
local function thisFilePath()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		path = (os.getenv("PWD") or ".") .. SEP .. path
	end
	return path
end

-- Make the dotted overlay modules (overlays.lua.modern_api, ...) resolvable from
-- the repo root regardless of the caller's cwd, so `require` below works both
-- under busted and as a standalone script. modern_api itself pulls in the
-- bootstrap, which sets the vendor src / runtime package paths.
local overlayDir = dirname(thisFilePath()) -- .../overlays/lua
local repoRoot = dirname(dirname(overlayDir)) -- .../<repo>
package.path = table.concat({
	repoRoot .. SEP .. "?.lua",
	repoRoot .. SEP .. "?" .. SEP .. "init.lua",
	package.path,
}, ";")

local json = require("dkjson")

local M = {}

-- JSON-RPC 2.0 standard error codes (subset the runner emits).
local RPC = {
	PARSE_ERROR = -32700, -- malformed JSON on a request line
	INVALID_REQUEST = -32600, -- not a valid JSON-RPC request object
	METHOD_NOT_FOUND = -32601, -- unknown method
	SERVER_ERROR = -32000, -- application/core error (modern_api CoreError)
}

-- Max byte length of a single request line (DESIGN §14.2 input size limit, crash
-- isolation). A line past this is a protocol fault by definition — no real build
-- XML / share-code frame is this large — so it is refused as a parse error rather
-- than handed to the JSON decoder. This is the runner-side half of the limit the
-- client also enforces before writing (RAW_REQUEST_MAX_BYTES); kept identical so a
-- frame either side rejects is rejected consistently (defence in depth).
local MAX_LINE_BYTES = 1024 * 1024

-- The upstream core narrates its boot/calc via ConPrintf -> print plus raw
-- io.write on stdout. Capture both for the duration of `fn` and flush them to
-- STDERR so stdout carries only JSON-RPC frames. Reused verbatim in spirit from
-- headless_bootstrap.runQuietly (same crash-isolation discipline).
local function runQuietly(fn)
	local realPrint = print
	local realWrite = io.write
	local captured = {}
	print = function(...) -- luacheck: ignore
		local parts = {}
		for i = 1, select("#", ...) do
			parts[i] = tostring((select(i, ...)))
		end
		captured[#captured + 1] = table.concat(parts, "\t") .. "\n"
	end
	io.write = function(...) -- luacheck: ignore
		for i = 1, select("#", ...) do
			captured[#captured + 1] = tostring((select(i, ...)))
		end
		return io.stdout
	end
	local ok, result = pcall(fn)
	print = realPrint -- luacheck: ignore
	io.write = realWrite -- luacheck: ignore
	if #captured > 0 then
		io.stderr:write(table.concat(captured))
	end
	if not ok then
		error(result, 0)
	end
	return result
end

-- Lazily load modern_api the first time a build/calc/items method is dispatched.
-- Deferring it keeps protocol-only errors (bad JSON, unknown method) free of the
-- core's boot cost, and means a boot failure surfaces as a per-request error
-- rather than a process that never starts.
local modern_api
local function getApi()
	if not modern_api then
		modern_api = require("overlays.lua.modern_api")
	end
	return modern_api
end

-- Protocol version of the runner's JSON-RPC surface. Bumped when the wire shape
-- of a method's params/result changes. core.version is the host's ready handshake
-- (the client blocks on it after spawn), so it must answer WITHOUT booting the
-- heavy vendored core — it only proves the process is up and speaking protocol.
local PROTOCOL_VERSION = "1.0.0"

-- Method -> adapter that pulls the positional args modern_api expects out of the
-- JSON-RPC `params` object and invokes the matching modern_api function. Each
-- returns modern_api's own {ok=...} envelope (translated to JSON-RPC below).
local METHODS = {
	-- Ready handshake (DESIGN §6.3 "core.version"). Returns the runner protocol
	-- version as a plain envelope; deliberately does NOT touch modern_api/getApi so
	-- the handshake stays cheap and a boot failure surfaces later, per-build.
	["core.version"] = function()
		return { ok = true, version = PROTOCOL_VERSION }
	end,
	["build.load"] = function(params)
		return getApi().build.load(params and params.xml)
	end,
	["build.save"] = function(params)
		return getApi().build.save(params and params.buildId)
	end,
	["calc.run"] = function(params)
		return getApi().calc.run(params and params.buildId)
	end,
	["calc.explain"] = function(params)
		return getApi().calc.explain(params and params.buildId, params and params.statId, params and params.activeSkillId)
	end,
	["items.parseClipboard"] = function(params)
		return getApi().items.parseClipboard(params and params.text)
	end,
	["items.getEquipped"] = function(params)
		return getApi().items.getEquipped(params and params.buildId)
	end,
	["items.compare"] = function(params)
		return getApi().items.compare(params and params.buildId, params and params.itemId, params and params.slot)
	end,
	["skills.getGroups"] = function(params)
		return getApi().skills.getGroups(params and params.buildId)
	end,
	["skills.setGemGroup"] = function(params)
		return getApi().skills.setGemGroup(params and params.buildId, params and params.groupId, params and params.gems)
	end,
	["config.getOptions"] = function(params)
		return getApi().config.getOptions(params and params.buildId)
	end,
	["config.setOption"] = function(params)
		return getApi().config.setOption(params and params.buildId, params and params.optionId, params and params.value)
	end,
	["tree.getData"] = function(params)
		return getApi().tree.getData(params and params.buildId)
	end,
	["tree.previewAllocate"] = function(params)
		return getApi().tree.previewAllocate(params and params.buildId, params and params.nodeIds)
	end,
	["tree.applyAllocate"] = function(params)
		return getApi().tree.applyAllocate(params and params.buildId, params and params.nodeIds)
	end,
}

local function ok(id, result)
	return { jsonrpc = "2.0", id = id, result = result }
end

local function rpcError(id, code, message, data)
	return { jsonrpc = "2.0", id = id, error = { code = code, message = message, data = data } }
end

-- Translate a modern_api result envelope ({ok=true, <fields>} | {ok=false,
-- error={code,message}}) into a JSON-RPC response. On success the `ok` flag is
-- dropped and the remaining fields become the JSON-RPC `result`. A core failure
-- becomes a JSON-RPC application error (-32000) carrying the CoreError code in
-- `error.data` so the typed CoreError union (DESIGN §6.4) survives the hop.
local function fromEnvelope(id, envelope)
	if type(envelope) ~= "table" then
		return rpcError(id, RPC.SERVER_ERROR, "core returned a non-table result")
	end
	if envelope.ok then
		local result = {}
		for k, v in pairs(envelope) do
			if k ~= "ok" then
				result[k] = v
			end
		end
		return ok(id, result)
	end
	local coreErr = envelope.error or {}
	return rpcError(id, RPC.SERVER_ERROR, tostring(coreErr.message or "core error"), { code = coreErr.code })
end

--- dispatch(request) -> JSON-RPC response table.
--- Routes a decoded request object by `method` to modern_api and returns the
--- JSON-RPC response table (never raises — a core crash is caught and reported as
--- a JSON-RPC error so the protocol stream stays well-formed). Unknown method ->
--- -32601 (Method not found).
function M.dispatch(request)
	if type(request) ~= "table" or type(request.method) ~= "string" then
		return rpcError(request and request.id, RPC.INVALID_REQUEST, "request must have a string `method`")
	end

	local handler = METHODS[request.method]
	if not handler then
		return rpcError(request.id, RPC.METHOD_NOT_FOUND, "Method not found: " .. request.method)
	end

	-- The core call runs inside runQuietly so its stdout chatter goes to stderr,
	-- and inside pcall so a Lua-level crash in the core becomes a JSON-RPC error
	-- rather than tearing down the protocol loop (DESIGN §14.2 crash isolation).
	local pcOk, envelope = pcall(function()
		return runQuietly(function()
			return handler(request.params)
		end)
	end)
	if not pcOk then
		return rpcError(request.id, RPC.SERVER_ERROR, tostring(envelope))
	end
	return fromEnvelope(request.id, envelope)
end

--- handleLine(line) -> single-line JSON response string.
--- Decodes one request line, dispatches it, and encodes exactly one JSON line
--- back. A line that is not valid JSON, or one beyond MAX_LINE_BYTES, yields a
--- JSON-RPC parse error (-32700) frame rather than a dropped/garbled response.
function M.handleLine(line)
	-- Size limit BEFORE decode (DESIGN §14.2 crash isolation): an oversized line is
	-- never fed to the JSON decoder — it cannot be a valid request, so reject it as
	-- a parse error and keep the dispatch loop running.
	if #line > MAX_LINE_BYTES then
		return json.encode(
			rpcError(nil, RPC.PARSE_ERROR, "Parse error: request line exceeds " .. MAX_LINE_BYTES .. " bytes"),
			{ indent = false }
		)
	end
	local request, _, decodeErr = json.decode(line)
	if decodeErr then
		return json.encode(rpcError(nil, RPC.PARSE_ERROR, "Parse error: " .. tostring(decodeErr)), { indent = false })
	end
	local response = M.dispatch(request)
	return json.encode(response, { indent = false })
end

--- run(inFile, outFile) -> the stdio dispatch loop.
--- Reads one request per line from `inFile` until EOF, writes exactly one JSON
--- response line per request to `outFile`, flushing each so a host reading the
--- pipe sees frames as soon as they are produced. Blank lines are skipped (a
--- stray newline is not a request).
function M.run(inFile, outFile)
	inFile = inFile or io.stdin
	outFile = outFile or io.stdout
	for line in inFile:lines() do
		if line:match("%S") then
			outFile:write(M.handleLine(line), "\n")
			outFile:flush()
		end
	end
end

-- CLI entry point -------------------------------------------------------------

local function isMainScript()
	local invoked = arg and arg[0]
	if not invoked then
		return false
	end
	return invoked:match("runner%.lua$") ~= nil
end

-- Re-exec the whole process under LuaJIT when on PUC Lua 5.1 (which cannot parse
-- the vendored core's `goto`). Mirrors headless_bootstrap.reexecUnderLuaJITIfNeeded.
local function reexecUnderLuaJITIfNeeded()
	if rawget(_G, "jit") then
		return false -- already on LuaJIT
	end
	local self = thisFilePath()
	local parts = { "luajit", "'" .. self .. "'" }
	for i = 1, #arg do
		parts[#parts + 1] = "'" .. tostring(arg[i]):gsub("'", "'\\''") .. "'"
	end
	local cmd = table.concat(parts, " ")
	local execOk, _, code = os.execute(cmd)
	local exitCode
	if type(execOk) == "number" then
		exitCode = execOk
	else
		exitCode = code or (execOk and 0 or 1)
	end
	os.exit(exitCode)
end

if isMainScript() then
	-- PUC Lua 5.1 can't parse the core; hop to LuaJIT and re-run there.
	reexecUnderLuaJITIfNeeded()
	M.run(io.stdin, io.stdout)
end

return M
