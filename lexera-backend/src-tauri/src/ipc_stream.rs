//! Server-side handlers for `StreamSubscribe` frames.
//!
//! Bridges the existing backend broadcast channels (`event_tx`,
//! `log_bridge::subscribe()`, future `sync_hub`) to IPC `StreamMessage`
//! frames. One stream per connection; clients open parallel connections for
//! concurrent streams, the same as they do for assets.

use crate::state::AppState;
use lexera_local_ipc::frame::{
    read_frame, write_frame, ClientFrame, ServerFrame, StreamTopic,
};
use lexera_local_ipc::transport::Stream;
use lexera_local_ipc::IpcError;
use tokio::sync::broadcast::error::RecvError;
use uuid::Uuid;

/// Entry point: dispatch on the topic and drive the chosen forwarder until
/// the client cancels, the connection drops, or the backend channel closes.
pub async fn handle_subscribe(
    stream: &mut Stream,
    state: &AppState,
    correlation_id: Uuid,
    topic: StreamTopic,
) -> Result<(), IpcError> {
    match topic {
        StreamTopic::Events => forward_events(stream, state, correlation_id).await,
        StreamTopic::Logs => forward_logs(stream, correlation_id).await,
        StreamTopic::Sync { board_id } => {
            crate::ipc_sync::forward_sync(stream, state, correlation_id, board_id).await
        }
    }
}

/// Mirrors `api::events::sse_events`: subscribes to the board-change
/// broadcast, emits each event as JSON, and on lag emits a resync sentinel
/// that the frontend adapter turns into the same `onEvent({type:'Resync'})`
/// call the HTTP SSE path delivers.
async fn forward_events(
    stream: &mut Stream,
    state: &AppState,
    correlation_id: Uuid,
) -> Result<(), IpcError> {
    let mut rx = state.event_tx.subscribe();
    let end_err = loop {
        tokio::select! {
            recv = rx.recv() => match recv {
                Ok(event) => {
                    let payload = serde_json::to_vec(&event).unwrap_or_default();
                    write_frame(
                        stream,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    )
                    .await?;
                }
                Err(RecvError::Lagged(n)) => {
                    log::warn!(
                        target: "lexera.ipc.stream",
                        "events: client lagged by {}, sending resync",
                        n
                    );
                    let resync = serde_json::json!({"type": "Resync", "lagged": n});
                    let payload = serde_json::to_vec(&resync).unwrap_or_default();
                    write_frame(
                        stream,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    )
                    .await?;
                }
                Err(RecvError::Closed) => break None,
            },
            client = read_frame::<_, ClientFrame>(stream) => match client? {
                Some(ClientFrame::Cancel { correlation_id: cid }) if cid == correlation_id => {
                    break None;
                }
                Some(_) => {
                    // Ignore out-of-band frames during a subscription. The
                    // current protocol binds the whole connection to one
                    // subscription; future versions may multiplex.
                }
                None => break Some("connection closed".to_string()),
            },
        }
    };

    write_frame(
        stream,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: end_err,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_helpers;
    use lexera_core::watcher::types::BoardChangeEvent;
    use lexera_local_ipc::{Client, Descriptor, Server};

    fn test_descriptor(dir: &tempfile::TempDir) -> Descriptor {
        Descriptor::new(dir.path().join("ipc.sock").to_string_lossy().into_owned())
    }

    #[tokio::test]
    async fn events_subscribe_delivers_broadcast_then_ends_on_cancel() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());
        let event_tx = state.event_tx.clone();

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();

        // Server drives one subscription then exits.
        let state_for_server = state.clone();
        let server_task = tokio::spawn(async move {
            let mut stream = server.accept().await.expect("accept");
            let frame = read_frame::<_, ClientFrame>(&mut stream)
                .await
                .expect("read")
                .expect("frame");
            let (correlation_id, topic) = match frame {
                ClientFrame::StreamSubscribe {
                    correlation_id,
                    topic,
                } => (correlation_id, topic),
                other => panic!("expected StreamSubscribe, got {:?}", other),
            };
            super::handle_subscribe(&mut stream, &state_for_server, correlation_id, topic)
                .await
                .expect("handler io");
        });

        let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
        let correlation_id = Uuid::new_v4();
        write_frame(
            client.stream(),
            &ClientFrame::StreamSubscribe {
                correlation_id,
                topic: StreamTopic::Events,
            },
        )
        .await
        .unwrap();

        // Give the server task time to subscribe before we publish, so it
        // doesn't miss the broadcast. `subscribe()` in the backend handler
        // runs synchronously before the first select; yielding once is
        // enough on single-threaded tokio tests.
        tokio::task::yield_now().await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        event_tx
            .send(BoardChangeEvent::MediaChanged {
                board_id: "b1".into(),
            })
            .unwrap();

        // First frame: the serialized event.
        let msg = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        let payload = match msg {
            ServerFrame::StreamMessage { payload, .. } => payload,
            other => panic!("expected StreamMessage, got {:?}", other),
        };
        let parsed: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(parsed["type"], "MediaChanged");
        assert_eq!(parsed["board_id"], "b1");

        // Cancel, expect clean StreamEnd.
        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id })
            .await
            .unwrap();
        let end = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        match end {
            ServerFrame::StreamEnd { error, .. } => assert!(error.is_none(), "{:?}", error),
            other => panic!("expected StreamEnd, got {:?}", other),
        }

        server_task.await.unwrap();
    }

    /// Unauthorized user (not a board member) receives a ServerError JSON
    /// payload followed by a StreamEnd with an error. Board auth mirrors the
    /// WebSocket path.
    #[tokio::test]
    async fn sync_unauthorized_user_receives_error_end() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();

        let state_for_server = state.clone();
        let server_task = tokio::spawn(async move {
            let mut stream = server.accept().await.expect("accept");
            let frame = read_frame::<_, ClientFrame>(&mut stream)
                .await
                .expect("read")
                .expect("frame");
            if let ClientFrame::StreamSubscribe {
                correlation_id,
                topic,
            } = frame
            {
                let _ = super::handle_subscribe(&mut stream, &state_for_server, correlation_id, topic)
                    .await;
            }
        });

        let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
        let correlation_id = Uuid::new_v4();
        write_frame(
            client.stream(),
            &ClientFrame::StreamSubscribe {
                correlation_id,
                topic: StreamTopic::Sync {
                    board_id: board_id.clone(),
                },
            },
        )
        .await
        .unwrap();

        // Send a ClientHello with an unregistered user id.
        let hello = serde_json::to_vec(&lexera_core::sync::ClientMessage::ClientHello {
            user_id: "not-a-member".into(),
            vv: String::new(),
        })
        .unwrap();
        write_frame(
            client.stream(),
            &ClientFrame::StreamSend {
                correlation_id,
                payload: hello,
            },
        )
        .await
        .unwrap();

        // Expect ServerError JSON, then StreamEnd with error.
        let msg = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        let err_payload = match msg {
            ServerFrame::StreamMessage { payload, .. } => payload,
            other => panic!("expected StreamMessage, got {:?}", other),
        };
        let parsed: serde_json::Value = serde_json::from_slice(&err_payload).unwrap();
        assert_eq!(parsed["type"], "ServerError");

        let end = read_frame::<_, ServerFrame>(client.stream())
            .await
            .unwrap()
            .unwrap();
        match end {
            ServerFrame::StreamEnd { error, .. } => {
                assert!(error.is_some(), "expected error on StreamEnd");
            }
            other => panic!("expected StreamEnd, got {:?}", other),
        }

        server_task.await.unwrap();
    }

    /// Authorized peer subscribes, exchanges Hello frames, then cancels
    /// cleanly. Validates the happy-path handshake for Sync streams.
    #[tokio::test]
    async fn sync_hello_roundtrip_completes() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());

        // Register the test user as a board member.
        let _ = test_helpers::register_test_user(&state);
        state
            .auth_service
            .lock()
            .unwrap()
            .add_to_room(&board_id, "test-user", crate::auth::RoomRole::Owner, "test")
            .unwrap();

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();

        let state_for_server = state.clone();
        let server_task = tokio::spawn(async move {
            let mut stream = server.accept().await.expect("accept");
            let frame = read_frame::<_, ClientFrame>(&mut stream)
                .await
                .expect("read")
                .expect("frame");
            if let ClientFrame::StreamSubscribe {
                correlation_id,
                topic,
            } = frame
            {
                let _ = super::handle_subscribe(&mut stream, &state_for_server, correlation_id, topic)
                    .await;
            }
        });

        let mut client = Client::connect_with_descriptor(&desc).await.unwrap();
        let correlation_id = Uuid::new_v4();
        write_frame(
            client.stream(),
            &ClientFrame::StreamSubscribe {
                correlation_id,
                topic: StreamTopic::Sync {
                    board_id: board_id.clone(),
                },
            },
        )
        .await
        .unwrap();

        let hello = serde_json::to_vec(&lexera_core::sync::ClientMessage::ClientHello {
            user_id: "test-user".into(),
            vv: String::new(),
        })
        .unwrap();
        write_frame(
            client.stream(),
            &ClientFrame::StreamSend {
                correlation_id,
                payload: hello,
            },
        )
        .await
        .unwrap();

        // The first server message is either ServerPresence (broadcast on
        // registration) or ServerHello; accept either until we've seen
        // ServerHello.
        let mut saw_hello = false;
        for _ in 0..3 {
            let msg = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            let payload = match msg {
                ServerFrame::StreamMessage { payload, .. } => payload,
                other => panic!("expected StreamMessage, got {:?}", other),
            };
            let parsed: serde_json::Value = serde_json::from_slice(&payload).unwrap();
            if parsed["type"] == "ServerHello" {
                saw_hello = true;
                assert!(parsed["peer_id"].is_number());
                break;
            }
        }
        assert!(saw_hello, "did not observe ServerHello within 3 frames");

        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id })
            .await
            .unwrap();
        // After cancel, the server eventually emits StreamEnd with no error.
        // It may first drain any pending hub broadcasts (e.g. presence).
        let mut saw_end = false;
        for _ in 0..5 {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap();
            match frame {
                Some(ServerFrame::StreamEnd { error, .. }) => {
                    assert!(error.is_none(), "unexpected end error: {:?}", error);
                    saw_end = true;
                    break;
                }
                Some(_) => continue,
                None => break,
            }
        }
        assert!(saw_end, "did not observe StreamEnd within 5 frames");

        server_task.await.unwrap();
    }
}

/// Mirrors `api::events::stream_logs`: emits a "Connected" entry on open,
/// then forwards `log_bridge` broadcasts as JSON. No resync concept — log
/// drops are recoverable without UI refresh.
async fn forward_logs(
    stream: &mut Stream,
    correlation_id: Uuid,
) -> Result<(), IpcError> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let started = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let greeting = crate::log_bridge::BackendLogEntry {
        timestamp_ms: started,
        level: "info".into(),
        target: "lexera.api.logs".into(),
        message: "Connected to /logs/stream (ipc)".into(),
    };
    let payload = serde_json::to_vec(&greeting).unwrap_or_default();
    write_frame(
        stream,
        &ServerFrame::StreamMessage { correlation_id, payload },
    )
    .await?;

    let mut rx = crate::log_bridge::subscribe();
    let end_err = loop {
        tokio::select! {
            recv = rx.recv() => match recv {
                Ok(entry) => {
                    let payload = serde_json::to_vec(&entry).unwrap_or_default();
                    write_frame(
                        stream,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    )
                    .await?;
                }
                Err(RecvError::Lagged(_)) => {
                    // Log drops are intentionally silent.
                }
                Err(RecvError::Closed) => break None,
            },
            client = read_frame::<_, ClientFrame>(stream) => match client? {
                Some(ClientFrame::Cancel { correlation_id: cid }) if cid == correlation_id => {
                    break None;
                }
                Some(_) => {}
                None => break Some("connection closed".to_string()),
            },
        }
    };

    write_frame(
        stream,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: end_err,
        },
    )
    .await
}
