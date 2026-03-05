use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;

use crate::config::{save_config, WorkspaceEntry};
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
    Ok(Json(serde_json::json!({ "theme": body.theme })))
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
pub struct SetDefaultWorkspaceRequest {
    pub workspace_id: Option<String>,
}

#[derive(Deserialize)]
pub struct AssignBoardWorkspaceRequest {
    pub workspace_id: Option<String>,
}

/// GET /config/workspaces — list all workspaces and the default workspace ID.
pub async fn list_workspaces(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.lock().ok();
    let workspaces: Vec<serde_json::Value> = cfg
        .as_ref()
        .map(|c| {
            c.workspaces
                .iter()
                .map(|w| serde_json::json!({ "id": w.id, "name": w.name }))
                .collect()
        })
        .unwrap_or_default();
    let default_ws = cfg.as_ref().and_then(|c| c.default_workspace.clone());

    Json(serde_json::json!({
        "workspaces": workspaces,
        "default_workspace": default_ws,
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
        cfg.workspaces.push(WorkspaceEntry {
            id: id.clone(),
            name: name.clone(),
        });
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace create: {}", e);
        }
    }

    log::info!("[config] Created workspace '{}' ({})", name, id);
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
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace rename: {}", e);
        }
    }

    log::info!("[config] Renamed workspace {} to '{}'", workspace_id, name);
    Ok(Json(serde_json::json!({ "id": workspace_id, "name": name })))
}

/// DELETE /config/workspaces/{id} — delete a workspace and unassign its boards.
pub async fn delete_workspace(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
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
        // Unassign boards from this workspace
        for board in &mut cfg.boards {
            if board.workspace_id.as_deref() == Some(&workspace_id) {
                board.workspace_id = None;
            }
        }
        // Clear default if it was this workspace
        if cfg.default_workspace.as_deref() == Some(&workspace_id) {
            cfg.default_workspace = None;
        }
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace delete: {}", e);
        }
    }

    log::info!("[config] Deleted workspace {}", workspace_id);
    Ok(Json(serde_json::json!({ "deleted": workspace_id })))
}

/// PUT /config/default-workspace — set or clear the default workspace.
pub async fn set_default_workspace(
    State(state): State<AppState>,
    Json(body): Json<SetDefaultWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
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
        }
        cfg.default_workspace = body.workspace_id.clone();
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after default workspace change: {}", e);
        }
    }

    log::info!("[config] Default workspace set to {:?}", body.workspace_id);
    Ok(Json(
        serde_json::json!({ "default_workspace": body.workspace_id }),
    ))
}

/// PUT /config/boards/{board_id}/workspace — assign or unassign a board to a workspace.
pub async fn assign_board_workspace(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<AssignBoardWorkspaceRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
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
    let board_file = board_path.to_string_lossy().to_string();

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;

        // Validate workspace exists if assigning
        if let Some(ref ws_id) = body.workspace_id {
            if !cfg.workspaces.iter().any(|w| w.id == *ws_id) {
                return Err((
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        error: "Workspace not found".to_string(),
                    }),
                ));
            }
        }

        // Find board in config by file path
        let board_entry = cfg.boards.iter_mut().find(|b| b.file == board_file);
        match board_entry {
            Some(entry) => entry.workspace_id = body.workspace_id.clone(),
            None => {
                return Err((
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse {
                        error: "Board not found in config".to_string(),
                    }),
                ));
            }
        }
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after board workspace assignment: {}", e);
        }
    }

    log::info!(
        "[config] Board {} assigned to workspace {:?}",
        board_id,
        body.workspace_id
    );
    Ok(Json(serde_json::json!({
        "board_id": board_id,
        "workspace_id": body.workspace_id,
    })))
}

// ── Helpers ────────────────────────────────────────────────────────────

fn lock_error() -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse {
            error: "Failed to lock config".to_string(),
        }),
    )
}
