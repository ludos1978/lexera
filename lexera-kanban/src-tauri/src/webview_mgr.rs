// Multi-webview lifecycle manager for the workspace shell.
//
// This module is part of the active multiview runtime used by the
// normal desktop shell today. Board tabs, utility views, modal
// windows, focus/health tracking, and cross-webview routing all
// depend on it. Embedded board mode and the frontend auto-run test
// mode still keep explicit iframe fallbacks, so both architectures
// coexist for now.
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
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSView, NSWindow};

fn is_reserved_window_label(app: &AppHandle, label: &str) -> bool {
    let trimmed = label.trim();
    !trimmed.is_empty() && app.get_webview_window(trimmed).is_some()
}

fn ensure_child_webview_label(app: &AppHandle, label: &str, action: &str) -> Result<(), String> {
    if is_reserved_window_label(app, label) {
        let msg = format!(
            "{} refused reserved top-level window label '{}'",
            action, label
        );
        eprintln!("[webview_mgr] {}", msg);
        log::error!("[webview_mgr] {}", msg);
        return Err(msg);
    }
    Ok(())
}

/// Position/size match tolerance for the ghost-sibling detector.
/// Slot coordinates flow through f64 layout math + native `LogicalPosition`
/// conversion, so exact equality is too strict; 0.5-px slack catches the
/// rounding noise without false positives on legitimately-adjacent slots.
const GHOST_COORD_EPSILON_PX: f64 = 0.5;

/// Pure-logic core of the ghost-sibling detector: which labels in the
/// registry are sitting at (within epsilon of) the same slot as the
/// imminent new spawn? Same-label is excluded because Tauri's
/// `add_child` already errors on label collision.
fn ghost_sibling_labels_at_slot(
    registry: &WebviewRegistry,
    new_label: &str,
    position: (f64, f64),
    size: (f64, f64),
) -> Vec<String> {
    let r = registry.inner.read();
    r.iter()
        .filter(|(l, meta)| {
            l.as_str() != new_label
                && (meta.x - position.0).abs() <= GHOST_COORD_EPSILON_PX
                && (meta.y - position.1).abs() <= GHOST_COORD_EPSILON_PX
                && (meta.width - size.0).abs() <= GHOST_COORD_EPSILON_PX
                && (meta.height - size.1).abs() <= GHOST_COORD_EPSILON_PX
        })
        .map(|(l, _)| l.clone())
        .collect()
}

/// Detect orphan child webviews painting at the same screen slot as the
/// imminent new spawn, and close them before `add_child` runs.
///
/// Why: when the shell webview is reloaded mid-spawn (e.g. the Tauri
/// frontend watcher fires on a file mtime bump), the OLD shell's
/// `destroyAll()` IPCs lose the race against the NEW shell's spawn loop.
/// The discarded child webviews survive and paint at the same placeholder
/// coordinates as the fresh spawns — the user-reported "ghost views in
/// the background" regression. Two earlier fixes already eliminate the
/// known triggers (cecd3aa7 + fb907e38 idempotent sync scripts; e978754c
/// atomic destroy-all-for-window). This is the third layer: even if some
/// future change re-introduces a reload trigger, any ghost sitting on
/// the slot a new spawn is about to occupy gets closed at spawn time.
///
/// Match criterion: same parent window, label != new_label, and the
/// existing webview's tracked geometry matches (x, y, w, h) within
/// `GHOST_COORD_EPSILON_PX`. Same-label collisions are NOT handled here
/// — Tauri's `add_child` already errors on label collision, and silently
/// destroying a same-label peer would mask a real bug.
fn close_ghost_siblings_at_slot(
    app: &AppHandle,
    parent_window_label: &str,
    new_label: &str,
    position: (f64, f64),
    size: (f64, f64),
) {
    let registry: State<WebviewRegistry> = app.state();
    let candidates = ghost_sibling_labels_at_slot(&registry, new_label, position, size);
    if candidates.is_empty() {
        return;
    }
    let webviews = app.webviews();
    for ghost_label in &candidates {
        let wv = match webviews.get(ghost_label) {
            Some(w) => w,
            None => continue,
        };
        if wv.window().label() != parent_window_label {
            continue; // siblings only; never reach into another window
        }
        eprintln!(
            "[webview_mgr] ghost-sibling detected at slot ({}, {}, {}, {}) on parent='{}': closing '{}' before spawning '{}'",
            position.0, position.1, size.0, size.1,
            parent_window_label, ghost_label, new_label
        );
        log::warn!(
            "[webview_mgr] ghost-sibling closed: parent='{}' ghost='{}' incoming='{}' slot=({}, {}, {}, {})",
            parent_window_label, ghost_label, new_label, position.0, position.1, size.0, size.1
        );
        let _ = wv.close();
        registry.inner.write().remove(ghost_label);
    }
}

/// Registry of all child webviews currently mounted in a window.
/// Keyed by webview label. Geometry is tracked here so the drag
/// coordinator can hit-test pointer positions against known slots
/// without round-tripping through the OS.
#[derive(Default)]
pub struct WebviewRegistry {
    inner: RwLock<HashMap<String, WebviewMeta>>,
}

impl WebviewRegistry {
    /// Drop every entry in `dead_labels`. Called from `main.rs`
    /// `CloseRequested` because Tauri implicitly destroys a window's
    /// child webviews when the parent window closes — without going
    /// through `multiview_destroy`, so per-webview cleanup never
    /// runs and the registry would otherwise accumulate stale
    /// geometry for webviews that no longer exist.
    pub fn drop_labels(&self, dead_labels: &[String]) {
        if dead_labels.is_empty() { return; }
        let mut w = self.inner.write();
        for label in dead_labels {
            w.remove(label);
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct WebviewMeta {
    pub label: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct HostGeometry {
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

#[cfg(not(target_os = "macos"))]
fn default_host_geometry() -> HostGeometry {
    HostGeometry {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    }
}

#[cfg(target_os = "macos")]
fn top_inset_for_view_rect(parent_height: f64, rect: objc2_foundation::NSRect, parent_is_flipped: bool) -> f64 {
    if parent_is_flipped {
        rect.origin.y
    } else {
        (parent_height - rect.origin.y - rect.size.height).max(0.0)
    }
}

#[cfg(target_os = "macos")]
fn current_host_geometry(caller: &tauri::Webview) -> Result<HostGeometry, String> {
    use std::sync::mpsc::channel;

    let window_ptr = caller
        .window()
        .ns_window()
        .map_err(|e| format!("read ns_window failed: {}", e))?;

    let (window_frame, content_rect, content_layout_rect, content_view_frame) = unsafe {
        let window: &NSWindow = &*window_ptr.cast();
        let frame = window.frame();
        let content_rect = window.contentRectForFrameRect(frame);
        let content_layout_rect = window.contentLayoutRect();
        let content_view_frame = window.contentView().map(|view| view.frame());
        (frame, content_rect, content_layout_rect, content_view_frame)
    };

    let (tx, rx) = channel();
    caller
        .with_webview(move |webview| unsafe {
            let view: &NSView = &*webview.inner().cast();
            let host_frame = view.frame();
            let parent = view.superview();
            let parent_frame = parent.as_ref().map(|v| v.frame());
            let parent_is_flipped = parent.as_ref().map(|v| v.isFlipped()).unwrap_or(false);
            let parent_height = parent_frame
                .as_ref()
                .map(|frame| frame.size.height)
                .unwrap_or(host_frame.size.height);
            let host_y = top_inset_for_view_rect(parent_height, host_frame, parent_is_flipped);
            let _ = tx.send((
                host_frame,
                parent_frame,
                parent_height,
                parent_is_flipped,
                HostGeometry {
                    x: host_frame.origin.x,
                    y: host_y,
                    width: host_frame.size.width,
                    height: host_frame.size.height,
                },
            ));
        })
        .map_err(|e| format!("inspect host webview failed: {}", e))?;

    let (host_frame, parent_frame, parent_height, parent_is_flipped, host_geometry) = rx
        .recv()
        .map_err(|e| format!("host webview geometry unavailable: {}", e))?;

    let content_top_inset =
        top_inset_for_view_rect(window_frame.size.height, content_rect, false);
    let layout_top_inset =
        top_inset_for_view_rect(window_frame.size.height, content_layout_rect, false);
    let content_view_top_inset = content_view_frame
        .map(|rect| top_inset_for_view_rect(window_frame.size.height, rect, false))
        .unwrap_or(0.0);
    let host_fills_window = host_frame.origin.x.abs() < 0.5
        && host_frame.origin.y.abs() < 0.5
        && (host_frame.size.width - window_frame.size.width).abs() < 0.5
        && (host_frame.size.height - window_frame.size.height).abs() < 0.5;
    let host_top = host_geometry.y;
    let geometry = if host_fills_window && layout_top_inset > 0.0 {
        HostGeometry {
            x: content_layout_rect.origin.x.max(0.0),
            y: layout_top_inset,
            width: content_layout_rect.size.width.max(0.0),
            height: content_layout_rect.size.height.max(0.0),
        }
    } else {
        host_geometry
    };

    eprintln!(
        "[webview_mgr] host geometry analysis caller='{}' window='{}' \
window_frame=({}, {}, {}x{}) content_rect=({}, {}, {}x{}) content_top={} \
content_layout_rect=({}, {}, {}x{}) layout_top={} content_view_top={} \
host_frame=({}, {}, {}x{}) parent_frame={:?} parent_height={} parent_flipped={} host_top={} host_fills_window={} effective=({}, {}, {}x{})",
        caller.label(),
        caller.window().label(),
        window_frame.origin.x,
        window_frame.origin.y,
        window_frame.size.width,
        window_frame.size.height,
        content_rect.origin.x,
        content_rect.origin.y,
        content_rect.size.width,
        content_rect.size.height,
        content_top_inset,
        content_layout_rect.origin.x,
        content_layout_rect.origin.y,
        content_layout_rect.size.width,
        content_layout_rect.size.height,
        layout_top_inset,
        content_view_top_inset,
        host_frame.origin.x,
        host_frame.origin.y,
        host_frame.size.width,
        host_frame.size.height,
        parent_frame.map(|frame| (
            frame.origin.x,
            frame.origin.y,
            frame.size.width,
            frame.size.height
        )),
        parent_height,
        parent_is_flipped,
        host_top,
        host_fills_window,
        geometry.x,
        geometry.y,
        geometry.width,
        geometry.height
    );

    Ok(geometry)
}

#[cfg(not(target_os = "macos"))]
fn current_host_geometry(_caller: &tauri::Webview) -> Result<HostGeometry, String> {
    Ok(default_host_geometry())
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
    eprintln!(
        "[webview_mgr] spawn_internal parent='{}' label='{}' url='{}' pos=({}, {}) size=({}, {})",
        window.label(),
        label,
        url,
        position.0,
        position.1,
        size.0,
        size.1
    );
    log::info!(
        "[webview_mgr] spawn_internal parent='{}' label='{}' url='{}' pos=({}, {}) size=({}, {})",
        window.label(),
        label,
        url,
        position.0,
        position.1,
        size.0,
        size.1
    );
    ensure_child_webview_label(app, label, "spawn_internal")?;
    // Backstop against the ghost-views regression class. See
    // `close_ghost_siblings_at_slot` for the full reasoning.
    close_ghost_siblings_at_slot(app, window.label(), label, position, size);
    let builder = WebviewBuilder::new(label, WebviewUrl::App(url.into()));
    window
        .add_child(
            builder,
            LogicalPosition::new(position.0, position.1),
            LogicalSize::new(size.0, size.1),
        )
        .map_err(|e| {
            let msg = format!("add_child failed for {}: {}", label, e);
            eprintln!("[webview_mgr] {}", msg);
            msg
        })?;

    let registry: State<WebviewRegistry> = app.state();
    registry.inner.write().insert(
        label.to_string(),
        WebviewMeta {
            label: label.to_string(),
            x: position.0,
            y: position.1,
            width: size.0,
            height: size.1,
            url: url.to_string(),
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
pub fn multiview_spawn(
    app: AppHandle,
    caller: tauri::Webview,
    req: SpawnRequest,
) -> Result<(), String> {
    let parent = req.parent_window.as_deref().unwrap_or("main");
    eprintln!(
        "[webview_mgr] multiview_spawn caller='{}' caller_window='{}' parent='{}' label='{}' url='{}' pos=({}, {}) size=({}, {})",
        caller.label(),
        caller.window().label(),
        parent,
        req.label,
        req.url,
        req.x,
        req.y,
        req.width,
        req.height
    );
    log::info!(
        "[webview_mgr] multiview_spawn caller='{}' caller_window='{}' parent='{}' label='{}' url='{}' pos=({}, {}) size=({}, {})",
        caller.label(),
        caller.window().label(),
        parent,
        req.label,
        req.url,
        req.x,
        req.y,
        req.width,
        req.height
    );
    ensure_child_webview_label(&app, &req.label, "multiview_spawn")?;
    let window = app
        .get_window(parent)
        .ok_or_else(|| format!("parent window '{}' not found", parent))?;
    spawn_internal(&app, &window, &req.label, &req.url, (req.x, req.y), (req.width, req.height))
}

#[tauri::command]
pub fn multiview_get_host_geometry(caller: tauri::Webview) -> Result<HostGeometry, String> {
    let geometry = current_host_geometry(&caller)?;
    eprintln!(
        "[webview_mgr] multiview_get_host_geometry caller='{}' window='{}' host=({}, {}) size=({}, {})",
        caller.label(),
        caller.window().label(),
        geometry.x,
        geometry.y,
        geometry.width,
        geometry.height
    );
    log::info!(
        "[webview_mgr] multiview_get_host_geometry caller='{}' window='{}' host=({}, {}) size=({}, {})",
        caller.label(),
        caller.window().label(),
        geometry.x,
        geometry.y,
        geometry.width,
        geometry.height
    );
    Ok(geometry)
}

/// Destroy a child webview. The geometry registry entry is removed,
/// the subscription registry is cleaned up, and a
/// `multiview-destroyed` event is broadcast so JS state holders
/// (workspaceShell, lifecycle, etc.) can clean up.
#[tauri::command]
pub fn multiview_destroy(app: AppHandle, label: String) -> Result<(), String> {
    use tauri::Emitter;
    eprintln!("[webview_mgr] multiview_destroy label='{}'", label);
    log::info!("[webview_mgr] multiview_destroy label='{}'", label);
    ensure_child_webview_label(&app, &label, "multiview_destroy")?;
    // Resolve the doomed webview's parent window from the registry so
    // we close it (and notify its siblings) on the right window. The
    // previous code hardcoded `app.get_window("main")`, which silently
    // no-op'd whenever the webview belonged to a secondary window —
    // child webviews in that window would stay alive after their tab
    // was supposedly closed, presenting as "view stuck floating".
    let parent_window = app.webviews().get(&label).map(|wv| wv.window());
    if let Some(window) = &parent_window {
        if let Some(webview) = window.get_webview(&label) {
            webview
                .close()
                .map_err(|e| format!("close failed for {}: {}", label, e))?;
        }
    }
    let registry: State<WebviewRegistry> = app.state();
    registry.inner.write().remove(&label);
    // Clean up subscription registry — remove this label from all
    // event subscriber lists so future broadcasts don't try to
    // emit_to a label that no longer exists.
    let sub_registry: State<SubscriptionRegistry> = app.state();
    {
        let mut w = sub_registry.inner.write();
        for (_, s) in w.iter_mut() { s.remove(&label); }
    }
    // Notify only the sibling webviews of the destroyed one. Using
    // `app.emit("multiview-destroyed", …)` would broadcast to every
    // window — sibling shells would think one of their own tabs had
    // been destroyed and clean up state for it.
    if let Some(window) = parent_window {
        let payload = serde_json::json!({ "label": label });
        for wv in window.webviews() {
            let _ = app.emit_to(wv.label(), "multiview-destroyed", payload.clone());
        }
    }
    log::info!("[webview_mgr] destroyed '{}'", label);
    Ok(())
}

/// Destroy every child webview owned by `window_label` in a single
/// atomic Rust call.
///
/// Why this command exists: `beforeunload` on the shell webview used
/// to call `multiview_destroy(label)` once per spawned tab. Each call
/// is a separate IPC round-trip; in the few-ms window between the
/// `beforeunload` event firing and the JS context being torn down for
/// reload, only the first one or two IPCs land — the rest are
/// dropped, and the discarded child webviews survive into the next
/// boot as ghosts painting at the same coordinates as the new shell's
/// fresh spawns. (Live-captured 2026-05-05: 9 webviews after a
/// double-boot, three of them ghosts whose destroy IPCs lost the race.)
///
/// One IPC dispatch is enough to hand the work to Rust. Even if the
/// JS context vanishes immediately afterwards, the Rust side runs to
/// completion and tears down every child. The shell window's primary
/// webview (label == window_label) is excluded so we don't destroy
/// the live shell while it's reloading.
///
/// Returns the number of child webviews actually destroyed. Errors
/// individually per child are logged but do not abort the loop.
#[tauri::command]
pub fn multiview_destroy_all_for_window(
    app: AppHandle,
    window_label: String,
) -> Result<usize, String> {
    use tauri::Emitter;
    // Resolve the parent window to (a) confirm it exists and (b) emit
    // the completion event onto a real target.
    if app.get_webview_window(&window_label).is_none() {
        return Err(format!("window '{}' not found", window_label));
    }
    // Walk the global webview map and pick out webviews whose owning
    // window matches `window_label`. Excludes the primary webview of
    // that window (label == window_label) — that's the live shell and
    // closing it from inside its own beforeunload handler is the
    // tear-down path the OS runs anyway.
    let labels: Vec<String> = app
        .webviews()
        .iter()
        .filter(|(label, wv)| {
            label.as_str() != window_label.as_str()
                && wv.window().label() == window_label.as_str()
        })
        .map(|(label, _)| label.clone())
        .collect();
    eprintln!(
        "[webview_mgr] multiview_destroy_all_for_window window='{}' begin children={:?}",
        window_label, labels
    );
    let mut destroyed = 0usize;
    let registry: State<WebviewRegistry> = app.state();
    let sub_registry: State<SubscriptionRegistry> = app.state();
    for label in &labels {
        let webview = match app.webviews().get(label).cloned() {
            Some(wv) => wv,
            None => continue,
        };
        if let Err(e) = webview.close() {
            eprintln!(
                "[webview_mgr] destroy_all close failed label='{}' err={}",
                label, e
            );
            continue;
        }
        registry.inner.write().remove(label);
        {
            let mut w = sub_registry.inner.write();
            for (_, s) in w.iter_mut() {
                s.remove(label);
            }
        }
        destroyed += 1;
    }
    // Notify any siblings of the window that its tabs are gone. With a
    // reload-driven beforeunload there usually is no listener left to
    // hear it, but this matches the per-tab `multiview_destroy` contract
    // and keeps state consistent for any peer windows still alive.
    let payload_window = serde_json::json!({ "window": window_label });
    let _ = app.emit_to(window_label.as_str(), "multiview-destroyed-all", payload_window);
    eprintln!(
        "[webview_mgr] multiview_destroy_all_for_window window='{}' done destroyed={}",
        window_label, destroyed
    );
    Ok(destroyed)
}

/// Update geometry for one or more webviews in a single batch.
/// Batching minimizes IPC overhead during dock-divider drag where
/// multiple webviews resize per frame.
///
/// Resolves each webview directly via `app.webviews()` instead of
/// looking it up under a hardcoded `"main"` parent window — child
/// webviews hosted in secondary windows would otherwise silently
/// not receive the geometry update, leaving them painted at their
/// previous position while the placeholder DIV moves underneath.
#[tauri::command]
pub fn multiview_set_geometry(
    app: AppHandle,
    updates: Vec<GeometryUpdate>,
) -> Result<(), String> {
    let registry: State<WebviewRegistry> = app.state();
    let webviews = app.webviews();
    for update in updates {
        if let Some(webview) = webviews.get(&update.label) {
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
pub fn multiview_list(caller: tauri::Webview, app: AppHandle) -> Vec<WebviewMeta> {
    // Filter to webviews living in the caller's top-level window.
    // The shell's `lifecycle.js` LRU evictor uses this list to pick
    // an eviction victim when the soft cap is exceeded; without
    // window scoping it picks victims from sibling windows and
    // destroys their webviews — those windows' render loops then
    // respawn the destroyed tab, which in turn pushes the original
    // window over its cap and triggers another eviction → infinite
    // cascade of destroy/respawn ping-pong between windows. Bug
    // surfaced as opening a board in window A causing tabs in
    // window B to repeatedly destroy and respawn.
    let caller_window = caller.window();
    let window_labels: std::collections::HashSet<String> = caller_window
        .webviews()
        .into_iter()
        .map(|w| w.label().to_string())
        .collect();
    let registry: State<WebviewRegistry> = app.state();
    let guard = registry.inner.read();
    guard
        .values()
        .filter(|m| window_labels.contains(&m.label))
        .cloned()
        .collect()
}

/// Navigate an existing child webview to a new URL without destroying
/// and recreating it. Used by the lifecycle pool fast-path: pre-warmed
/// webviews live at a placeholder URL; on first activation they're
/// navigated to the real URL, which is dramatically cheaper than
/// `add_child` because the renderer process is already running.
///
/// Resolves the (typically relative) `url` against the main window's
/// own URL so the navigation lands on the same origin / asset protocol
/// the shell uses. Hardcoding `tauri://localhost/` would break on
/// targets that serve via `http://localhost:PORT` (dev) or a custom
/// asset protocol like `lexera-asset:` — both of which the kanban CSP
/// explicitly allows.
#[tauri::command]
pub fn multiview_navigate(app: AppHandle, label: String, url: String) -> Result<(), String> {
    eprintln!(
        "[webview_mgr] multiview_navigate label='{}' url='{}'",
        label,
        url
    );
    log::info!(
        "[webview_mgr] multiview_navigate label='{}' url='{}'",
        label,
        url
    );
    ensure_child_webview_label(&app, &label, "multiview_navigate")?;
    // Look up the webview across all windows — hardcoding the parent
    // as `app.get_window("main")` would silently fail for child
    // webviews hosted in secondary windows.
    let webview = app
        .webviews()
        .get(&label)
        .cloned()
        .ok_or_else(|| format!("no webview with label '{}'", label))?;

    // Try parsing as an absolute URL first (caller may pass a fully-
    // qualified url). If that fails, treat the input as a path relative
    // to the webview's CURRENT url and resolve against it. This keeps
    // navigation on the same origin (`http://localhost:PORT` in dev,
    // the configured asset protocol in built mode) instead of forcing
    // a hardcoded `tauri://` scheme that the kanban's CSP doesn't allow.
    let parsed = tauri::Url::parse(&url).or_else(|_| {
        let base = webview
            .url()
            .map_err(|e| format!("get webview url for '{}': {}", label, e))?;
        base.join(&url).map_err(|e| format!(
            "could not resolve '{}' against webview url '{}': {}",
            url, base, e
        ))
    })?;

    webview
        .navigate(parsed.clone())
        .map_err(|e| format!("navigate failed for {}: {}", label, e))?;
    let registry: State<WebviewRegistry> = app.state();
    if let Some(meta) = registry.inner.write().get_mut(&label) {
        meta.url = url.clone();
    }
    log::info!("[webview_mgr] navigated '{}' to '{}' (resolved: {})", label, url, parsed);
    Ok(())
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
    ensure_child_webview_label(&app, &label, "multiview_set_visible")?;
    // Resolve via `app.webviews()` so secondary-window child webviews
    // can also be hidden / shown — hardcoded `"main"` would silently
    // skip them, leaving stale child webviews visible above the wrong
    // placeholders.
    let webviews = app.webviews();
    if let Some(webview) = webviews.get(&label) {
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

// ── Event subscription registry (Stage 9) ──────────────────────
//
// Views declare which events they care about via multiview_subscribe.
// multiview_broadcast then only forwards to subscribers, avoiding the
// "wake every webview for every event" overhead. Views that haven't
// subscribed to anything receive nothing (explicit opt-in).
//
// Events that have no subscribers fall back to `app.emit()` (global
// broadcast) so back-compat is preserved for code that hasn't been
// updated to use the subscription API.
//
// MULTI-WINDOW SAFETY. The registry itself is process-global —
// `event_name → Set<webview_label>`, no window context. That's safe
// today because:
//   1. Webview labels include the per-shell bootId (see boardHost.js
//      / panelHost.js), so labels are globally unique across windows.
//   2. `multiview_broadcast` filters subscribers post-lookup against
//      the caller window's `webviews()`, so even if a sibling-window
//      label somehow ended up in the registry, it would be skipped.
//   3. `CloseRequested` invokes `drop_labels` for the closing
//      window's webviews so the registry doesn't accumulate ghosts.
// If any of those invariants change (e.g. labels stop including
// bootId, or `multiview_broadcast` drops the post-lookup filter),
// re-key this registry by `(window_label, webview_label)` to
// restore the contract.

#[derive(Default)]
pub struct SubscriptionRegistry {
    // event_name -> set of webview labels subscribed
    inner: parking_lot::RwLock<std::collections::HashMap<String, std::collections::HashSet<String>>>,
}

impl SubscriptionRegistry {
    /// Drop every subscription registered by any of the supplied
    /// webview labels. Called from the window-close handler so the
    /// registry doesn't accumulate stale labels of destroyed webviews.
    pub fn drop_labels(&self, labels: &[String]) {
        if labels.is_empty() { return; }
        let mut w = self.inner.write();
        for (_event, subs) in w.iter_mut() {
            for label in labels {
                subs.remove(label);
            }
        }
    }
}

#[tauri::command]
pub fn multiview_subscribe(
    app: AppHandle,
    caller: tauri::Webview,
    label: String,
    events: Vec<String>,
) -> Result<(), String> {
    // Defensive: only allow subscribing labels that live in the
    // caller's window. With unique bootId-suffixed labels a sibling
    // label is hard to guess, but a buggy caller passing the wrong
    // label would otherwise pollute the registry with subscriptions
    // for a webview the caller doesn't own.
    let caller_window = caller.window();
    let owns = caller_window
        .webviews()
        .into_iter()
        .any(|w| w.label() == label);
    if !owns {
        return Err(format!(
            "multiview_subscribe refused: label '{}' not in caller window '{}'",
            label,
            caller_window.label()
        ));
    }
    let reg: State<SubscriptionRegistry> = app.state();
    let mut w = reg.inner.write();
    for e in events {
        w.entry(e).or_insert_with(Default::default).insert(label.clone());
    }
    Ok(())
}

/// Debug: print a message to Tauri's stderr from JS. Used during the
/// "duplicate spawn" investigation when console.error in the webview
/// doesn't reach the kanban stdout. Remove after the loop is fixed.
#[tauri::command]
pub fn ws_debug_log(message: String) {
    eprintln!("[ws-debug] {}", message);
}

#[tauri::command]
pub fn multiview_unsubscribe(
    app: AppHandle,
    caller: tauri::Webview,
    label: String,
    events: Option<Vec<String>>,
) -> Result<(), String> {
    // Defensive: a window must only unsubscribe labels it owns.
    // Otherwise a buggy/malicious caller in window B could pass
    // window A's webview label and silently unhook A's event flow.
    let caller_window = caller.window();
    let owns = caller_window
        .webviews()
        .into_iter()
        .any(|w| w.label() == label);
    if !owns {
        return Err(format!(
            "multiview_unsubscribe refused: label '{}' not in caller window '{}'",
            label,
            caller_window.label()
        ));
    }
    let reg: State<SubscriptionRegistry> = app.state();
    let mut w = reg.inner.write();
    match events {
        Some(evs) => {
            for e in evs {
                if let Some(s) = w.get_mut(&e) { s.remove(&label); }
            }
        }
        None => {
            // Remove this label from all event subscriber lists
            for (_, s) in w.iter_mut() { s.remove(&label); }
        }
    }
    Ok(())
}

fn subscribers_for(reg: &SubscriptionRegistry, event: &str) -> Vec<String> {
    let r = reg.inner.read();
    r.get(event).map(|s| s.iter().cloned().collect()).unwrap_or_default()
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
    pub target: String,
    pub message: String,
    pub timestamp_ms: f64,
}

/// Broadcast a log entry to every webview that has subscribed to
/// `log-message`. Called from the main kanban process whenever
/// lexeraLog is invoked, so any open log sub-app webview sees it.
///
/// Filtered via SubscriptionRegistry: only webviews that called
/// `multiview_subscribe(['log-message'])` actually wake up. This
/// prevents the dozen-plus settings/board/calendar webviews from being
/// woken on every log line. Log events are intentionally cross-window:
/// the in-app Log panel in any window reflects activity from any
/// window's webviews. So this one keeps the global broadcast.
#[tauri::command]
pub fn log_broadcast(app: AppHandle, entry: LogEvent) -> Result<(), String> {
    use tauri::Emitter;
    let reg: State<SubscriptionRegistry> = app.state();
    let subs = subscribers_for(&reg, "log-message");
    if subs.is_empty() {
        let _ = app.emit("log-message", entry);
    } else {
        for label in subs {
            let _ = app.emit_to(label.as_str(), "log-message", entry.clone());
        }
    }
    Ok(())
}

/// Emit `event` to every webview in the same top-level window as
/// `source_label`. Used by lifecycle commands (`drag-began`,
/// `drag-ended`, `focus-changed`, `multiview-destroyed`, …) that
/// historically called `app.emit(…)` (global broadcast) — Tauri 2's
/// emit-side has no per-webview filter, so a global emit reaches
/// every listener regardless of webview target and leaks across
/// windows. Resolve the source's parent via `app.webviews().get(label)
/// .window()`, then `emit_to` each webview in that window only.
///
/// Silently no-ops when the source webview has been closed by the
/// time the event fires — the alternative is a stray global broadcast.
pub fn emit_to_window_of_label<S>(app: &AppHandle, source_label: &str, event: &str, payload: S)
where
    S: Serialize + Clone,
{
    use tauri::Emitter;
    let source_window = match app.webviews().get(source_label) {
        Some(wv) => wv.window(),
        None => return,
    };
    for wv in source_window.webviews() {
        let _ = app.emit_to(wv.label(), event, payload.clone());
    }
}

/// Generic event broadcaster — scoped to the CALLER'S window.
///
/// Each top-level window owns one workspace shell + its child
/// multiview webviews. Events emitted by a sub-app must reach only
/// the shell + sibling webviews IN THE SAME WINDOW; routing them
/// across windows is the source of "the views show in the wrong
/// window" reports (a panel click in window B opens the board in
/// window A's shell).
///
/// Behaviour:
///   * Find every webview attached to the caller's top-level window.
///   * If the event has registered subscribers (`multiview_subscribe`),
///     emit only to those subscribers WHOSE LABEL is one of the
///     caller-window's webviews. Cross-window subscribers are skipped.
///   * If no subscribers, emit to every webview in the caller's
///     window (one-shot fan-out, no cross-window leak).
#[tauri::command]
pub fn multiview_broadcast(
    app: AppHandle,
    caller: tauri::Webview,
    event: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    use tauri::Emitter;
    let caller_window = caller.window();
    let window_webview_labels: std::collections::HashSet<String> = caller_window
        .webviews()
        .into_iter()
        .map(|w| w.label().to_string())
        .collect();

    let reg: State<SubscriptionRegistry> = app.state();
    let subs = subscribers_for(&reg, &event);
    if subs.is_empty() {
        for label in &window_webview_labels {
            let _ = app.emit_to(label.as_str(), &event, payload.clone());
        }
    } else {
        for label in subs {
            if !window_webview_labels.contains(&label) { continue; }
            let _ = app.emit_to(label.as_str(), &event, payload.clone());
        }
    }
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
    caller: tauri::Webview,
    spec: ModalSpec,
) -> Result<(), String> {
    use tauri::WebviewWindowBuilder;
    let url_obj = tauri::WebviewUrl::App(spec.url.into());
    let mut builder = WebviewWindowBuilder::new(&app, &spec.label, url_obj);
    // Tie the modal's lifecycle and stacking to the WINDOW that
    // requested it. Without `parent`, the modal floats above every
    // open window — opening a confirm dialog from window B would
    // appear over window A too, which is confusing and (on macOS)
    // drags focus across windows. With `parent`, the OS keeps the
    // modal grouped with its opener and auto-closes it when the
    // parent closes. `parent()` consumes the builder and returns a
    // Result, so it must run before the other chained config.
    let caller_window = caller.window();
    if let Some(parent_window) = app.get_webview_window(caller_window.label()) {
        builder = builder
            .parent(&parent_window)
            .map_err(|e| format!("modal parent attach failed for {}: {}", spec.label, e))?;
    }
    builder = builder
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
    log::info!(
        "[modal] opened '{}' (parent='{}')",
        spec.label,
        caller_window.label()
    );
    Ok(())
}

#[tauri::command]
pub fn multiview_close_window(
    app: AppHandle,
    caller: tauri::Webview,
    label: String,
) -> Result<(), String> {
    // Defensive: a webview can only close ITS OWN window. The single
    // production caller is a modal closing itself
    // (`views/modals/confirm.html` / `prompt.html` after the user
    // clicks OK / Cancel). Without this check, a sub-app webview in
    // window B could call `multiview_close_window("main")` and
    // terminate window A — destructive and invisible to the user.
    let caller_window_label = caller.window().label().to_string();
    if caller_window_label != label {
        return Err(format!(
            "multiview_close_window refused: caller window '{}' cannot close foreign window '{}'",
            caller_window_label, label
        ));
    }
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
// currently-focused webview PER WINDOW so each window's shell can
// query "what has focus in MY window" without seeing focus state
// from sibling windows.
//
// Earlier shape (`Mutex<Option<String>>`) was a process-wide
// singleton: window B's shell calling `multiview_get_focused`
// could receive a label from window A, breaking shortcut routing
// and focus indicators in multi-window setups.

#[derive(Default)]
pub struct FocusTracker {
    inner: parking_lot::Mutex<std::collections::HashMap<String, Option<String>>>,
}

impl FocusTracker {
    /// Drop every label belonging to the closing window from the
    /// tracker. Called by `main.rs` `CloseRequested` so the registry
    /// doesn't accumulate stale per-window slots over multi-window
    /// open/close churn.
    pub fn drop_window(&self, window_label: &str) {
        self.inner.lock().remove(window_label);
    }
}

#[derive(Serialize, Clone)]
struct FocusChangedEvent {
    label: Option<String>,
}

#[tauri::command]
pub fn multiview_set_focused(
    app: AppHandle,
    label: String,
    focused: bool,
) -> Result<(), String> {
    // Resolve the affected webview's parent window so we update the
    // right window's slot. If the webview has already been destroyed
    // by the time the report arrives (typical end-of-frame race),
    // silently drop the event.
    let window_label = match app.webviews().get(&label) {
        Some(wv) => wv.window().label().to_string(),
        None => return Ok(()),
    };
    let tracker: State<FocusTracker> = app.state();
    let mut map = tracker.inner.lock();
    let current = map.get(&window_label).cloned().flatten();
    let new_label: Option<String> = if focused {
        Some(label.clone())
    } else if current.as_deref() == Some(label.as_str()) {
        None
    } else {
        // Blur from a label that wasn't this window's focused webview — ignore
        return Ok(());
    };
    if current != new_label {
        map.insert(window_label.clone(), new_label.clone());
        drop(map);
        log::info!("[focus] window '{}' now: {:?}", window_label, new_label);
        // Scope the emit to webviews in the same window as the
        // affected label. `label` is the webview that gained or lost
        // focus; `new_label` is None on blur.
        emit_to_window_of_label(
            &app,
            &label,
            "focus-changed",
            FocusChangedEvent { label: new_label },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn multiview_get_focused(caller: tauri::Webview, tracker: State<FocusTracker>) -> Option<String> {
    // Return the focused webview for THIS WINDOW only — not whatever
    // happens to be globally focused across the app.
    let window_label = caller.window().label().to_string();
    tracker.inner.lock().get(&window_label).cloned().flatten()
}

// ── Health indicator (per-view connection state) ────────────────
//
// Each view reports its current health to Rust:
//   green  — fully synced, responsive
//   yellow — syncing / partial / reconnecting
//   red    — disconnected / failed / not-responding
//
// The shell shows a colored dot on each webview's placeholder so
// users can tell at a glance whether each view is up-to-date.

#[derive(Default)]
pub struct HealthTracker {
    inner: parking_lot::RwLock<std::collections::HashMap<String, String>>,
}

impl HealthTracker {
    /// Drop every label in `dead_labels` from the tracker. Called by
    /// `main.rs` `CloseRequested` so a window's webview-health entries
    /// don't linger after its window is gone.
    pub fn drop_labels(&self, dead_labels: &[String]) {
        let mut w = self.inner.write();
        for label in dead_labels {
            w.remove(label);
        }
    }
}

#[derive(Serialize, Clone)]
struct HealthChangedEvent {
    label: String,
    state: String,
}

#[tauri::command]
pub fn multiview_set_health(
    app: AppHandle,
    label: String,
    state: String,
) -> Result<(), String> {
    let valid = matches!(state.as_str(), "green" | "yellow" | "red" | "unknown");
    if !valid {
        return Err(format!("invalid health state '{}'; expected green/yellow/red/unknown", state));
    }
    let tracker: State<HealthTracker> = app.state();
    let mut changed = false;
    {
        let mut w = tracker.inner.write();
        let prev = w.get(&label).cloned();
        if prev.as_deref() != Some(state.as_str()) {
            w.insert(label.clone(), state.clone());
            changed = true;
        }
    }
    if changed {
        // Only the windowing the affected webview should re-paint
        // health dots. A global emit would mean every shell repaints
        // for unrelated webviews in other windows.
        emit_to_window_of_label(
            &app,
            &label,
            "health-changed",
            HealthChangedEvent { label: label.clone(), state: state.clone() },
        );
    }
    Ok(())
}

#[tauri::command]
pub fn multiview_get_health(
    caller: tauri::Webview,
    tracker: State<HealthTracker>,
    label: String,
) -> Option<String> {
    // Refuse queries that cross window boundaries. Window B asking
    // for `multiview_get_health(<labelInWindowA>)` would otherwise
    // return window A's state — a defensive scope that matches
    // multiview_list_health. With unique bootId-suffixed labels
    // (see boardHost / panelHost) a sibling label is harmless to
    // see, but tightening at this entry point keeps the contract
    // consistent regardless of label-uniqueness invariants.
    let caller_window = caller.window();
    let label_belongs = caller_window
        .webviews()
        .into_iter()
        .any(|w| w.label() == label);
    if !label_belongs {
        return None;
    }
    tracker.inner.read().get(&label).cloned()
}

#[tauri::command]
pub fn multiview_list_health(
    caller: tauri::Webview,
    tracker: State<HealthTracker>,
) -> std::collections::HashMap<String, String> {
    // Filter to webviews that live in the caller's window. The
    // HealthTracker map is shared across the whole app; without this
    // filter a window's "list all" call returned health entries for
    // sibling-window webviews too — which would either silently confuse
    // the UI or lead to phantom health dots if the consumer ever
    // surfaced those labels.
    let caller_window = caller.window();
    let window_labels: std::collections::HashSet<String> = caller_window
        .webviews()
        .into_iter()
        .map(|w| w.label().to_string())
        .collect();
    tracker
        .inner
        .read()
        .iter()
        .filter(|(label, _)| window_labels.contains(label.as_str()))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
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
        WebviewMeta { label: label.into(), x, y, width: w, height: h, url: String::new() }
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

    #[test]
    fn drop_labels_removes_only_named_entries() {
        let r = registry_with(vec![
            meta("a", 0.0, 0.0, 1.0, 1.0),
            meta("b", 0.0, 0.0, 1.0, 1.0),
            meta("c", 0.0, 0.0, 1.0, 1.0),
        ]);
        // Drop two of three.
        r.drop_labels(&["a".to_string(), "c".to_string()]);
        assert!(get_meta(&r, "a").is_none());
        assert!(get_meta(&r, "c").is_none());
        assert!(get_meta(&r, "b").is_some());
    }

    #[test]
    fn drop_labels_empty_input_is_noop() {
        let r = registry_with(vec![meta("a", 0.0, 0.0, 1.0, 1.0)]);
        r.drop_labels(&[]);
        assert!(get_meta(&r, "a").is_some());
    }

    #[test]
    fn drop_labels_unknown_label_is_silent_noop() {
        let r = registry_with(vec![meta("a", 0.0, 0.0, 1.0, 1.0)]);
        r.drop_labels(&["nonexistent".to_string()]);
        assert!(get_meta(&r, "a").is_some());
    }

    // ── Ghost-sibling slot detector (commit feature: TODO line 75) ──
    //
    // Pre-condition for the user-reported "ghost views in the
    // background" regression: an old shell webview was reloaded
    // mid-spawn, its `destroyAll()` IPCs lost the race, and N orphan
    // child webviews kept painting at the same slots the new shell's
    // fresh spawns occupy. The two earlier fixes (idempotent sync
    // scripts + atomic destroy-all-for-window) close known triggers;
    // this detector catches any future trigger we haven't anticipated
    // by closing any sibling already painting at the new spawn's slot.

    #[test]
    fn ghost_sibling_finds_exact_slot_match_with_different_label() {
        // The user-visible scenario: old bootId is mosg0xej, new is
        // mosg22hy. Different labels, identical placeholder slot.
        let r = registry_with(vec![
            meta("panel-tab-mosg0xej-3rb6c-tab-x-a", 1.0, 57.0, 221.0, 455.0),
        ]);
        let ghosts = ghost_sibling_labels_at_slot(
            &r, "panel-tab-mosg22hy-g9mfr-tab-x-a", (1.0, 57.0), (221.0, 455.0));
        assert_eq!(ghosts, vec!["panel-tab-mosg0xej-3rb6c-tab-x-a".to_string()]);
    }

    #[test]
    fn ghost_sibling_skips_same_label() {
        // Same label is Tauri's add_child collision case — handled
        // separately. The detector must NOT close a same-label peer
        // (would mask a real bug).
        let r = registry_with(vec![
            meta("dup", 0.0, 0.0, 100.0, 100.0),
        ]);
        let ghosts = ghost_sibling_labels_at_slot(&r, "dup", (0.0, 0.0), (100.0, 100.0));
        assert!(ghosts.is_empty());
    }

    #[test]
    fn ghost_sibling_ignores_legitimately_distinct_slots() {
        // Two panels in different docks: same parent window, different
        // coordinates. Must not be flagged as ghosts of each other.
        let r = registry_with(vec![
            meta("panel-left", 1.0, 57.0, 221.0, 455.0),
            meta("panel-right", 1001.0, 57.0, 198.0, 720.0),
        ]);
        let ghosts = ghost_sibling_labels_at_slot(
            &r, "panel-bottom", (1.0, 689.0), (1198.0, 110.0));
        assert!(ghosts.is_empty());
    }

    #[test]
    fn ghost_sibling_tolerates_subpixel_rounding_noise() {
        // Slot coordinates round-trip through f64 layout math + native
        // LogicalPosition conversion. Within 0.5 px must still match.
        let r = registry_with(vec![
            meta("ghost", 1.0, 57.0, 221.0, 455.0),
        ]);
        let ghosts = ghost_sibling_labels_at_slot(
            &r, "fresh", (1.4, 56.6), (221.3, 455.4));
        assert_eq!(ghosts, vec!["ghost".to_string()]);
    }

    #[test]
    fn ghost_sibling_rejects_more_than_half_pixel_drift() {
        // 0.5 px is the threshold; >0.5 px must NOT match (otherwise
        // adjacent slots would falsely flag each other).
        let r = registry_with(vec![
            meta("a", 0.0, 0.0, 100.0, 100.0),
        ]);
        let ghosts = ghost_sibling_labels_at_slot(&r, "b", (0.6, 0.0), (100.0, 100.0));
        assert!(ghosts.is_empty(), "0.6 px drift should not match");
    }

    #[test]
    fn ghost_sibling_returns_all_overlapping_siblings_at_the_slot() {
        // Two ghosts somehow stacked at the same slot — both must be
        // reported so the spawn can clear them all.
        let r = registry_with(vec![
            meta("ghost-1", 1.0, 57.0, 221.0, 455.0),
            meta("ghost-2", 1.0, 57.0, 221.0, 455.0),
            meta("not-ghost", 999.0, 999.0, 100.0, 100.0),
        ]);
        let mut ghosts = ghost_sibling_labels_at_slot(
            &r, "fresh", (1.0, 57.0), (221.0, 455.0));
        ghosts.sort();
        assert_eq!(ghosts, vec!["ghost-1".to_string(), "ghost-2".to_string()]);
    }
}
