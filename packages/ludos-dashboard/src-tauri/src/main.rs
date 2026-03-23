// Ludos Dashboard — Tauri v2 entry point.
// The frontend uses fetch() to talk to ludos-sync; no custom Rust commands needed.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
