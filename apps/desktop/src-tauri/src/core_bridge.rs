//! Out-of-process Lua core bridge (DESIGN §5.1 "Lua core runner process lifecycle
//! 관리", §6.2 out-of-process runner, §14.1 허용된 command만, §14.2 crash isolation).
//!
//! The Rust host owns the lifecycle of the out-of-process Lua runner
//! (`overlays/lua/runner.lua`): it spawns the runner under LuaJIT, speaks
//! newline-delimited JSON-RPC 2.0 over its stdin/stdout, completes the
//! `core.version` ready handshake, and routes the allowlisted Core API methods
//! (`build.load` / `build.save` / `calc.run` / `calc.explain` /
//! `items.parseClipboard` / `items.getEquipped` / `items.compare` /
//! `skills.getGroups` / `skills.setGemGroup` / `config.getOptions` /
//! `config.setOption`) through it.
//!
//! NO-FALLBACK (DESIGN §14.2): a runner crash, a malformed reply, or a
//! non-allowlisted method is surfaced to the frontend as a normalised
//! [`CoreError`] (DESIGN §6.4). It NEVER panics the host process — every public
//! entry point returns `Result<_, CoreError>`, and a dead runner makes every
//! later request reject with `CORE_INIT_FAILED` rather than killing the host.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};

/// The six normalised Core API error codes (DESIGN §6.4). Kept byte-identical to
/// `@pob2/schema`'s `CORE_ERROR_CODES` so the closed set never drifts across the
/// host boundary.
pub const CORE_ERROR_CODES: [&str; 6] = [
    "CORE_INIT_FAILED",
    "BUILD_PARSE_FAILED",
    "UNKNOWN_MOD",
    "CALC_FAILED",
    "LOCALIZATION_MISSING",
    "UPSTREAM_INCOMPATIBLE",
];

/// The Core API methods the IPC bridge will route (DESIGN §14.1 "허용된 command만
/// expose"). `core.version` is the ready handshake; the rest are the MVP surface
/// (DESIGN §6.3): build load/save, calc.run + calc.explain, the §10.4 Items-tab
/// reads (`items.parseClipboard`, `items.getEquipped`, `items.compare`), and the
/// Phase 4 §10.5/§10.8 Skills/Config edits (`skills.getGroups` / `skills.setGemGroup`,
/// `config.getOptions` / `config.setOption`). A method outside this set is refused as
/// `UPSTREAM_INCOMPATIBLE` BEFORE it can reach the runner.
pub const ALLOWED_METHODS: [&str; 12] = [
    "core.version",
    "build.load",
    "build.save",
    "calc.run",
    "calc.explain",
    "items.parseClipboard",
    "items.getEquipped",
    "items.compare",
    "skills.getGroups",
    "skills.setGemGroup",
    "config.getOptions",
    "config.setOption",
];

/// Normalised Core API error envelope (DESIGN §6.4). Serialized as the IPC
/// command's error payload so the frontend's `CoreError` union survives the hop
/// (`code` is one of [`CORE_ERROR_CODES`]; `details`/`upstreamStack` are optional
/// diagnostics).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CoreError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream_stack: Option<String>,
}

impl CoreError {
    /// Construct a CoreError from a code + message (no diagnostics). The code MUST
    /// be one of [`CORE_ERROR_CODES`]; passing an out-of-set code is a programming
    /// error, so this debug-asserts the closed set while still producing a
    /// well-formed envelope in release.
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        debug_assert!(
            CORE_ERROR_CODES.contains(&code),
            "CoreError code `{code}` is not in the DESIGN §6.4 closed set"
        );
        CoreError {
            code: code.to_string(),
            message: message.into(),
            details: None,
            upstream_stack: None,
        }
    }

    /// Attach the captured runner stderr as `upstreamStack` dev diagnostics.
    pub fn with_upstream_stack(mut self, stack: Option<String>) -> Self {
        self.upstream_stack = stack.filter(|s| !s.is_empty());
        self
    }
}

impl std::fmt::Display for CoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for CoreError {}

/// Refuse a method that is not in the IPC allowlist (DESIGN §14.1). Returns the
/// borrowed method on success so the caller reuses it; `Err(CoreError)` with
/// `UPSTREAM_INCOMPATIBLE` otherwise — a hostile frontend cannot reach an
/// arbitrary runner method (or anything outside the Core API) through the bridge.
pub fn ensure_allowed(method: &str) -> Result<(), CoreError> {
    if ALLOWED_METHODS.contains(&method) {
        Ok(())
    } else {
        Err(CoreError::new(
            "UPSTREAM_INCOMPATIBLE",
            format!("method `{method}` is not in the IPC allowlist"),
        ))
    }
}

/// Max byte length of a single JSON-RPC frame written to / read from the runner
/// (DESIGN §14.2 input size limit). Mirrors `RAW_REQUEST_MAX_BYTES` /
/// `MAX_LINE_BYTES` on the JS client and the runner so a frame either side
/// rejects is rejected consistently (defence in depth). 1 MiB comfortably holds
/// any real build XML / share-code frame while bounding a single allocation.
pub const MAX_FRAME_BYTES: usize = 1024 * 1024;

/// Options for spawning the runner. Defaults resolve the in-repo overlay runner
/// and `luajit` on PATH; tests override the interpreter to prove crash isolation.
#[derive(Debug, Clone)]
pub struct RunnerOptions {
    /// Absolute path to `runner.lua`.
    pub runner_path: PathBuf,
    /// Interpreter to spawn the runner under (LuaJIT).
    pub luajit: String,
}

impl RunnerOptions {
    /// Resolve the in-repo overlay runner relative to this crate at compile time
    /// (`apps/desktop/src-tauri` -> repo root -> `overlays/lua/runner.lua`). The
    /// runner itself resolves the vendored core via its own absolute self-path, so
    /// only this script path depends on the source tree layout.
    pub fn in_repo() -> Self {
        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let runner_path = manifest_dir
            .join("../../../overlays/lua/runner.lua")
            .canonicalize()
            .unwrap_or_else(|_| manifest_dir.join("../../../overlays/lua/runner.lua"));
        RunnerOptions {
            runner_path,
            luajit: "luajit".to_string(),
        }
    }
}

/// Resolve the luarocks `--local` Lua module search paths so the spawned runner
/// can `require('lua-utf8')` (a native `.so` the vendored core needs; see
/// `overlays/lua/README.md`). Mirrors the JS client's `childEnv()`. Absent
/// luarocks, the parent env is used unchanged — a missing module then surfaces as
/// a per-request `CORE_INIT_FAILED` rather than a silent wrong answer (NO-FALLBACK).
fn luarocks_path(flag: &str) -> Option<String> {
    let out = Command::new("luarocks")
        .args(["--local", "path", flag])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let value = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

/// The live runner subprocess plus its stdin writer and a buffered stdout reader.
/// Held behind the [`CoreBridge`] mutex so concurrent IPC calls serialize (the
/// runner answers one request per line in order).
struct RunnerProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    /// Monotonic JSON-RPC request id.
    next_id: u64,
}

/// Owns one out-of-process Lua runner and routes allowlisted Core API requests to
/// it (DESIGN §5.1 lifecycle, §6.2 out-of-process). `None` once the runner has
/// died; every later request then rejects with `CORE_INIT_FAILED` (NO-FALLBACK —
/// a dead runner never silently produces a result, and never panics the host).
pub struct CoreBridge {
    inner: Mutex<Option<RunnerProcess>>,
}

impl CoreBridge {
    /// Spawn the runner under LuaJIT and complete the `core.version` ready
    /// handshake. A spawn failure (e.g. interpreter not on PATH), an early exit, or
    /// a handshake that returns no version becomes a `CORE_INIT_FAILED` CoreError —
    /// never a panic, never a hang.
    pub fn start(options: RunnerOptions) -> Result<Self, CoreError> {
        let mut command = Command::new(&options.luajit);
        command
            .arg(&options.runner_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Merge the luarocks --local search paths so the runner can load lua-utf8.
        if let Some(lr_path) = luarocks_path("--lr-path") {
            let existing = std::env::var("LUA_PATH").unwrap_or_else(|_| ";;".to_string());
            command.env("LUA_PATH", format!("{lr_path};{existing}"));
        }
        if let Some(lr_cpath) = luarocks_path("--lr-cpath") {
            let existing = std::env::var("LUA_CPATH").unwrap_or_else(|_| ";;".to_string());
            command.env("LUA_CPATH", format!("{lr_cpath};{existing}"));
        }

        let mut child = command.spawn().map_err(|e| {
            CoreError::new(
                "CORE_INIT_FAILED",
                format!("failed to spawn runner `{}`: {e}", options.luajit),
            )
        })?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CoreError::new("CORE_INIT_FAILED", "runner stdin was not captured"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CoreError::new("CORE_INIT_FAILED", "runner stdout was not captured"))?;

        let process = RunnerProcess {
            child,
            stdin,
            stdout: BufReader::new(stdout),
            next_id: 1,
        };
        let bridge = CoreBridge {
            inner: Mutex::new(Some(process)),
        };

        // Ready handshake (DESIGN §6.3 core.version): block until the runner answers
        // before any build request can be routed. A failed handshake tears the
        // runner down and surfaces CORE_INIT_FAILED.
        let version = bridge.request("core.version", json!({}))?;
        let ok = version
            .get("version")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty());
        if !ok {
            bridge.shutdown();
            return Err(CoreError::new(
                "CORE_INIT_FAILED",
                "runner core.version handshake returned no version",
            ));
        }
        Ok(bridge)
    }

    /// Route an ALLOWLISTED Core API request to the runner and return its result
    /// value (DESIGN §6.3). The method is allowlist-checked first (§14.1); a runner
    /// crash / malformed reply / JSON-RPC error becomes a CoreError (§6.4, §14.2),
    /// never a panic. On a transport failure the runner is torn down so later calls
    /// fail fast with `CORE_INIT_FAILED` instead of writing to a dead pipe.
    pub fn request(&self, method: &str, params: Value) -> Result<Value, CoreError> {
        ensure_allowed(method)?;

        let mut guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let process = guard
            .as_mut()
            .ok_or_else(|| CoreError::new("CORE_INIT_FAILED", "runner is not running"))?;

        match Self::exchange(process, method, params) {
            Ok(value) => Ok(value),
            Err(err) => {
                // A transport-level failure (write/read/parse) means the protocol
                // stream is broken; drop the runner so the host can restart it and
                // later requests don't pile onto a dead pipe.
                if err.code == "CORE_INIT_FAILED" || err.code == "UPSTREAM_INCOMPATIBLE" {
                    // Kill first so draining stderr cannot block on a still-running
                    // child (its stderr stays open until the process exits), then
                    // capture whatever it narrated for dead-process diagnostics.
                    let _ = process.child.kill();
                    let _ = process.child.wait();
                    let stderr = take_stderr(process);
                    *guard = None;
                    return Err(err.with_upstream_stack(stderr));
                }
                Err(err)
            }
        }
    }

    /// Whether the runner is still alive (used by tests to assert crash isolation:
    /// a malformed/erroring request must NOT bring the runner down).
    pub fn is_running(&self) -> bool {
        let guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        guard.is_some()
    }

    /// Kill the runner subprocess if still alive. Idempotent.
    pub fn shutdown(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(mut process) = guard.take() {
            let _ = process.child.kill();
            let _ = process.child.wait();
        }
    }

    /// Write one JSON-RPC request frame and read exactly one response frame,
    /// correlated by `id`. Translates a JSON-RPC error frame into a CoreError
    /// (preserving the runner's `error.data.code` when it is a §6.4 code), and a
    /// broken stream / oversized frame into a transport CoreError.
    fn exchange(
        process: &mut RunnerProcess,
        method: &str,
        params: Value,
    ) -> Result<Value, CoreError> {
        let id = process.next_id;
        process.next_id += 1;

        let frame = serde_json::to_string(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .map_err(|e| {
            CoreError::new(
                "UPSTREAM_INCOMPATIBLE",
                format!("failed to encode request: {e}"),
            )
        })?;

        if frame.len() > MAX_FRAME_BYTES {
            return Err(CoreError::new(
                "BUILD_PARSE_FAILED",
                format!("request frame exceeds the {MAX_FRAME_BYTES}-byte runner input limit"),
            ));
        }

        writeln!(process.stdin, "{frame}")
            .and_then(|()| process.stdin.flush())
            .map_err(|e| {
                CoreError::new(
                    "CORE_INIT_FAILED",
                    format!("failed to write to runner: {e}"),
                )
            })?;

        let mut line = String::new();
        let read = process.stdout.read_line(&mut line).map_err(|e| {
            CoreError::new(
                "CORE_INIT_FAILED",
                format!("failed to read from runner: {e}"),
            )
        })?;
        if read == 0 {
            return Err(CoreError::new(
                "CORE_INIT_FAILED",
                "runner closed its output stream (exited)",
            ));
        }

        let frame: Value = serde_json::from_str(line.trim()).map_err(|e| {
            CoreError::new(
                "UPSTREAM_INCOMPATIBLE",
                format!("runner emitted a non-JSON protocol line: {e}"),
            )
        })?;

        if let Some(error) = frame.get("error") {
            return Err(rpc_error_to_core(error));
        }
        Ok(frame.get("result").cloned().unwrap_or(Value::Null))
    }
}

impl Drop for CoreBridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Drain whatever the runner wrote to stderr (its boot/calc narration is on
/// stderr by design) for dead-process diagnostics. Best-effort: never blocks the
/// shutdown path.
fn take_stderr(process: &mut RunnerProcess) -> Option<String> {
    let stderr = process.child.stderr.take()?;
    let mut reader = BufReader::new(stderr);
    let mut buf = String::new();
    use std::io::Read;
    let _ = reader.read_to_string(&mut buf);
    let tail: String = buf
        .chars()
        .rev()
        .take(4000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    if tail.is_empty() {
        None
    } else {
        Some(tail)
    }
}

/// Map a runner JSON-RPC error frame to a normalised CoreError (DESIGN §6.4). The
/// runner's application error (-32000) carries the typed CoreError code in
/// `error.data.code`; a protocol-level fault (parse / method-not-found) for a
/// method the host itself issues can only mean an incompatible core surface.
fn rpc_error_to_core(error: &Value) -> CoreError {
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("runner error")
        .to_string();
    let data_code = error
        .get("data")
        .and_then(|d| d.get("code"))
        .and_then(Value::as_str);
    if let Some(code) = data_code {
        if CORE_ERROR_CODES.contains(&code) {
            return CoreError::new(code, message);
        }
    }
    let rpc_code = error.get("code").and_then(Value::as_i64);
    // -32000 is the core's own application error; anything else is a protocol-level
    // fault which, for a method the host issues, means the core surface is broken.
    let normalized = if rpc_code == Some(-32000) {
        "CALC_FAILED"
    } else {
        "UPSTREAM_INCOMPATIBLE"
    };
    CoreError::new(normalized, message)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo_runner() -> RunnerOptions {
        RunnerOptions::in_repo()
    }

    // --- pure allowlist guard (DESIGN §14.1) -- no process needed ---------------

    #[test]
    fn allowlist_accepts_the_mvp_core_methods() {
        for method in [
            "core.version",
            "build.load",
            "build.save",
            "calc.run",
            "calc.explain",
            "items.parseClipboard",
            "items.getEquipped",
            "items.compare",
            "skills.getGroups",
            "skills.setGemGroup",
            "config.getOptions",
            "config.setOption",
        ] {
            assert!(ensure_allowed(method).is_ok(), "{method} should be allowed");
        }
    }

    #[test]
    fn allowlist_refuses_a_non_allowlisted_method_as_core_error() {
        // A method NOT in the Core API allowlist must be refused before it can reach
        // the runner — never an arbitrary method, never a shell escape (DESIGN §14.1).
        for method in [
            "build.applyPatch",
            "items.createCustom",
            "tree.applyAllocate",
            "os.execute",
        ] {
            let err = ensure_allowed(method).expect_err("should be refused");
            assert_eq!(err.code, "UPSTREAM_INCOMPATIBLE");
        }
    }

    // --- crash isolation: a bad interpreter never panics the host (DESIGN §14.2) -

    #[test]
    fn spawning_with_a_missing_interpreter_is_a_core_error_not_a_panic() {
        let mut options = repo_runner();
        options.luajit = "definitely-not-an-interpreter-xyz".to_string();
        match CoreBridge::start(options) {
            Ok(_) => panic!("spawn with a missing interpreter should fail"),
            Err(err) => assert_eq!(err.code, "CORE_INIT_FAILED"),
        }
    }

    #[test]
    fn request_on_a_non_allowlisted_method_never_touches_the_runner() {
        // Even with a started bridge, a non-allowlisted method is refused by the
        // guard before any frame is written (DESIGN §14.1).
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");
        let err = bridge
            .request("build.applyPatch", json!({}))
            .expect_err("refused");
        assert_eq!(err.code, "UPSTREAM_INCOMPATIBLE");
        // The runner is untouched and still alive.
        assert!(bridge.is_running());
    }

    // --- live round-trip against the real runner (LuaJIT present in this env) ----

    #[test]
    fn ready_handshake_starts_the_runner_and_reports_a_version() {
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");
        assert!(bridge.is_running());
        let version = bridge
            .request("core.version", json!({}))
            .expect("core.version");
        assert!(version
            .get("version")
            .and_then(Value::as_str)
            .is_some_and(|v| !v.is_empty()));
    }

    #[test]
    fn build_load_then_calc_run_returns_real_stats() {
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");

        let xml = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tools/golden-tests/fixtures/sample-build.xml"),
        )
        .expect("read sample fixture");

        let loaded = bridge
            .request("build.load", json!({ "xml": xml }))
            .expect("build.load");
        let build_id = loaded
            .get("buildId")
            .and_then(Value::as_str)
            .expect("buildId");
        assert_eq!(build_id, "build-1");

        let calc = bridge
            .request("calc.run", json!({ "buildId": build_id }))
            .expect("calc.run");
        let stats = calc
            .get("stats")
            .and_then(Value::as_array)
            .expect("stats array");
        let life = stats
            .iter()
            .find(|s| s.get("statId").and_then(Value::as_str) == Some("Life"))
            .and_then(|s| s.get("value"))
            .and_then(Value::as_f64)
            .expect("Life stat");
        // The fixture is deterministic (PROGRESS.md Phase 0): Life = 65.
        assert_eq!(life, 65.0);
    }

    #[test]
    fn items_getequipped_and_compare_route_through_the_bridge() {
        // The §10.4 Items-tab reads the shipped app drives after Open: items.getEquipped
        // (equipped grid) and items.compare (equip delta) must be allowlisted AND route
        // to the runner end to end — getEquipped was previously missing from the
        // allowlist, so the live equipped grid could never load.
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");
        let xml = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tools/golden-tests/fixtures/sample-build.xml"),
        )
        .expect("read sample fixture");
        let build_id = bridge
            .request("build.load", json!({ "xml": xml }))
            .expect("build.load")
            .get("buildId")
            .and_then(Value::as_str)
            .expect("buildId")
            .to_string();

        // items.getEquipped: the sample build equips a Runeforged Warpick in Weapon 1.
        let equipped = bridge
            .request("items.getEquipped", json!({ "buildId": build_id }))
            .expect("items.getEquipped");
        let cards = equipped
            .get("equipped")
            .and_then(Value::as_array)
            .expect("equipped array");
        let weapon = cards
            .iter()
            .find(|c| c.get("slot").and_then(Value::as_str) == Some("Weapon 1"))
            .expect("Weapon 1 card");
        let item_id = weapon
            .get("itemId")
            .and_then(Value::as_str)
            .expect("itemId")
            .to_string();

        // items.compare: equipping that same item in its own slot is a real measured 0,
        // and `before` is the live baseline (Life = 65), proving the real diff runs.
        let compare = bridge
            .request(
                "items.compare",
                json!({ "buildId": build_id, "itemId": item_id, "slot": "Weapon 1" }),
            )
            .expect("items.compare");
        assert_eq!(compare.get("slot").and_then(Value::as_str), Some("Weapon 1"));
        let deltas = compare
            .get("deltas")
            .and_then(Value::as_array)
            .expect("deltas array");
        let life = deltas
            .iter()
            .find(|d| d.get("statId").and_then(Value::as_str) == Some("Life"))
            .expect("Life delta");
        assert_eq!(life.get("before").and_then(Value::as_f64), Some(65.0));
        assert_eq!(life.get("delta").and_then(Value::as_f64), Some(0.0));
    }

    #[test]
    fn phase4_skills_config_explain_route_through_the_bridge() {
        // CARRYOVER of the p3-review/getequipped-allowlist BLOCKING regression: the
        // Phase 4 Skills/Config/Calcs methods (skills.getGroups, skills.setGemGroup,
        // config.getOptions, config.setOption, calc.explain) must be allowlisted AND
        // route through the REAL runner end to end — proven against the live bridge,
        // not a mock client (same discipline as items_getequipped above). If any one
        // were missing from ALLOWED_METHODS, the shipped app's Skills/Config/Calcs tabs
        // would be refused as UPSTREAM_INCOMPATIBLE at runtime, never load.
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");
        let xml = std::fs::read_to_string(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../tools/golden-tests/fixtures/sample-build.xml"),
        )
        .expect("read sample fixture");
        let build_id = bridge
            .request("build.load", json!({ "xml": xml }))
            .expect("build.load")
            .get("buildId")
            .and_then(Value::as_str)
            .expect("buildId")
            .to_string();

        // skills.getGroups: the sample build's first socket group leads with the
        // Mace Strike active gem at level 20 (modern_api_skills_spec known-good).
        let groups = bridge
            .request("skills.getGroups", json!({ "buildId": build_id }))
            .expect("skills.getGroups");
        let group_list = groups
            .get("groups")
            .and_then(Value::as_array)
            .expect("groups array");
        let first_group = group_list.first().expect("at least one socket group");
        let group_id = first_group
            .get("groupId")
            .and_then(Value::as_str)
            .expect("groupId")
            .to_string();
        let first_gem = first_group
            .get("gems")
            .and_then(Value::as_array)
            .and_then(|g| g.first())
            .expect("first gem");
        assert_eq!(
            first_gem.get("nameSpec").and_then(Value::as_str),
            Some("Mace Strike")
        );

        // skills.setGemGroup: replace the group with that same Mace Strike gem and
        // re-resolve. It mutates the live build and echoes the groupId back.
        let set_group = bridge
            .request(
                "skills.setGemGroup",
                json!({
                    "buildId": build_id,
                    "groupId": group_id,
                    "gems": [{ "nameSpec": "Mace Strike", "level": 20, "quality": 0 }],
                }),
            )
            .expect("skills.setGemGroup");
        assert_eq!(
            set_group.get("groupId").and_then(Value::as_str),
            Some(group_id.as_str())
        );

        // config.getOptions: the flat option list carries the always-eligible
        // conditionEnemyShocked check option (modern_api_config_spec known-good).
        let options = bridge
            .request("config.getOptions", json!({ "buildId": build_id }))
            .expect("config.getOptions");
        let option_list = options
            .get("options")
            .and_then(Value::as_array)
            .expect("options array");
        assert!(
            option_list.iter().any(|c| c.get("optionId").and_then(Value::as_str)
                == Some("conditionEnemyShocked")),
            "config.getOptions must expose the conditionEnemyShocked option"
        );

        // config.setOption: toggle that real option on. It mutates the live build and
        // echoes the optionId back (an unknown optionId would be a CoreError).
        let set_option = bridge
            .request(
                "config.setOption",
                json!({ "buildId": build_id, "optionId": "conditionEnemyShocked", "value": true }),
            )
            .expect("config.setOption");
        assert_eq!(
            set_option.get("optionId").and_then(Value::as_str),
            Some("conditionEnemyShocked")
        );

        // calc.explain: the live Life breakdown resolves to the deterministic 65 the
        // fixture computes (62 base x 1.05), proving the real breakdown trace runs.
        let explain = bridge
            .request(
                "calc.explain",
                json!({ "buildId": build_id, "statId": "Life" }),
            )
            .expect("calc.explain");
        assert_eq!(explain.get("statId").and_then(Value::as_str), Some("Life"));
        assert_eq!(explain.get("finalValue").and_then(Value::as_f64), Some(65.0));

        assert!(bridge.is_running());
    }

    #[test]
    fn malformed_params_are_a_core_error_and_keep_the_runner_alive() {
        // A build.load with no usable XML must come back as a CoreError (the core
        // rejects it) WITHOUT killing the runner — crash isolation (DESIGN §14.2).
        let bridge = CoreBridge::start(repo_runner()).expect("runner should start");
        let result = bridge.request("build.load", json!({ "xml": "<not a build>" }));
        assert!(result.is_err(), "garbage XML should be a CoreError");
        let err = result.unwrap_err();
        assert!(
            CORE_ERROR_CODES.contains(&err.code.as_str()),
            "error code `{}` must be in the closed set",
            err.code
        );
        // The runner survived the bad request and still answers the handshake.
        assert!(bridge.is_running());
        let version = bridge
            .request("core.version", json!({}))
            .expect("still alive");
        assert!(version.get("version").and_then(Value::as_str).is_some());
    }
}
