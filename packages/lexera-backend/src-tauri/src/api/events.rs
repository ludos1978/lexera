use axum::{
    extract::State,
    response::{sse::Event, Json, Sse},
};
use std::convert::Infallible;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::StreamExt;

use crate::state::AppState;

const SSE_KEEPALIVE_SECS: u64 = 30;

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
            std::time::Duration::from_secs(SSE_KEEPALIVE_SECS),
        )),
        |_| Ok(Event::default().comment("keep-alive")),
    ));

    Sse::new(stream)
}

pub async fn status(State(state): State<AppState>) -> Json<serde_json::Value> {
    let actual_port = state.live_port.lock().map(|p| *p).unwrap_or(state.port);
    let config_snapshot = state.config.lock().ok().map(|cfg| cfg.clone());
    let ludos_sync = {
        let mut manager = state.ludos_sync.lock().await;
        config_snapshot
            .as_ref()
            .map(|cfg| manager.status(cfg))
            .unwrap_or_else(|| manager.status(&crate::config::SyncConfig::default()))
    };
    Json(serde_json::json!({
        "status": "running",
        "port": actual_port,
        "bind_address": state.bind_address,
        "incoming": state.incoming,
        "ludosSync": ludos_sync,
    }))
}

pub async fn open_connection_window(State(state): State<AppState>) -> Json<serde_json::Value> {
    if let Some(ref handle) = state.app_handle {
        crate::connection_window::open_connection_window(handle);
    }
    Json(serde_json::json!({ "success": true }))
}

pub async fn list_logs() -> Json<serde_json::Value> {
    let file_path = crate::log_bridge::log_file_path();
    log::info!(
        target: "lexera.api.logs",
        "Serving /logs snapshot entries={} file={}",
        crate::log_bridge::recent_entries().len(),
        file_path
    );
    let entries = crate::log_bridge::recent_entries();
    Json(serde_json::json!({
        "entries": entries,
        "filePath": file_path,
    }))
}

pub async fn stream_logs() -> Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>> {
    let stream_started_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    log::info!(
        target: "lexera.api.logs",
        "Client subscribed to /logs/stream at {}",
        stream_started_ms
    );

    let rx = crate::log_bridge::subscribe();
    let live_stream = BroadcastStream::new(rx).filter_map(|item| {
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

    let connected_entry = crate::log_bridge::BackendLogEntry {
        timestamp_ms: stream_started_ms,
        level: "info".to_string(),
        target: "lexera.api.logs".to_string(),
        message: "Connected to /logs/stream".to_string(),
    };
    let initial_payload = serde_json::to_string(&connected_entry)
        .unwrap_or_else(|_| "{\"level\":\"info\",\"target\":\"lexera.api.logs\",\"message\":\"Connected to /logs/stream\"}".to_string());
    let initial_stream = tokio_stream::once(Ok(Event::default().data(initial_payload)));

    let keepalive_stream = tokio_stream::wrappers::IntervalStream::new(tokio::time::interval(
        Duration::from_secs(SSE_KEEPALIVE_SECS),
    ))
    .map(|_| Ok(Event::default().comment("keep-alive")));

    Sse::new(initial_stream.chain(live_stream).merge(keepalive_stream))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use lexera_core::storage::local::LocalStorage;
    use lexera_core::watcher::types::BoardChangeEvent;
    use std::sync::Arc;
    use tower::ServiceExt;

    use crate::state::AppState;

    fn test_state(tmp: &std::path::Path) -> AppState {
        let storage = Arc::new(LocalStorage::new());
        let (event_tx, _) = tokio::sync::broadcast::channel(16);
        let (shutdown_tx, _) = tokio::sync::watch::channel(false);
        AppState {
            storage,
            event_tx,
            port: 0,
            bind_address: "127.0.0.1".into(),
            live_port: Arc::new(std::sync::Mutex::new(0)),
            server_shutdown: Arc::new(std::sync::Mutex::new(None)),
            incoming: None,
            local_user_id: "test-user".into(),
            config_path: tmp.join("config.json"),
            identity_path: tmp.join("identity.json"),
            config: Arc::new(std::sync::Mutex::new(crate::config::SyncConfig::default())),
            watcher: Arc::new(std::sync::Mutex::new(None)),
            invite_service: Arc::new(std::sync::Mutex::new(crate::invite::InviteService::new())),
            public_service: Arc::new(std::sync::Mutex::new(
                crate::public::PublicRoomService::new(),
            )),
            auth_service: Arc::new(std::sync::Mutex::new(crate::auth::AuthService::new())),
            sync_hub: Arc::new(tokio::sync::Mutex::new(crate::sync_ws::BoardSyncHub::new())),
            sync_client: Arc::new(tokio::sync::Mutex::new(
                crate::sync_client::SyncClientManager::new(),
            )),
            discovery: Arc::new(std::sync::Mutex::new(
                crate::discovery::DiscoveryService::new(),
            )),
            app_handle: None,
            collab_dir: tmp.join("collab"),
            ludos_sync: Arc::new(tokio::sync::Mutex::new(
                crate::ludos_sync::LudosSyncManager::new(tmp.join("ludos-sync.generated.json")),
            )),
            shutdown_tx,
        }
    }

    fn test_router(state: AppState) -> Router {
        crate::api::api_router().with_state(state)
    }

    async fn body_json(body: Body) -> serde_json::Value {
        let bytes = body.collect().await.unwrap().to_bytes();
        serde_json::from_slice(&bytes).unwrap()
    }

    // -- /events SSE endpoint tests --

    #[tokio::test]
    async fn sse_events_returns_200_and_event_stream_content_type() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let content_type = resp
            .headers()
            .get("content-type")
            .expect("response should have content-type header")
            .to_str()
            .unwrap();
        assert!(
            content_type.contains("text/event-stream"),
            "content-type should be text/event-stream, got: {}",
            content_type
        );
    }

    #[tokio::test]
    async fn sse_events_delivers_broadcast_event() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let event_tx = state.event_tx.clone();
        let app = test_router(state);

        // Send the request to get the SSE stream
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Broadcast an event after the SSE stream is established
        let sent_event = BoardChangeEvent::MainFileChanged {
            board_id: "test-board-42".into(),
            revision: None,
            generation: None,
            writer_id: None,
        };
        event_tx.send(sent_event.clone()).unwrap();

        // Collect some body bytes with a timeout. The SSE stream is infinite so
        // we cannot await it to completion; instead we read frames until we get
        // the event data or the timeout fires.
        let body = resp.into_body();
        let collected = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            collect_sse_data_frame(body),
        )
        .await
        .expect("timed out waiting for SSE data frame");

        // The event should be serialised as JSON with serde tag = "type"
        let expected_json = serde_json::to_string(&BoardChangeEvent::MainFileChanged {
            board_id: "test-board-42".into(),
            revision: None,
            generation: None,
            writer_id: None,
        })
        .unwrap();

        assert!(
            collected.contains(&expected_json),
            "SSE body should contain the broadcast event JSON.\nExpected substring: {}\nGot: {}",
            expected_json,
            collected
        );
    }

    #[tokio::test]
    async fn sse_events_delivers_multiple_events_in_order() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let event_tx = state.event_tx.clone();
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/events")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);

        // Send two distinct events
        event_tx
            .send(BoardChangeEvent::MainFileChanged {
                board_id: "board-a".into(),
                revision: None,
                generation: None,
                writer_id: None,
            })
            .unwrap();
        event_tx
            .send(BoardChangeEvent::MainFileChanged {
                board_id: "board-b".into(),
                revision: None,
                generation: None,
                writer_id: None,
            })
            .unwrap();

        let body = resp.into_body();
        let collected = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            collect_sse_until_n_data_frames(body, 2),
        )
        .await
        .expect("timed out waiting for SSE data frames");

        assert!(
            collected.contains("board-a"),
            "SSE body should contain board-a event. Got: {}",
            collected
        );
        assert!(
            collected.contains("board-b"),
            "SSE body should contain board-b event. Got: {}",
            collected
        );

        // Verify ordering: board-a should appear before board-b
        let pos_a = collected.find("board-a").unwrap();
        let pos_b = collected.find("board-b").unwrap();
        assert!(
            pos_a < pos_b,
            "board-a should appear before board-b in the stream"
        );
    }

    // -- /status endpoint tests --

    #[tokio::test]
    async fn status_returns_running() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["status"], "running");
        assert_eq!(json["bind_address"], "127.0.0.1");
        assert_eq!(json["port"], 0);
        assert_eq!(json["ludosSync"]["enabled"], false);
        assert_eq!(json["ludosSync"]["running"], false);
        assert_eq!(json["ludosSync"]["configuredPort"], 13081);
        assert_eq!(json["ludosSync"]["bookmarksUrl"], "http://localhost:13081/bookmarks/");
        assert_eq!(json["ludosSync"]["caldavUrl"], "http://localhost:13081/caldav/");
        assert_eq!(json["ludosSync"]["authEnabled"], false);
    }

    #[tokio::test]
    async fn status_reflects_live_port() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        // Simulate the server updating the live port after bind
        *state.live_port.lock().unwrap() = 9876;
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/status")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["port"], 9876);
    }

    #[tokio::test]
    async fn list_logs_returns_recent_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        crate::log_bridge::push_external_entry(
            "info",
            "lexera.test.logs",
            "hello from logs test",
        );

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/logs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let entries = json["entries"].as_array().expect("entries array");
        assert!(entries.iter().any(|entry| {
            entry["target"] == "lexera.test.logs"
                && entry["message"]
                    .as_str()
                    .map(|message| message.contains("hello from logs test"))
                    .unwrap_or(false)
        }));
        assert!(json["filePath"].as_str().is_some());
    }

    // -- Helper functions for reading SSE streams --

    /// Read from an SSE body until we find at least one `data:` line.
    /// Returns all text collected so far (may include keep-alive comments).
    async fn collect_sse_data_frame(body: Body) -> String {
        use futures_util::StreamExt;
        let mut stream = body.into_data_stream();
        let mut collected = String::new();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.unwrap();
            let text = String::from_utf8_lossy(&bytes);
            collected.push_str(&text);
            // SSE data frames look like "data:...\n\n"
            if collected.contains("data:") {
                break;
            }
        }
        collected
    }

    /// Read from an SSE body until we have accumulated `n` lines starting with `data:`.
    async fn collect_sse_until_n_data_frames(body: Body, n: usize) -> String {
        use futures_util::StreamExt;
        let mut stream = body.into_data_stream();
        let mut collected = String::new();
        while let Some(chunk) = stream.next().await {
            let bytes = chunk.unwrap();
            let text = String::from_utf8_lossy(&bytes);
            collected.push_str(&text);
            let data_count = collected.lines().filter(|l| l.starts_with("data:")).count();
            if data_count >= n {
                break;
            }
        }
        collected
    }
}
