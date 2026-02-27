use crate::api::api_router;
use crate::collab_api::collab_router;
use crate::export_api::export_router;
use crate::state::AppState;
use crate::sync_ws::sync_router;
/// HTTP server: spawns axum on a background tokio task.
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

/// Fallback ports to try when the configured port is in use.
const FALLBACK_PORTS: &[u16] = &[13080, 12080, 14080, 11080, 15080];

fn build_app(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    api_router()
        .merge(collab_router())
        .merge(sync_router())
        .merge(export_router())
        .layer(cors)
        .with_state(state)
}

/// Try to bind a TCP listener on the given address:port.
async fn try_bind(
    bind_addr: &str,
    port: u16,
) -> Option<(tokio::net::TcpListener, u16)> {
    match tokio::net::TcpListener::bind(format!("{}:{}", bind_addr, port)).await {
        Ok(listener) => {
            let actual_port = listener.local_addr().ok()?.port();
            Some((listener, actual_port))
        }
        Err(e) => {
            log::warn!(
                "[server] Cannot bind {}:{} — {}",
                bind_addr,
                port,
                e
            );
            None
        }
    }
}

/// Spawn the HTTP server. Tries the configured port first, then fallback ports.
/// Returns the actual port and a shutdown sender.
pub async fn spawn_server(
    state: AppState,
) -> Result<(u16, tokio::sync::watch::Sender<bool>), Box<dyn std::error::Error>> {
    let port = state.port;
    let bind_addr = state.bind_address.clone();

    // Build candidate port list: configured port first, then fallbacks (deduplicated)
    let mut candidates: Vec<u16> = vec![port];
    for &fp in FALLBACK_PORTS {
        if !candidates.contains(&fp) {
            candidates.push(fp);
        }
    }

    let mut listener_and_port = None;
    for &candidate in &candidates {
        if let Some(result) = try_bind(&bind_addr, candidate).await {
            listener_and_port = Some(result);
            break;
        }
    }

    let (listener, actual_port) = listener_and_port.ok_or_else(|| {
        format!(
            "All ports exhausted ({:?}), cannot start HTTP server",
            candidates
        )
    })?;

    if actual_port != port {
        log::warn!(
            "[server] Configured port {} was busy, using fallback port {}",
            port,
            actual_port
        );
    }

    log::info!(
        "HTTP server listening on http://{}:{}",
        bind_addr,
        actual_port
    );

    let app = build_app(state);

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        let server = axum::serve(listener, app);
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    log::error!("HTTP server exited with error: {}", e);
                }
            }
            _ = shutdown_rx.changed() => {
                log::info!("[server] Shutdown signal received, stopping HTTP server");
            }
        }
    });

    Ok((actual_port, shutdown_tx))
}

/// Restart the HTTP server on a new bind address and port.
/// Shuts down the old server, spawns a new one, updates AppState's live port.
pub async fn restart_server(
    state: AppState,
    new_bind: String,
    new_port: u16,
) -> Result<u16, String> {
    // Shut down the old server (scope ensures MutexGuard is dropped before await)
    {
        let old_tx = state.server_shutdown.lock().map_err(|e| e.to_string())?;
        if let Some(tx) = old_tx.as_ref() {
            let _ = tx.send(true);
        }
    }

    // Brief pause to let the old listener release
    tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

    // Build candidate port list (no mutex held here)
    let mut candidates: Vec<u16> = vec![new_port];
    for &fp in FALLBACK_PORTS {
        if !candidates.contains(&fp) {
            candidates.push(fp);
        }
    }

    let mut listener_and_port = None;
    for &candidate in &candidates {
        if let Some(result) = try_bind(&new_bind, candidate).await {
            listener_and_port = Some(result);
            break;
        }
    }

    let (listener, actual_port) = listener_and_port
        .ok_or_else(|| format!("All ports exhausted ({:?})", candidates))?;

    log::info!(
        "[server] Restarted on http://{}:{}",
        new_bind,
        actual_port
    );

    // Build a new app with the same shared state
    let app = build_app(state.clone());

    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    tokio::spawn(async move {
        let server = axum::serve(listener, app);
        tokio::select! {
            result = server => {
                if let Err(e) = result {
                    log::error!("HTTP server exited with error: {}", e);
                }
            }
            _ = shutdown_rx.changed() => {
                log::info!("[server] Shutdown signal received, stopping HTTP server");
            }
        }
    });

    // Store new shutdown handle (short lock, no await after)
    {
        let mut old_tx = state.server_shutdown.lock().map_err(|e| e.to_string())?;
        *old_tx = Some(shutdown_tx);
    }

    // Update live port (short lock, no await after)
    {
        let mut live = state.live_port.lock().map_err(|e| e.to_string())?;
        *live = actual_port;
    }

    Ok(actual_port)
}
