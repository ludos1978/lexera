/// System tray setup for Lexera Backend.

use tauri::{
    AppHandle, Manager,
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder, TrayIconEvent, MouseButtonState, MouseButton},
};
use crate::capture::open_capture_popup;

pub fn setup_tray(app: &AppHandle, port: u16) -> Result<TrayIcon, tauri::Error> {
    let status_item = MenuItem::with_id(app, "status", format!("Lexera Backend — port {}", port), false, None::<&str>)?;
    let open_dashboard = MenuItem::with_id(app, "open_dashboard", "Open Dashboard", true, None::<&str>)?;
    let quick_capture = MenuItem::with_id(app, "quick_capture", "Quick Capture", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(app, &[&status_item, &open_dashboard, &quick_capture, &quit])?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Lexera Backend")
        .on_menu_event(move |app, event| {
            match event.id().as_ref() {
                "open_dashboard" => {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                "quick_capture" => {
                    open_capture_popup(app);
                }
                "quit" => {
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if let Some(window) = tray.app_handle().get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;

    Ok(tray)
}
