mod commands;
mod ios_storage;

use std::sync::Arc;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            commands::capture_text,
            commands::capture_url,
            commands::list_boards,
            commands::get_board,
            commands::create_board,
            commands::search,
            commands::process_pending_shares,
        ])
        .setup(|app| {
            // Determine storage path.
            // On iOS: read from LEXERA_APP_GROUP_PATH env var (set by Swift AppDelegate).
            // Fallback: app's data directory.
            let storage_path = std::env::var("LEXERA_APP_GROUP_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| {
                    app.path()
                        .app_data_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."))
                });

            let boards_dir = storage_path.join("Documents").join("boards");
            let pending_path = storage_path.join("ShareExtension").join("pending.json");

            let storage = match ios_storage::IosStorage::new(boards_dir, pending_path) {
                Ok(s) => Arc::new(s),
                Err(e) => {
                    log::error!("[ios_capture.setup] Failed to initialize iOS storage: {}", e);
                    return Err(Box::new(e));
                }
            };

            app.manage(storage);
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            log::error!("[ios_capture.run] Tauri runtime failed: {}", e);
        });
}
