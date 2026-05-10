#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_menu;
mod asset_protocol;
mod backend_status;
mod commands;
mod drag_coordinator;
mod export_commands;
mod ipc_client;
mod ipc_commands;
mod ipc_streams;
mod webview_mgr;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewUrl};

static WINDOW_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

/// Most-recently-focused window label. Updated by the window
/// `Focused(true)` event. Read by the native menu handler — on macOS
/// the menu briefly steals focus while a menu item is being clicked,
/// so `WebviewWindow::is_focused()` returns false for every window
/// during the menu event. This tracker preserves "the window the user
/// just clicked from" so menu actions like `open-workspace:<id>`
/// route correctly.
static LAST_FOCUSED_WINDOW: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

/// Tracks whether the user explicitly requested to quit the app
/// (via Cmd+Q / File > Quit, which routes to `quit_app`). Closing
/// the last window does NOT set this flag — the `ExitRequested`
/// handler then prevents the exit so the app stays alive without
/// any windows. The user can then re-open via the menu bar (macOS)
/// or the system tray / dock.
pub static USER_REQUESTED_QUIT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// CLI-derived test-runner config, populated once in `main()` and
/// exposed to the frontend via the `get_test_runner_config` command.
/// Pull-based delivery sidesteps timing races between Tauri's
/// `on_page_load` hook (which fires AFTER scripts have already run)
/// and the frontend test harness's IIFE initialization.
#[derive(serde::Serialize, Default, Clone)]
struct TestRunnerConfig {
    auto_run: bool,
    delay_ms: u64,
    output_path: Option<String>,
    quit_after: bool,
    board: Option<String>,
    filter: Option<String>,
    include_fixture_path: Option<String>,
}

static TEST_RUNNER_CONFIG: std::sync::OnceLock<TestRunnerConfig> = std::sync::OnceLock::new();

#[tauri::command]
fn get_test_runner_config() -> TestRunnerConfig {
    TEST_RUNNER_CONFIG.get().cloned().unwrap_or_default()
}

#[tauri::command]
fn open_new_window(
    app: tauri::AppHandle,
    board_id: Option<String>,
    view_kind: Option<String>,
    profile: Option<String>,
    panel_kind: Option<String>,
    initial_panel: Option<String>,
    window_role: Option<String>,
    width: Option<f64>,
    height: Option<f64>,
    workspace_id: Option<String>,
    origin_window: Option<String>,
) -> Result<String, String> {
    let n = WINDOW_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = format!("kanban-{}", n);

    let mut url_str = String::from("index.html");
    let mut query_started = false;
    if let Some(ref bid) = board_id {
        url_str.push_str("?board=");
        url_str.push_str(bid);
        query_started = true;
    }
    if let Some(ref view) = view_kind {
        url_str.push_str(if query_started { "&view=" } else { "?view=" });
        url_str.push_str(view);
        query_started = true;
    }
    if let Some(ref window_profile) = profile {
        url_str.push_str(if query_started { "&profile=" } else { "?profile=" });
        url_str.push_str(window_profile);
        query_started = true;
    }
    if let Some(ref panel) = panel_kind {
        url_str.push_str(if query_started { "&panelKind=" } else { "?panelKind=" });
        url_str.push_str(panel);
        query_started = true;
    }
    if let Some(ref panel) = initial_panel {
        url_str.push_str(if query_started { "&initialPanel=" } else { "?initialPanel=" });
        url_str.push_str(panel);
        query_started = true;
    }
    if let Some(ref role) = window_role {
        url_str.push_str(if query_started { "&windowRole=" } else { "?windowRole=" });
        url_str.push_str(role);
        query_started = true;
    }
    // workspace_id locks the new window to a single workspace — the
    // frontend reads `urlParams.get('workspace')` at boot and uses it
    // as the workspace filter for the entire session of that window.
    // This implements "one workspace per window": the user picks
    // "Open" on a workspace dropdown, we open a fresh window for it,
    // and the existing window stays on its current workspace.
    if let Some(ref ws) = workspace_id {
        url_str.push_str(if query_started { "&workspace=" } else { "?workspace=" });
        url_str.push_str(ws);
        query_started = true;
    }
    // origin_window: which window spawned this one. Panel-only
    // windows use it on dock-back so their `Dock` button targets the
    // originator with `multiview_emit_to(origin_window, ...)` instead
    // of broadcasting `menu-action: reveal-panel:<kind>` to every
    // open workspace window.
    if let Some(ref origin) = origin_window {
        url_str.push_str(if query_started { "&originWindow=" } else { "?originWindow=" });
        url_str.push_str(origin);
        query_started = true;
    }
    url_str.push_str(if query_started { "&windowLabel=" } else { "?windowLabel=" });
    url_str.push_str(&label);
    let url = WebviewUrl::App(url_str.into());

    let mut builder = tauri::WebviewWindowBuilder::new(&app, &label, url);
    let inner_width = width.unwrap_or(1200.0).max(360.0);
    let inner_height = height.unwrap_or(800.0).max(260.0);

    builder = builder
        .title("Lexera Kanban")
        .inner_size(inner_width, inner_height)
        .min_inner_size(600.0, 400.0)
        .resizable(true);

    if panel_kind.is_some() || initial_panel.is_some() {
        builder = builder.min_inner_size(320.0, 220.0);
    }

    builder.build()
        .map_err(|e| format!("Failed to create window: {}", e))?;

    Ok(label)
}

fn write_kanban_crash_report(report: &str) {
    let crash_path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lexera")
        .join("logs")
        .join("kanban-crash.log");
    if let Some(parent) = crash_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&crash_path)
    {
        let _ = file.write_all(report.as_bytes());
        let _ = file.write_all(b"\n");
        let _ = file.flush();
        let _ = file.sync_all();
    }
}

fn install_panic_hook() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("<unnamed>");
        let thread_id = format!("{:?}", thread.id());
        let process_id = std::process::id();
        let location = info
            .location()
            .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
            .unwrap_or_else(|| "unknown location".to_string());
        let message = if let Some(s) = info.payload().downcast_ref::<&str>() {
            (*s).to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic payload".to_string()
        };
        let backtrace = std::backtrace::Backtrace::force_capture();
        let report = format!(
            "=== KANBAN CRASH REPORT ===\n\
             Timestamp: {}\n\
             ProcessId: {}\n\
             Thread: {}\n\
             ThreadId: {}\n\
             Package: {} {}\n\
             Location: {}\n\
             Message: {}\n\
             \n\
             Backtrace:\n\
             {}\n\
             === END KANBAN CRASH REPORT ===\n",
            timestamp,
            process_id,
            thread_name,
            thread_id,
            env!("CARGO_PKG_NAME"),
            env!("CARGO_PKG_VERSION"),
            location,
            message,
            backtrace
        );
        write_kanban_crash_report(&report);
        default_hook(info);
    }));
}

/// Snap the window to the nearest screen edge if it's within a threshold distance.
fn snap_window_to_edges(window: &tauri::Window) {
    use tauri::PhysicalPosition;

    const SNAP_THRESHOLD: i32 = 20; // pixels

    let Ok(win_pos) = window.outer_position() else { return };
    let Ok(win_size) = window.outer_size() else { return };
    let Some(monitor) = window.current_monitor().ok().flatten() else { return };

    let mon_pos = monitor.position();
    let mon_size = monitor.size();

    let mut x = win_pos.x;
    let mut y = win_pos.y;
    let mut snapped = false;

    // Left edge
    let dist_left = (x - mon_pos.x).abs();
    if dist_left > 0 && dist_left <= SNAP_THRESHOLD {
        x = mon_pos.x;
        snapped = true;
    }

    // Top edge
    let dist_top = (y - mon_pos.y).abs();
    if dist_top > 0 && dist_top <= SNAP_THRESHOLD {
        y = mon_pos.y;
        snapped = true;
    }

    // Right edge
    let win_right = x + win_size.width as i32;
    let mon_right = mon_pos.x + mon_size.width as i32;
    let dist_right = (win_right - mon_right).abs();
    if dist_right > 0 && dist_right <= SNAP_THRESHOLD {
        x = mon_right - win_size.width as i32;
        snapped = true;
    }

    // Bottom edge
    let win_bottom = y + win_size.height as i32;
    let mon_bottom = mon_pos.y + mon_size.height as i32;
    let dist_bottom = (win_bottom - mon_bottom).abs();
    if dist_bottom > 0 && dist_bottom <= SNAP_THRESHOLD {
        y = mon_bottom - win_size.height as i32;
        snapped = true;
    }

    if snapped {
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
}

fn main() {
    install_panic_hook();

    // Parse CLI flags.
    //   --run-tests             Auto-run the frontend test suite a few
    //                            seconds after the window loads. Used to
    //                            iterate on test failures without clicking
    //                            through the test panel UI every time.
    //   --run-tests-delay=N      Override the delay before the tests start
    //                            (milliseconds). Defaults to 10000.
    //   --run-tests-output=PATH  After the run completes, write the full
    //                            result text (same format as the test
    //                            panel's "Copy" button, `all` scope) to
    //                            PATH. The file can be tailed by a parent
    //                            process to observe results headlessly.
    //   --quit-after-tests       Exit the process once the run completes
    //                            and the output file (if any) has been
    //                            flushed. Pair with --run-tests-output so
    //                            a parent script knows when to proceed.
    //   --run-tests-board=ID     Pre-seed the test harness's board
    //                            selector with this board id so
    //                            `ensureSelectedBoardLoaded()` loads it
    //                            before the first test runs. Without
    //                            this, auto-run depends on whatever
    //                            board localStorage happens to have.
    //   --run-tests-filter=TEXT  Run only tests whose names contain
    //                            TEXT. Used for focused frontend
    //                            regression passes.
    let args: Vec<String> = std::env::args().collect();
    let auto_run_tests = args.iter().any(|a| a == "--run-tests");
    let auto_run_delay_ms: u64 = args
        .iter()
        .find_map(|a| a.strip_prefix("--run-tests-delay="))
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(10_000);
    let auto_run_output_path: Option<String> = args
        .iter()
        .find_map(|a| a.strip_prefix("--run-tests-output=").map(|v| v.to_string()));
    let quit_after_tests = args.iter().any(|a| a == "--quit-after-tests");
    let auto_run_board: Option<String> = args
        .iter()
        .find_map(|a| a.strip_prefix("--run-tests-board=").map(|v| v.to_string()));
    let auto_run_filter: Option<String> = args
        .iter()
        .find_map(|a| a.strip_prefix("--run-tests-filter=").map(|v| v.to_string()));
    // `--debug` opens a separate top-level webview window after the
    // main shell finishes booting. The window hosts on-demand
    // diagnostics (toggle child-webview overlays, dump dock state,
    // launch the frontend-tests view) — see `lexera-kanban/src/views/debug/`.
    // Cheap to ignore when not in use; nothing routes to that window
    // unless the user explicitly clicks one of its buttons.
    let open_debug_window = args.iter().any(|a| a == "--debug");
    let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let include_fixture_path = repo_root
        .join("tests")
        .join("kanban-include-tests")
        .join("root")
        .join("root-include-1.md")
        .to_string_lossy()
        .to_string();

    // Publish the parsed config so the frontend can pull it via
    // `get_test_runner_config`. Once set, `.get()` is lock-free.
    let _ = TEST_RUNNER_CONFIG.set(TestRunnerConfig {
        auto_run: auto_run_tests,
        delay_ms: auto_run_delay_ms,
        output_path: auto_run_output_path.clone(),
        quit_after: quit_after_tests,
        board: auto_run_board.clone(),
        filter: auto_run_filter.clone(),
        include_fixture_path: Some(include_fixture_path.clone()),
    });

    // Diagnostic: when auto-run is requested, write a "kanban started"
    // marker to the configured output path at process start. This
    // confirms the right binary is running even if the frontend
    // bootstrap silently fails. The frontend will overwrite the file
    // once the run completes.
    if auto_run_tests {
        if let Some(ref path) = auto_run_output_path {
            let marker = format!(
                "[kanban-startup] binary started, auto_run={}, delay_ms={}, board={:?}, filter={:?}, quit_after={}\n",
                auto_run_tests, auto_run_delay_ms, auto_run_board, auto_run_filter, quit_after_tests
            );
            if let Some(parent) = std::path::Path::new(path).parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, marker);
        }
    }

    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            asset_protocol::SCHEME,
            |_app, request, responder| {
                tauri::async_runtime::spawn(async move {
                    let response = asset_protocol::handle(request).await;
                    responder.respond(response);
                });
            },
        )
        .setup(move |app| {
            // Boot with an empty workspaces submenu — the frontend
            // refills it via `set_workspaces_submenu` once the catalog
            // hydrates from the backend.
            let menu = app_menu::create_app_menu(app, &[])?;
            app.set_menu(menu)?;

            // ── Auto-run: write config file (best-effort fallback) ──
            //
            // Primary delivery: the `get_test_runner_config` Tauri command
            // (which serves the in-memory `TEST_RUNNER_CONFIG` populated
            // above). `autoRunBootstrap.js` and the workspace shell prefer
            // this command over the file fallback.
            //
            // The file fallback is kept for `workspaceShell.js`'s
            // synchronous `MULTIVIEW_BOARDS` detection at IIFE init time
            // (sync XHR is the only API available before async invokes
            // resolve). It's also picked up by autoRunBootstrap.js when
            // the Tauri command path fails.
            //
            // Important: writing this file into `lexera-kanban/src/`
            // (which is `frontendDist` in dev mode) makes Tauri's
            // frontend watcher fire on the resulting fs event and reload
            // the main webview a few hundred ms after boot. Same problem
            // hit `remove_file` whenever a stale file existed from a
            // previous --run-tests session. Skip the write/remove when
            // it would be a no-op (file content/state unchanged) so the
            // watcher stays quiet on every subsequent boot.
            let config_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("src")
                .join("auto-run-config.json");
            if auto_run_tests {
                let config_json = serde_json::json!({
                    "auto_run": true,
                    "board": auto_run_board,
                    "output": auto_run_output_path,
                    "quit": quit_after_tests,
                    "delay": auto_run_delay_ms,
                    "filter": auto_run_filter,
                    "includeFixturePath": include_fixture_path
                });
                let new_content = config_json.to_string();
                let needs_write = match std::fs::read_to_string(&config_path) {
                    Ok(existing) => existing != new_content,
                    Err(_) => true,
                };
                if needs_write {
                    let _ = std::fs::write(&config_path, &new_content);
                }
            } else if config_path.exists() {
                let _ = std::fs::remove_file(&config_path);
            }

            // Start the descriptor watcher so the webview learns when the
            // backend starts/stops/restarts without polling. Matches plan
            // gap #4.
            backend_status::spawn(app.handle().clone());

            // `--debug` opens a small standalone diagnostics window in
            // parallel with the main shell. Hosted at
            // `lexera-kanban/src/views/debug/index.html`. Doesn't host
            // any of the kanban content; its buttons emit Tauri events
            // that the shell webview listens for. Failure to open is
            // logged but not fatal — the main app still boots normally.
            if open_debug_window {
                let url = tauri::WebviewUrl::App("views/debug/index.html".into());
                match tauri::WebviewWindowBuilder::new(app, "debug", url)
                    .title("Lexera — Debug")
                    .inner_size(720.0, 540.0)
                    .min_inner_size(420.0, 320.0)
                    .resizable(true)
                    .build()
                {
                    Ok(_) => {
                        eprintln!("[main] --debug window opened (label='debug')");
                    }
                    Err(e) => {
                        eprintln!("[main] --debug window failed to open: {}", e);
                    }
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(action) = app_menu::menu_id_to_action(id) {
                // Handle Rust-side actions that don't go to the frontend
                if action == "new-window" {
                    let _ = open_new_window(app.clone(), None, None, Some("workspace".to_string()), None, None, None, None, None, None, None);
                    return;
                }
                // open-workspace:<id> → spawn a new window pinned to
                // that workspace, entirely from Rust. Doing this here
                // (instead of emitting `menu-action: open-workspace:<id>`
                // for the frontend to consume) sidesteps a Tauri 2
                // listener-filter quirk: every webview that registered
                // `plugin:event|listen` with `target: { kind: 'Any' }`
                // (i.e. every webview running app.js — shell + each
                // child board/panel webview + each other open window)
                // matches `emit_to(label, …)` regardless of label, so
                // the action would fire once per webview JS context and
                // each context has its own debounce → multiple new
                // windows per click.
                if let Some(workspace_id) = action.strip_prefix("open-workspace:") {
                    if !workspace_id.is_empty() {
                        let _ = open_new_window(
                            app.clone(),
                            None,
                            None,
                            Some("workspace".to_string()),
                            None,
                            None,
                            None,
                            None,
                            None,
                            Some(workspace_id.to_string()),
                            None,
                        );
                    }
                    return;
                }
                // Route remaining menu actions to the FOCUSED window
                // only. macOS shares one menu bar across windows;
                // clicking View > Panels > Dashboard means "show the
                // dashboard panel in THIS window I'm in".
                //
                // NOTE: Tauri 2's `emit_to(label, …)` does NOT actually
                // restrict delivery if listeners registered with
                // `target: { kind: 'Any' }` — those match every emit.
                // The frontend-side guard for cross-webview leakage is
                // SHELL_ONLY_PREFIXES / SHELL_ONLY_EXACT in
                // workspaceShell.js: panel-only/embedded webviews drop
                // shell-only actions before handling. Keeping this
                // emit_to call still avoids the OTHER-window leak when
                // both windows actually filter (e.g. Webview-targeted
                // listeners added in the future).
                //
                // Fallback chain:
                //   1. live `is_focused()` — works on Linux/Windows
                //      where the click doesn't transfer focus to the
                //      menu bar.
                //   2. LAST_FOCUSED_WINDOW tracker — required on macOS,
                //      where opening the menu bar steals focus from
                //      every window for the duration of the click, so
                //      step 1 finds nothing.
                //   3. drop the action with a log warning rather than
                //      broadcast.
                let focused_label = app
                    .webview_windows()
                    .into_iter()
                    .find(|(_, w)| w.is_focused().unwrap_or(false))
                    .map(|(label, _)| label)
                    .or_else(|| LAST_FOCUSED_WINDOW.lock().ok().and_then(|guard| guard.clone()));
                if let Some(label) = focused_label {
                    // Emit a structured payload so JavaScript can filter out
                    // events intended for other windows. Tauri 2's
                    // `target: { kind: 'Any' }` listener is a greedy wildcard
                    // that matches every emit regardless of the emitter's label.
                    let payload = serde_json::json!({
                        "target": label,
                        "action": action
                    });
                    let _ = app.emit_to(label.as_str(), "menu-action", payload);
                    log::debug!("[main] menu-action sent to focused window '{}': {}", label, action);
                } else {
                    log::warn!("[main] menu-action dropped because no focused window was found: {}", action);
                }
            }
        })
        .manage(export_commands::MarpWatchState::new())
        .manage::<ipc_client::SharedIpcClient>(std::sync::Arc::new(ipc_client::IpcClientState::new()))
        .manage::<ipc_streams::SharedStreamRegistry>(std::sync::Arc::new(ipc_streams::StreamRegistry::new()))
        // Active multiview runtime state for child-webview hosting in the
        // normal desktop shell. Embedded mode and frontend auto-run tests
        // still keep explicit iframe fallbacks.
        .manage(webview_mgr::WebviewRegistry::default())
        .manage(webview_mgr::FocusTracker::default())
        .manage(webview_mgr::SubscriptionRegistry::default())
        .manage(webview_mgr::HealthTracker::default())
        .manage(drag_coordinator::DragState::default())
        .invoke_handler(tauri::generate_handler![
            open_new_window,
            get_test_runner_config,
            ipc_commands::backend_ipc_status,
            ipc_commands::backend_ipc_request,
            ipc_commands::backend_ipc_upload,
            ipc_commands::backend_ipc_stream_open,
            ipc_commands::backend_ipc_stream_close,
            ipc_commands::backend_ipc_stream_send,
            ipc_commands::backend_asset_url,
            commands::get_backend_url,
            commands::open_in_system,
            commands::open_url,
            commands::show_in_folder,
            commands::open_with_default_app,
            commands::browse_files,
            commands::browse_folder,
            commands::rename_path,
            commands::discover_visual_themes,
            commands::read_text_file,
            commands::write_text_file,
            commands::read_keybindings,
            commands::write_keybindings,
            commands::read_clipboard_image,
            commands::read_clipboard_text,
            commands::show_context_menu,
            commands::toggle_devtools,
            commands::open_devtools_all,
            commands::set_menu_check_state,
            commands::set_workspaces_submenu,
            commands::quit_app,
            // Export commands
            export_commands::marp_export,
            export_commands::marp_watch,
            export_commands::marp_stop_watch,
            export_commands::marp_stop_all_watches,
            export_commands::pandoc_export,
            export_commands::check_marp_available,
            export_commands::check_pandoc_available,
            export_commands::check_embedded_renderer_statuses,
            export_commands::test_render_apps,
            export_commands::discover_marp_themes,
            export_commands::discover_marp_classes,
            export_commands::open_export_folder,
            export_commands::write_export_file,
            export_commands::remove_export_files,
            export_commands::copy_export_assets,
            export_commands::render_embedded_file,
            export_commands::render_plantuml_code,
            export_commands::get_marp_engine_path,
            export_commands::get_file_mtime_ms,
            export_commands::read_file_as_data_uri,
            // Multi-webview runtime commands used by board hosting,
            // utility views, modal windows, and smoke-test tooling.
            webview_mgr::multiview_spawn,
            webview_mgr::multiview_get_host_geometry,
            webview_mgr::multiview_destroy,
            webview_mgr::multiview_destroy_all_for_window,
            webview_mgr::multiview_set_geometry,
            webview_mgr::multiview_list,
            webview_mgr::multiview_navigate,
            webview_mgr::log_broadcast,
            webview_mgr::multiview_broadcast,
            webview_mgr::multiview_broadcast_global_subscribers,
            webview_mgr::multiview_webview_at_screen_point,
            webview_mgr::multiview_route_external_dnd,
            webview_mgr::multiview_emit_to,
            webview_mgr::multiview_subscribe,
            webview_mgr::multiview_unsubscribe,
            webview_mgr::ws_debug_log,
            webview_mgr::multiview_set_health,
            webview_mgr::multiview_get_health,
            webview_mgr::multiview_list_health,
            webview_mgr::multiview_open_modal_window,
            webview_mgr::multiview_close_window,
            webview_mgr::multiview_set_focused,
            webview_mgr::multiview_get_focused,
            webview_mgr::multiview_set_visible,
            webview_mgr::drag_ghost_ensure,
            webview_mgr::drag_ghost_move,
            webview_mgr::drag_ghost_hide,
            webview_mgr::drag_ghost_set_content,
            drag_coordinator::drag_start,
            drag_coordinator::drag_pointer_move,
            drag_coordinator::drag_pointer_up,
            drag_coordinator::drag_cancel,
            drag_coordinator::drop_ack,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } => {
                    let closing_label = window.label().to_string();
                    {
                        // Every window closes normally on red-X click. The
                        // OS-level "should the app exit when all windows are
                        // gone" decision is handled in the `ExitRequested`
                        // run-event below — closing the last window keeps
                        // the app alive, only an explicit `quit_app`
                        // (Cmd+Q / File > Quit) actually exits.
                        //
                        // 1. If LAST_FOCUSED_WINDOW points at this
                        //    closing window, clear it. Otherwise the
                        //    next menu click would `emit_to(<dead-
                        //    window-label>, …)` and silently no-op
                        //    because that webview no longer exists.
                        // 2. Drop every subscription registered by
                        //    webviews attached to this window. Stale
                        //    entries in the SubscriptionRegistry would
                        //    keep multiview_broadcast trying to emit to
                        //    dead webview labels — harmless today, but
                        //    grows unbounded over multi-window
                        //    open/close churn.
                        if let Ok(mut last) = LAST_FOCUSED_WINDOW.lock() {
                            if last.as_deref() == Some(closing_label.as_str()) {
                                *last = None;
                            }
                        }
                        let dead_labels: Vec<String> = window
                            .webviews()
                            .into_iter()
                            .map(|w| w.label().to_string())
                            .collect();
                        if !dead_labels.is_empty() {
                            use tauri::Manager;
                            let app = window.app_handle();
                            // SubscriptionRegistry: drop dead webview labels
                            // so multiview_broadcast doesn't emit_to ghosts.
                            let reg = app.state::<webview_mgr::SubscriptionRegistry>();
                            reg.drop_labels(&dead_labels);
                            // HealthTracker: drop the closing window's
                            // webview health entries so the HashMap doesn't
                            // grow unbounded over multi-window churn.
                            let health = app.state::<webview_mgr::HealthTracker>();
                            health.drop_labels(&dead_labels);
                            // WebviewRegistry: Tauri implicitly destroys
                            // a window's child webviews on parent close
                            // without calling `multiview_destroy`, so the
                            // per-webview geometry rows never get cleaned
                            // up by that path. Drop them here.
                            let webviews = app.state::<webview_mgr::WebviewRegistry>();
                            webviews.drop_labels(&dead_labels);
                        }
                        // FocusTracker is keyed by WINDOW label (one slot
                        // per top-level window), so we drop by the closing
                        // window's label, not its webview labels.
                        {
                            use tauri::Manager;
                            let app = window.app_handle();
                            let focus = app.state::<webview_mgr::FocusTracker>();
                            focus.drop_window(&closing_label);
                        }
                        // MarpWatchState: kill any Marp --watch processes
                        // owned by this window. Without this, watch
                        // processes outlive their parent window forever.
                        {
                            use tauri::Manager;
                            let app = window.app_handle();
                            let marp = app.state::<export_commands::MarpWatchState>();
                            marp.stop_window(&closing_label);
                        }
                        // StreamRegistry: abort any IPC streams the
                        // closing window's webviews opened. Backend
                        // sees EOF and tears down its end.
                        {
                            use tauri::Manager;
                            let app = window.app_handle();
                            let streams = app.state::<ipc_streams::SharedStreamRegistry>();
                            streams.stop_window_blocking(&closing_label);
                        }
                    }
                }
                tauri::WindowEvent::Moved(_pos) => {
                    snap_window_to_edges(window);
                }
                tauri::WindowEvent::Focused(true) => {
                    // Persist the most-recently-focused window label.
                    // The native menu handler reads this when its own
                    // `is_focused()` check finds nothing focused — on
                    // macOS the menu bar steals focus from every window
                    // while a menu is open, so `is_focused()` returns
                    // false for all of them during the menu event.
                    if let Ok(mut last) = LAST_FOCUSED_WINDOW.lock() {
                        *last = Some(window.label().to_string());
                    }
                }
                _ => {}
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building lexera-kanban")
        .run(|_app, event| {
            // Closing the last window normally raises `ExitRequested`
            // and Tauri exits the process. The user contract is "close
            // the view, but not the application" — re-openable via
            // the shared macOS menu bar.
            //
            // Scoped to macOS because that platform's menu bar
            // persists when no window is open, so the user can always
            // get back into the app via File > New Window. On
            // Windows / Linux the menu is on the window itself; with
            // no window AND no system tray, a kept-alive app is
            // invisible to the user — exit normally there to match
            // platform convention. (Add `cfg(target_os = "linux")`
            // here once a system tray ships.)
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if !USER_REQUESTED_QUIT.load(std::sync::atomic::Ordering::Relaxed) {
                    api.prevent_exit();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = event;
        });
}
