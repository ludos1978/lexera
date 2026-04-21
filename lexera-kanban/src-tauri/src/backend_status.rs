//! Descriptor-file watcher that emits `backend-status` Tauri events.
//!
//! Phase 7.5 gap #4: the plan requires Kanban Rust to emit a single event
//! `backend-status` with payload `{ state, reason? }` so the webview (and
//! any listeners) react to backend start/stop/restart without polling.
//!
//! Implementation:
//!
//! - On startup, emit the current status (single sanity read).
//! - Watch the config directory non-recursively via `notify`. Any change to
//!   the descriptor filename re-evaluates status and emits a new event if
//!   it differs from the last.
//! - The webview listens for `backend-status` via the Tauri events API.

use crate::ipc_client::{status as current_status, BackendStatus};
use notify::{event::EventKind, Event, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc as std_mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const EVENT_NAME: &str = "backend-status";

/// Resolve the parent directory of the descriptor. The watcher targets the
/// directory rather than the file itself so create/delete events are seen
/// too (a file watcher only fires once the target file exists).
fn descriptor_dir() -> PathBuf {
    let file = lexera_local_ipc::descriptor::descriptor_path();
    file.parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn descriptor_filename_matches(event: &Event) -> bool {
    let expected = lexera_local_ipc::descriptor::descriptor_path();
    event.paths.iter().any(|p| p == &expected)
}

fn emit(app: &AppHandle, status: &BackendStatus) {
    if let Err(e) = app.emit(EVENT_NAME, status) {
        log::warn!(target: "lexera.kanban.backend_status",
            "failed to emit backend-status: {}", e);
    }
}

fn same_status(a: &BackendStatus, b: &BackendStatus) -> bool {
    // Equal when both the variant and the load-bearing payload match. Avoids
    // emitting a flood of `Connected { pid: same, endpoint: same }` events
    // for unrelated writes in the same directory.
    match (a, b) {
        (
            BackendStatus::Connected {
                pid: p1,
                endpoint: e1,
            },
            BackendStatus::Connected {
                pid: p2,
                endpoint: e2,
            },
        ) => p1 == p2 && e1 == e2,
        (BackendStatus::Waiting, BackendStatus::Waiting) => true,
        (
            BackendStatus::Reconnecting { attempt: a1 },
            BackendStatus::Reconnecting { attempt: a2 },
        ) => a1 == a2,
        (
            BackendStatus::Unavailable { reason: r1 },
            BackendStatus::Unavailable { reason: r2 },
        ) => r1 == r2,
        _ => false,
    }
}

/// Start the watcher. Spawns a background thread that re-emits the status
/// on every descriptor-file change. Returns immediately.
pub fn spawn(app: AppHandle) {
    // Initial sanity read before the watcher is attached — covers the case
    // where the descriptor already exists on launch.
    let initial = current_status();
    emit(&app, &initial);

    std::thread::Builder::new()
        .name("lexera.backend-status-watcher".into())
        .spawn(move || run(app, initial))
        .ok();
}

fn run(app: AppHandle, mut last: BackendStatus) {
    let dir = descriptor_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        log::warn!(target: "lexera.kanban.backend_status",
            "unable to create descriptor dir {}: {}", dir.display(), e);
    }

    let (tx, rx) = std_mpsc::channel::<notify::Result<Event>>();
    let mut watcher: notify::RecommendedWatcher = match notify::recommended_watcher(tx) {
        Ok(w) => w,
        Err(e) => {
            log::error!(target: "lexera.kanban.backend_status",
                "failed to construct watcher: {}", e);
            return;
        }
    };
    if let Err(e) = watcher.watch(&dir, RecursiveMode::NonRecursive) {
        log::error!(target: "lexera.kanban.backend_status",
            "failed to watch descriptor dir: {}", e);
        return;
    }

    // Keep the watcher alive for the lifetime of this thread.
    while let Ok(result) = rx.recv() {
        let event = match result {
            Ok(ev) => ev,
            Err(e) => {
                log::debug!(target: "lexera.kanban.backend_status",
                    "watcher error: {}", e);
                continue;
            }
        };
        // Only react to events involving the descriptor file. Some
        // backends emit an event for every sibling; ignore noise.
        if !descriptor_filename_matches(&event) {
            continue;
        }
        if !matches!(
            event.kind,
            EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
        ) {
            continue;
        }
        // Small debounce: the backend's atomic tempfile+rename fires
        // multiple events in rapid succession; coalesce by sleeping a beat
        // then reading the final state.
        std::thread::sleep(Duration::from_millis(50));
        let next = current_status();
        if !same_status(&last, &next) {
            emit(&app, &next);
            last = next;
        }
    }
}
