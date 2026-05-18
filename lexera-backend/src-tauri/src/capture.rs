/// Quick Capture: opens a small floating window for clipboard/drop capture.
/// Also manages the in-memory clipboard history.
use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext as CrsContext, ContentFormat};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Re-export from lexera-core for backward compatibility.
pub type ClipboardEntry = lexera_core::capture::CaptureEntry;

/// Shared clipboard history, newest first.
pub type ClipboardHistory = Arc<Mutex<Vec<ClipboardEntry>>>;

/// Maximum number of clipboard entries to retain in memory.
const MAX_CLIPBOARD_HISTORY: usize = 50;
/// Width of the quick-capture popup in expanded mode (logical pixels).
const CAPTURE_WINDOW_WIDTH: f64 = 420.0;
/// Height of the quick-capture popup in expanded mode (logical pixels).
const CAPTURE_WINDOW_HEIGHT: f64 = 460.0;
/// Width of the quick-capture strip (collapsed drop target) in logical pixels.
const CAPTURE_STRIP_WIDTH: f64 = 32.0;
/// Height of the quick-capture strip in logical pixels.
const CAPTURE_STRIP_HEIGHT: f64 = 460.0;
/// Milliseconds to wait for the simulated Cmd+C to complete before reading clipboard.
const COPY_SIMULATION_DELAY_MS: u64 = 150;
/// Maximum PNG payload size for clipboard image conversion to base64.
/// Prevents large clipboard images from causing UI stalls or crashes.
const MAX_CLIPBOARD_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Interval for checking monitor configuration changes (seconds).
const MONITOR_CHECK_INTERVAL_SECS: u64 = 3;

static NEXT_ENTRY_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
/// Track last known monitor rect so we can detect config changes.
static LAST_MONITOR_WIDTH: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static LAST_MONITOR_HEIGHT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
static LAST_MONITOR_X: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static LAST_MONITOR_Y: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
/// Guard against spawning multiple monitor watcher threads on close/reopen cycles.
static MONITOR_WATCHER_RUNNING: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Read current clipboard content and add as a new entry to the history.
/// Called by the clipboard watcher on each change.
pub fn capture_clipboard_to_history(history: &ClipboardHistory) {
    let ctx = match CrsContext::new() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[lexera.capture] Failed to create clipboard context: {}", e);
            return;
        }
    };

    let text = ctx.get_text().ok().filter(|t| !t.is_empty());
    let has_image_flag = ctx.has(ContentFormat::Image);
    let has_text_flag = ctx.has(ContentFormat::Text);
    let (image_data, image_filename) = read_image_as_base64(&ctx);
    log::info!(
        "[lexera.capture] Clipboard snapshot flags image={} text={} resolved_image={} resolved_text={}",
        has_image_flag,
        has_text_flag,
        image_data.is_some(),
        text.as_ref().map(|t| !t.is_empty()).unwrap_or(false)
    );

    if text.is_none() && image_data.is_none() {
        return;
    }

    let ts = lexera_core::capture::timestamp_millis();

    let entry = ClipboardEntry {
        id: NEXT_ENTRY_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
        text,
        image_data,
        image_filename,
        timestamp: ts,
    };

    if let Ok(mut hist) = history.lock() {
        hist.insert(0, entry);
        hist.truncate(MAX_CLIPBOARD_HISTORY);
    }
}

/// Read clipboard image as base64 PNG string.
fn read_image_as_base64(ctx: &CrsContext) -> (Option<String>, Option<String>) {
    let image = match ctx.get_image() {
        Ok(img) => img,
        Err(error) => {
            log::info!(
                "[lexera.capture] Clipboard image read skipped: get_image failed: {}",
                error
            );
            return (None, None);
        }
    };

    let (width, height) = image.get_size();
    if width == 0 || height == 0 {
        log::warn!(
            "[lexera.capture] Clipboard image read failed: image has invalid dimensions {}x{}",
            width,
            height
        );
        return (None, None);
    }

    let png = match image.to_png() {
        Ok(data) => data,
        Err(error) => {
            log::warn!(
                "[lexera.capture] Clipboard image conversion to PNG failed ({}x{}): {}",
                width,
                height,
                error
            );
            return (None, None);
        }
    };
    let png_bytes = png.get_bytes();
    if png_bytes.is_empty() {
        log::warn!(
            "[lexera.capture] Clipboard image conversion produced empty payload ({}x{})",
            width,
            height
        );
        return (None, None);
    }
    if png_bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        log::warn!(
            "[lexera.capture] Clipboard image skipped: payload {} bytes exceeds limit {} bytes ({}x{})",
            png_bytes.len(),
            MAX_CLIPBOARD_IMAGE_BYTES,
            width,
            height
        );
        return (None, None);
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, png_bytes);
    let filename = format!("clipboard-{}.png", ts);
    log::info!(
        "[lexera.capture] Clipboard image captured {}x{} bytes={} filename={}",
        width,
        height,
        png_bytes.len(),
        filename
    );

    (Some(b64), Some(filename))
}

/// Copy the current selection (simulate Cmd+C), then open the capture popup.
/// Spawns async so the shortcut handler doesn't block.
#[cfg(target_os = "macos")]
pub fn capture_selection_and_open(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Suppress clipboard watcher while we simulate Cmd+C
        crate::clipboard_watcher::set_suppress(true);

        // Simulate Cmd+C via AppleScript to copy current selection
        let _ = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"c\" using command down")
            .output()
            .await;

        // Brief delay for the copy to complete
        tokio::time::sleep(std::time::Duration::from_millis(COPY_SIMULATION_DELAY_MS)).await;

        // Capture the selection into history before re-enabling watcher
        if let Some(history) = app.try_state::<ClipboardHistory>() {
            capture_clipboard_to_history(&history);
        }

        crate::clipboard_watcher::set_suppress(false);

        open_capture_popup(&app);
    });
}

#[cfg(not(target_os = "macos"))]
pub fn capture_selection_and_open(app: &AppHandle) {
    log::warn!(
        "[lexera.capture] Selection capture via AppleScript is not supported on this platform"
    );
    open_capture_popup(app);
}

/// Focus the quick-capture window: open if needed, expand, and focus.
/// Called on Cmd+B — always shows the expanded panel.
pub fn focus_capture_popup(app: &AppHandle) {
    let just_created = app.get_webview_window("quick-capture").is_none();
    if just_created {
        open_capture_popup(app);
        // Wait briefly for the webview to initialize before expanding
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
    // Expand and focus
    let _ = expand_capture(app.clone());
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.show();
        let _ = window.set_focus();
        // Retry focus after a short delay (macOS sometimes ignores the first focus call)
        let app_clone = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            if let Some(w) = app_clone.get_webview_window("quick-capture") {
                let _ = w.set_focus();
            }
        });
        let _ = window.emit("capture-expanded", ());
    }
}

/// Open (or show) the quick-capture window in strip (collapsed) mode.
/// The strip is a thin drop-target bar snapped to a screen edge.
pub fn open_capture_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.show();
        return;
    }

    // Create window in strip mode — thin, snapped to right edge
    match WebviewWindowBuilder::new(
        app,
        "quick-capture",
        WebviewUrl::App("quick-capture.html".into()),
    )
    .title("Quick Capture")
    .inner_size(CAPTURE_STRIP_WIDTH, CAPTURE_STRIP_HEIGHT)
    .resizable(false)
    .always_on_top(true)
    .focused(false)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .build()
    {
        Ok(_) => {
            log::info!("[lexera.capture] Quick capture strip opened");
            // Snap to saved side (default right)
            let side = "right".to_string();
            let _ = snap_capture_strip(app, &side);
            // Start periodic monitor watcher for screen changes
            start_monitor_watcher(app.clone());
        }
        Err(e) => log::error!("[lexera.capture] Failed to open capture window: {}", e),
    }
}

/// Get the quick-capture window and its display scale factor.
fn capture_window(app: &AppHandle) -> Result<(tauri::WebviewWindow, f64), CaptureError> {
    let window = app
        .get_webview_window("quick-capture")
        .ok_or(CaptureError::WindowNotFound)?;
    let scale = window.scale_factor().unwrap_or(1.0);
    Ok((window, scale))
}

/// Typed error for capture-window helpers (`capture_window`, `monitor_rect`,
/// `detect_side`, `snap_capture_strip`). Display impls reproduce the prior
/// stringified shapes so the `From<CaptureError> for String` boundary at the
/// existing `?` call sites in the surrounding Tauri commands stays
/// byte-identical to the previous `Result<_, String>` implementation.
#[derive(Debug, thiserror::Error)]
pub(super) enum CaptureError {
    #[error("{0}")]
    Tauri(#[from] tauri::Error),
    #[error("No monitor")]
    NoMonitor,
    #[error("Window not found")]
    WindowNotFound,
}

impl From<CaptureError> for String {
    fn from(err: CaptureError) -> String {
        err.to_string()
    }
}

/// Get current monitor position and size for a window.
fn monitor_rect(
    window: &tauri::WebviewWindow,
) -> Result<(tauri::PhysicalPosition<i32>, tauri::PhysicalSize<u32>), CaptureError> {
    let monitor = window.current_monitor()?.ok_or(CaptureError::NoMonitor)?;
    Ok((*monitor.position(), *monitor.size()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct MonitorRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

impl MonitorRect {
    fn from_parts(position: tauri::PhysicalPosition<i32>, size: tauri::PhysicalSize<u32>) -> Self {
        Self {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CaptureResnapMode {
    Strip,
    Expanded,
}

fn did_monitor_rect_change(current: MonitorRect) -> bool {
    let prev_w = LAST_MONITOR_WIDTH.swap(current.width, std::sync::atomic::Ordering::Relaxed);
    let prev_h = LAST_MONITOR_HEIGHT.swap(current.height, std::sync::atomic::Ordering::Relaxed);
    let prev_x = LAST_MONITOR_X.swap(current.x, std::sync::atomic::Ordering::Relaxed);
    let prev_y = LAST_MONITOR_Y.swap(current.y, std::sync::atomic::Ordering::Relaxed);
    prev_w != 0
        && (prev_w != current.width
            || prev_h != current.height
            || prev_x != current.x
            || prev_y != current.y)
}

fn is_capture_window_in_bounds(pos: tauri::PhysicalPosition<i32>, monitor: MonitorRect) -> bool {
    pos.x >= monitor.x
        && pos.y >= monitor.y
        && pos.x < monitor.x + monitor.width as i32
        && pos.y < monitor.y + monitor.height as i32
}

fn plan_capture_resnap(
    pos: tauri::PhysicalPosition<i32>,
    monitor: MonitorRect,
    monitor_changed: bool,
    is_expanded: bool,
) -> Option<CaptureResnapMode> {
    if is_capture_window_in_bounds(pos, monitor) && !monitor_changed {
        return None;
    }
    Some(if is_expanded {
        CaptureResnapMode::Expanded
    } else {
        CaptureResnapMode::Strip
    })
}

fn try_acquire_monitor_watcher_guard() -> bool {
    MONITOR_WATCHER_RUNNING
        .compare_exchange(
            false,
            true,
            std::sync::atomic::Ordering::Acquire,
            std::sync::atomic::Ordering::Relaxed,
        )
        .is_ok()
}

fn release_monitor_watcher_guard() {
    MONITOR_WATCHER_RUNNING.store(false, std::sync::atomic::Ordering::Release);
}

#[cfg(test)]
fn reset_capture_monitor_state_for_tests() {
    LAST_MONITOR_WIDTH.store(0, std::sync::atomic::Ordering::Relaxed);
    LAST_MONITOR_HEIGHT.store(0, std::sync::atomic::Ordering::Relaxed);
    LAST_MONITOR_X.store(0, std::sync::atomic::Ordering::Relaxed);
    LAST_MONITOR_Y.store(0, std::sync::atomic::Ordering::Relaxed);
    release_monitor_watcher_guard();
}

/// Calculate X coordinate for snapping to a screen edge.
fn side_x(side: &str, monitor_x: i32, monitor_width: u32, window_width: i32) -> i32 {
    if side == "left" {
        monitor_x
    } else {
        monitor_x + monitor_width as i32 - window_width
    }
}

/// Snap the strip-mode window to a screen edge vertically centered.
fn snap_capture_strip(app: &AppHandle, side: &str) -> Result<(), CaptureError> {
    let (window, scale) = capture_window(app)?;
    let phys_w = (CAPTURE_STRIP_WIDTH * scale) as i32;
    let phys_h = (CAPTURE_STRIP_HEIGHT * scale) as i32;
    let (monitor_pos, monitor_size) = monitor_rect(&window)?;

    let x = side_x(side, monitor_pos.x, monitor_size.width, phys_w);
    let y = monitor_pos.y + (monitor_size.height as i32 - phys_h) / 2;

    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))?;

    Ok(())
}

/// Re-snap the quick-capture window if the monitor configuration changed
/// or if the window is outside the current monitor bounds.
/// Call this periodically or after display configuration changes.
pub fn validate_capture_position(app: &AppHandle) {
    let window = match app.get_webview_window("quick-capture") {
        Some(w) => w,
        None => return,
    };
    let pos = match window.outer_position() {
        Ok(p) => p,
        Err(_) => return,
    };
    let (monitor_pos, monitor_size) = match monitor_rect(&window) {
        Ok(r) => r,
        Err(_) => return,
    };
    let monitor = MonitorRect::from_parts(monitor_pos, monitor_size);

    // Detect monitor configuration change (resolution, position, or monitor swap)
    let monitor_changed = did_monitor_rect_change(monitor);
    let in_bounds = is_capture_window_in_bounds(pos, monitor);
    let side = detect_side(&window).unwrap_or_else(|_| "right".to_string());
    let is_expanded = window
        .outer_size()
        .ok()
        .map(|s| {
            let scale = window.scale_factor().unwrap_or(1.0);
            s.width as f64 / scale > CAPTURE_STRIP_WIDTH * 1.5
        })
        .unwrap_or(false);

    if let Some(mode) = plan_capture_resnap(pos, monitor, monitor_changed, is_expanded) {
        log::info!(
            "[lexera.capture] Re-snapping to {} (out_of_bounds={}, monitor_changed={}, expanded={})",
            side,
            !in_bounds,
            monitor_changed,
            mode == CaptureResnapMode::Expanded
        );
        if mode == CaptureResnapMode::Expanded {
            // Re-invoke expand_capture to re-snap at expanded dimensions on the new monitor.
            let _ = expand_capture(app.clone());
        } else {
            let _ = snap_capture_strip(app, &side);
        }
    }
}

/// Start a background thread that periodically checks for monitor
/// configuration changes (resolution, connected/disconnected displays).
/// Runs every MONITOR_CHECK_INTERVAL_SECS while the quick-capture window exists.
/// Guarded against multiple concurrent spawns via MONITOR_WATCHER_RUNNING.
pub fn start_monitor_watcher(app: AppHandle) {
    if !try_acquire_monitor_watcher_guard() {
        // Another watcher is already running.
        return;
    }
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(MONITOR_CHECK_INTERVAL_SECS));
            if app.get_webview_window("quick-capture").is_none() {
                log::info!("[lexera.capture] Monitor watcher stopping (window closed)");
                break;
            }
            validate_capture_position(&app);
        }
        release_monitor_watcher_guard();
    });
}

/// Determine which screen edge the window is closest to ("left" or "right").
fn detect_side(window: &tauri::WebviewWindow) -> Result<String, CaptureError> {
    let pos = window.outer_position()?;
    let (monitor_pos, monitor_size) = monitor_rect(window)?;
    let mid_x = monitor_pos.x + monitor_size.width as i32 / 2;
    Ok(if pos.x < mid_x { "left" } else { "right" }.to_string())
}

/// Tauri command: expand the quick-capture window from strip to full panel.
/// Preserves side and Y position from the strip.
#[tauri::command]
pub fn expand_capture(app: AppHandle) -> Result<String, String> {
    let (window, scale) = capture_window(&app)?;
    let phys_w = (CAPTURE_WINDOW_WIDTH * scale) as i32;
    let phys_h = (CAPTURE_WINDOW_HEIGHT * scale) as i32;

    let current_pos = window.outer_position().map_err(|e| e.to_string())?;
    let side = detect_side(&window)?;
    let (monitor_pos, monitor_size) = monitor_rect(&window)?;

    let x = side_x(&side, monitor_pos.x, monitor_size.width, phys_w);
    let y = current_pos
        .y
        .max(monitor_pos.y)
        .min(monitor_pos.y + monitor_size.height as i32 - phys_h);

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: phys_w as u32,
            height: phys_h as u32,
        }))
        .map_err(|e| e.to_string())?;

    window.set_resizable(true).map_err(|e| e.to_string())?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(side)
}

/// Tauri command: collapse the quick-capture window back to strip mode.
/// Preserves side and Y position from the expanded panel.
#[tauri::command]
pub fn collapse_capture(app: AppHandle) -> Result<String, String> {
    let (window, scale) = capture_window(&app)?;
    let phys_w = (CAPTURE_STRIP_WIDTH * scale) as i32;
    let phys_h = (CAPTURE_STRIP_HEIGHT * scale) as i32;

    let current_pos = window.outer_position().map_err(|e| e.to_string())?;
    let side = detect_side(&window)?;
    let (monitor_pos, monitor_size) = monitor_rect(&window)?;

    let x = side_x(&side, monitor_pos.x, monitor_size.width, phys_w);
    let y = current_pos
        .y
        .max(monitor_pos.y)
        .min(monitor_pos.y + monitor_size.height as i32 - phys_h);

    window.set_resizable(false).map_err(|e| e.to_string())?;

    window
        .set_size(tauri::Size::Physical(tauri::PhysicalSize {
            width: phys_w as u32,
            height: phys_h as u32,
        }))
        .map_err(|e| e.to_string())?;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(side)
}

/// Tauri command: snap the strip to the nearest screen edge after a drag,
/// preserving the Y position. Returns the side ("left" or "right").
#[tauri::command]
pub fn snap_strip_after_drag(app: AppHandle) -> Result<String, String> {
    let (window, scale) = capture_window(&app)?;
    let phys_w = (CAPTURE_STRIP_WIDTH * scale) as i32;
    let phys_h = (CAPTURE_STRIP_HEIGHT * scale) as i32;

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let side = detect_side(&window)?;
    let (monitor_pos, monitor_size) = monitor_rect(&window)?;

    let x = side_x(&side, monitor_pos.x, monitor_size.width, phys_w);
    let y = pos
        .y
        .max(monitor_pos.y)
        .min(monitor_pos.y + monitor_size.height as i32 - phys_h);

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(side)
}

/// Tauri command: read clipboard text from the system clipboard.
#[tauri::command]
pub fn read_clipboard(app: AppHandle) -> Result<String, String> {
    let result = app.clipboard().read_text();
    match &result {
        Ok(text) => {
            let preview: String = text.chars().take(80).collect();
            log::info!(
                "[lexera.capture] read_clipboard succeeded len={} preview={:?}",
                text.len(),
                preview
            );
        }
        Err(error) => {
            log::warn!("[lexera.capture] read_clipboard failed: {}", error);
        }
    }
    result.map_err(|e| format!("Failed to read clipboard: {}", e))
}

/// Tauri command: read lightweight clipboard summary without transferring large image payloads.
#[tauri::command]
pub fn read_clipboard_summary() -> Result<serde_json::Value, String> {
    let ctx =
        CrsContext::new().map_err(|e| format!("Failed to create clipboard context: {}", e))?;
    let has_image = ctx.has(ContentFormat::Image);
    let has_text = ctx.has(ContentFormat::Text);

    let text = ctx.get_text().ok().unwrap_or_default();
    let text_trimmed = text.trim();
    let text_len = text_trimmed.chars().count();
    let text_preview: String = text_trimmed.chars().take(240).collect();

    let image_meta = if has_image {
        match ctx.get_image() {
            Ok(image) => {
                let (width, height) = image.get_size();
                if width > 0 && height > 0 {
                    Some(serde_json::json!({
                        "width": width,
                        "height": height
                    }))
                } else {
                    None
                }
            }
            Err(error) => {
                log::warn!(
                    "[lexera.capture] read_clipboard_summary image probe failed: {}",
                    error
                );
                None
            }
        }
    } else {
        None
    };

    let kind = if image_meta.is_some() {
        "image"
    } else if !text_trimmed.is_empty() {
        "text"
    } else {
        "empty"
    };

    log::info!(
        "[lexera.capture] read_clipboard_summary kind={} has_image={} has_text={} text_len={} image_meta={}",
        kind,
        has_image,
        has_text,
        text_len,
        image_meta.is_some()
    );

    Ok(serde_json::json!({
        "kind": kind,
        "hasImage": has_image,
        "hasText": has_text,
        "text": text_trimmed,
        "textLength": text_len,
        "textPreview": text_preview,
        "image": image_meta,
    }))
}

/// Tauri command: read clipboard image as base64-encoded PNG.
#[tauri::command]
pub fn read_clipboard_image() -> Result<serde_json::Value, String> {
    let ctx =
        CrsContext::new().map_err(|e| format!("Failed to create clipboard context: {}", e))?;
    log::info!(
        "[lexera.capture] read_clipboard_image requested has_image={} has_text={}",
        ctx.has(ContentFormat::Image),
        ctx.has(ContentFormat::Text)
    );

    let (data, filename) = read_image_as_base64(&ctx);
    match (data, filename) {
        (Some(d), Some(f)) => {
            log::info!(
                "[lexera.capture] read_clipboard_image succeeded filename={} b64_len={}",
                f,
                d.len()
            );
            Ok(serde_json::json!({ "data": d, "filename": f }))
        }
        _ => {
            log::warn!("[lexera.capture] read_clipboard_image failed: no image payload available");
            Err("Failed to read clipboard image".to_string())
        }
    }
}

/// Tauri command: get the clipboard history (newest first).
#[tauri::command]
pub fn get_clipboard_history(history: tauri::State<'_, ClipboardHistory>) -> Vec<ClipboardEntry> {
    history.lock().map(|h| h.clone()).unwrap_or_default()
}

/// Tauri command: remove an entry from the clipboard history by id.
#[tauri::command]
pub fn remove_clipboard_entry(history: tauri::State<'_, ClipboardHistory>, id: u64) {
    if let Ok(mut h) = history.lock() {
        h.retain(|e| e.id != id);
    }
}

/// Tauri command: snap the quick-capture window to a screen edge.
/// `side` must be "left" or "right".
/// Uses the known logical dimensions rather than querying `outer_size()`
/// which can return stale values during resize transitions.
#[tauri::command]
pub fn snap_capture_window(app: AppHandle, side: String) -> Result<(), String> {
    match side.as_str() {
        "left" | "right" => {}
        _ => return Err(format!("Invalid side: {}", side)),
    }

    let (window, scale) = capture_window(&app)?;
    let phys_w = (CAPTURE_WINDOW_WIDTH * scale) as i32;
    let phys_h = (CAPTURE_WINDOW_HEIGHT * scale) as i32;
    let (monitor_pos, monitor_size) = monitor_rect(&window)?;

    let x = side_x(&side, monitor_pos.x, monitor_size.width, phys_w);
    let y = monitor_pos.y + (monitor_size.height as i32 - phys_h) / 2;

    window
        .set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }))
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Tauri command: close the quick-capture window.
#[tauri::command]
pub fn close_capture(app: AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.destroy();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_error_no_monitor_preserves_string_format() {
        // Prior `Result<_, String>` produced exactly "No monitor" for the
        // missing-monitor sentinel. The typed Display + From<_> for String
        // path must yield the same byte sequence so any `?` against an
        // outer `Result<_, String>` (8 call sites in capture.rs) reads
        // unchanged.
        let err = CaptureError::NoMonitor;
        assert_eq!(err.to_string(), "No monitor");
        let s: String = err.into();
        assert_eq!(s, "No monitor");
    }

    #[test]
    fn capture_error_window_not_found_preserves_string_format() {
        let err = CaptureError::WindowNotFound;
        assert_eq!(err.to_string(), "Window not found");
        let s: String = err.into();
        assert_eq!(s, "Window not found");
    }

    #[test]
    fn capture_error_distinct_variants() {
        // Pin that future refactors don't collapse the variants into
        // a single string-bag — variant identity is what makes pattern
        // matching at call sites (when they migrate) possible.
        let no_mon = CaptureError::NoMonitor;
        assert!(matches!(no_mon, CaptureError::NoMonitor));
        let win_nf = CaptureError::WindowNotFound;
        assert!(matches!(win_nf, CaptureError::WindowNotFound));
        // The Tauri variant carries the wrapped error verbatim; we don't
        // construct a tauri::Error in tests (no public constructor), but
        // we can prove the enum has the variant via the matches! arm.
        fn _shape_check(e: CaptureError) {
            match e {
                CaptureError::Tauri(_) => {}
                CaptureError::NoMonitor => {}
                CaptureError::WindowNotFound => {}
            }
        }
    }

    fn monitor(x: i32, y: i32, width: u32, height: u32) -> MonitorRect {
        MonitorRect {
            x,
            y,
            width,
            height,
        }
    }

    fn pos(x: i32, y: i32) -> tauri::PhysicalPosition<i32> {
        tauri::PhysicalPosition { x, y }
    }

    #[test]
    fn validate_capture_position_detects_monitor_changes_after_first_sample() {
        reset_capture_monitor_state_for_tests();

        let initial = monitor(0, 0, 1920, 1080);
        let moved = monitor(1920, 0, 2560, 1440);

        assert!(!did_monitor_rect_change(initial));
        assert!(!did_monitor_rect_change(initial));
        assert!(did_monitor_rect_change(moved));
    }

    #[test]
    fn validate_capture_position_resnap_plan_distinguishes_strip_and_expanded_modes() {
        reset_capture_monitor_state_for_tests();

        let current = monitor(0, 0, 1920, 1080);

        assert_eq!(
            plan_capture_resnap(pos(100, 100), current, false, false),
            None
        );
        assert_eq!(
            plan_capture_resnap(pos(-5, 100), current, false, false),
            Some(CaptureResnapMode::Strip)
        );
        assert_eq!(
            plan_capture_resnap(pos(100, 100), current, true, true),
            Some(CaptureResnapMode::Expanded)
        );
    }

    #[test]
    fn validate_capture_position_bounds_check_tracks_monitor_edges() {
        let current = monitor(10, 20, 500, 400);

        assert!(is_capture_window_in_bounds(pos(10, 20), current));
        assert!(is_capture_window_in_bounds(pos(509, 419), current));
        assert!(!is_capture_window_in_bounds(pos(510, 419), current));
        assert!(!is_capture_window_in_bounds(pos(509, 420), current));
        assert!(!is_capture_window_in_bounds(pos(9, 20), current));
    }

    #[test]
    fn monitor_watcher_guard_prevents_duplicate_spawns_until_released() {
        reset_capture_monitor_state_for_tests();

        assert!(try_acquire_monitor_watcher_guard());
        assert!(!try_acquire_monitor_watcher_guard());

        release_monitor_watcher_guard();

        assert!(try_acquire_monitor_watcher_guard());
        release_monitor_watcher_guard();
    }
}
