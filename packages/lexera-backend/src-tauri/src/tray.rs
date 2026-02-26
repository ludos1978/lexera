use crate::capture::open_capture_popup;
use crate::connection_window::open_connection_window;
/// System tray setup for Lexera Backend.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle,
};

pub fn setup_tray(app: &AppHandle, port: u16) -> Result<TrayIcon, tauri::Error> {
    let status_item = MenuItem::with_id(
        app,
        "status",
        format!("Lexera Backend — port {}", port),
        false,
        None::<&str>,
    )?;
    let quick_capture =
        MenuItem::with_id(app, "quick_capture", "Quick Capture", true, None::<&str>)?;
    let connection_settings = MenuItem::with_id(
        app,
        "connection_settings",
        "Connection Settings",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&status_item, &quick_capture, &connection_settings, &quit],
    )?;

    let mut builder = TrayIconBuilder::new().menu(&menu).tooltip("Lexera Backend");

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let tray_port = port;
    let tray = builder
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "quick_capture" => {
                open_capture_popup(app);
            }
            "connection_settings" => {
                open_connection_window(app);
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(move |_tray, event| {
            if let tauri::tray::TrayIconEvent::Click { .. } = event {
                let url = format!("http://localhost:{}", tray_port);
                #[cfg(target_os = "macos")]
                let _ = std::process::Command::new("open").arg(&url).spawn();
                #[cfg(target_os = "linux")]
                let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
                #[cfg(target_os = "windows")]
                let _ = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn();
            }
        })
        .build(app)?;

    Ok(tray)
}
