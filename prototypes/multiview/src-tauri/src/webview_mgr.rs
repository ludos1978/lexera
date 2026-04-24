// Webview lifecycle: spawn / position / list child webviews.
//
// Tauri 2 child webviews (Window::add_child) each get their own OS
// process on macOS (WKWebView WebContent) and Windows (WebView2). On
// Linux WebKitGTK each webview gets its own WebContext which yields a
// separate web process when configured.

use std::collections::HashMap;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize,
    Manager, State, WebviewUrl, Window,
};

#[derive(Default)]
pub struct WebviewRegistry {
    inner: RwLock<HashMap<String, WebviewMeta>>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WebviewMeta {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Deserialize)]
pub struct GeometryUpdate {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn spawn_board_internal(
    app: &AppHandle,
    window: &Window,
    label: &str,
    url: &str,
    position: (f64, f64),
    size: (f64, f64),
) -> Result<(), String> {
    let builder = WebviewBuilder::new(label, WebviewUrl::App(url.into()));
    window
        .add_child(
            builder,
            LogicalPosition::new(position.0, position.1),
            LogicalSize::new(size.0, size.1),
        )
        .map_err(|e| format!("add_child failed for {}: {}", label, e))?;

    let registry: State<WebviewRegistry> = app.state();
    registry.inner.write().insert(
        label.to_string(),
        WebviewMeta {
            label: label.to_string(),
            x: position.0,
            y: position.1,
            width: size.0,
            height: size.1,
        },
    );
    log::info!("spawned webview {} at ({},{}) size ({},{})",
        label, position.0, position.1, size.0, size.1);
    Ok(())
}

#[tauri::command]
pub fn spawn_board(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let main_window = app.get_window("main").ok_or("main window not found")?;
    spawn_board_internal(&app, &main_window, &label, &url, (x, y), (width, height))
}

#[tauri::command]
pub fn set_webview_geometry(
    app: AppHandle,
    updates: Vec<GeometryUpdate>,
) -> Result<(), String> {
    let registry: State<WebviewRegistry> = app.state();
    let main_window = app.get_window("main").ok_or("main window not found")?;
    for update in updates {
        if let Some(webview) = main_window.get_webview(&update.label) {
            webview
                .set_position(LogicalPosition::new(update.x, update.y))
                .map_err(|e| format!("set_position failed for {}: {}", update.label, e))?;
            webview
                .set_size(LogicalSize::new(update.width, update.height))
                .map_err(|e| format!("set_size failed for {}: {}", update.label, e))?;
            if let Some(meta) = registry.inner.write().get_mut(&update.label) {
                meta.x = update.x;
                meta.y = update.y;
                meta.width = update.width;
                meta.height = update.height;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn list_webviews(app: AppHandle) -> Vec<WebviewMeta> {
    let registry: State<WebviewRegistry> = app.state();
    let result: Vec<WebviewMeta> = registry.inner.read().values().cloned().collect();
    result
}

/// Return the webview label whose rectangle contains (x, y) in
/// shell-local (window-client) coordinates. Used by the drag
/// coordinator for hit testing.
pub fn hit_test(registry: &WebviewRegistry, x: f64, y: f64) -> Option<String> {
    registry
        .inner
        .read()
        .values()
        .find(|meta| {
            x >= meta.x
                && x <= meta.x + meta.width
                && y >= meta.y
                && y <= meta.y + meta.height
        })
        .map(|meta| meta.label.clone())
}

/// Translate a shell-local coordinate into a webview-local coordinate.
pub fn to_local(meta: &WebviewMeta, x: f64, y: f64) -> (f64, f64) {
    (x - meta.x, y - meta.y)
}

pub fn get_meta(registry: &WebviewRegistry, label: &str) -> Option<WebviewMeta> {
    registry.inner.read().get(label).cloned()
}
