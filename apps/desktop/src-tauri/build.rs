// Tauri build script (DESIGN §5.1 Rust host layer). Generates the context/permissions
// from tauri.conf.json so `tauri::generate_context!()` in lib.rs resolves at compile time.
fn main() {
    tauri_build::build();
}
