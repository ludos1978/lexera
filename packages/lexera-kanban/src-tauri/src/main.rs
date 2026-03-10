#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_menu;
mod commands;
mod export_commands;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

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

    tauri::Builder::default()
        .setup(|app| {
            let menu = app_menu::create_app_menu(app)?;
            app.set_menu(menu)?;
            Ok(())
        })
        .on_menu_event(|app, event| {
            let id = event.id().0.as_str();
            if let Some(action) = app_menu::menu_id_to_action(id) {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.emit("menu-action", action);
                }
            }
        })
        .manage(export_commands::MarpWatchState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_backend_url,
            commands::open_in_system,
            commands::open_url,
            commands::show_in_folder,
            commands::rename_path,
            commands::read_text_file,
            commands::write_text_file,
            commands::show_context_menu,
            commands::toggle_devtools,
            commands::set_menu_check_state,
            // Export commands
            export_commands::marp_export,
            export_commands::marp_watch,
            export_commands::marp_stop_watch,
            export_commands::marp_stop_all_watches,
            export_commands::pandoc_export,
            export_commands::check_marp_available,
            export_commands::check_pandoc_available,
            export_commands::check_embedded_renderer_statuses,
            export_commands::discover_marp_themes,
            export_commands::discover_marp_classes,
            export_commands::open_export_folder,
            export_commands::write_export_file,
            export_commands::remove_export_files,
            export_commands::copy_export_assets,
            export_commands::render_embedded_file,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    let _ = window.minimize();
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
