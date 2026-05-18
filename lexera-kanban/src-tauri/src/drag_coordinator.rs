// Cross-webview drag coordinator.
//
// State machine:
//   Idle → DragInitiated (drag_start)
//        → Dragging      (drag_pointer_move repeats)
//        → Idle          (drag_pointer_up | drag_cancel)
//
// Source webview detects the drag start via local pointer events,
// captures the pointer, and forwards subsequent pointer positions
// (in shell-local coords) via drag_pointer_move. This module routes
// drag-enter / drag-over / drag-leave / drop events to the correct
// target webview based on hit-testing against the WebviewRegistry.
//
// CRITICAL: every per-view sub-app must use myWebview.listen() (not
// the global listen() from @tauri-apps/api/event) to receive these
// events. The default listener target is `Any` which would deliver
// every event to every webview. See TODOs-lexera-multiview.md
// "Architectural rules" for details.
//
// This module provides the native drag-routing path for multiview
// child webviews. The primitives are active and callable today, but
// production board drag/drop still mostly runs through the legacy
// board drag system. This coordinator is the target architecture,
// not yet the only production path.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::webview_mgr::{emit_to_window_of_label, get_meta, hit_test, to_local, WebviewRegistry};

/// Per-window drag state. Each top-level window can have at most one
/// drag in progress at a time (single OS pointer per window). Two
/// windows running concurrent drags must not interfere — keying the
/// HashMap by the source webview's PARENT WINDOW label gives each
/// window its own slot.
///
/// Earlier shape (`Mutex<Option<ActiveDrag>>`) was a process-level
/// singleton: window B starting a drag while window A was mid-drag
/// either errored out ("drag already in progress") or stomped A's
/// state. The HashMap fixes that without changing the OS-pointer
/// invariant — within one window, the lock + take/insert pattern
/// still ensures only one active drag.
#[derive(Default)]
pub struct DragState {
    inner: Mutex<HashMap<String, ActiveDrag>>,
}

#[derive(Clone, Debug)]
struct ActiveDrag {
    source_label: String,
    payload: Value,
    current_target: Option<String>,
}

#[derive(Deserialize)]
pub struct DragStartPayload {
    pub source: String,
    pub payload: Value,
}

#[derive(Deserialize)]
pub struct PointerPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
struct DragBeganEvent {
    source: String,
    payload: Value,
}

#[derive(Serialize, Clone)]
struct DragOverEvent {
    source: String,
    payload: Value,
    local_x: f64,
    local_y: f64,
}

#[derive(Serialize, Clone)]
struct DropEvent {
    source: String,
    payload: Value,
    local_x: f64,
    local_y: f64,
}

#[derive(Serialize, Clone)]
struct DragCompleteEvent {
    accepted: bool,
}

/// Begin a drag. Source webview calls this when its threshold-cross
/// detection fires. Errors if THIS WINDOW already has a drag in
/// progress; concurrent drags in DIFFERENT windows are allowed
/// (each window is keyed independently in `DragState`).
#[tauri::command]
pub fn drag_start(
    app: AppHandle,
    caller: tauri::Webview,
    drag_state: State<DragState>,
    payload: DragStartPayload,
) -> Result<(), String> {
    let window_label = caller.window().label().to_string();
    let mut state = drag_state.inner.lock();
    if state.contains_key(&window_label) {
        return Err("drag already in progress in this window".into());
    }
    state.insert(
        window_label.clone(),
        ActiveDrag {
            source_label: payload.source.clone(),
            payload: payload.payload.clone(),
            current_target: None,
        },
    );
    drop(state);
    log::info!(
        "[drag] started by {} in window {}",
        payload.source,
        window_label
    );
    // Auto-ensure the drag ghost window exists (first-drag cost: a
    // Tauri window build, ~50-100ms; subsequent drags reuse it).
    if app.get_webview_window("drag-ghost").is_none() {
        use tauri::WebviewWindowBuilder;
        let url_obj = tauri::WebviewUrl::App("views/drag-ghost/index.html".into());
        let _ = WebviewWindowBuilder::new(&app, "drag-ghost", url_obj)
            .inner_size(240.0, 48.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .visible(false)
            .skip_taskbar(true)
            .focused(false)
            .build();
    }
    // Push the payload's text (if any) into the drag-ghost window
    // so it shows meaningful content during the drag.
    if let Some(ghost) = app.get_webview_window("drag-ghost") {
        let text = payload
            .payload
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if !text.is_empty() {
            let html = format!(
                "<div style=\"padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\">{}</div>",
                html_escape(&text)
            );
            let _ = ghost.emit("ghost-content", html);
        }
    }
    emit_to_window_of_label(
        &app,
        &payload.source,
        "drag-began",
        DragBeganEvent {
            source: payload.source.clone(),
            payload: payload.payload.clone(),
        },
    );
    Ok(())
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Forward a pointer-move event during drag. Coordinates are in
/// shell-local space (pixels relative to the shell window's content
/// origin). The source webview must translate webview-local coords
/// to shell-local before calling. Also moves the drag ghost window
/// to follow the cursor (offset by ~16,16 so it doesn't sit under
/// the pointer).
#[tauri::command]
pub fn drag_pointer_move(
    app: AppHandle,
    caller: tauri::Webview,
    drag_state: State<DragState>,
    registry: State<WebviewRegistry>,
    pos: PointerPosition,
) -> Result<(), String> {
    let caller_window = caller.window();
    let window_label = caller_window.label().to_string();
    let mut state = drag_state.inner.lock();
    let active = match state.get_mut(&window_label) {
        Some(a) => a,
        None => return Ok(()),
    };

    // Position the ghost window if it exists. The screen-space coords
    // are relative to the SOURCE WINDOW's outer position — not a
    // hardcoded "main" window. Multi-window drags would otherwise
    // paint the ghost at window A's offset while the user drags in
    // window B (off-screen / on the wrong monitor).
    if let Some(ghost) = app.get_webview_window("drag-ghost") {
        if let Ok(window_pos) = caller_window.outer_position() {
            let scale = caller_window.scale_factor().unwrap_or(1.0);
            let screen_x = (window_pos.x as f64) / scale + pos.x + 16.0;
            let screen_y = (window_pos.y as f64) / scale + pos.y + 16.0;
            let _ = ghost.set_position(tauri::LogicalPosition::new(screen_x, screen_y));
            let _ = ghost.show();
        }
    }

    let new_target = hit_test(&registry, pos.x, pos.y);

    if active.current_target != new_target {
        if let Some(old) = active.current_target.clone() {
            let _ = app.emit_to(old.as_str(), "drag-leave", ());
        }
        if let Some(ref new) = new_target {
            let _ = app.emit_to(
                new.as_str(),
                "drag-enter",
                DragBeganEvent {
                    source: active.source_label.clone(),
                    payload: active.payload.clone(),
                },
            );
        }
        active.current_target = new_target.clone();
    }

    if let Some(ref target_label) = new_target {
        if let Some(meta) = get_meta(&registry, target_label) {
            let (lx, ly) = to_local(&meta, pos.x, pos.y);
            let _ = app.emit_to(
                target_label.as_str(),
                "drag-over",
                DragOverEvent {
                    source: active.source_label.clone(),
                    payload: active.payload.clone(),
                    local_x: lx,
                    local_y: ly,
                },
            );
        }
    }

    Ok(())
}

/// Drop. Routes the payload to the target webview (if any) and
/// notifies the source whether the drop was accepted.
#[tauri::command]
pub fn drag_pointer_up(
    app: AppHandle,
    caller: tauri::Webview,
    drag_state: State<DragState>,
    registry: State<WebviewRegistry>,
    pos: PointerPosition,
) -> Result<(), String> {
    let window_label = caller.window().label().to_string();
    let mut state = drag_state.inner.lock();
    let active = match state.remove(&window_label) {
        Some(a) => a,
        None => return Ok(()),
    };

    let target_label = hit_test(&registry, pos.x, pos.y);

    if let Some(target) = target_label {
        if let Some(meta) = get_meta(&registry, &target) {
            let (lx, ly) = to_local(&meta, pos.x, pos.y);
            log::info!("[drag] drop on {} at local ({},{})", target, lx, ly);
            let _ = app.emit_to(
                target.as_str(),
                "drop",
                DropEvent {
                    source: active.source_label.clone(),
                    payload: active.payload.clone(),
                    local_x: lx,
                    local_y: ly,
                },
            );
            // Optimistic source notification. Production may want to
            // wait for drop_ack before this; deferred until needed.
            let _ = app.emit_to(
                active.source_label.as_str(),
                "drag-complete",
                DragCompleteEvent { accepted: true },
            );
        }
    } else {
        log::info!("[drag] dropped outside any webview — cancelling");
        let _ = app.emit_to(active.source_label.as_str(), "drag-cancelled", ());
    }

    if let Some(ghost) = app.get_webview_window("drag-ghost") {
        let _ = ghost.hide();
    }
    emit_to_window_of_label(&app, &active.source_label, "drag-ended", ());
    Ok(())
}

/// Cancel an in-progress drag (called from JS on Escape, etc).
#[tauri::command]
pub fn drag_cancel(
    app: AppHandle,
    caller: tauri::Webview,
    drag_state: State<DragState>,
) -> Result<(), String> {
    let window_label = caller.window().label().to_string();
    let mut state = drag_state.inner.lock();
    let active = match state.remove(&window_label) {
        Some(a) => a,
        None => return Ok(()),
    };
    log::info!(
        "[drag] cancelled by source {} in window {}",
        active.source_label,
        window_label
    );
    if let Some(target) = active.current_target {
        let _ = app.emit_to(target.as_str(), "drag-leave", ());
    }
    let _ = app.emit_to(active.source_label.as_str(), "drag-cancelled", ());
    if let Some(ghost) = app.get_webview_window("drag-ghost") {
        let _ = ghost.hide();
    }
    emit_to_window_of_label(&app, &active.source_label, "drag-ended", ());
    Ok(())
}

#[derive(Deserialize)]
pub struct DropAck {
    pub accepted: bool,
}

/// Target webview acknowledges receipt of the drop. Currently
/// informational; production will use this to defer the
/// drag-complete notification to the source.
#[tauri::command]
pub fn drop_ack(_app: AppHandle, ack: DropAck) -> Result<(), String> {
    log::info!("[drag] drop_ack: accepted={}", ack.accepted);
    Ok(())
}
