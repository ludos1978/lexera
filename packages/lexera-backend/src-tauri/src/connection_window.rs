/// Connection Settings window management.
///
/// Opens a separate Tauri webview for collaboration setup (server connections,
/// invites, remote board management). This keeps the frontend free from
/// collaboration UI — it only talks to the local backend.
use crate::config::DEFAULT_BIND_ADDRESS;
use crate::state::AppState;
use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde_json::json;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Width of the connection-settings window in logical pixels.
const CONNECTION_WINDOW_WIDTH: f64 = 520.0;
/// Height of the connection-settings window in logical pixels.
const CONNECTION_WINDOW_HEIGHT: f64 = 640.0;

fn resolve_connection_window_backend_url(app: &AppHandle) -> Option<String> {
    let state = app.try_state::<AppState>()?;
    let cfg = state.config.lock().ok();
    let bind_address = cfg
        .as_ref()
        .map(|guard| guard.bind_address.clone())
        .unwrap_or_else(|| state.bind_address.clone());
    let configured_port = cfg.as_ref().map(|guard| guard.port).unwrap_or(state.port);
    let port = state
        .live_port
        .lock()
        .ok()
        .map(|guard| *guard)
        .unwrap_or(configured_port);
    let host = if bind_address == "0.0.0.0" {
        DEFAULT_BIND_ADDRESS.to_string()
    } else {
        bind_address
    };
    Some(format!("http://{}:{}", host, port))
}

fn connection_window_url(app: &AppHandle) -> WebviewUrl {
    if let Some(backend_url) = resolve_connection_window_backend_url(app) {
        let encoded = utf8_percent_encode(&backend_url, NON_ALPHANUMERIC).to_string();
        WebviewUrl::App(format!("connection-settings.html?backend={}", encoded).into())
    } else {
        WebviewUrl::App("connection-settings.html".into())
    }
}

fn connection_window_route(app: &AppHandle) -> String {
    match connection_window_url(app) {
        WebviewUrl::App(path) => format!("/{}", path.to_string_lossy()),
        WebviewUrl::External(url) => url.to_string(),
        #[allow(unreachable_patterns)]
        _ => "/connection-settings.html".to_string(),
    }
}

pub fn open_connection_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("connection-settings") {
        let route = connection_window_route(app);
        let refresh_script = format!(
            "(function() {{ const target = new URL({route}, window.location.origin).toString(); if (window.location.href !== target) {{ window.location.replace(target); }} else {{ window.location.reload(); }} }})();",
            route = json!(route)
        );
        if let Err(e) = window.eval(refresh_script) {
            log::warn!(
                "[connection_window] Failed to refresh existing window location: {}",
                e
            );
            let _ = window.reload();
        }
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
        connection_window_url(app),
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
