#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod export_commands;

fn main() {
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
