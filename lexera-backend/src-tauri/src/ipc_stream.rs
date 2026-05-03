//! Server-side handlers for `StreamSubscribe` frames.
//!
//! Bridges the existing backend broadcast channels (`event_tx`,
//! `log_bridge::subscribe()`, future `sync_hub`) to IPC `StreamMessage`
//! frames. One stream per connection; clients open parallel connections for
//! concurrent streams, the same as they do for assets.

use crate::state::AppState;
use lexera_local_ipc::frame::{write_frame, ClientFrame, ServerFrame, StreamTopic};
use lexera_local_ipc::transport::Stream;
use lexera_local_ipc::IpcError;
use tokio::io::WriteHalf;
use tokio::sync::broadcast::error::RecvError;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Entry point: dispatch on the topic and drive the chosen forwarder until
/// the client cancels, the connection drops, or the backend channel closes.
pub async fn handle_subscribe(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    state: &AppState,
    correlation_id: Uuid,
    topic: StreamTopic,
) -> Result<(), IpcError> {
    match topic {
        StreamTopic::Events => {
            forward_events(write_half, control_rx, state, correlation_id).await
        }
        StreamTopic::Logs => forward_logs(write_half, control_rx, correlation_id).await,
        StreamTopic::Sync { board_id } => {
            crate::ipc_sync::forward_sync(write_half, control_rx, state, correlation_id, board_id)
                .await
        }
    }
}

/// Mirrors `api::events::sse_events`: subscribes to the board-change
/// broadcast, emits each event as JSON, and on lag emits a resync sentinel
/// that the frontend adapter turns into the same `onEvent({type:'Resync'})`
/// call the HTTP SSE path delivers.
async fn forward_events(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
    state: &AppState,
    correlation_id: Uuid,
) -> Result<(), IpcError> {
    let mut rx = state.event_tx.subscribe();

    // Heartbeat every 30s when idle. Skip immediate tick.
    let heartbeat_duration = std::time::Duration::from_secs(30);
    let mut heartbeat_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + heartbeat_duration,
        heartbeat_duration
    );
    heartbeat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let end_err = loop {
        tokio::select! {
            recv = rx.recv() => match recv {
                Ok(event) => {
                    let payload = serde_json::to_vec(&event).unwrap_or_default();
                    if let Err(e) = write_frame(
                        write_half,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    ).await {
                        break Some(format!("write failed: {}", e));
                    }
                }
                Err(RecvError::Lagged(n)) => {
                    log::warn!(
                        target: "lexera.ipc.stream",
                        "events: client lagged by {}, sending resync",
                        n
                    );
                    let resync = serde_json::json!({"type": "Resync", "lagged": n});
                    let payload = serde_json::to_vec(&resync).unwrap_or_default();
                    if let Err(e) = write_frame(
                        write_half,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    ).await {
                        break Some(format!("write failed: {}", e));
                    }
                }
                Err(RecvError::Closed) => break None,
            },
            client_msg = control_rx.recv() => match client_msg {
                Some(ClientFrame::Cancel { correlation_id: cid }) if cid == correlation_id => {
                    break None;
                }
                Some(ClientFrame::Ping) => {
                    let _ = write_frame(write_half, &ServerFrame::Pong).await;
                }
                Some(_) => {}
                None => break Some("connection closed".to_string()),
            },
            _ = heartbeat_interval.tick() => {
                if let Err(e) = write_frame(write_half, &ServerFrame::Heartbeat).await {
                    break Some(format!("heartbeat failed: {}", e));
                }
            }
        }
    };

    write_frame(
        write_half,
        &ServerFrame::StreamEnd {
            correlation_id,
            error: end_err,
        },
    )
    .await
}

/// Mirrors `api::events::stream_logs`: emits a "Connected" entry on open,
/// then forwards `log_bridge` broadcasts as JSON. No resync concept — log
/// drops are recoverable without UI refresh.
async fn forward_logs(
    write_half: &mut WriteHalf<Stream>,
    control_rx: &mut mpsc::Receiver<ClientFrame>,
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
        write_half,
        &ServerFrame::StreamMessage {
            correlation_id,
            payload,
        },
    )
    .await?;

    let mut rx = crate::log_bridge::subscribe();

    // Heartbeat every 30s when idle. Skip immediate tick.
    let heartbeat_duration = std::time::Duration::from_secs(30);
    let mut heartbeat_interval = tokio::time::interval_at(
        tokio::time::Instant::now() + heartbeat_duration,
        heartbeat_duration
    );
    heartbeat_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let end_err = loop {
        tokio::select! {
            recv = rx.recv() => match recv {
                Ok(entry) => {
                    let payload = serde_json::to_vec(&entry).unwrap_or_default();
                    if let Err(e) = write_frame(
                        write_half,
                        &ServerFrame::StreamMessage { correlation_id, payload },
                    ).await {
                        break Some(format!("write failed: {}", e));
                    }
                }
                Err(RecvError::Lagged(_)) => {
                    // Log drops are intentionally silent.
                }
                Err(RecvError::Closed) => break None,
            },
            client_msg = control_rx.recv() => match client_msg {
                Some(ClientFrame::Cancel { correlation_id: cid }) if cid == correlation_id => {
                    break None;
                }
                Some(ClientFrame::Ping) => {
                    let _ = write_frame(write_half, &ServerFrame::Pong).await;
                }
                Some(_) => {}
                None => break Some("connection closed".to_string()),
            },
            _ = heartbeat_interval.tick() => {
                if let Err(e) = write_frame(write_half, &ServerFrame::Heartbeat).await {
                    break Some(format!("heartbeat failed: {}", e));
                }
            }
        }
    };

    write_frame(
        write_half,
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
    use lexera_local_ipc::frame::{read_frame, write_frame, ClientFrame, ServerFrame};
    use lexera_local_ipc::{Client, Descriptor, Server};

    fn test_descriptor(dir: &tempfile::TempDir) -> Descriptor {
        Descriptor::new(dir.path().join("ipc.sock").to_string_lossy().into_owned())
    }

    async fn drive_handler(
        server: Server,
        app_state: AppState,
    ) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
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

            let (mut read_half, mut write_half) = tokio::io::split(stream);
            let (tx, mut rx) = mpsc::channel(4);
            tokio::spawn(async move {
                while let Ok(Some(f)) = read_frame::<_, ClientFrame>(&mut read_half).await {
                    let _ = tx.send(f).await;
                }
            });

            super::handle_subscribe(&mut write_half, &mut rx, &app_state, correlation_id, topic)
                .await
                .expect("handler io");
        })
    }

    #[tokio::test]
    async fn events_subscribe_delivers_broadcast_then_ends_on_cancel() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_helpers::test_state(tmp.path());
        let event_tx = state.event_tx.clone();

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _server_handle = drive_handler(server, state.clone()).await;

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

        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        event_tx
            .send(BoardChangeEvent::MediaChanged {
                board_id: "b1".into(),
                path: None,
            })
            .unwrap();

        // Drain until we see StreamMessage, ignoring heartbeats.
        let msg = loop {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            match frame {
                ServerFrame::Heartbeat => continue,
                other => break other,
            }
        };
        let payload = match msg {
            ServerFrame::StreamMessage { payload, .. } => payload,
            other => panic!("expected StreamMessage, got {:?}", other),
        };
        let parsed: serde_json::Value = serde_json::from_slice(&payload).unwrap();
        assert_eq!(parsed["type"], "MediaChanged");

        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id })
            .await
            .unwrap();
        let end = loop {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            match frame {
                ServerFrame::Heartbeat => continue,
                other => break other,
            }
        };
        match end {
            ServerFrame::StreamEnd { error, .. } => assert!(error.is_none(), "{:?}", error),
            other => panic!("expected StreamEnd, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn sync_unauthorized_user_receives_error_end() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _server_handle = drive_handler(server, state.clone()).await;

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

        let msg = loop {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            match frame {
                ServerFrame::Heartbeat => continue,
                other => break other,
            }
        };
        let err_payload = match msg {
            ServerFrame::StreamMessage { payload, .. } => payload,
            other => panic!("expected StreamMessage, got {:?}", other),
        };
        let parsed: serde_json::Value = serde_json::from_slice(&err_payload).unwrap();
        assert_eq!(parsed["type"], "ServerError");

        let end = loop {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            match frame {
                ServerFrame::Heartbeat => continue,
                other => break other,
            }
        };
        match end {
            ServerFrame::StreamEnd { error, .. } => {
                assert!(error.is_some(), "expected error on StreamEnd");
            }
            other => panic!("expected StreamEnd, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn sync_hello_roundtrip_completes() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = test_helpers::setup_board(tmp.path());

        let _ = test_helpers::register_test_user(&state);
        state
            .auth_service
            .write()
            .unwrap()
            .add_to_room(&board_id, "test-user", crate::auth::RoomRole::Owner, "test")
            .unwrap();

        let desc = test_descriptor(&tmp);
        let server = Server::bind_with_descriptor(&desc).await.unwrap();
        let _server_handle = drive_handler(server, state.clone()).await;

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

        let mut saw_hello = false;
        for _ in 0..5 {
            let frame = read_frame::<_, ServerFrame>(client.stream())
                .await
                .unwrap()
                .unwrap();
            let payload = match frame {
                ServerFrame::StreamMessage { payload, .. } => payload,
                ServerFrame::Heartbeat => continue,
                other => panic!("expected StreamMessage or Heartbeat, got {:?}", other),
            };
            let parsed: serde_json::Value = serde_json::from_slice(&payload).unwrap();
            if parsed["type"] == "ServerHello" {
                saw_hello = true;
                break;
            }
        }
        assert!(saw_hello);

        write_frame(client.stream(), &ClientFrame::Cancel { correlation_id })
            .await
            .unwrap();
        let mut saw_end = false;
        for _ in 0..10 {
            let frame = read_frame::<_, ServerFrame>(client.stream()).await.unwrap();
            match frame {
                Some(ServerFrame::StreamEnd { error, .. }) => {
                    assert!(error.is_none());
                    saw_end = true;
                    break;
                }
                Some(ServerFrame::Heartbeat) => continue,
                Some(_) => continue,
                None => break,
            }
        }
        assert!(saw_end);
    }
}
