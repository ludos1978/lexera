use crate::api::api_router;
use crate::collab_api::collab_router;
use crate::state::AppState;
use crate::sync_ws::sync_router;
/// HTTP server: spawns axum on a background tokio task.
use axum::Router;
use tower_http::cors::{Any, CorsLayer};

pub async fn spawn_server(state: AppState) -> Result<u16, Box<dyn std::error::Error>> {
    let port = state.port;
    let bind_addr = state.bind_address.clone();

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app: Router = api_router()
        .merge(collab_router())
        .merge(sync_router())
        .layer(cors)
        .with_state(state);

    let listener =
        tokio::net::TcpListener::bind(format!("{}:{}", bind_addr, port)).await?;
    let actual_port = listener.local_addr()?.port();

    log::info!(
        "HTTP server listening on http://{}:{}",
        bind_addr,
        actual_port
    );

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            log::error!("HTTP server exited with error: {}", e);
        }
    });

    Ok(actual_port)
}
