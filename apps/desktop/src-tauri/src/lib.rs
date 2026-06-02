//! PoB2 Remastered desktop host (Tauri shell + allowlisted IPC).
//!
//! DESIGN §5.1 "Rust host layer": this crate is the Tauri application shell. It
//! owns file save/load for build documents and exposes only an explicit set of
//! commands to the web frontend.
//!
//! DESIGN §14.1 "Tauri IPC": 허용된 command만 expose — the commands registered
//! with `invoke_handler` are [`open_build_file`], [`save_build_file`], and
//! [`core_request`] (the single allowlisted Core API gateway, which itself only
//! routes the [`core_bridge::ALLOWED_METHODS`] set). No arbitrary shell, no
//! networking.
//!
//! DESIGN §14.2 "Clipboard/import sandbox": 파일 import는 확장자와 schema 검증 —
//! every file path crossing the IPC boundary is run through the pure
//! [`validate_build_path`] guard (extension allowlist + path-traversal reject)
//! before any filesystem access. The Lua core runs out-of-process (see
//! [`core_bridge`]); a runner crash / malformed input becomes a CoreError, never
//! a host crash.

pub mod core_bridge;

use std::path::{Component, Path};
use std::sync::Mutex;

use core_bridge::{CoreBridge, CoreError, RunnerOptions};
use serde_json::Value;
use tauri::State;

/// File extensions a build document may use (DESIGN §5.1 "build XML/share code",
/// §6.5 build documents). Compared case-insensitively against the path's extension.
const ALLOWED_BUILD_EXTENSIONS: [&str; 2] = ["xml", "json"];

/// Why a candidate build-file path was rejected by [`validate_build_path`].
///
/// Surfaced to the frontend as a stable string (see [`BuildPathError::as_str`])
/// so the UI can localize without depending on Rust error formatting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuildPathError {
    /// The path was empty / whitespace-only.
    Empty,
    /// The path contains a `..` (parent) component — potential traversal.
    Traversal,
    /// The extension is missing or not in [`ALLOWED_BUILD_EXTENSIONS`].
    DisallowedExtension,
}

impl BuildPathError {
    /// Stable machine-readable code for the IPC error payload.
    pub fn as_str(self) -> &'static str {
        match self {
            BuildPathError::Empty => "empty-path",
            BuildPathError::Traversal => "path-traversal",
            BuildPathError::DisallowedExtension => "disallowed-extension",
        }
    }
}

impl std::fmt::Display for BuildPathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::error::Error for BuildPathError {}

/// Pure guard for a build-file path crossing the IPC boundary (DESIGN §14.2
/// "파일 import는 확장자와 schema 검증").
///
/// Validates, without touching the filesystem, that `raw`:
/// 1. is non-empty,
/// 2. contains no `..` component (path traversal), and
/// 3. ends in one of [`ALLOWED_BUILD_EXTENSIONS`] (case-insensitive).
///
/// Returns the borrowed [`Path`] on success so callers reuse the parsed value.
pub fn validate_build_path(raw: &str) -> Result<&Path, BuildPathError> {
    if raw.trim().is_empty() {
        return Err(BuildPathError::Empty);
    }

    let path = Path::new(raw);

    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(BuildPathError::Traversal);
    }

    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .is_some_and(|e| ALLOWED_BUILD_EXTENSIONS.contains(&e.as_str()));

    if ext_ok {
        Ok(path)
    } else {
        Err(BuildPathError::DisallowedExtension)
    }
}

/// IPC: read a build document from disk (DESIGN §5.1 파일 저장/로드, §10.4 build open).
///
/// `path` is validated by [`validate_build_path`] before any read, so a hostile
/// frontend cannot read arbitrary files via traversal or a non-build extension.
/// Returns the file contents as UTF-8 text (build XML / JSON) or a stable error code.
#[tauri::command]
fn open_build_file(path: String) -> Result<String, String> {
    let validated = validate_build_path(&path).map_err(|e| e.as_str().to_string())?;
    std::fs::read_to_string(validated).map_err(|e| e.to_string())
}

/// IPC: write a build document to disk (DESIGN §5.1 파일 저장/로드, §10.4 build save).
///
/// `path` is validated by [`validate_build_path`] before any write. `contents`
/// is the serialized build document (XML / JSON) produced by the core runner.
#[tauri::command]
fn save_build_file(path: String, contents: String) -> Result<(), String> {
    let validated = validate_build_path(&path).map_err(|e| e.as_str().to_string())?;
    std::fs::write(validated, contents).map_err(|e| e.to_string())
}

/// Lazily-started out-of-process Lua core bridge, owned by the Tauri app as
/// managed state (DESIGN §5.1 "Lua core runner process lifecycle 관리"). The
/// runner is spawned on the FIRST [`core_request`] rather than at startup so a
/// boot failure surfaces as a per-request CoreError to the UI (and so the host
/// window still opens if the core cannot boot). The `Mutex<Option<…>>` lets the
/// bridge be (re)started on demand; a crash drops it back to `None`.
#[derive(Default)]
pub struct CoreBridgeState(Mutex<Option<CoreBridge>>);

/// IPC: the single allowlisted Core API gateway (DESIGN §14.1 "허용된 command만
/// expose", §6.3 Core API). Routes `method` + `params` to the out-of-process Lua
/// runner and returns its result JSON. The bridge's own allowlist
/// ([`core_bridge::ALLOWED_METHODS`]) is the security boundary: a non-allowlisted
/// method is refused as a CoreError before it can reach the runner.
///
/// NO-FALLBACK (DESIGN §14.2): a runner crash / malformed reply is returned to the
/// frontend as a [`CoreError`] (the IPC `Err` payload). It never panics the host;
/// a dead runner is dropped so the NEXT call re-spawns it.
#[tauri::command]
fn core_request(
    state: State<'_, CoreBridgeState>,
    method: String,
    params: Value,
) -> Result<Value, CoreError> {
    // Hold the state lock across the whole request so the single runner serializes
    // concurrent IPC calls (the runner answers one request per line, in order).
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());

    // (Re)start the runner if it is not currently alive (first call, or after a
    // crash dropped it). A start failure is itself a CoreError, not a panic.
    let needs_start = guard.as_ref().map(|b| !b.is_running()).unwrap_or(true);
    if needs_start {
        *guard = Some(CoreBridge::start(RunnerOptions::in_repo())?);
    }

    let bridge = guard
        .as_ref()
        .expect("bridge was just started or already running");
    let result = bridge.request(&method, params);

    // If the request killed the runner (transport failure), drop it so the next
    // call re-spawns a fresh runner rather than reusing a dead pipe.
    if result.is_err() && !bridge.is_running() {
        *guard = None;
    }
    result
}

/// Build and run the Tauri application (DESIGN §5.1 Tauri application shell).
///
/// Registers exactly the allowlisted IPC commands (DESIGN §14.1 허용된 command만
/// expose) and manages the lazily-started [`CoreBridgeState`]. `#[cfg_attr(mobile,
/// ...)]` lets the same entry point serve mobile.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(CoreBridgeState::default())
        .invoke_handler(tauri::generate_handler![
            open_build_file,
            save_build_file,
            core_request
        ])
        .run(tauri::generate_context!())
        .expect("error while running PoB2 Remastered desktop host");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_allowed_build_extensions() {
        assert!(validate_build_path("/home/u/builds/my.xml").is_ok());
        assert!(validate_build_path("/home/u/builds/my.json").is_ok());
        // Case-insensitive: real filesystems hand us mixed-case extensions.
        assert!(validate_build_path("/home/u/builds/MY.XML").is_ok());
    }

    #[test]
    fn rejects_disallowed_extensions() {
        assert_eq!(
            validate_build_path("/home/u/builds/evil.sh"),
            Err(BuildPathError::DisallowedExtension)
        );
        assert_eq!(
            validate_build_path("/home/u/builds/noext"),
            Err(BuildPathError::DisallowedExtension)
        );
    }

    #[test]
    fn rejects_path_traversal() {
        assert_eq!(
            validate_build_path("/home/u/builds/../../etc/passwd.xml"),
            Err(BuildPathError::Traversal)
        );
    }

    #[test]
    fn rejects_empty_path() {
        assert_eq!(validate_build_path(""), Err(BuildPathError::Empty));
    }
}
