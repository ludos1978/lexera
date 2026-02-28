use crate::capture::open_capture_popup;
use crate::connection_window::open_connection_window;
/// System tray setup for Lexera Backend.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle,
};

const BACKEND_TRAY_ID: &str = "lexera-backend-tray";

pub fn setup_tray(app: &AppHandle, port: u16) -> Result<TrayIcon, tauri::Error> {
    if app.tray_by_id(BACKEND_TRAY_ID).is_some() {
        let _ = app.remove_tray_by_id(BACKEND_TRAY_ID);
    }

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
    let open_browser = MenuItem::with_id(
        app,
        "open_browser",
        "Open Backend Status",
        true,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&status_item, &quick_capture, &connection_settings, &open_browser, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(BACKEND_TRAY_ID)
        .menu(&menu)
        .tooltip("Lexera Backend");

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    } else {
        log::warn!(
            target: "lexera.tray",
            "No default tray icon found, using text title fallback"
        );
        #[cfg(target_os = "macos")]
        {
            builder = builder.title("Lexera");
        }
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
            "open_browser" => {
                let url = format!("http://127.0.0.1:{}/status", tray_port);
                log::info!(target: "lexera.tray", "Opening backend status in browser: {}", url);
                #[cfg(target_os = "macos")]
                if let Err(e) = std::process::Command::new("open").arg(&url).spawn() {
                    log::error!(target: "lexera.tray", "Failed to open backend status: {}", e);
                }
                #[cfg(target_os = "linux")]
                if let Err(e) = std::process::Command::new("xdg-open").arg(&url).spawn() {
                    log::error!(target: "lexera.tray", "Failed to open backend status: {}", e);
                }
                #[cfg(target_os = "windows")]
                if let Err(e) = std::process::Command::new("cmd").args(["/C", "start", &url]).spawn() {
                    log::error!(target: "lexera.tray", "Failed to open backend status: {}", e);
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    log::info!(
        target: "lexera.tray",
        "Tray icon ready on port {}",
        port
    );

    Ok(tray)
}
