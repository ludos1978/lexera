pub mod api;
mod capture;
mod clipboard_watcher;
/// Lexera Backend: Tauri setup, config loading, storage init, tray, HTTP server.
mod config;
pub mod connection_window;
pub mod discovery;
pub mod export_api;
mod log_bridge;
mod server;
pub mod state;
pub mod sync_client;
mod tray;

// New collaboration modules
pub mod auth;
pub mod collab_api;
pub mod invite;
pub mod public;
pub mod sync_ws;

use crate::state::{AppState, ResolvedIncoming};
use lexera_core::include::resolver::IncludeMap;
use lexera_core::storage::local::LocalStorage;
use lexera_core::watcher::file_watcher::FileWatcher;
use lexera_core::watcher::types::BoardChangeEvent;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::RwLock;
use tauri::Manager;

/// Capacity of the board-change event broadcast channel.
const EVENT_CHANNEL_CAPACITY: usize = 256;
/// Seconds between expired-invite cleanup runs.
const INVITE_CLEANUP_INTERVAL_SECS: u64 = 3600;
/// Seconds between periodic saves of collaboration state and config.
const PERIODIC_SAVE_INTERVAL_SECS: u64 = 60;

pub fn run() {
    if let Err(e) = log_bridge::init() {
        log_bridge::write_fallback_line(&format!("failed to initialize backend logger: {}", e));
    }

    // Install a panic hook that writes crash reports to disk before the
    // process aborts.  This captures panics on any thread (main, tokio,
    // clipboard-watcher, etc.) and persists the backtrace so we can
    // diagnose unexpected crashes (especially on Windows).
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");

        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let backtrace = std::backtrace::Backtrace::force_capture();

        let report = format!(
            "=== CRASH REPORT ===\n\
             Timestamp: {}\n\
             Thread: {}\n\
             Location: {}\n\
             Message: {}\n\
             \n\
             Backtrace:\n\
             {}\n\
             === END CRASH REPORT ===\n",
            timestamp, thread_name, location, message, backtrace
        );

        log_bridge::write_crash_report(&report);

        // Call the default hook so the panic still prints to stderr
        default_hook(info);
    }));

    // Global shutdown signal — created before Tauri builder so both setup and
    // the run-event handler can hold a reference.
    let (shutdown_tx, shutdown_rx) = tokio::sync::watch::channel(false);
    let shutdown_tx_for_exit = shutdown_tx.clone();

    let build_result = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            capture::read_clipboard,
            capture::read_clipboard_image,
            capture::get_clipboard_history,
            capture::remove_clipboard_entry,
            capture::snap_capture_window,
            capture::close_capture,
            connection_window::open_connection_window_cmd,
            config::get_backend_url,
        ])
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if let tauri_plugin_global_shortcut::ShortcutState::Pressed = event.state {
                        let focus: tauri_plugin_global_shortcut::Shortcut = match "CmdOrCtrl+B".parse() {
                            Ok(s) => s,
                            Err(e) => {
                                log::error!("[lexera.shortcut] Failed to parse CmdOrCtrl+B shortcut: {}", e);
                                return;
                            }
                        };
                        if *shortcut == focus {
                            capture::focus_capture_popup(app);
                        } else {
                            capture::capture_selection_and_open(app);
                        }
                    }
                })
                .build(),
        )
        .on_window_event(|_window, event| {
            // Prevent app exit when the last window closes (this is a tray-only app)
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .setup(move |app| {
            // Hide from Dock, show only as menu bar (tray) app
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let config_path = config::default_config_path();
            let config = config::load_config(&config_path);
            let port = config.port;
            let bind_address = config.bind_address.clone();
            let config = Arc::new(std::sync::Mutex::new(config));
            let local_user = config::load_or_create_identity();
            let identity_path = dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(config::CONFIG_DIR_NAME)
                .join(config::IDENTITY_FILENAME);

            if let Err(e) = tray::setup_tray(&app.handle().clone(), port) {
                log::error!(
                    target: "lexera.tray",
                    "Failed to create initial tray icon for configured port {}: {}",
                    port,
                    e
                );
            }

            // Initialize storage and load boards
            let storage = Arc::new(LocalStorage::new());
            let mut board_paths: Vec<(String, PathBuf)> = Vec::new();

            {
                let cfg = match config.lock() {
                    Ok(c) => c,
                    Err(e) => {
                        log::error!("[lexera.setup] Config mutex poisoned during board loading: {}", e);
                        return Ok(());
                    }
                };
                for entry in &cfg.boards {
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
            }

            // Resolve incoming config (map file path to board ID)
            let incoming = config.lock().ok().and_then(|cfg| cfg.incoming.clone()).and_then(|inc| {
                let inc_path = PathBuf::from(&inc.board);
                board_paths.iter().find(|(_, p)| {
                    let canonical_inc = std::fs::canonicalize(&inc_path).unwrap_or(inc_path.clone());
                    *p == canonical_inc
                }).map(|(id, _)| ResolvedIncoming {
                    board_id: id.clone(),
                    column: inc.column,
                })
            });

            // Register global shortcuts
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().register("CmdOrCtrl+Shift+C");
            let _ = app.global_shortcut().register("CmdOrCtrl+B");

            // Create file watcher
            let include_map = Arc::new(RwLock::new(IncludeMap::new()));
            let (event_tx, _event_rx) = tokio::sync::broadcast::channel::<BoardChangeEvent>(EVENT_CHANNEL_CAPACITY);

            let watcher_arc: Arc<std::sync::Mutex<Option<FileWatcher>>> = Arc::new(std::sync::Mutex::new(None));

            let watcher_result = FileWatcher::new(include_map.clone());

            if let Ok((mut watcher, _watcher_rx)) = watcher_result {
                // Watch all board files
                for (board_id, path) in &board_paths {
                    if let Err(e) = watcher.watch_board(board_id, path) {
                        log::warn!("[lexera.watcher] Failed to watch board {}: {}", board_id, e);
                    }
                }

                // Watch include files
                if let Some(storage_map) = storage.include_map() {
                    for path in storage_map.all_include_paths() {
                        if let Err(e) = watcher.watch_include(&path) {
                            log::warn!("[lexera.watcher] Failed to watch include {:?}: {}", path, e);
                        }
                    }
                } else {
                    log::error!("[lexera.watcher] Include map lock poisoned, skipping include watches");
                }

                // Subscribe before moving watcher into Arc
                let mut event_rx = watcher.event_sender().subscribe();

                // Store watcher in Arc for AppState access
                match watcher_arc.lock() {
                    Ok(mut guard) => *guard = Some(watcher),
                    Err(e) => {
                        log::error!("[lexera.watcher] Watcher mutex poisoned, cannot store file watcher: {}", e);
                    }
                }

                // Spawn event processing loop
                let storage_for_events = storage.clone();
                let event_tx_for_forward = event_tx.clone();
                let mut event_shutdown_rx = shutdown_rx.clone();

                tauri::async_runtime::spawn(async move {
                    loop {
                        tokio::select! {
                            result = event_rx.recv() => {
                                match result {
                                    Ok(event) => {
                                        // Check self-write before propagating
                                        match &event {
                                            BoardChangeEvent::MainFileChanged { board_id, .. } => {
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

                                        // Enrich MainFileChanged events with authoritative
                                        // backend-computed freshness data after reload.
                                        let event = match event {
                                            BoardChangeEvent::MainFileChanged { board_id, .. } => {
                                                let revision =
                                                    storage_for_events.get_board_revision_token(&board_id);
                                                let generation =
                                                    storage_for_events.get_board_generation(&board_id);
                                                log::info!(
                                                    "[lexera.events] Forwarding MainFileChanged board={} revision={:?} generation={:?}",
                                                    board_id,
                                                    revision,
                                                    generation
                                                );
                                                BoardChangeEvent::MainFileChanged {
                                                    revision,
                                                    generation,
                                                    writer_id: None,
                                                    board_id,
                                                }
                                            }
                                            other => other,
                                        };

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
                            _ = event_shutdown_rx.changed() => {
                                log::info!("[lexera.events] Shutdown signal received");
                                break;
                            }
                        }
                    }
                });
            } else if let Err(e) = watcher_result {
                log::warn!("[lexera.watcher] Failed to create file watcher: {}", e);
            }

            // Initialize collaboration services with persistence
            let collab_dir = dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(config::CONFIG_DIR_NAME)
                .join(config::COLLAB_DIR_NAME);
            if let Err(e) = std::fs::create_dir_all(&collab_dir) {
                log::error!("[collab] Failed to create collab dir {:?}: {}", collab_dir, e);
            }

            let auth_path = collab_dir.join("auth.json");
            let invites_path = collab_dir.join("invites.json");
            let public_rooms_path = collab_dir.join("public_rooms.json");

            let auth_service = Arc::new(std::sync::Mutex::new(
                crate::auth::AuthService::load_from_file(&auth_path).unwrap_or_else(|e| {
                    log::warn!("[collab] Failed to load auth state: {}, starting empty", e);
                    crate::auth::AuthService::new()
                }),
            ));
            let invite_service = Arc::new(std::sync::Mutex::new(
                crate::invite::InviteService::load_from_file(&invites_path).unwrap_or_else(|e| {
                    log::warn!("[collab] Failed to load invite state: {}, starting empty", e);
                    crate::invite::InviteService::new()
                }),
            ));
            let public_service = Arc::new(std::sync::Mutex::new(
                crate::public::PublicRoomService::load_from_file(&public_rooms_path).unwrap_or_else(|e| {
                    log::warn!("[collab] Failed to load public rooms state: {}, starting empty", e);
                    crate::public::PublicRoomService::new()
                }),
            ));

            // Bootstrap local user as owner of all boards
            {
                match auth_service.lock() {
                    Ok(mut auth) => {
                        auth.register_user(local_user.clone()).unwrap_or_else(|e| {
                            log::info!("[identity] User already registered: {}", e);
                        });
                        for (board_id, _) in &board_paths {
                            auth.add_to_room(board_id, &local_user.id, crate::auth::RoomRole::Owner, "local")
                                .unwrap_or_else(|e| {
                                    log::warn!("[identity] Failed to add owner to board {}: {}", board_id, e);
                                });
                        }
                    }
                    Err(e) => {
                        log::error!("[identity] Auth service unavailable during bootstrap: {}", e);
                    }
                }
            }

            // Start periodic cleanup for expired invites
            let invite_cleanup = invite_service.clone();
            let mut invite_shutdown_rx = shutdown_rx.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(INVITE_CLEANUP_INTERVAL_SECS));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            match invite_cleanup.lock() {
                                Ok(mut service) => {
                                    let count = service.cleanup_expired();
                                    if count > 0 {
                                        log::info!("[collab] Cleaned up {} expired invites", count);
                                    }
                                }
                                Err(e) => {
                                    log::error!("[collab] Invite cleanup skipped; service unavailable: {}", e);
                                }
                            }
                        }
                        _ = invite_shutdown_rx.changed() => {
                            log::info!("[collab] Invite cleanup shutting down");
                            break;
                        }
                    }
                }
            });

            // Start periodic save for collaboration services and config (every 60 seconds)
            let save_auth = auth_service.clone();
            let save_invite = invite_service.clone();
            let save_public = public_service.clone();
            let save_config_arc = config.clone();
            let save_config_path = config_path.clone();
            let save_dir = collab_dir.clone();
            let mut save_shutdown_rx = shutdown_rx.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(PERIODIC_SAVE_INTERVAL_SECS));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            if let Ok(cfg) = save_config_arc.lock() {
                                if let Err(e) = crate::config::save_config(&save_config_path, &cfg) {
                                    log::error!("[collab.save] Failed to save sync config: {}", e);
                                }
                            }
                            if let Ok(auth) = save_auth.lock() {
                                if let Err(e) = auth.save_to_file(&save_dir.join("auth.json")) {
                                    log::error!("[collab.save] Failed to save auth state: {}", e);
                                }
                            }
                            if let Ok(invite) = save_invite.lock() {
                                if let Err(e) = invite.save_to_file(&save_dir.join("invites.json")) {
                                    log::error!("[collab.save] Failed to save invite state: {}", e);
                                }
                            }
                            if let Ok(public) = save_public.lock() {
                                if let Err(e) = public.save_to_file(&save_dir.join("public_rooms.json")) {
                                    log::error!("[collab.save] Failed to save public rooms state: {}", e);
                                }
                            }
                        }
                        _ = save_shutdown_rx.changed() => {
                            // Final save before exiting
                            if let Ok(cfg) = save_config_arc.lock() {
                                let _ = crate::config::save_config(&save_config_path, &cfg);
                            }
                            if let Ok(auth) = save_auth.lock() {
                                let _ = auth.save_to_file(&save_dir.join("auth.json"));
                            }
                            if let Ok(invite) = save_invite.lock() {
                                let _ = invite.save_to_file(&save_dir.join("invites.json"));
                            }
                            if let Ok(public) = save_public.lock() {
                                let _ = public.save_to_file(&save_dir.join("public_rooms.json"));
                            }
                            log::info!("[collab.save] Final save completed, shutting down");
                            break;
                        }
                    }
                }
            });

            let sync_hub = Arc::new(tokio::sync::Mutex::new(crate::sync_ws::BoardSyncHub::new()));
            let sync_client = Arc::new(tokio::sync::Mutex::new(crate::sync_client::SyncClientManager::new()));
            let discovery = Arc::new(std::sync::Mutex::new(crate::discovery::DiscoveryService::new()));

            let app_handle = app.handle().clone();
            let discovery_bind = bind_address.clone();

            let live_port = Arc::new(std::sync::Mutex::new(port));
            let server_shutdown: Arc<std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>> =
                Arc::new(std::sync::Mutex::new(None));

            let app_state = AppState {
                storage: storage.clone(),
                event_tx: event_tx.clone(),
                port,
                bind_address,
                live_port: live_port.clone(),
                server_shutdown: server_shutdown.clone(),
                incoming,
                local_user_id: local_user.id.clone(),
                config_path: config_path.clone(),
                identity_path,
                config: config.clone(),
                watcher: watcher_arc,
                // Collaboration services
                invite_service,
                public_service,
                auth_service,
                sync_hub,
                sync_client,
                discovery: discovery.clone(),
                app_handle: Some(app_handle.clone()),
                collab_dir,
                shutdown_tx,
            };

            app.manage(app_state.clone());

            // Spawn HTTP server
            let discovery_for_start = discovery.clone();
            let discovery_user_id = local_user.id.clone();
            let discovery_user_name = local_user.name.clone();
            let event_tx_for_discovery = event_tx.clone();
            tauri::async_runtime::spawn(async move {
                match server::spawn_server(app_state).await {
                    Ok((actual_port, shutdown_tx)) => {
                        log::info!("Server started on port {}", actual_port);

                        // Store the shutdown handle and actual port
                        if let Ok(mut sh) = server_shutdown.lock() {
                            *sh = Some(shutdown_tx);
                        }
                        if let Ok(mut lp) = live_port.lock() {
                            *lp = actual_port;
                        }

                        // Set up tray with actual port (must run on main thread on macOS)
                        let tray_handle = app_handle.clone();
                        let _ = app_handle.run_on_main_thread(move || {
                            if let Err(e) = tray::setup_tray(&tray_handle, actual_port) {
                                log::error!(
                                    target: "lexera.tray",
                                    "Failed to update tray icon for live port {}: {}",
                                    actual_port,
                                    e
                                );
                            }
                        });

                        // Start UDP discovery if not localhost-only
                        if discovery_bind != config::DEFAULT_BIND_ADDRESS {
                            if let Ok(mut disc) = discovery_for_start.lock() {
                                disc.start(actual_port, discovery_user_id, discovery_user_name, event_tx_for_discovery);
                                log::info!("[discovery] Started LAN discovery");
                            }
                        } else {
                            log::info!("[discovery] Skipped (bind_address is localhost)");
                        }
                    }
                    Err(e) => log::error!("Failed to start server: {}", e),
                }
            });

            // Create shared clipboard history and start watcher
            let clipboard_history: capture::ClipboardHistory = Arc::new(std::sync::Mutex::new(Vec::new()));
            app.manage(clipboard_history.clone());

            let app_handle_for_watcher = app.handle().clone();
            let watcher_shutdown = clipboard_watcher::start_clipboard_watcher(&app_handle_for_watcher, clipboard_history);
            if watcher_shutdown.is_none() {
                log::warn!("[lexera.clipboard_watcher] Clipboard watcher disabled");
            }
            app.manage(std::sync::Mutex::new(watcher_shutdown));

            Ok(())
        })
        .build(tauri::generate_context!());

    match build_result {
        Ok(app) => {
            app.run(move |_app_handle, event| {
                if let tauri::RunEvent::Exit = event {
                    log::info!(
                        "[lexera.shutdown] Application exiting, cancelling background tasks"
                    );
                    let _ = shutdown_tx_for_exit.send(true);
                }
            });
        }
        Err(e) => {
            log::error!("error while running lexera-backend: {}", e);
        }
    }
}
