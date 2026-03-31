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
#[cfg(test)]
pub mod test_helpers;
mod tray;

// New collaboration modules
pub mod auth;
pub mod collab_api;
pub mod invite;
pub mod public;
pub mod sync_ws;

use crate::state::{AppState, ResolvedIncoming};
use lexera_core::panic_util::panic_payload_to_string;
use lexera_core::storage::local::LocalStorage;
use lexera_core::watcher::file_watcher::FileWatcher;
use lexera_core::watcher::types::BoardChangeEvent;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::Manager;
use uuid::Uuid;

/// Capacity of the board-change event broadcast channel.
const EVENT_CHANNEL_CAPACITY: usize = 4096;
/// Seconds between expired-invite cleanup runs.
const INVITE_CLEANUP_INTERVAL_SECS: u64 = 3600;
/// Seconds between periodic saves of collaboration state and config.
const PERIODIC_SAVE_INTERVAL_SECS: u64 = 60;

// ── Setup helper functions ─────────────────────────────────────────────────

/// Load boards from config into storage using parallel file I/O.
/// Returns `(board_id, canonical_path)` pairs.
fn init_storage_and_boards(
    storage: &LocalStorage,
    config: &std::sync::Mutex<config::SyncConfig>,
) -> Vec<(String, PathBuf)> {
    let board_entries: Vec<PathBuf> = match config.lock() {
        Ok(cfg) => cfg.boards.iter().map(|e| PathBuf::from(&e.file)).collect(),
        Err(e) => {
            log::error!(
                "[lexera.setup] Config mutex poisoned during board loading: {}",
                e
            );
            return Vec::new();
        }
    };

    if board_entries.is_empty() {
        return Vec::new();
    }

    let start = std::time::Instant::now();

    // Prepare all boards in parallel: file I/O, parsing, CRDT loading happen
    // concurrently across threads. The boards RwLock is NOT acquired here.
    let prepared: Vec<_> = std::thread::scope(|s| {
        let handles: Vec<_> = board_entries
            .iter()
            .map(|path| s.spawn(|| storage.prepare_board_state(path)))
            .collect();

        handles
            .into_iter()
            .enumerate()
            .filter_map(|(i, h)| match h.join() {
                Ok(Ok(pair)) => {
                    log::info!("Loaded board: {} -> {}", board_entries[i].display(), pair.0);
                    Some(pair)
                }
                Ok(Err(e)) => {
                    log::warn!("Failed to load board {}: {}", board_entries[i].display(), e);
                    None
                }
                Err(payload) => {
                    log::error!(
                        "Board loading thread panicked for {}: {}",
                        board_entries[i].display(),
                        lexera_core::panic_util::panic_payload_to_string(&*payload)
                    );
                    None
                }
            })
            .collect()
    });

    // Collect canonical paths before batch insert (need file_path from state)
    let board_paths: Vec<(String, PathBuf)> = prepared
        .iter()
        .map(|(id, state)| (id.clone(), state.file_path.clone()))
        .collect();

    // Single write-lock acquisition for all boards
    if let Err(e) = storage.batch_add_boards(prepared) {
        log::error!("[lexera.setup] Failed to batch-insert boards: {}", e);
        return Vec::new();
    }

    log::info!(
        "[lexera.setup] Loaded {} board(s) in {:.1}ms (parallel)",
        board_paths.len(),
        start.elapsed().as_secs_f64() * 1000.0
    );

    board_paths
}

pub(crate) fn sync_watcher_include_paths(
    storage: &LocalStorage,
    watcher: &mut FileWatcher,
    target: &str,
) {
    let Some(include_map) = storage.include_map() else {
        log::error!(
            "[{}] Include map lock poisoned, skipping include watch sync",
            target
        );
        return;
    };

    let desired = include_map.all_include_paths();
    match watcher.sync_include_paths(&desired) {
        Ok(count) => {
            if count > 0 {
                log::info!(
                    "[{}] Synced include watch paths: {} new path(s) watched",
                    target,
                    count
                );
            }
        }
        Err(error) => {
            log::warn!(
                "[{}] Failed to sync include watch paths: {}",
                target,
                error
            );
        }
    }
}

/// Resolve the incoming config (map file path to board ID).
fn resolve_incoming(
    config: &std::sync::Mutex<config::SyncConfig>,
    board_paths: &[(String, PathBuf)],
) -> Option<ResolvedIncoming> {
    config.lock().ok()?.incoming.clone().and_then(|inc| {
        let inc_path = PathBuf::from(&inc.board);
        board_paths
            .iter()
            .find(|(_, p)| {
                let canonical_inc = std::fs::canonicalize(&inc_path).unwrap_or(inc_path.clone());
                *p == canonical_inc
            })
            .map(|(id, _)| ResolvedIncoming {
                board_id: id.clone(),
                column: inc.column,
            })
    })
}

/// Create file watcher, watch boards/includes, and spawn the event processing loop.
fn setup_file_watcher(
    storage: &Arc<LocalStorage>,
    board_paths: &[(String, PathBuf)],
    event_tx: &tokio::sync::broadcast::Sender<BoardChangeEvent>,
    shutdown_rx: &tokio::sync::watch::Receiver<bool>,
) -> Arc<std::sync::Mutex<Option<FileWatcher>>> {
    let watcher_arc: Arc<std::sync::Mutex<Option<FileWatcher>>> =
        Arc::new(std::sync::Mutex::new(None));

    let watcher_result = FileWatcher::new(storage.include_map_handle());
    if let Ok((mut watcher, _watcher_rx)) = watcher_result {
        for (board_id, path) in board_paths {
            if let Err(e) = watcher.watch_board(board_id, path) {
                log::warn!("[lexera.watcher] Failed to watch board {}: {}", board_id, e);
            }
        }
        sync_watcher_include_paths(storage.as_ref(), &mut watcher, "lexera.watcher");

        let mut event_rx = watcher.event_sender().subscribe();
        match watcher_arc.lock() {
            Ok(mut guard) => *guard = Some(watcher),
            Err(e) => {
                log::error!(
                    "[lexera.watcher] Watcher mutex poisoned, cannot store file watcher: {}",
                    e
                );
            }
        }

        let storage_for_events = storage.clone();
        let event_tx_for_forward = event_tx.clone();
        let mut event_shutdown_rx = shutdown_rx.clone();
        let watcher_for_events = watcher_arc.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                tokio::select! {
                    result = event_rx.recv() => {
                        match result {
                            Ok(event) => {
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
                                        } else if let Ok(mut watcher_guard) = watcher_for_events.lock() {
                                            if let Some(ref mut watcher) = *watcher_guard {
                                                sync_watcher_include_paths(
                                                    storage_for_events.as_ref(),
                                                    watcher,
                                                    "lexera.events",
                                                );
                                            }
                                        }
                                    }
                                    BoardChangeEvent::IncludeFileChanged { board_ids, include_path } => {
                                        if storage_for_events.check_self_write(include_path) {
                                            log::info!("[lexera.events] Suppressed self-write for include {:?}", include_path);
                                            continue;
                                        }
                                        for bid in board_ids {
                                            match storage_for_events.reload_board_include_path(bid, include_path) {
                                                Ok(true) => {
                                                    log::info!(
                                                        "[lexera.events] Refreshed include {:?} for board {} without full board reload",
                                                        include_path,
                                                        bid
                                                    );
                                                }
                                                Ok(false) => {}
                                                Err(e) => {
                                                    log::warn!(
                                                        "[lexera.events] Failed to refresh include {:?} for board {}: {}",
                                                        include_path,
                                                        bid,
                                                        e
                                                    );
                                                }
                                            }
                                        }
                                        if let Ok(mut watcher_guard) = watcher_for_events.lock() {
                                            if let Some(ref mut watcher) = *watcher_guard {
                                                sync_watcher_include_paths(
                                                    storage_for_events.as_ref(),
                                                    watcher,
                                                    "lexera.events",
                                                );
                                            }
                                        }
                                    }
                                    _ => {}
                                }

                                let event = match event {
                                    BoardChangeEvent::MainFileChanged { board_id, .. } => {
                                        let revision = storage_for_events.get_board_revision_token(&board_id);
                                        let generation = storage_for_events.get_board_generation(&board_id);
                                        log::info!(
                                            "[lexera.events] Forwarding MainFileChanged board={} revision={:?} generation={:?}",
                                            board_id, revision, generation
                                        );
                                        BoardChangeEvent::MainFileChanged {
                                            revision, generation, writer_id: None, board_id,
                                        }
                                    }
                                    other => other,
                                };
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

    watcher_arc
}

/// Collaboration services container returned by `init_collab_services`.
struct CollabServices {
    auth_service: Arc<std::sync::Mutex<crate::auth::AuthService>>,
    invite_service: Arc<std::sync::Mutex<crate::invite::InviteService>>,
    public_service: Arc<std::sync::Mutex<crate::public::PublicRoomService>>,
}

/// Initialize collaboration services from persisted state on disk.
fn init_collab_services(collab_dir: &std::path::Path) -> CollabServices {
    if let Err(e) = std::fs::create_dir_all(collab_dir) {
        log::error!(
            "[collab] Failed to create collab dir {:?}: {}",
            collab_dir,
            e
        );
    }

    let auth_service = Arc::new(std::sync::Mutex::new(
        crate::auth::AuthService::load_from_file(&collab_dir.join("auth.json")).unwrap_or_else(
            |e| {
                log::warn!("[collab] Failed to load auth state: {}, starting empty", e);
                crate::auth::AuthService::new()
            },
        ),
    ));
    let invite_service = Arc::new(std::sync::Mutex::new(
        crate::invite::InviteService::load_from_file(&collab_dir.join("invites.json"))
            .unwrap_or_else(|e| {
                log::warn!(
                    "[collab] Failed to load invite state: {}, starting empty",
                    e
                );
                crate::invite::InviteService::new()
            }),
    ));
    let public_service = Arc::new(std::sync::Mutex::new(
        crate::public::PublicRoomService::load_from_file(&collab_dir.join("public_rooms.json"))
            .unwrap_or_else(|e| {
                log::warn!(
                    "[collab] Failed to load public rooms state: {}, starting empty",
                    e
                );
                crate::public::PublicRoomService::new()
            }),
    ));

    CollabServices {
        auth_service,
        invite_service,
        public_service,
    }
}

/// Register the local user as owner of all boards, ensuring they have a token.
fn bootstrap_local_user(
    auth_service: &std::sync::Mutex<crate::auth::AuthService>,
    local_user: &crate::auth::User,
    board_paths: &[(String, PathBuf)],
    collab_dir: &std::path::Path,
) {
    match auth_service.lock() {
        Ok(mut auth) => {
            match auth.register_user(local_user.clone()) {
                Ok(token) => {
                    log::info!("[identity] Local user registered, token: {}…", &token[..8]);
                }
                Err(_) => {
                    if auth.get_token_for_user(&local_user.id).is_none() {
                        match auth.generate_token_for_user(&local_user.id) {
                            Ok(token) => {
                                log::info!(
                                    "[identity] Generated token for existing user: {}…",
                                    &token[..8]
                                );
                            }
                            Err(e) => {
                                log::error!("[identity] Failed to generate token: {}", e);
                            }
                        }
                    }
                }
            }
            for (board_id, _) in board_paths {
                auth.add_to_room(
                    board_id,
                    &local_user.id,
                    crate::auth::RoomRole::Owner,
                    "local",
                )
                .unwrap_or_else(|e| {
                    log::warn!(
                        "[identity] Failed to add owner to board {}: {}",
                        board_id,
                        e
                    );
                });
            }
        }
        Err(e) => {
            log::error!(
                "[identity] Auth service unavailable during bootstrap: {}",
                e
            );
        }
    }
    // Persist auth state immediately (token must survive a crash before periodic save)
    if let Ok(auth) = auth_service.lock() {
        if let Err(e) = auth.save_to_file(&collab_dir.join("auth.json")) {
            log::error!(
                "[identity] Failed to save auth state after bootstrap: {}",
                e
            );
        }
    }
}

/// Spawn the invite cleanup and periodic save background tasks.
fn spawn_background_tasks(
    invite_service: &Arc<std::sync::Mutex<crate::invite::InviteService>>,
    auth_service: &Arc<std::sync::Mutex<crate::auth::AuthService>>,
    public_service: &Arc<std::sync::Mutex<crate::public::PublicRoomService>>,
    config: &Arc<std::sync::Mutex<config::SyncConfig>>,
    config_path: &std::path::Path,
    collab_dir: &std::path::Path,
    shutdown_rx: &tokio::sync::watch::Receiver<bool>,
) {
    // Invite cleanup loop
    let invite_cleanup = invite_service.clone();
    let mut invite_shutdown_rx = shutdown_rx.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            INVITE_CLEANUP_INTERVAL_SECS,
        ));
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

    // Periodic save loop
    let save_auth = auth_service.clone();
    let save_invite = invite_service.clone();
    let save_public = public_service.clone();
    let save_config_arc = config.clone();
    let save_config_path = config_path.to_path_buf();
    let save_dir = collab_dir.to_path_buf();
    let mut save_shutdown_rx = shutdown_rx.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(
            PERIODIC_SAVE_INTERVAL_SECS,
        ));
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
}

/// Restore persisted remote connections from config.
fn restore_persisted_connections(
    config: &Arc<std::sync::Mutex<config::SyncConfig>>,
    app_state: &AppState,
    local_user_id: &str,
    local_user_name: &str,
) {
    let persisted = match config.lock() {
        Ok(cfg) => cfg.remote_connections.clone(),
        Err(e) => {
            log::error!(
                "[sync_client.restore] Failed to read persisted remote connections: {}",
                e
            );
            return;
        }
    };
    if persisted.is_empty() {
        return;
    }

    let restore_state = app_state.clone();
    let restore_user_id = local_user_id.to_string();
    let restore_user_name = local_user_name.to_string();
    tauri::async_runtime::spawn(async move {
        log::info!(
            "[sync_client.restore] Restoring {} persisted remote connection(s)",
            persisted.len()
        );
        for entry in persisted {
            if !entry.enabled {
                log::info!(
                    "[sync_client.restore] Skipping disabled connection local_board_id={} server={}",
                    entry.local_board_id, entry.server_url
                );
                continue;
            }
            let remote_board_id = if entry.remote_board_id.trim().is_empty() {
                entry
                    .local_board_id
                    .strip_prefix("remote-")
                    .unwrap_or(entry.local_board_id.as_str())
                    .to_string()
            } else {
                entry.remote_board_id.clone()
            };
            if remote_board_id.trim().is_empty() {
                log::error!(
                    "[sync_client.restore] Skipping connection with empty remote board id local_board_id={} server={}",
                    entry.local_board_id, entry.server_url
                );
                continue;
            }

            let final_result = {
                let client = restore_state.sync_client.lock().await;
                if client.is_connected(&entry.local_board_id) {
                    Ok(entry.local_board_id.clone())
                } else {
                    drop(client);
                    match crate::sync_client::SyncClientManager::prepare_existing_connection(
                        entry.server_url.clone(),
                        remote_board_id.clone(),
                        restore_user_id.clone(),
                        restore_user_name.clone(),
                        entry.auth_token.clone(),
                        restore_state.storage.clone(),
                    )
                    .await
                    {
                        Ok(pending) => {
                            let local_board_id = pending.local_board_id.clone();
                            let mut client = restore_state.sync_client.lock().await;
                            client.register_prepared_connection(
                                pending,
                                restore_state.storage.clone(),
                                restore_state.event_tx.clone(),
                                restore_state.sync_hub.clone(),
                            );
                            Ok(local_board_id)
                        }
                        Err(primary_error) => {
                            if let Some(token) = entry.invite_token.clone() {
                                log::warn!(
                                    "[sync_client.restore] Reconnect failed for {} ({}): {}. Retrying with invite token.",
                                    entry.local_board_id, entry.server_url, primary_error
                                );
                                match crate::sync_client::SyncClientManager::prepare_invite_connection(
                                    entry.server_url.clone(),
                                    token,
                                    restore_user_id.clone(),
                                    restore_user_name.clone(),
                                    restore_state.storage.clone(),
                                )
                                .await
                                {
                                    Ok(pending) => {
                                        let local_board_id = pending.local_board_id.clone();
                                        let mut client = restore_state.sync_client.lock().await;
                                        client.register_prepared_connection(
                                            pending,
                                            restore_state.storage.clone(),
                                            restore_state.event_tx.clone(),
                                            restore_state.sync_hub.clone(),
                                        );
                                        Ok(local_board_id)
                                    }
                                    Err(error) => Err(error),
                                }
                            } else {
                                Err(primary_error)
                            }
                        }
                    }
                }
            };

            match final_result {
                Ok(local_board_id) => {
                    log::info!(
                        "[sync_client.restore] Restored connection local_board_id={} remote={} server={}",
                        local_board_id, remote_board_id, entry.server_url
                    );
                    let _ = restore_state
                        .event_tx
                        .send(BoardChangeEvent::CollabConnectionChanged);
                }
                Err(error) => {
                    log::error!(
                        "[sync_client.restore] Failed to restore connection local_board_id={} remote={} server={}: {}",
                        entry.local_board_id, remote_board_id, entry.server_url, error
                    );
                }
            }
        }
    });
}

/// Spawn the HTTP server and start LAN discovery if not localhost-only.
fn spawn_http_server(
    app_state: AppState,
    server_shutdown: Arc<std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>>,
    live_port: Arc<std::sync::Mutex<u16>>,
    discovery: Arc<std::sync::Mutex<crate::discovery::DiscoveryService>>,
    app_handle: tauri::AppHandle,
    bind_address: &str,
    local_user_id: &str,
    local_user_name: &str,
    event_tx: &tokio::sync::broadcast::Sender<BoardChangeEvent>,
) {
    let discovery_bind = bind_address.to_string();
    let discovery_user_id = local_user_id.to_string();
    let discovery_user_name = local_user_name.to_string();
    let event_tx_for_discovery = event_tx.clone();
    tauri::async_runtime::spawn(async move {
        match server::spawn_server(app_state).await {
            Ok((actual_port, shutdown_tx)) => {
                log::info!("Server started on port {}", actual_port);
                if let Ok(mut sh) = server_shutdown.lock() {
                    *sh = Some(shutdown_tx);
                }
                if let Ok(mut lp) = live_port.lock() {
                    *lp = actual_port;
                }

                let tray_handle = app_handle.clone();
                let _ = app_handle.run_on_main_thread(move || {
                    if let Err(e) = tray::setup_tray(&tray_handle, actual_port) {
                        log::error!(target: "lexera.tray", "Failed to update tray for port {}: {}", actual_port, e);
                    }
                });

                if discovery_bind != config::DEFAULT_BIND_ADDRESS {
                    if let Ok(mut disc) = discovery.lock() {
                        disc.start(
                            actual_port,
                            discovery_user_id,
                            discovery_user_name,
                            event_tx_for_discovery,
                        );
                        log::info!("[discovery] Started LAN discovery");
                    }
                } else {
                    log::info!("[discovery] Skipped (bind_address is localhost)");
                }
            }
            Err(e) => log::error!("Failed to start server: {}", e),
        }
    });
}

fn format_recent_backend_log_tail(limit: usize) -> String {
    let entries = log_bridge::recent_entries();
    if entries.is_empty() {
        return "  <no recent backend log entries available>\n".to_string();
    }

    let start = entries.len().saturating_sub(limit);
    let mut out = String::new();
    for entry in &entries[start..] {
        out.push_str(&format!(
            "  {} [{}] [{}] {}\n",
            entry.timestamp_ms, entry.level, entry.target, entry.message
        ));
    }
    out
}

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
        let crash_id = Uuid::new_v4().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");
        let thread_id = format!("{:?}", thread.id());
        let process_id = std::process::id();

        let message = panic_payload_to_string(info.payload());

        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());

        let backtrace = std::backtrace::Backtrace::force_capture();
        let recent_logs = format_recent_backend_log_tail(100);

        let report = format!(
            "=== CRASH REPORT ===\n\
             CrashId: {}\n\
             Timestamp: {}\n\
             ProcessId: {}\n\
             Thread: {}\n\
             ThreadId: {}\n\
             Package: {} {}\n\
             Location: {}\n\
             Message: {}\n\
             \n\
             RecentBackendLogs:\n\
             {}\n\
             \
             Backtrace:\n\
             {}\n\
             === END CRASH REPORT ===\n",
            crash_id,
            timestamp,
            process_id,
            thread_name,
            thread_id,
            env!("CARGO_PKG_NAME"),
            env!("CARGO_PKG_VERSION"),
            location,
            message,
            recent_logs,
            backtrace
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
            capture::read_clipboard_summary,
            capture::read_clipboard_image,
            capture::get_clipboard_history,
            capture::remove_clipboard_entry,
            capture::snap_capture_window,
            capture::expand_capture,
            capture::collapse_capture,
            capture::snap_strip_after_drag,
            capture::close_capture,
            connection_window::open_connection_window_cmd,
            config::get_backend_url,
            config::browse_files,
        ])
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if let tauri_plugin_global_shortcut::ShortcutState::Pressed = event.state {
                        let focus: tauri_plugin_global_shortcut::Shortcut =
                            match "CmdOrCtrl+B".parse() {
                                Ok(s) => s,
                                Err(e) => {
                                    log::error!(
                                    "[lexera.shortcut] Failed to parse CmdOrCtrl+B shortcut: {}",
                                    e
                                );
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
            // Collapse quick-capture window immediately when it loses focus.
            // The JS blur handler is unreliable for borderless always-on-top
            // windows on macOS, so we handle it at the native Tauri level.
            if let tauri::WindowEvent::Focused(false) = event {
                if _window.label() == "quick-capture" {
                    let app = _window.app_handle().clone();
                    let _ = capture::collapse_capture(app);
                }
            }
        })
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // ── Config & identity ──────────────────────────────────────────
            let config_path = config::default_config_path();
            let mut config = config::load_config(&config_path);
            config::ensure_default_workspace(&mut config, &config_path);
            let port = config.port;
            let bind_address = config.bind_address.clone();
            let config = Arc::new(std::sync::Mutex::new(config));
            let local_user = config::load_or_create_identity();
            let identity_path = dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(config::CONFIG_DIR_NAME)
                .join(config::IDENTITY_FILENAME);

            if let Err(e) = tray::setup_tray(&app.handle().clone(), port) {
                log::error!(target: "lexera.tray", "Failed to create initial tray: {}", e);
            }

            // ── Storage & boards ───────────────────────────────────────────
            let storage = Arc::new(LocalStorage::new());
            let board_paths = init_storage_and_boards(&storage, &config);
            let incoming = resolve_incoming(&config, &board_paths);

            // ── Global shortcuts ───────────────────────────────────────────
            use tauri_plugin_global_shortcut::GlobalShortcutExt;
            let _ = app.global_shortcut().register("CmdOrCtrl+Shift+C");
            let _ = app.global_shortcut().register("CmdOrCtrl+B");

            // ── File watcher ───────────────────────────────────────────────
            let (event_tx, _event_rx) =
                tokio::sync::broadcast::channel::<BoardChangeEvent>(EVENT_CHANNEL_CAPACITY);
            let watcher_arc = setup_file_watcher(&storage, &board_paths, &event_tx, &shutdown_rx);

            // ── Collaboration services ─────────────────────────────────────
            let collab_dir = dirs::config_dir()
                .unwrap_or_else(|| PathBuf::from("."))
                .join(config::CONFIG_DIR_NAME)
                .join(config::COLLAB_DIR_NAME);
            let collab = init_collab_services(&collab_dir);
            bootstrap_local_user(&collab.auth_service, &local_user, &board_paths, &collab_dir);

            // ── Background tasks ───────────────────────────────────────────
            spawn_background_tasks(
                &collab.invite_service,
                &collab.auth_service,
                &collab.public_service,
                &config,
                &config_path,
                &collab_dir,
                &shutdown_rx,
            );

            // ── App state ──────────────────────────────────────────────────
            let sync_hub = Arc::new(tokio::sync::Mutex::new(crate::sync_ws::BoardSyncHub::new()));
            let sync_client = Arc::new(tokio::sync::Mutex::new(
                crate::sync_client::SyncClientManager::new(),
            ));
            let discovery = Arc::new(std::sync::Mutex::new(
                crate::discovery::DiscoveryService::new(),
            ));
            let app_handle = app.handle().clone();
            let live_port = Arc::new(std::sync::Mutex::new(port));
            let server_shutdown: Arc<std::sync::Mutex<Option<tokio::sync::watch::Sender<bool>>>> =
                Arc::new(std::sync::Mutex::new(None));

            let app_state = AppState {
                storage: storage.clone(),
                event_tx: event_tx.clone(),
                port,
                bind_address: bind_address.clone(),
                live_port: live_port.clone(),
                server_shutdown: server_shutdown.clone(),
                incoming,
                local_user_id: local_user.id.clone(),
                config_path: config_path.clone(),
                identity_path,
                config: config.clone(),
                watcher: watcher_arc,
                invite_service: collab.invite_service,
                public_service: collab.public_service,
                auth_service: collab.auth_service,
                sync_hub,
                sync_client,
                discovery: discovery.clone(),
                app_handle: Some(app_handle.clone()),
                clipboard_history: None,
                collab_dir,
                shutdown_tx,
                file_search_cache: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            };

            app.manage(app_state.clone());

            // ── Restore persisted connections ───────────────────────────────
            restore_persisted_connections(&config, &app_state, &local_user.id, &local_user.name);

            // ── HTTP server & discovery ─────────────────────────────────────
            spawn_http_server(
                app_state,
                server_shutdown,
                live_port,
                discovery,
                app_handle,
                &bind_address,
                &local_user.id,
                &local_user.name,
                &event_tx,
            );

            // ── Clipboard watcher ──────────────────────────────────────────
            let clipboard_history: capture::ClipboardHistory =
                Arc::new(std::sync::Mutex::new(Vec::new()));
            app.manage(clipboard_history.clone());
            let app_handle_for_watcher = app.handle().clone();
            let watcher_shutdown = clipboard_watcher::start_clipboard_watcher(
                &app_handle_for_watcher,
                clipboard_history,
            );
            if watcher_shutdown.is_none() {
                log::warn!("[lexera.clipboard_watcher] Clipboard watcher disabled");
            }
            app.manage(std::sync::Mutex::new(watcher_shutdown));

            capture::open_capture_popup(app.handle());

            // Periodically validate quick-capture position (catches display changes)
            let app_handle_for_capture = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(10));
                capture::validate_capture_position(&app_handle_for_capture);
            });

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
