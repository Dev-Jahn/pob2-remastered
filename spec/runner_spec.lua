-- spec/runner_spec.lua
--
-- Tests for overlays/lua/runner.lua: the out-of-process JSON-RPC runner
-- (task runner-protocol). The runner is a long-lived process that speaks
-- newline-delimited JSON-RPC 2.0 over stdin/stdout: one request per line in,
-- exactly one JSON response line out, dispatched by method to modern_api
-- (build.load / build.save / calc.run / items.parseClipboard).
--
-- The defining property of this layer is the STDOUT/STDERR split: the upstream
-- core narrates its boot/calc over print + raw io.write on stdout (see the
-- "Processing tree... / Uniques loaded" chatter), so the runner must capture
-- that to stderr (the runQuietly pattern) and let stdout carry ONLY protocol
-- frames. The headline test therefore drives the REAL process end to end: it
-- spawns the runner, pipes a build.load+calc.run request pair on stdin, and
-- asserts stdout is exactly two well-formed single-line JSON-RPC responses with
-- no core chatter mixed in.
--
-- Unknown method -> JSON-RPC error -32601 (Method not found); this crash
-- isolation boundary is the foundation later phases build on (DESIGN §14.2).
--
-- INTERPRETER: like the bootstrap, the vendored core uses Lua 5.2+ `goto`, which
-- PUC Lua 5.1 cannot even parse. So this spec must run under LuaJIT:
--
--     busted --lua=luajit spec/runner_spec.lua

local MODULE = "overlays.lua.runner"

-- Absolute repo root, resolved from this spec file's location so the test is
-- independent of busted's working directory.
local function repoRoot()
	local source = debug.getinfo(1, "S").source
	local path = source:sub(1, 1) == "@" and source:sub(2) or source
	if path:sub(1, 1) ~= "/" and not path:match("^%a:[/\\]") then
		path = (os.getenv("PWD") or ".") .. "/" .. path
	end
	local specDir = path:match("^(.*)[/\\][^/\\]*$")
	return specDir:match("^(.*)[/\\][^/\\]*$")
end

local ROOT = repoRoot()
local RUNNER = ROOT .. "/overlays/lua/runner.lua"
local FIXTURE = ROOT .. "/tools/golden-tests/fixtures/sample-build.xml"

local json = require("dkjson")

local function readFile(path)
	local fh = assert(io.open(path, "r"))
	local data = fh:read("*a")
	fh:close()
	return data
end

-- Quote a Lua string as a single-quoted shell word (POSIX-safe).
local function shellQuote(s)
	return "'" .. tostring(s):gsub("'", "'\\''") .. "'"
end

-- Run the runner as a real subprocess under LuaJIT, feeding `requests` (a list
-- of already-encoded JSON request strings) one per line on stdin, and return the
-- raw stdout. The runner's own stderr (where the core chatter lands) is sent to
-- /dev/null so this captures EXACTLY the protocol frames the runner wrote to
-- stdout — that separation is the property under test.
--
-- stdin is staged through a temp file and `< file` redirect rather than piped via
-- `printf`: the JSON requests embed `\n`/`\"` escapes, and `printf` (per shell)
-- can re-interpret those escapes, corrupting the frame. A file redirect transports
-- the bytes verbatim.
local function runRunner(requests)
	local stdin = table.concat(requests, "\n") .. "\n"
	local stdinPath = os.tmpname()
	local fh = assert(io.open(stdinPath, "wb"))
	fh:write(stdin)
	fh:close()

	local cmd = string.format(
		"luajit %s < %s 2>/dev/null",
		shellQuote(RUNNER),
		shellQuote(stdinPath)
	)
	local proc = assert(io.popen(cmd, "r"))
	local stdout = proc:read("*a")
	proc:close()
	os.remove(stdinPath)
	return stdout
end

-- Split runner stdout into the individual newline-delimited frames, rejecting
-- any empty trailing fragment.
local function frames(stdout)
	local out = {}
	for line in stdout:gmatch("[^\n]+") do
		out[#out + 1] = line
	end
	return out
end

describe("runner (out-of-process JSON-RPC, stdio line protocol)", function()
	it("exposes a dispatch entrypoint as a module", function()
		local runner = require(MODULE)
		assert.are.equal("table", type(runner))
		assert.are.equal("function", type(runner.dispatch))
	end)

	describe("build.load + calc.run request pair over real stdin/stdout", function()
		local responseLines

		setup(function()
			local sampleXml = readFile(FIXTURE)
			local loadReq = json.encode({
				jsonrpc = "2.0",
				id = 1,
				method = "build.load",
				params = { xml = sampleXml },
			})
			-- The runner is sequential: build.load runs first and registers the
			-- buildId the core reports back, so calc.run can reference it. We use
			-- the well-known first id the modern_api allocates ("build-1") in the
			-- fresh process so the two-line pipe is self-contained.
			local calcReq = json.encode({
				jsonrpc = "2.0",
				id = 2,
				method = "calc.run",
				params = { buildId = "build-1" },
			})
			responseLines = frames(runRunner({ loadReq, calcReq }))
		end)

		it("writes exactly one JSON line per request (no core chatter on stdout)", function()
			assert.are.equal(2, #responseLines, "expected exactly two protocol frames on stdout")
			-- Each frame is a single line: no embedded newlines, parses as JSON.
			for _, line in ipairs(responseLines) do
				assert.is_falsy(line:find("\n", 1, true), "a frame must be a single line")
				local obj = json.decode(line)
				assert.are.equal("table", type(obj), "each frame must be a JSON object")
				assert.are.equal("2.0", obj.jsonrpc, "each frame is a JSON-RPC 2.0 envelope")
			end
		end)

		it("build.load returns a result envelope with a buildId echoing the request id", function()
			local resp = json.decode(responseLines[1])
			assert.are.equal(1, resp.id)
			assert.is_nil(resp.error, "build.load on the sample fixture must not error")
			assert.are.equal("table", type(resp.result))
			assert.are.equal("string", type(resp.result.buildId))
			assert.is_true(#resp.result.buildId > 0, "buildId must be non-empty")
		end)

		it("calc.run returns the curated stat list referencing the loaded build", function()
			local resp = json.decode(responseLines[2])
			assert.are.equal(2, resp.id)
			assert.is_nil(resp.error, "calc.run on the loaded build must not error")
			assert.are.equal("table", type(resp.result))
			assert.are.equal("table", type(resp.result.stats))
			assert.is_true(#resp.result.stats > 0, "calc.run must return curated core stats")
			-- The Life pool is always present and positive on a real build — proof the
			-- calc layer actually ran behind the protocol, not a stubbed echo.
			local life
			for _, stat in ipairs(resp.result.stats) do
				if stat.statId == "Life" then
					life = stat
				end
			end
			assert.is_not_nil(life, "curated stats must include Life")
			assert.is_true(life.value > 0)
		end)
	end)

	describe("dispatch() in-process", function()
		it("maps an unknown method to JSON-RPC error -32601 (Method not found)", function()
			local runner = require(MODULE)
			local resp = runner.dispatch({
				jsonrpc = "2.0",
				id = 7,
				method = "no.such.method",
				params = {},
			})
			assert.are.equal("2.0", resp.jsonrpc)
			assert.are.equal(7, resp.id)
			assert.is_nil(resp.result)
			assert.are.equal("table", type(resp.error))
			assert.are.equal(-32601, resp.error.code)
			assert.are.equal("string", type(resp.error.message))
		end)
	end)
end)
