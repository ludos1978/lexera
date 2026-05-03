//! Kanban-side stream subscription manager.
//!
//! Opens a fresh IPC connection per subscription (matching assets), drives
//! the `StreamSubscribe` handshake, and forwards each `StreamMessage`
//! payload into a Tauri `Channel<String>` that the webview listens on.
//!
//! Concurrent subscriptions use parallel connections; the protocol does not
//! multiplex. A registry keyed by `correlation_id` holds the task handles
//! so `backend_ipc_stream_close` can abort them deterministically.

use lexera_local_ipc::frame::{
    read_frame, write_frame, ClientFrame, ServerFrame, StreamTopic,
};
use lexera_local_ipc::{Client, IpcError};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

/// Bounded outbound queue per subscription. Matches the backend hub's
/// per-client capacity (1024) so backpressure surfaces symmetrically.
const OUTBOUND_CAPACITY: usize = 1024;

/// Serializable topic wrapper for the Tauri command boundary. The frontend
/// passes `{ kind: 'events' | 'logs' | 'sync', boardId?: string }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum StreamTopicArg {
    Events,
    Logs,
    Sync {
        #[serde(rename = "boardId")]
        board_id: String,
    },
}

impl From<StreamTopicArg> for StreamTopic {
    fn from(v: StreamTopicArg) -> Self {
        match v {
            StreamTopicArg::Events => StreamTopic::Events,
            StreamTopicArg::Logs => StreamTopic::Logs,
            StreamTopicArg::Sync { board_id } => StreamTopic::Sync { board_id },
        }
    }
}

/// Shape of each message the webview receives on the channel. `payload` is
/// a UTF-8 string — JSON for Events/Logs, raw string for Sync (Phase 5b).
/// `end` is populated on the terminal message only.
#[derive(Debug, Clone, Serialize)]
pub struct StreamMessageOut {
    pub payload: Option<String>,
    /// `Some(None)` means clean close; `Some(Some(msg))` means error.
    pub end: Option<Option<String>>,
}

struct StreamEntry {
    handle: tokio::task::JoinHandle<()>,
    /// Bidirectional streams use this to send payloads back to the backend.
    /// One-way topics (Events, Logs) simply never exercise it.
    send_tx: mpsc::Sender<Vec<u8>>,
    /// Top-level window label of the webview that opened the stream.
    /// Used by `stop_window` (called from `main.rs` `CloseRequested`)
    /// to abort streams owned by a closing window so the registry
    /// doesn't grow unbounded over multi-window churn.
    owner_window: String,
}

#[derive(Default)]
pub struct StreamRegistry {
    inner: Mutex<HashMap<Uuid, StreamEntry>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    async fn insert(&self, id: Uuid, entry: StreamEntry) {
        self.inner.lock().await.insert(id, entry);
    }

    async fn remove(&self, id: &Uuid) -> Option<StreamEntry> {
        self.inner.lock().await.remove(id)
    }

    async fn send_tx(&self, id: &Uuid) -> Option<mpsc::Sender<Vec<u8>>> {
        self.inner.lock().await.get(id).map(|e| e.send_tx.clone())
    }

    /// Abort and drop every stream owned by `window_label`. Synchronous
    /// best-effort cleanup: tasks are aborted (forwarder drops its IPC
    /// connection, backend sees EOF and tears down its end) and the
    /// registry rows are removed. Called from the window-close path
    /// — no-op if the registry mutex is contended (a closing window
    /// shouldn't block on an in-flight stream registration).
    pub fn stop_window_blocking(&self, window_label: &str) {
        let mut map = match self.inner.try_lock() {
            Ok(m) => m,
            Err(_) => return,
        };
        let ids: Vec<Uuid> = map
            .iter()
            .filter(|(_, e)| e.owner_window == window_label)
            .map(|(id, _)| *id)
            .collect();
        for id in ids {
            if let Some(entry) = map.remove(&id) {
                entry.handle.abort();
            }
        }
    }
}

pub type SharedStreamRegistry = Arc<StreamRegistry>;

/// Open a new subscription. Returns the correlation id so the webview can
/// cancel it later via [`close`] or send payloads via [`send`]. Starts a
/// background task that forwards server frames into `channel` and
/// outbound client payloads onto the IPC stream until the stream ends.
///
/// `owner_window` is the top-level window label of the requesting
/// webview (`caller.window().label()` in the Tauri command). It's
/// stored on the stream entry so window-close cleanup can abort
/// streams owned by the closing window.
pub async fn open(
    registry: &SharedStreamRegistry,
    topic: StreamTopicArg,
    channel: Channel<StreamMessageOut>,
    owner_window: String,
) -> Result<Uuid, String> {
    let correlation_id = Uuid::new_v4();
    let topic: StreamTopic = topic.into();

    let mut client = Client::connect()
        .await
        .map_err(|e| format!("ipc connect: {}", e))?;
    write_frame(
        client.stream(),
        &ClientFrame::StreamSubscribe {
            correlation_id,
            topic,
        },
    )
    .await
    .map_err(|e| format!("ipc write subscribe: {}", e))?;

    let (send_tx, send_rx) = mpsc::channel::<Vec<u8>>(OUTBOUND_CAPACITY);
    let registry_for_task = registry.clone();
    let task = tokio::spawn(async move {
        let exit = pump(&mut client, correlation_id, &channel, send_rx).await;
        let _ = channel.send(StreamMessageOut {
            payload: None,
            end: Some(exit),
        });
        let _ = registry_for_task.remove(&correlation_id).await;
    });

    registry
        .insert(correlation_id, StreamEntry { handle: task, send_tx, owner_window })
        .await;
    Ok(correlation_id)
}

/// Close a subscription by correlation id. Aborts the forwarder task,
/// which drops the IPC connection; the backend sees EOF and cleans up.
pub async fn close(registry: &SharedStreamRegistry, correlation_id: Uuid) {
    if let Some(entry) = registry.remove(&correlation_id).await {
        entry.handle.abort();
    }
}

/// Send a payload into an active bidirectional stream. Returns an error if
/// the subscription is unknown or the task has exited.
pub async fn send(
    registry: &SharedStreamRegistry,
    correlation_id: Uuid,
    payload: Vec<u8>,
) -> Result<(), String> {
    let tx = registry
        .send_tx(&correlation_id)
        .await
        .ok_or("unknown or closed stream")?;
    tx.send(payload)
        .await
        .map_err(|_| "stream task exited".into())
}

async fn pump(
    client: &mut Client,
    correlation_id: Uuid,
    channel: &Channel<StreamMessageOut>,
    mut send_rx: mpsc::Receiver<Vec<u8>>,
) -> Option<String> {
    loop {
        tokio::select! {
            frame = read_frame::<_, ServerFrame>(client.stream()) => {
                let f: Result<Option<ServerFrame>, IpcError> = frame;
                match f {
                    Ok(Some(ServerFrame::StreamMessage {
                        correlation_id: cid,
                        payload,
                    })) if cid == correlation_id => {
                        let text = String::from_utf8_lossy(&payload).into_owned();
                        if channel
                            .send(StreamMessageOut {
                                payload: Some(text),
                                end: None,
                            })
                            .is_err()
                        {
                            return Some("webview channel closed".into());
                        }
                    }
                    Ok(Some(ServerFrame::StreamEnd {
                        correlation_id: cid,
                        error,
                    })) if cid == correlation_id => {
                        return error;
                    }
                    Ok(Some(ServerFrame::Error { code, message, .. })) => {
                        return Some(format!("{}: {}", code, message));
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => return Some("connection closed".into()),
                    Err(e) => return Some(format!("ipc read: {}", e)),
                }
            }
            outbound = send_rx.recv() => match outbound {
                Some(payload) => {
                    if let Err(e) = write_frame(
                        client.stream(),
                        &ClientFrame::StreamSend { correlation_id, payload },
                    )
                    .await
                    {
                        return Some(format!("ipc write: {}", e));
                    }
                }
                None => {
                    // All senders dropped (subscription closed from our side).
                    // Send Cancel to let the server tear down cleanly.
                    let _ = write_frame(
                        client.stream(),
                        &ClientFrame::Cancel { correlation_id },
                    )
                    .await;
                    return None;
                }
            }
        }
    }
}
