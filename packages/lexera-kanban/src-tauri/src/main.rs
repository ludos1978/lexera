#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod export_commands;

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

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

fn main() {
    install_panic_hook();

    tauri::Builder::default()
        .manage(export_commands::MarpWatchState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_backend_url,
            commands::open_in_system,
            commands::open_url,
            commands::show_in_folder,
            commands::rename_path,
            commands::show_context_menu,
            commands::toggle_devtools,
            // Export commands
            export_commands::marp_export,
            export_commands::marp_watch,
            export_commands::marp_stop_watch,
            export_commands::marp_stop_all_watches,
            export_commands::pandoc_export,
            export_commands::check_marp_available,
            export_commands::check_pandoc_available,
            export_commands::discover_marp_themes,
            export_commands::discover_marp_classes,
            export_commands::open_export_folder,
            export_commands::write_export_file,
            export_commands::remove_export_files,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.minimize();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running lexera-kanban");
}
