#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_menu;
mod commands;
mod export_commands;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{Emitter, Manager, WebviewUrl};

static WINDOW_COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

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

/// Find the window with the lowest ID. "main" is always lowest (id 0),
/// then "kanban-1", "kanban-2", etc.
fn find_lowest_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(main_win) = app.get_webview_window("main") {
        return Some(main_win);
    }
    let mut windows: Vec<_> = app.webview_windows().into_iter().collect();
    windows.sort_by(|a, b| a.0.cmp(&b.0));
    windows.into_iter().next().map(|(_, w)| w)
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
        .setup(move |app| {
            let menu = app_menu::create_app_menu(app)?;
            app.set_menu(menu)?;

            // ── Auto-run: write config file + navigate with query param ──
            // Write a JSON config to `src/auto-run-config.json` (served
            // by the dev server) AND navigate to `index.html?autoRunTests=1`
            // so the frontend can detect auto-run from location.search
            // synchronously at IIFE time, then fetch() the config file
            // for the details (board, output path, quit flag).
            let config_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or_else(|| std::path::Path::new("."))
                .join("src")
                .join("auto-run-config.json");
            if auto_run_tests {
                // Write config file for fetch()
                let config_json = serde_json::json!({
                    "auto_run": true,
                    "board": auto_run_board,
                    "output": auto_run_output_path,
                    "quit": quit_after_tests,
                    "delay": auto_run_delay_ms,
                    "filter": auto_run_filter,
                    "includeFixturePath": include_fixture_path
                });
                let _ = std::fs::write(&config_path, config_json.to_string());

                // The frontend polls for `auto-run-config.json` via
                // XHR on startup (every 1s for 30 attempts). When it
                // finds the file, it reads the config and starts.
            } else {
                let _ = std::fs::remove_file(&config_path);
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(action) = app_menu::menu_id_to_action(id) {
                // Handle Rust-side actions that don't go to the frontend
                if action == "new-window" {
                    let _ = open_new_window(app.clone(), None, None, Some("workspace".to_string()), None, None, None, None, None);
                    return;
                }
                // Panel reveal actions go to the lowest-numbered window;
                // all other actions go to the focused window.
                let target = if action.starts_with("reveal-panel:") {
                    find_lowest_window(app)
                } else {
                    app.webview_windows().values()
                        .find(|w| w.is_focused().unwrap_or(false))
                        .cloned()
                        .or_else(|| find_lowest_window(app))
                };
                if let Some(window) = target {
                    let _ = window.emit("menu-action", action);
                }
            }
        })
        .manage(export_commands::MarpWatchState::new())
        .invoke_handler(tauri::generate_handler![
            open_new_window,
            get_test_runner_config,
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
            commands::set_menu_check_state,
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
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // Only prevent close on the main window; secondary windows close normally
                    if window.label() == "main" {
                        api.prevent_close();
                        let _ = window.minimize();
                    }
                }
                tauri::WindowEvent::Moved(_pos) => {
                    snap_window_to_edges(window);
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running lexera-kanban");
}
