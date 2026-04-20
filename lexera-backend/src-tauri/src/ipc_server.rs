//! Local IPC listener.
//!
//! Phase 1 introduced the listener + handshake + Ping/Pong.
//! Phase 2 dispatches `ApiRequest` frames through the shared Axum router via
//! [`crate::ipc_dispatch`] so route semantics are identical to the HTTP path.
//!
//! Failures in IPC setup are logged and do not prevent the HTTP server from
//! coming up.

use crate::ipc_asset;
use crate::ipc_dispatch::{self, DispatchError};
use crate::ipc_stream;
use crate::state::AppState;
use axum::Router;
use lexera_local_ipc::frame::{read_frame, write_frame, ClientFrame, ServerFrame};
use lexera_local_ipc::{Descriptor, Server};
use std::sync::Arc;
use tokio::sync::watch;

/// Spawn the IPC accept loop. Returns immediately.
///
/// Builds a Router from `app_state` using the same [`crate::server::build_app`]
/// that serves HTTP, so route semantics, middleware, and state are identical
/// across transports. `shutdown_rx` signals graceful shutdown; the descriptor
/// file is removed when the signal fires.
pub fn spawn(app_state: AppState, shutdown_rx: watch::Receiver<bool>) {
    let router = crate::server::build_app(app_state.clone());
    tokio::spawn(async move {
        match Server::bind_default().await {
            Ok((server, descriptor)) => {
                log::info!(
                    target: "lexera.ipc",
                    "IPC server listening on {} (pid={})",
                    descriptor.endpoint, descriptor.pid
                );
                let server = Arc::new(server);
                run_accept_loop(server, router, app_state, shutdown_rx.clone()).await;
                let path = lexera_local_ipc::descriptor::descriptor_path();
                if let Err(e) = Descriptor::remove_at(&path) {
                    log::warn!(target: "lexera.ipc", "descriptor cleanup failed: {}", e);
                }
            }
            Err(e) => {
                log::error!(
                    target: "lexera.ipc",
                    "IPC server failed to bind; HTTP remains available: {}",
                    e
                );
            }
        }
    });
}

async fn run_accept_loop(
    server: Arc<Server>,
    router: Router,
    app_state: AppState,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            _ = shutdown_rx.changed() => {
                if *shutdown_rx.borrow() {
                    log::info!(target: "lexera.ipc", "IPC accept loop shutting down");
                    break;
                }
            }
            res = server.accept() => {
                match res {
                    Ok(stream) => {
                        let r = router.clone();
                        let s = app_state.clone();
                        tokio::spawn(handle_connection(stream, r, s));
                    }
                    Err(e) => {
                        log::warn!(target: "lexera.ipc", "accept/handshake failed: {}", e);
                    }
                }
            }
        }
    }
}

async fn handle_connection(
    mut stream: lexera_local_ipc::transport::Stream,
    router: Router,
    app_state: AppState,
) {
    loop {
        let frame = match read_frame::<_, ClientFrame>(&mut stream).await {
            Ok(Some(f)) => f,
            Ok(None) => return,
            Err(e) => {
                log::debug!(target: "lexera.ipc", "connection read error: {}", e);
                return;
            }
        };
        match frame {
            ClientFrame::Ping => {
                if let Err(e) = write_frame(&mut stream, &ServerFrame::Pong).await {
                    log::debug!(target: "lexera.ipc", "pong write failed: {}", e);
                    return;
                }
            }
            ClientFrame::Cancel { .. } => {
                // Phase 2 has no streaming requests to cancel; ignore. Phase 4
                // will use cancellation for AssetRequest streams.
            }
            ClientFrame::Handshake { .. } => {
                let err = ServerFrame::Error {
                    correlation_id: None,
                    code: "unexpected_handshake".into(),
                    message: "handshake already completed".into(),
                };
                let _ = write_frame(&mut stream, &err).await;
                return;
            }
            ClientFrame::AssetRequest {
                correlation_id,
                request,
            } => {
                if let Err(e) = ipc_asset::handle_asset_request(
                    &mut stream,
                    &app_state,
                    correlation_id,
                    request,
                )
                .await
                {
                    log::debug!(target: "lexera.ipc", "asset stream IO error: {}", e);
                    return;
                }
            }
            ClientFrame::StreamSubscribe {
                correlation_id,
                topic,
            } => {
                if let Err(e) = ipc_stream::handle_subscribe(
                    &mut stream,
                    &app_state,
                    correlation_id,
                    topic,
                )
                .await
                {
                    log::debug!(target: "lexera.ipc", "subscribe IO error: {}", e);
                    return;
                }
            }
            ClientFrame::StreamSend { correlation_id, .. } => {
                // Phase 5a has no bidirectional streams open. Respond with an
                // explicit error so the client fails fast.
                let err = ServerFrame::Error {
                    correlation_id: Some(correlation_id),
                    code: "no_active_stream".into(),
                    message: "StreamSend outside a bidirectional subscription".into(),
                };
                if let Err(e) = write_frame(&mut stream, &err).await {
                    log::debug!(target: "lexera.ipc", "error write failed: {}", e);
                    return;
                }
            }
            ClientFrame::ApiRequest {
                correlation_id,
                request,
            } => {
                let server_frame =
                    match ipc_dispatch::dispatch_api_request(router.clone(), request).await {
                        Ok(response) => ServerFrame::ApiResponse {
                            correlation_id,
                            response,
                        },
                        Err(DispatchError::BodyTooLarge { size }) => ServerFrame::Error {
                            correlation_id: Some(correlation_id),
                            code: "body_too_large".into(),
                            message: format!(
                                "response body {} bytes exceeds MAX_FRAME_BYTES; use AssetRequest",
                                size
                            ),
                        },
                        Err(e) => ServerFrame::Error {
                            correlation_id: Some(correlation_id),
                            code: "dispatch_failed".into(),
                            message: e.to_string(),
                        },
                    };
                if let Err(e) = write_frame(&mut stream, &server_frame).await {
                    log::debug!(target: "lexera.ipc", "ApiResponse write failed: {}", e);
                    return;
                }
            }
        }
    }
}
