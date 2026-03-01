/// Connection Settings window management.
///
/// Opens a separate Tauri webview for collaboration setup (server connections,
/// invites, remote board management). This keeps the frontend free from
/// collaboration UI — it only talks to the local backend.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Width of the connection-settings window in logical pixels.
const CONNECTION_WINDOW_WIDTH: f64 = 520.0;
/// Height of the connection-settings window in logical pixels.
const CONNECTION_WINDOW_HEIGHT: f64 = 640.0;

pub fn open_connection_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("connection-settings") {
        let _ = window.show();
        let _ = window.unminimize();
        // Bring to front: briefly set always-on-top then reset
        let _ = window.set_always_on_top(true);
        let _ = window.set_always_on_top(false);
        let _ = window.set_focus();
        return;
    }

    match WebviewWindowBuilder::new(
        app,
        "connection-settings",
        WebviewUrl::App("connection-settings.html".into()),
    )
    .title("Management")
    .inner_size(CONNECTION_WINDOW_WIDTH, CONNECTION_WINDOW_HEIGHT)
    .center()
    .resizable(true)
    .build()
    {
        Ok(_) => log::info!("[connection_window] Connection settings window opened"),
        Err(e) => log::error!("[connection_window] Failed to open window: {}", e),
    }
}

#[tauri::command]
pub fn open_connection_window_cmd(app: AppHandle) {
    open_connection_window(&app);
}
