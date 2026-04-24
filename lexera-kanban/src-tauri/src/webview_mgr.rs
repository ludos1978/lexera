// Multi-webview lifecycle manager for the workspace shell.
//
// This module is the foundation for the multi-webview migration
// described in TODOs-lexera-multiview.md. It is currently UNUSED by
// the existing iframe-based shell — all commands are registered but
// no JS code calls them yet. The shell migration in Stage 3+ wires
// this up incrementally; until then, this module is dormant code.
//
// Tauri 2 child webviews (Window::add_child) each get their own OS
// renderer process on macOS (WKWebView WebContent), Windows (WebView2),
// and Linux (WebKitGTK with per-WebContext config). This gives true
// process-level isolation and parallel rendering for board content.

use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::{
    webview::WebviewBuilder, AppHandle, LogicalPosition, LogicalSize, Manager,
    State, WebviewUrl, Window,
};

/// Registry of all child webviews currently mounted in a window.
/// Keyed by webview label. Geometry is tracked here so the drag
/// coordinator can hit-test pointer positions against known slots
/// without round-tripping through the OS.
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

#[derive(Deserialize)]
pub struct SpawnRequest {
    pub label: String,
    pub url: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// Optional parent window label; defaults to "main".
    pub parent_window: Option<String>,
}

/// Internal helper: spawn a child webview without going through the
/// JS IPC layer. Used during app startup (e.g., pre-warming a pool)
/// or by other Rust modules.
pub fn spawn_internal(
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
    log::info!(
        "[webview_mgr] spawned '{}' at ({},{}) size ({},{})",
        label, position.0, position.1, size.0, size.1
    );
    Ok(())
}

/// Spawn a new child webview at the given position/size. Called from
/// JS via `core.invoke('multiview_spawn', payload)`.
#[tauri::command]
pub fn multiview_spawn(app: AppHandle, req: SpawnRequest) -> Result<(), String> {
    let parent = req.parent_window.as_deref().unwrap_or("main");
    let window = app
        .get_window(parent)
        .ok_or_else(|| format!("parent window '{}' not found", parent))?;
    spawn_internal(&app, &window, &req.label, &req.url, (req.x, req.y), (req.width, req.height))
}

/// Destroy a child webview. The geometry registry entry is removed.
/// State preservation (for re-spawn later) is the caller's responsibility.
#[tauri::command]
pub fn multiview_destroy(app: AppHandle, label: String) -> Result<(), String> {
    let main_window = app.get_window("main").ok_or("main window not found")?;
    if let Some(webview) = main_window.get_webview(&label) {
        webview
            .close()
            .map_err(|e| format!("close failed for {}: {}", label, e))?;
    }
    let registry: State<WebviewRegistry> = app.state();
    registry.inner.write().remove(&label);
    log::info!("[webview_mgr] destroyed '{}'", label);
    Ok(())
}

/// Update geometry for one or more webviews in a single batch.
/// Batching minimizes IPC overhead during dock-divider drag where
/// multiple webviews resize per frame.
#[tauri::command]
pub fn multiview_set_geometry(
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
pub fn multiview_list(app: AppHandle) -> Vec<WebviewMeta> {
    let registry: State<WebviewRegistry> = app.state();
    let result: Vec<WebviewMeta> = registry.inner.read().values().cloned().collect();
    result
}

/// Show/hide a child webview without destroying it. Useful for
/// inactive tabs so we can keep the webview alive (state preserved)
/// but not visible.
#[tauri::command]
pub fn multiview_set_visible(
    app: AppHandle,
    label: String,
    visible: bool,
) -> Result<(), String> {
    let main_window = app.get_window("main").ok_or("main window not found")?;
    if let Some(webview) = main_window.get_webview(&label) {
        if visible {
            // Tauri 2 child webview show/hide via setSize to non-zero/zero
            // is unreliable across platforms. Use the Webview API.
            webview
                .show()
                .map_err(|e| format!("show failed for {}: {}", label, e))?;
        } else {
            webview
                .hide()
                .map_err(|e| format!("hide failed for {}: {}", label, e))?;
        }
    }
    Ok(())
}

// ── Cross-webview event broadcasting ────────────────────────────
//
// Used by per-view sub-apps to share events that any other view
// might care about (e.g., log messages, theme changes, catalog
// updates). Recipients use scoped `webview.listen()` per the
// "Architectural rules" in TODOs-lexera-multiview.md — global
// broadcasts reach scoped listeners since they target "all".

#[derive(Deserialize, Serialize, Clone)]
pub struct LogEvent {
    pub level: String,
    pub source: String,
    pub message: String,
    pub timestamp_ms: f64,
}

/// Broadcast a log entry to every webview that has subscribed to
/// `log-message`. Called from the main kanban process whenever
/// lexeraLog is invoked, so any open log sub-app webview sees it.
#[tauri::command]
pub fn log_broadcast(app: AppHandle, entry: LogEvent) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit("log-message", entry);
    Ok(())
}

/// Generic event broadcaster for use by per-view sub-apps that
/// want to share state changes with other views (theme, catalog,
/// active board, etc). Uses `app.emit()` (broadcast to all).
#[tauri::command]
pub fn multiview_broadcast(
    app: AppHandle,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit(&event, payload);
    Ok(())
}

/// Emit an event to a specific webview by label. Used when the
/// main shell wants to send a targeted message (e.g., a board
/// action to the currently-active board webview).
#[tauri::command]
pub fn multiview_emit_to(
    app: AppHandle,
    target: String,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit_to(target.as_str(), &event, payload);
    Ok(())
}

// ── Modal child windows ─────────────────────────────────────────
//
// Stage 6 architectural fix: native child webviews paint above HTML,
// so HTML-overlay dialogs no longer work as a UI primitive once we
// have multiple child webviews mounted. The fix is to spawn a real
// native window for each modal — a top-level Tauri webview window,
// not a child webview. This naturally composites above all child
// webviews of the parent window because it's its own OS window.
//
// The modal communicates result back via Tauri events
// ('modal-result-<label>') and self-closes.

#[derive(Deserialize)]
pub struct ModalSpec {
    pub label: String,
    pub url: String,
    pub title: Option<String>,
    pub width: f64,
    pub height: f64,
    pub center: Option<bool>,
}

#[tauri::command]
pub fn multiview_open_modal_window(
    app: AppHandle,
    spec: ModalSpec,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    let url_obj = tauri::WebviewUrl::App(spec.url.into());
    let mut builder = WebviewWindowBuilder::new(&app, &spec.label, url_obj)
        .inner_size(spec.width, spec.height)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .always_on_top(true);
    if let Some(t) = spec.title {
        builder = builder.title(t);
    }
    if spec.center.unwrap_or(true) {
        builder = builder.center();
    }
    builder
        .build()
        .map_err(|e| format!("modal window build failed for {}: {}", spec.label, e))?;
    log::info!("[modal] opened '{}'", spec.label);
    Ok(())
}

#[tauri::command]
pub fn multiview_close_window(app: AppHandle, label: String) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(&label) {
        window
            .close()
            .map_err(|e| format!("close failed for {}: {}", label, e))?;
        log::info!("[modal] closed '{}'", label);
    }
    Ok(())
}

// ── Focus tracking (Stage 9) ───────────────────────────────────
//
// Sub-apps report their focused/blurred state. Rust tracks the
// currently-focused webview so the main shell can route global
// keyboard shortcuts to the right place, show focus indicators,
// or query "who has focus" at any time.

#[derive(Default)]
pub struct FocusTracker {
    inner: parking_lot::Mutex<Option<String>>,
}

#[derive(Serialize, Clone)]
struct FocusChangedEvent {
    label: Option<String>,
}

#[tauri::command]
pub fn multiview_set_focused(
    app: AppHandle,
    tracker: State<FocusTracker>,
    label: String,
    focused: bool,
) -> Result<(), String> {
    use tauri::Emitter;
    let mut current = tracker.inner.lock();
    let new_label: Option<String> = if focused {
        Some(label.clone())
    } else if current.as_deref() == Some(label.as_str()) {
        None
    } else {
        // Blur from a label that wasn't currently focused — ignore
        return Ok(());
    };
    if *current != new_label {
        *current = new_label.clone();
        log::info!("[focus] now: {:?}", new_label);
        let _ = app.emit("focus-changed", FocusChangedEvent { label: new_label });
    }
    Ok(())
}

#[tauri::command]
pub fn multiview_get_focused(tracker: State<FocusTracker>) -> Option<String> {
    tracker.inner.lock().clone()
}

// ── Drag ghost window (Stage 7) ────────────────────────────────
//
// Transparent always-on-top child window used during cross-webview
// drag. Hosts a tiny HTML page that renders the drag preview and
// follows the OS cursor via set_position calls from JS.
//
// Created lazily on first drag, kept alive between drags (cheaper
// than respawning each time). Hidden via set_visible(false) when
// not in use.

const GHOST_LABEL: &str = "drag-ghost";

#[derive(Deserialize)]
pub struct GhostSpec {
    pub url: String,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
pub fn drag_ghost_ensure(
    app: AppHandle,
    spec: GhostSpec,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    if app.get_webview_window(GHOST_LABEL).is_some() {
        return Ok(());
    }
    let url_obj = tauri::WebviewUrl::App(spec.url.into());
    // Note: Tauri's `.transparent(true)` requires the `macos-private-api`
    // / `linux-private-api` features and per-platform setup that's beyond
    // this scope. The ghost window uses a colored, opaque background instead
    // (works on all platforms without extra config).
    WebviewWindowBuilder::new(&app, GHOST_LABEL, url_obj)
        .inner_size(spec.width, spec.height)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        .build()
        .map_err(|e| format!("ghost window build failed: {}", e))?;
    log::info!("[drag-ghost] created");
    Ok(())
}

#[derive(Deserialize)]
pub struct GhostMove {
    pub x: f64,
    pub y: f64,
    pub visible: Option<bool>,
}

#[tauri::command]
pub fn drag_ghost_move(app: AppHandle, m: GhostMove) -> Result<(), String> {
    use tauri::LogicalPosition;
    let win = app.get_webview_window(GHOST_LABEL)
        .ok_or("ghost window not created — call drag_ghost_ensure first")?;
    win.set_position(LogicalPosition::new(m.x, m.y))
        .map_err(|e| format!("ghost set_position failed: {}", e))?;
    if let Some(visible) = m.visible {
        if visible {
            win.show().map_err(|e| format!("ghost show failed: {}", e))?;
        } else {
            win.hide().map_err(|e| format!("ghost hide failed: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn drag_ghost_hide(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(GHOST_LABEL) {
        win.hide().map_err(|e| format!("ghost hide failed: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub fn drag_ghost_set_content(
    app: AppHandle,
    html: String,
) -> Result<(), String> {
    use tauri::Emitter;
    let _ = app.emit_to(GHOST_LABEL, "ghost-content", html);
    Ok(())
}

// ── Internal API for the drag coordinator ───────────────────────

/// Hit-test a shell-local coordinate against known webview rectangles.
/// Returns the label of the topmost matching webview, if any.
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

pub fn get_meta(registry: &WebviewRegistry, label: &str) -> Option<WebviewMeta> {
    registry.inner.read().get(label).cloned()
}

pub fn to_local(meta: &WebviewMeta, x: f64, y: f64) -> (f64, f64) {
    (x - meta.x, y - meta.y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(label: &str, x: f64, y: f64, w: f64, h: f64) -> WebviewMeta {
        WebviewMeta { label: label.into(), x, y, width: w, height: h }
    }

    fn registry_with(metas: Vec<WebviewMeta>) -> WebviewRegistry {
        let r = WebviewRegistry::default();
        let mut w = r.inner.write();
        for m in metas {
            w.insert(m.label.clone(), m);
        }
        drop(w);
        r
    }

    #[test]
    fn hit_test_inside_returns_label() {
        let r = registry_with(vec![
            meta("a", 0.0, 0.0, 100.0, 100.0),
            meta("b", 100.0, 0.0, 100.0, 100.0),
        ]);
        assert_eq!(hit_test(&r, 50.0, 50.0), Some("a".into()));
        assert_eq!(hit_test(&r, 150.0, 50.0), Some("b".into()));
    }

    #[test]
    fn hit_test_outside_returns_none() {
        let r = registry_with(vec![meta("a", 0.0, 0.0, 100.0, 100.0)]);
        assert_eq!(hit_test(&r, 200.0, 200.0), None);
    }

    #[test]
    fn hit_test_on_boundary_includes_edge() {
        let r = registry_with(vec![meta("a", 10.0, 20.0, 100.0, 100.0)]);
        assert_eq!(hit_test(&r, 10.0, 20.0), Some("a".into()));
        assert_eq!(hit_test(&r, 110.0, 120.0), Some("a".into()));
    }

    #[test]
    fn to_local_translates_correctly() {
        let m = meta("x", 100.0, 50.0, 200.0, 200.0);
        assert_eq!(to_local(&m, 150.0, 75.0), (50.0, 25.0));
        assert_eq!(to_local(&m, 100.0, 50.0), (0.0, 0.0));
    }

    #[test]
    fn get_meta_returns_clone_when_present() {
        let r = registry_with(vec![meta("a", 1.0, 2.0, 3.0, 4.0)]);
        let m = get_meta(&r, "a").expect("present");
        assert_eq!((m.x, m.y, m.width, m.height), (1.0, 2.0, 3.0, 4.0));
    }

    #[test]
    fn get_meta_returns_none_when_absent() {
        let r = registry_with(vec![]);
        assert!(get_meta(&r, "missing").is_none());
    }
}

