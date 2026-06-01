// Binary entry point. Keeps the Windows release build from spawning a console
// window; delegates to the library's run() (DESIGN §5.1 Rust host layer).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pob2_desktop_lib::run();
}
