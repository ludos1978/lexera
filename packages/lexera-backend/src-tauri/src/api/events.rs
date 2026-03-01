use axum::{
    extract::State,
    response::{sse::Event, Json, Sse},
};
use std::convert::Infallible;
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::state::AppState;

/// SSE endpoint: streams BoardChangeEvent as JSON to connected clients.
pub async fn sse_events(
    State(state): State<AppState>,
) -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = state.event_tx.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|result| match result {
        Ok(event) => {
            let json = serde_json::to_string(&event).unwrap_or_default();
            Some(Ok(Event::default().data(json)))
        }
        Err(_) => None,
    });

    // Keep-alive every 30 seconds
    let stream = stream.merge(tokio_stream::StreamExt::map(
        tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
            std::time::Duration::from_secs(30),
        )),
        |_| Ok(Event::default().comment("keep-alive")),
    ));

    Sse::new(stream)
}

pub async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let actual_port = state.live_port.lock().map(|p| *p).unwrap_or(state.port);
    Json(serde_json::json!({
        "status": "running",
        "port": actual_port,
        "bind_address": state.bind_address,
        "incoming": state.incoming,
    }))
}

pub async fn open_connection_window(State(state): State<AppState>) -> Json<serde_json::Value> {
    crate::connection_window::open_connection_window(&state.app_handle);
    Json(serde_json::json!({ "success": true }))
}

pub async fn list_logs() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "entries": crate::log_bridge::recent_entries(),
        "filePath": crate::log_bridge::log_file_path(),
    }))
}

pub async fn stream_logs() -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let rx = crate::log_bridge::subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|item| {
        let entry = match item {
            Ok(entry) => entry,
            Err(_) => return None,
        };
        let payload = match serde_json::to_string(&entry) {
            Ok(payload) => payload,
            Err(_) => return None,
        };
        Some(Ok(Event::default().data(payload)))
    });
    Sse::new(stream)
}
