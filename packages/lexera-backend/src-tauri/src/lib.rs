/// Lexera Backend: Tauri setup, config loading, storage init, tray, HTTP server.

mod config;
pub mod state;
pub mod api;
mod server;
mod tray;
mod capture;
mod clipboard_watcher;

// New collaboration modules
pub mod invite;
pub mod public;
pub mod auth;
pub mod collab_api;

use std::sync::Arc;
use std::path::PathBuf;
use std::sync::RwLock;
use lexera_core::storage::local::LocalStorage;
use lexera_core::include::resolver::IncludeMap;
use lexera_core::watcher::file_watcher::FileWatcher;
use lexera_core::watcher::types::BoardChangeEvent;
use tauri::Manager;
use crate::state::{AppState, ResolvedIncoming};

pub fn run() {
    env_logger::init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            capture::read_clipboard,
            capture::read_clipboard_image,
            capture::get_clipboard_history,
            capture::remove_clipboard_entry,
            capture::snap_capture_window,
            capture::close_capture,
        ])
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if let tauri_plugin_global_shortcut::ShortcutState::Pressed = event.state {
                        capture::capture_selection_and_open(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            // Hide from Dock, show only as menu bar (tray) app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_path = config::default_config_path();
            let config = config::load_config(&config_path);
            let port = config.port;

            // Initialize storage and load boards
            let storage = Arc::new(LocalStorage::new());
            let mut board_paths: Vec<(String, PathBuf)> = Vec::new();

            for entry in &config.boards {
                let path = PathBuf::from(&entry.file);
                match storage.add_board(&path) {
                    Ok(id) => {
                        log::info!("Loaded board: {} -> {}", entry.file, id);
                        let canonical = std::fs::canonicalize(&path).unwrap_or(path);
                        board_paths.push((id, canonical));
                    }
                    Err(e) => log::warn!("Failed to load board {}: {}", entry.file, e),
                }
            }

            // Resolve incoming config (map file path to board ID)
            let incoming = config.incoming.and_then(|inc| {
                let inc_path = PathBuf::from(&inc.board);
                board_paths.iter().find(|(_, p)| {
                    let canonical_inc = std::fs::canonicalize(&inc_path).unwrap_or(inc_path.clone());
                    *p == canonical_inc
                }).map(|(id, _)| ResolvedIncoming {
                    board_id: id.clone(),
                    column: inc.column,
                })
            });

            // Register global shortcut
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().register("CmdOrCtrl+Shift+C");

            // Create file watcher
            let include_map = Arc::new(RwLock::new(IncludeMap::new()));
            let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<BoardChangeEvent>(256);

            let watcher_result = FileWatcher::new(include_map.clone());

            if let Ok((mut watcher, _watcher_rx)) = watcher_result {
                // Watch all board files
                for (board_id, path) in &board_paths {
                    if let Err(e) = watcher.watch_board(board_id, path) {
                        log::warn!("[lexera.watcher] Failed to watch board {}: {}", board_id, e);
                    }
                }

                // Watch include files
                let storage_map = storage.include_map();
                for path in storage_map.all_include_paths() {
                    if let Err(e) = watcher.watch_include(&path) {
                        log::warn!("[lexera.watcher] Failed to watch include {:?}: {}", path, e);
                    }
                }
                drop(storage_map);

                // Spawn event processing loop
                let storage_for_events = storage.clone();
                let event_tx_for_forward = event_tx.clone();
                let mut event_rx = watcher.event_sender().subscribe();

                tauri::async_runtime::spawn(async move {
                    // Keep watcher alive
                    let _watcher = watcher;

                    loop {
                        match event_rx.recv().await {
                            Ok(event) => {
                                // Check self-write before propagating
                                match &event {
                                    BoardChangeEvent::MainFileChanged { board_id } => {
                                        if let Some(path) = storage_for_events.get_board_path(board_id) {
                                            if storage_for_events.check_self_write(&path) {
                                                log::info!("[lexera.events] Suppressed self-write for board {}", board_id);
                                                continue;
                                            }
                                        }
                                        if let Err(e) = storage_for_events.reload_board(board_id) {
                                            log::warn!("[lexera.events] Failed to reload board {}: {}", board_id, e);
                                        }
                                    }
                                    BoardChangeEvent::IncludeFileChanged { board_ids, include_path } => {
                                        if storage_for_events.check_self_write(include_path) {
                                            log::info!("[lexera.events] Suppressed self-write for include {:?}", include_path);
                                            continue;
                                        }
                                        for bid in board_ids {
                                            if let Err(e) = storage_for_events.reload_board(bid) {
                                                log::warn!("[lexera.events] Failed to reload board {}: {}", bid, e);
                                            }
                                        }
                                    }
                                    _ => {}
                                }

                                // Forward event to SSE clients
                                let _ = event_tx_for_forward.send(event);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                log::warn!("[lexera.events] Lagged by {} events", n);
                            }
                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                log::info!("[lexera.events] Event channel closed");
                                break;
                            }
                        }
                    }
                });
            } else if let Err(e) = watcher_result {
                log::warn!("[lexera.watcher] Failed to create file watcher: {}", e);
            }

            // Initialize collaboration services
            let invite_service = Arc::new(std::sync::Mutex::new(crate::invite::InviteService::new()));
            let public_service = Arc::new(std::sync::Mutex::new(crate::public::PublicRoomService::new()));
            let auth_service = Arc::new(std::sync::Mutex::new(crate::auth::AuthService::new()));

            // Start periodic cleanup for expired invites
            let invite_cleanup = invite_service.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(3600)); // Every hour
                loop {
                    interval.tick().await;
                    let count = invite_cleanup.lock().unwrap().cleanup_expired();
                    if count > 0 {
                        log::info!("[collab] Cleaned up {} expired invites", count);
                    }
                }
            });

            let app_state = AppState {
                storage: storage.clone(),
                event_tx: event_tx.clone(),
                port,
                incoming,
                // Collaboration services
                invite_service,
                public_service,
                auth_service,
            };

            let app_handle = app.handle().clone();

            // Spawn HTTP server
            tauri::async_runtime::spawn(async move {
                match server::spawn_server(app_state).await {
                    Ok(actual_port) => {
                        log::info!("Server started on port {}", actual_port);
                        // Set up tray with actual port
                        let _ = tray::setup_tray(&app_handle, actual_port);
                    }
                    Err(e) => log::error!("Failed to start server: {}", e),
                }
            });

            // Create shared clipboard history and start watcher
            let clipboard_history: capture::ClipboardHistory = Arc::new(std::sync::Mutex::new(Vec::new()));
            app.manage(clipboard_history.clone());

            let app_handle_for_watcher = app.handle().clone();
            let _watcher_shutdown = clipboard_watcher::start_clipboard_watcher(&app_handle_for_watcher, clipboard_history);
            app.manage(std::sync::Mutex::new(Some(_watcher_shutdown)));

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running lexera-backend");
}
