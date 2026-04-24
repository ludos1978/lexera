// Drag coordinator: cross-webview drag state machine.
//
// Source webview detects pointer-down + threshold, calls drag_start.
// Shell webview reports pointer position via drag_pointer_move.
// Rust hit-tests against known webview rectangles, routes drag-enter /
// drag-over / drag-leave / drop events to the correct target.
//
// The shell webview is the only entity that tracks pointer events
// during a drag — all other webviews stop receiving them once the
// drag begins. This keeps the protocol simple: one source of truth
// for pointer routing.

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::webview_mgr::{hit_test, get_meta, to_local, WebviewRegistry};

#[derive(Default)]
pub struct DragState {
    inner: Mutex<Option<ActiveDrag>>,
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

#[tauri::command]
pub fn drag_start(
    app: AppHandle,
    drag_state: State<DragState>,
    payload: DragStartPayload,
) -> Result<(), String> {
    let mut state = drag_state.inner.lock();
    if state.is_some() {
        return Err("drag already in progress".into());
    }
    *state = Some(ActiveDrag {
        source_label: payload.source.clone(),
        payload: payload.payload.clone(),
        current_target: None,
    });
    log::info!("drag started by {}", payload.source);
    let _ = app.emit(
        "drag-began",
        DragBeganEvent {
            source: payload.source,
            payload: payload.payload,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn drag_pointer_move(
    app: AppHandle,
    drag_state: State<DragState>,
    registry: State<WebviewRegistry>,
    pos: PointerPosition,
) -> Result<(), String> {
    let mut state = drag_state.inner.lock();
    let active = match state.as_mut() {
        Some(a) => a,
        None => return Ok(()),
    };

    let new_target = hit_test(&registry, pos.x, pos.y);

    // Send drag-leave to old target if it changed
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

    // Send drag-over to current target with local coords
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

#[tauri::command]
pub fn drag_pointer_up(
    app: AppHandle,
    drag_state: State<DragState>,
    registry: State<WebviewRegistry>,
    pos: PointerPosition,
) -> Result<(), String> {
    let mut state = drag_state.inner.lock();
    let active = match state.take() {
        Some(a) => a,
        None => return Ok(()),
    };

    let target_label = hit_test(&registry, pos.x, pos.y);

    if let Some(target) = target_label.clone() {
        if let Some(meta) = get_meta(&registry, &target) {
            let (lx, ly) = to_local(&meta, pos.x, pos.y);
            log::info!("drop on {} at local ({},{})", target, lx, ly);
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
            // Wait for drop_ack from target before notifying source.
            // For the prototype we optimistically notify source now;
            // production should defer until drop_ack arrives.
            let _ = app.emit_to(
                active.source_label.as_str(),
                "drag-complete",
                DragCompleteEvent { accepted: true },
            );
        }
    } else {
        // Dropped on nothing — cancel
        log::info!("drop outside any webview — cancelling");
        let _ = app.emit_to(
            active.source_label.as_str(),
            "drag-cancelled",
            (),
        );
    }

    let _ = app.emit("drag-ended", ());
    Ok(())
}

#[tauri::command]
pub fn drag_cancel(
    app: AppHandle,
    drag_state: State<DragState>,
) -> Result<(), String> {
    let mut state = drag_state.inner.lock();
    let active = match state.take() {
        Some(a) => a,
        None => return Ok(()),
    };
    log::info!("drag cancelled by source {}", active.source_label);
    if let Some(target) = active.current_target {
        let _ = app.emit_to(target.as_str(), "drag-leave", ());
    }
    let _ = app.emit_to(
        active.source_label.as_str(),
        "drag-cancelled",
        (),
    );
    let _ = app.emit("drag-ended", ());
    Ok(())
}

#[derive(Deserialize)]
pub struct DropAck {
    pub accepted: bool,
}

#[tauri::command]
pub fn drop_ack(
    _app: AppHandle,
    ack: DropAck,
) -> Result<(), String> {
    log::info!("drop_ack: accepted={}", ack.accepted);
    // In the prototype we already notified the source on pointer-up.
    // Production should hold the drag-complete event until this ack arrives.
    Ok(())
}
