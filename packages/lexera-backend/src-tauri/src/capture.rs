/// Quick Capture: opens a small floating window for clipboard/drop capture.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// Copy the current selection (simulate Cmd+C), then open the capture popup.
/// Spawns async so the shortcut handler doesn't block.
pub fn capture_selection_and_open(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // Simulate Cmd+C via AppleScript to copy current selection
        let _ = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"c\" using command down")
            .output()
            .await;

        // Brief delay for the copy to complete
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;

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
    match WebviewWindowBuilder::new(app, "quick-capture", WebviewUrl::App("quick-capture.html".into()))
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

/// Tauri command: close the quick-capture window.
#[tauri::command]
pub fn close_capture(app: AppHandle) {
    if let Some(window) = app.get_webview_window("quick-capture") {
        let _ = window.destroy();
    }
}
