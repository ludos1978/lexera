/// Quick Capture: opens a small floating window for clipboard/drop capture.
/// Also manages the in-memory clipboard history.
use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext as CrsContext, ContentFormat};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// A single clipboard history entry.
#[derive(Clone, Debug, serde::Serialize)]
pub struct ClipboardEntry {
    pub id: u64,
    pub text: Option<String>,
    pub image_data: Option<String>,
    pub image_filename: Option<String>,
    pub timestamp: u64,
}

/// Shared clipboard history, newest first.
pub type ClipboardHistory = Arc<Mutex<Vec<ClipboardEntry>>>;

static NEXT_ENTRY_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

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
    let (image_data, image_filename) = if ctx.has(ContentFormat::Image) {
        read_image_as_base64(&ctx)
    } else {
        (None, None)
    };

    if text.is_none() && image_data.is_none() {
        return;
    }

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let entry = ClipboardEntry {
        id: NEXT_ENTRY_ID.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
        text,
        image_data,
        image_filename,
        timestamp: ts,
    };

    if let Ok(mut hist) = history.lock() {
        hist.insert(0, entry);
        // Keep max 50 entries
        hist.truncate(50);
    }
}

/// Read clipboard image as base64 PNG string.
fn read_image_as_base64(ctx: &CrsContext) -> (Option<String>, Option<String>) {
    let image = match ctx.get_image() {
        Ok(img) => img,
        Err(_) => return (None, None),
    };

    let tmp_dir = std::env::temp_dir();
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let tmp_path = tmp_dir.join(format!("lexera-clip-{}.png", ts));
    let tmp_str = tmp_path.to_str().unwrap_or("/tmp/lexera-clip.png");

    if image.save_to_path(tmp_str).is_err() {
        return (None, None);
    }

    let png_bytes = match std::fs::read(&tmp_path) {
        Ok(bytes) => bytes,
        Err(_) => return (None, None),
    };

    let _ = std::fs::remove_file(&tmp_path);

    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &png_bytes);
    let filename = format!("clipboard-{}.png", ts);

    (Some(b64), Some(filename))
}

/// Copy the current selection (simulate Cmd+C), then open the capture popup.
/// Spawns async so the shortcut handler doesn't block.
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
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

        // Capture the selection into history before re-enabling watcher
        if let Some(history) = app.try_state::<ClipboardHistory>() {
            capture_clipboard_to_history(&history);
        }

        crate::clipboard_watcher::set_suppress(false);

        open_capture_popup(&app);
    });
}

/// Open (or focus) the quick-capture popup window.
pub fn open_capture_popup(app: &AppHandle) {
    // If the window already exists, focus it
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }

    // Create new popup window
    match WebviewWindowBuilder::new(
        app,
        "quick-capture",
        WebviewUrl::App("quick-capture.html".into()),
    )
    .title("Quick Capture")
    .inner_size(420.0, 460.0)
    .center()
    .resizable(true)
    .always_on_top(true)
    .decorations(false)
    .shadow(true)
    .build()
    {
        Ok(_) => log::info!("[lexera.capture] Quick capture window opened"),
        Err(e) => log::error!("[lexera.capture] Failed to open capture window: {}", e),
    }
}

/// Tauri command: read clipboard text from the system clipboard.
#[tauri::command]
pub fn read_clipboard(app: AppHandle) -> Result<String, String> {
    app.clipboard()
        .read_text()
        .map_err(|e| format!("Failed to read clipboard: {}", e))
}

/// Tauri command: read clipboard image as base64-encoded PNG.
#[tauri::command]
pub fn read_clipboard_image() -> Result<serde_json::Value, String> {
    let ctx =
        CrsContext::new().map_err(|e| format!("Failed to create clipboard context: {}", e))?;

    if !ctx.has(ContentFormat::Image) {
        return Err("No image in clipboard".to_string());
    }

    let (data, filename) = read_image_as_base64(&ctx);
    match (data, filename) {
        (Some(d), Some(f)) => Ok(serde_json::json!({ "data": d, "filename": f })),
        _ => Err("Failed to read clipboard image".to_string()),
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
#[tauri::command]
pub fn snap_capture_window(app: AppHandle, side: String) -> Result<(), String> {
    let window = app
        .get_webview_window("quick-capture")
        .ok_or("Window not found")?;

    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .ok_or("No monitor")?;

    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let window_size = window.outer_size().map_err(|e| e.to_string())?;

    let x = match side.as_str() {
        "left" => monitor_pos.x,
        "right" => monitor_pos.x + monitor_size.width as i32 - window_size.width as i32,
        _ => return Err(format!("Invalid side: {}", side)),
    };

    let y = monitor_pos.y + (monitor_size.height as i32 - window_size.height as i32) / 2;

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
