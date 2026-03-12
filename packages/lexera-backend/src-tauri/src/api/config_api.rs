use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;

use lexera_core::watcher::types::BoardChangeEvent;

use crate::config::{normalize_workspace_setup, save_config, LudosSyncModuleConfig, WorkspaceEntry};
use crate::ludos_sync::spawn_ludos_sync_reconcile;
use crate::state::AppState;

use super::ErrorResponse;

// ── Theme ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SetThemeRequest {
    pub theme: String,
}

/// Valid theme IDs (must match themes.js LEXERA_THEMES array).
const VALID_THEMES: &[&str] = &["lexera", "mono", "warm", "nord"];

/// GET /config/theme — returns the current theme ID.
pub async fn get_theme(State(state): State<AppState>) -> Json<serde_json::Value> {
    let theme = state
        .config
        .lock()
        .ok()
        .and_then(|cfg| cfg.theme.clone())
        .unwrap_or_else(|| "lexera".to_string());

    Json(serde_json::json!({ "theme": theme }))
}

/// PUT /config/theme — sets the theme ID and persists to config.
pub async fn set_theme(
    State(state): State<AppState>,
    Json(body): Json<SetThemeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if !VALID_THEMES.contains(&body.theme.as_str()) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!(
                    "Invalid theme '{}'. Valid themes: {}",
                    body.theme,
                    VALID_THEMES.join(", ")
                ),
            }),
        ));
    }

    let config_path = state.config_path.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        cfg.theme = Some(body.theme.clone());
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after theme change: {}", e);
        }
    }

    log::info!("[config] Theme changed to '{}'", body.theme);
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({ "theme": body.theme })))
}

// ── Ludos Sync Module ────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateLudosSyncRequest {
    pub enabled: bool,
    pub port: u16,
    pub bookmarks_enabled: bool,
    pub calendar_enabled: bool,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

pub async fn get_ludos_sync_config(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.lock().ok().map(|guard| guard.clone());
    let config = cfg
        .as_ref()
        .map(|guard| guard.ludos_sync.clone())
        .unwrap_or_default();
    let status = {
        let mut manager = state.ludos_sync.lock().await;
        cfg.as_ref()
            .map(|guard| manager.status(guard))
            .unwrap_or_else(|| manager.status(&crate::config::SyncConfig::default()))
    };

    Json(serde_json::json!({
        "config": config,
        "status": status,
    }))
}

pub async fn update_ludos_sync_config(
    State(state): State<AppState>,
    Json(body): Json<UpdateLudosSyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    if body.port == 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "ludos-sync port must be greater than 0".to_string(),
            }),
        ));
    }

    let config_path = state.config_path.clone();
    let next = LudosSyncModuleConfig {
        enabled: body.enabled,
        port: body.port,
        bookmarks_enabled: body.bookmarks_enabled,
        calendar_enabled: body.calendar_enabled,
        username: body.username.clone().filter(|value| !value.trim().is_empty()),
        password: body.password.clone().filter(|value| !value.trim().is_empty()),
    };

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        cfg.ludos_sync = next.clone();
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after ludos-sync update: {}", e);
        }
    }

    notify_config_changed(&state);
    spawn_ludos_sync_reconcile(state.clone());

    let status = {
        let cfg = state.config.lock().ok().map(|guard| guard.clone());
        let mut manager = state.ludos_sync.lock().await;
        cfg.as_ref()
            .map(|guard| manager.status(guard))
            .unwrap_or_else(|| manager.status(&crate::config::SyncConfig::default()))
    };

    Ok(Json(serde_json::json!({
        "config": next,
        "status": status,
    })))
}

pub async fn restart_ludos_sync(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let cfg = state.config.lock().map_err(|_| lock_error())?.clone();
    let status = {
        let mut manager = state.ludos_sync.lock().await;
        manager.restart(&cfg).await.map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse { error: e }),
            )
        })?;
        manager.status(&cfg)
    };

    Ok(Json(serde_json::json!({ "status": status })))
}

// ── Workspaces ─────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateWorkspaceRequest {
    pub name: String,
}

#[derive(Deserialize)]
pub struct UpdateWorkspaceRequest {
    pub name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateWorkspaceSyncRequest {
    #[serde(default)]
    pub bookmark_sync: Option<bool>,
    #[serde(default)]
    pub calendar_sync: Option<bool>,
    #[serde(default)]
    pub calendar_slug: Option<String>,
    #[serde(default)]
    pub calendar_name: Option<String>,
}

#[derive(Deserialize)]
pub struct SetDefaultWorkspaceRequest {
    pub workspace_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AssignBoardWorkspacesRequest {
    pub workspace_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBoardSyncRequest {
    #[serde(default)]
    pub xbel_name: Option<String>,
    #[serde(default)]
    pub bookmark_sync: Option<bool>,
    #[serde(default)]
    pub calendar_sync: Option<bool>,
    #[serde(default)]
    pub calendar_slug: Option<String>,
    #[serde(default)]
    pub calendar_name: Option<String>,
}

/// GET /config/workspaces — list all workspaces and the default workspace ID.
pub async fn list_workspaces(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.lock().ok();
    let workspaces: Vec<serde_json::Value> = cfg
        .as_ref()
        .map(|c| {
            c.workspaces
                .iter()
                .map(|w| {
                    let board_count = c
                        .boards
                        .iter()
                        .filter(|b| b.workspace_ids.iter().any(|id| id == &w.id))
                        .count();
                    serde_json::json!({
                        "id": w.id,
                        "name": w.name,
                        "board_count": board_count,
                        "bookmarkSync": w.bookmark_sync,
                        "calendarSync": w.calendar_sync,
                        "calendarSlug": w.calendar_slug,
                        "calendarName": w.calendar_name,
                    })
                })
                .collect::<Vec<serde_json::Value>>()
        })
        .unwrap_or_default();
    let default_ws = cfg.as_ref().and_then(|c| c.default_workspace.clone());
    let unassigned_board_count = cfg
        .as_ref()
        .map(|c| {
            c.boards
                .iter()
                .filter(|b| b.workspace_ids.is_empty())
                .count()
        })
        .unwrap_or(0);

    Json(serde_json::json!({
        "workspaces": workspaces,
        "default_workspace": default_ws,
        "unassigned_board_count": unassigned_board_count,
    }))
}

/// POST /config/workspaces — create a new workspace.
pub async fn create_workspace(
    State(state): State<AppState>,
    Json(body): Json<CreateWorkspaceRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Workspace name must not be empty".to_string(),
            }),
        ));
    }

    let id = uuid::Uuid::new_v4().to_string();
    let config_path = state.config_path.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        if cfg
            .workspaces
            .iter()
            .any(|w| w.name.trim().eq_ignore_ascii_case(&name))
        {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "Workspace name already exists".to_string(),
                }),
            ));
        }
        cfg.workspaces.push(WorkspaceEntry {
            id: id.clone(),
            name: name.clone(),
            ..WorkspaceEntry::default()
        });
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace create: {}", e);
        }
    }

    log::info!("[config] Created workspace '{}' ({})", name, id);
    notify_config_changed(&state);
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({ "id": id, "name": name })),
    ))
}

/// PUT /config/workspaces/{id} — rename a workspace.
pub async fn update_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<UpdateWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Workspace name must not be empty".to_string(),
            }),
        ));
    }

    let config_path = state.config_path.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        if cfg
            .workspaces
            .iter()
            .any(|w| w.id != workspace_id && w.name.trim().eq_ignore_ascii_case(&name))
        {
            return Err((
                StatusCode::CONFLICT,
                Json(ErrorResponse {
                    error: "Workspace name already exists".to_string(),
                }),
            ));
        }
        let ws = cfg.workspaces.iter_mut().find(|w| w.id == workspace_id);
        match ws {
            Some(w) => w.name = name.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Workspace not found".to_string(),
                    }),
                ));
            }
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace rename: {}", e);
        }
    }

    log::info!("[config] Renamed workspace {} to '{}'", workspace_id, name);
    notify_config_changed(&state);
    Ok(Json(
        serde_json::json!({ "id": workspace_id, "name": name }),
    ))
}

/// PUT /config/workspaces/{id}/sync — update workspace-level ludos-sync defaults.
pub async fn update_workspace_sync(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    Json(body): Json<UpdateWorkspaceSyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    let calendar_slug = normalize_optional_text(body.calendar_slug);
    let calendar_name = normalize_optional_text(body.calendar_name);

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        let ws = cfg.workspaces.iter_mut().find(|w| w.id == workspace_id);
        match ws {
            Some(workspace) => {
                workspace.bookmark_sync = body.bookmark_sync;
                workspace.calendar_sync = body.calendar_sync;
                workspace.calendar_slug = calendar_slug.clone();
                workspace.calendar_name = calendar_name.clone();
            }
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Workspace not found".to_string(),
                    }),
                ));
            }
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace sync update: {}", e);
        }
    }

    log::info!("[config] Updated workspace sync defaults for {}", workspace_id);
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({
        "id": workspace_id,
        "bookmarkSync": body.bookmark_sync,
        "calendarSync": body.calendar_sync,
        "calendarSlug": calendar_slug,
        "calendarName": calendar_name,
    })))
}

/// DELETE /config/workspaces/{id} — delete a workspace and reassign affected boards.
pub async fn delete_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        if cfg.workspaces.len() <= 1 {
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    error: "At least one workspace is required".to_string(),
                }),
            ));
        }

        let before = cfg.workspaces.len();
        cfg.workspaces.retain(|w| w.id != workspace_id);
        if cfg.workspaces.len() == before {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Workspace not found".to_string(),
                }),
            ));
        }

        let fallback_workspace = cfg
            .default_workspace
            .clone()
            .filter(|id| *id != workspace_id && cfg.workspaces.iter().any(|w| w.id == *id))
            .or_else(|| cfg.workspaces.first().map(|w| w.id.clone()));

        // Remove this workspace from all boards and reassign orphaned boards.
        for board in &mut cfg.boards {
            board.workspace_ids.retain(|id| id != &workspace_id);
            if board.workspace_ids.is_empty() {
                if let Some(ref fallback_id) = fallback_workspace {
                    board.workspace_ids.push(fallback_id.clone());
                }
            }
        }
        // Move default if it was this workspace.
        if cfg.default_workspace.as_deref() == Some(&workspace_id) {
            cfg.default_workspace = fallback_workspace;
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace delete: {}", e);
        }
    }

    log::info!("[config] Deleted workspace {}", workspace_id);
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({ "deleted": workspace_id })))
}

/// PUT /config/default-workspace — set the default workspace.
pub async fn set_default_workspace(
    State(state): State<AppState>,
    Json(body): Json<SetDefaultWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    let default_workspace;
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        if let Some(ref ws_id) = body.workspace_id {
            if !cfg.workspaces.iter().any(|w| w.id == *ws_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Workspace not found".to_string(),
                    }),
                ));
            }
            cfg.default_workspace = Some(ws_id.clone());
        } else {
            cfg.default_workspace = cfg.workspaces.first().map(|w| w.id.clone());
        }
        normalize_workspace_setup(&mut cfg);
        default_workspace = cfg.default_workspace.clone();
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!(
                "Failed to save config after default workspace change: {}",
                e
            );
        }
    }

    log::info!("[config] Default workspace set to {:?}", default_workspace);
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({
        "default_workspace": default_workspace
    })))
}

/// PUT /config/boards/{board_id}/workspaces — set the workspaces a board belongs to.
pub async fn assign_board_workspaces(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<AssignBoardWorkspacesRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let mut workspace_ids: Vec<String> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    for ws_id in body.workspace_ids {
        let trimmed = ws_id.trim();
        if trimmed.is_empty() {
            continue;
        }
        if seen_ids.insert(trimmed.to_string()) {
            workspace_ids.push(trimmed.to_string());
        }
    }

    if workspace_ids.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Board must belong to at least one workspace".to_string(),
            }),
        ));
    }

    let config_path = state.config_path.clone();

    // Resolve board_id to file path via storage
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;
    let board_file = canonicalize_path(board_path.to_string_lossy().as_ref());

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;

        // Validate all workspace IDs exist
        for ws_id in &workspace_ids {
            if !cfg.workspaces.iter().any(|w| w.id == *ws_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: format!("Workspace '{}' not found", ws_id),
                    }),
                ));
            }
        }

        // Find board in config by file path (canonicalized fallback for legacy paths).
        let board_index = cfg
            .boards
            .iter()
            .position(|b| b.file == board_file)
            .or_else(|| {
                cfg.boards
                    .iter()
                    .position(|b| canonicalize_path(&b.file) == board_file)
            });
        match board_index {
            Some(index) => cfg.boards[index].workspace_ids = workspace_ids.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Board not found in config".to_string(),
                    }),
                ));
            }
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!(
                "Failed to save config after board workspace assignment: {}",
                e
            );
        }
    }

    log::info!(
        "[config] Board {} assigned to workspaces {:?}",
        board_id,
        workspace_ids
    );
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({
        "board_id": board_id,
        "workspace_ids": workspace_ids,
    })))
}

/// PUT /config/boards/{board_id}/sync — update per-board ludos-sync overrides.
pub async fn update_board_sync(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<UpdateBoardSyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;
    let board_file = canonicalize_path(board_path.to_string_lossy().as_ref());
    let xbel_name = normalize_optional_text(body.xbel_name);
    let calendar_slug = normalize_optional_text(body.calendar_slug);
    let calendar_name = normalize_optional_text(body.calendar_name);

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        let board = cfg
            .boards
            .iter_mut()
            .find(|entry| entry.file == board_file || canonicalize_path(&entry.file) == board_file);
        match board {
            Some(entry) => {
                entry.xbel_name = xbel_name.clone();
                entry.bookmark_sync = body.bookmark_sync;
                entry.calendar_sync = body.calendar_sync;
                entry.calendar_slug = calendar_slug.clone();
                entry.calendar_name = calendar_name.clone();
            }
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Board not found in config".to_string(),
                    }),
                ));
            }
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after board sync update: {}", e);
        }
    }

    log::info!("[config] Updated board sync overrides for {}", board_id);
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({
        "boardId": board_id,
        "xbelName": xbel_name,
        "bookmarkSync": body.bookmark_sync,
        "calendarSync": body.calendar_sync,
        "calendarSlug": calendar_slug,
        "calendarName": calendar_name,
    })))
}

// ── Helpers ────────────────────────────────────────────────────────────

fn canonicalize_path(path: &str) -> String {
    let path_buf = PathBuf::from(path);
    std::fs::canonicalize(&path_buf)
        .unwrap_or(path_buf)
        .to_string_lossy()
        .to_string()
}

fn normalize_optional_text(value: Option<String>) -> Option<String> {
    value.and_then(|raw| {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn notify_config_changed(state: &AppState) {
    let _ = state.event_tx.send(BoardChangeEvent::ConfigChanged);
    spawn_ludos_sync_reconcile(state.clone());
}

fn lock_error() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Failed to lock config".to_string(),
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use http_body_util::BodyExt;
    use lexera_core::storage::local::LocalStorage;
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

    fn write_board_file(dir: &std::path::Path, name: &str) -> std::path::PathBuf {
        let path = dir.join(name);
        std::fs::write(
            &path,
            "---\nkanban-plugin: board\n---\n\n## Todo\n- [ ] Task\n",
        )
        .unwrap();
        path
    }

    #[tokio::test]
    async fn get_ludos_sync_config_returns_defaults() {
        let tmp = tempfile::tempdir().unwrap();
        let app = test_router(test_state(tmp.path()));

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/config/ludos-sync")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["config"]["enabled"], false);
        assert_eq!(json["config"]["port"], 13081);
        assert_eq!(json["status"]["running"], false);
    }

    #[tokio::test]
    async fn update_ludos_sync_config_persists_values() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state.clone());

        let resp = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/config/ludos-sync")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "enabled": false,
                            "port": 13123,
                            "bookmarksEnabled": true,
                            "calendarEnabled": true,
                            "username": "sync-user",
                            "password": "secret",
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["config"]["port"], 13123);
        assert_eq!(json["config"]["username"], "sync-user");
        assert_eq!(json["status"]["configuredPort"], 13123);

        let cfg = state.config.lock().unwrap().clone();
        assert_eq!(cfg.ludos_sync.port, 13123);
        assert_eq!(cfg.ludos_sync.username.as_deref(), Some("sync-user"));
        assert_eq!(cfg.ludos_sync.password.as_deref(), Some("secret"));
    }

    #[tokio::test]
    async fn update_workspace_sync_persists_values() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.workspaces.push(WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            });
        }
        let app = test_router(state.clone());

        let resp = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/config/workspaces/ws-1/sync")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "bookmarkSync": false,
                            "calendarSync": true,
                            "calendarSlug": "team",
                            "calendarName": "Team Calendar",
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let cfg = state.config.lock().unwrap().clone();
        let ws = cfg.workspaces.iter().find(|entry| entry.id == "ws-1").unwrap();
        assert_eq!(ws.bookmark_sync, Some(false));
        assert_eq!(ws.calendar_sync, Some(true));
        assert_eq!(ws.calendar_slug.as_deref(), Some("team"));
        assert_eq!(ws.calendar_name.as_deref(), Some("Team Calendar"));
    }

    #[tokio::test]
    async fn update_board_sync_persists_values() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = write_board_file(tmp.path(), "board.md");
        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.boards.push(crate::config::BoardEntry {
                file: std::fs::canonicalize(&board_path)
                    .unwrap()
                    .to_string_lossy()
                    .to_string(),
                workspace_ids: Vec::new(),
                ..crate::config::BoardEntry::default()
            });
        }
        let app = test_router(state.clone());

        let resp = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(&format!("/config/boards/{}/sync", board_id))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "xbelName": "bookmarks.xbel",
                            "bookmarkSync": true,
                            "calendarSync": false,
                            "calendarSlug": "project",
                            "calendarName": "Project Calendar",
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let cfg = state.config.lock().unwrap().clone();
        let board = cfg.boards.iter().find(|entry| entry.file.ends_with("board.md")).unwrap();
        assert_eq!(board.xbel_name.as_deref(), Some("bookmarks.xbel"));
        assert_eq!(board.bookmark_sync, Some(true));
        assert_eq!(board.calendar_sync, Some(false));
        assert_eq!(board.calendar_slug.as_deref(), Some("project"));
        assert_eq!(board.calendar_name.as_deref(), Some("Project Calendar"));
    }
}
