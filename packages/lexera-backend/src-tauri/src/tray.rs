/// System tray setup for Lexera Backend.

use tauri::{
    AppHandle,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
};
use crate::capture::open_capture_popup;

pub fn setup_tray(app: &AppHandle, port: u16) -> Result<TrayIcon, tauri::Error> {
    let status_item = MenuItem::with_id(app, "status", format!("Lexera Backend — port {}", port), false, None::<&str>)?;
    let quick_capture = MenuItem::with_id(app, "quick_capture", "Quick Capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&status_item, &quick_capture, &quit])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Lexera Backend");

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let tray = builder
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "quick_capture" => {
                    open_capture_popup(app);
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .build(app)?;

    Ok(tray)
}
