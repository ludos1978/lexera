/// Clipboard watcher: monitors system clipboard for changes.
/// On change, captures content into the clipboard history and opens Quick Capture.

use clipboard_rs::{
    ClipboardHandler, ClipboardWatcher,
    ClipboardWatcherContext, WatcherShutdown,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use crate::capture::ClipboardHistory;

/// Flag to suppress the watcher when our own Cmd+C simulation fires.
static SUPPRESS_WATCHER: AtomicBool = AtomicBool::new(false);

pub fn set_suppress(val: bool) {
    SUPPRESS_WATCHER.store(val, Ordering::SeqCst);
}

struct ClipboardChangeHandler {
    app: AppHandle,
    history: ClipboardHistory,
}

impl ClipboardHandler for ClipboardChangeHandler {
    fn on_clipboard_change(&mut self) {
        if SUPPRESS_WATCHER.load(Ordering::SeqCst) {
            return;
        }

        log::info!("[lexera.clipboard_watcher] Clipboard changed");
        crate::capture::capture_clipboard_to_history(&self.history);
        crate::capture::open_capture_popup(&self.app);
    }
}

/// Start the clipboard watcher on a dedicated std::thread.
/// Returns the WatcherShutdown handle for clean termination.
pub fn start_clipboard_watcher(app: &AppHandle, history: ClipboardHistory) -> Option<WatcherShutdown> {
    let mut watcher = match ClipboardWatcherContext::new() {
        Ok(watcher) => watcher,
        Err(e) => {
            log::error!("[lexera.clipboard_watcher] Failed to create watcher: {}", e);
            return None;
        }
    };
    let handler = ClipboardChangeHandler {
        app: app.clone(),
        history,
    };
    watcher.add_handler(handler);
    let shutdown = watcher.get_shutdown_channel();

    if let Err(e) = std::thread::Builder::new()
        .name("clipboard-watcher".into())
        .spawn(move || {
            log::info!("[lexera.clipboard_watcher] Watcher thread started");
            watcher.start_watch();
        })
    {
        log::error!("[lexera.clipboard_watcher] Failed to spawn watcher thread: {}", e);
        return None;
    }

    Some(shutdown)
}
