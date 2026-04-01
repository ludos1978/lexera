use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::Deserialize;
use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::OnceLock;

use lexera_core::watcher::types::BoardChangeEvent;

use crate::config::{normalize_workspace_setup, save_config, RenderAppsConfig, WorkspaceEntry};
use crate::state::AppState;

use super::{err_bad_request, err_internal, err_not_found, ErrorResponse};

// ── Theme ──────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct SetThemeRequest {
    pub theme: String,
}

/// Valid theme IDs (must match themes.js LEXERA_THEMES array).
const SHARED_THEMES_SOURCE: &str = include_str!("../../../../lexera-shared/themes.js");
static VALID_THEME_IDS: OnceLock<Vec<&'static str>> = OnceLock::new();

fn extract_valid_theme_ids(source: &'static str) -> Vec<&'static str> {
    source
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim_start();
            let rest = trimmed.strip_prefix("id: '")?;
            let end = rest.find('\'')?;
            Some(&rest[..end])
        })
        .collect()
}

fn valid_theme_ids() -> &'static [&'static str] {
    VALID_THEME_IDS
        .get_or_init(|| {
            let ids = extract_valid_theme_ids(SHARED_THEMES_SOURCE);
            assert!(
                !ids.is_empty(),
                "Failed to extract theme IDs from lexera-shared/themes.js"
            );
            ids
        })
        .as_slice()
}

/// GET /config/theme — returns the current theme ID.
pub async fn get_theme(State(state): State<AppState>) -> Json<serde_json::Value> {
    let theme = state
        .config_service
        .read(|cfg| cfg.theme.clone())
        .unwrap_or_else(|| "lexera".to_string());

    Json(serde_json::json!({ "theme": theme }))
}

/// PUT /config/theme — sets the theme ID and persists to config.
pub async fn set_theme(
    State(state): State<AppState>,
    Json(body): Json<SetThemeRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let valid_themes = valid_theme_ids();
    if !valid_themes.contains(&body.theme.as_str()) {
        return Err(err_bad_request(format!(
            "Invalid theme '{}'. Valid themes: {}",
            body.theme,
            valid_themes.join(", ")
        )));
    }

    let theme = body.theme.clone();
    state
        .config_service
        .mutate_and_save(|cfg| {
            cfg.theme = Some(theme.clone());
        })
        .map_err(|e| err_internal(e.to_string()))?;
    notify_config_changed(&state);
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
#[serde(rename_all = "camelCase")]
pub struct UpdateGlobalSyncRequest {
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

/// GET /config/global-sync — return global-level sync defaults.
pub async fn get_global_sync(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = state.config.lock().ok();
    let (bm, cal, slug, name) = cfg
        .as_ref()
        .map(|c| {
            (
                c.bookmark_sync,
                c.calendar_sync,
                c.calendar_slug.clone(),
                c.calendar_name.clone(),
            )
        })
        .unwrap_or((None, None, None, None));
    Json(serde_json::json!({
        "bookmarkSync": bm,
        "calendarSync": cal,
        "calendarSlug": slug,
        "calendarName": name,
    }))
}

/// PUT /config/global-sync — update global-level sync defaults.
pub async fn update_global_sync(
    State(state): State<AppState>,
    Json(body): Json<UpdateGlobalSyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    let calendar_slug = normalize_optional_text(body.calendar_slug);
    let calendar_name = normalize_optional_text(body.calendar_name);

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;
        cfg.bookmark_sync = body.bookmark_sync;
        cfg.calendar_sync = body.calendar_sync;
        cfg.calendar_slug = calendar_slug.clone();
        cfg.calendar_name = calendar_name.clone();
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after global sync update: {}", e);
        }
    }

    log::info!("[config] Updated global sync defaults");
    notify_config_changed(&state);
    Ok(Json(serde_json::json!({
        "bookmarkSync": body.bookmark_sync,
        "calendarSync": body.calendar_sync,
        "calendarSlug": calendar_slug,
        "calendarName": calendar_name,
    })))
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
        return Err(err_bad_request("Workspace name must not be empty"));
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
        return Err(err_bad_request("Workspace name must not be empty"));
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
                return Err(err_not_found("Workspace not found"));
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

/// PUT /config/workspaces/{id}/sync — update workspace-level sync defaults.
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
                return Err(err_not_found("Workspace not found"));
            }
        }
        normalize_workspace_setup(&mut cfg);
        if let Err(e) = save_config(&config_path, &cfg) {
            log::error!("Failed to save config after workspace sync update: {}", e);
        }
    }

    log::info!(
        "[config] Updated workspace sync defaults for {}",
        workspace_id
    );
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
            return Err(err_bad_request("At least one workspace is required"));
        }

        let before = cfg.workspaces.len();
        cfg.workspaces.retain(|w| w.id != workspace_id);
        if cfg.workspaces.len() == before {
            return Err(err_not_found("Workspace not found"));
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
                return Err(err_bad_request("Workspace not found"));
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
        return Err(err_bad_request(
            "Board must belong to at least one workspace",
        ));
    }

    let config_path = state.config_path.clone();

    // Resolve board_id to file path via storage
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
    let board_file = canonicalize_path(board_path.to_string_lossy().as_ref());

    {
        let mut cfg = state.config.lock().map_err(|_| lock_error())?;

        // Validate all workspace IDs exist
        for ws_id in &workspace_ids {
            if !cfg.workspaces.iter().any(|w| w.id == *ws_id) {
                return Err(err_bad_request(format!("Workspace '{}' not found", ws_id)));
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
                return Err(err_not_found("Board not found in config"));
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

/// PUT /config/boards/{board_id}/sync — update per-board sync overrides.
pub async fn update_board_sync(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    Json(body): Json<UpdateBoardSyncRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let config_path = state.config_path.clone();
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
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
                return Err(err_not_found("Board not found in config"));
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

// ── Render Applications ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRenderAppsRequest {
    #[serde(default)]
    pub drawio: Option<String>,
    #[serde(default)]
    pub marp: Option<String>,
    #[serde(default)]
    pub pandoc: Option<String>,
    #[serde(default)]
    pub soffice: Option<String>,
    #[serde(default)]
    pub pdftoppm: Option<String>,
    #[serde(default)]
    pub mutool: Option<String>,
}

/// GET /config/render-apps — returns configured render application paths.
pub async fn get_render_apps(State(state): State<AppState>) -> Json<serde_json::Value> {
    let ra = state
        .config_service
        .read(|cfg| cfg.render_apps.clone())
        .unwrap_or_default();

    Json(serde_json::json!({
        "drawio": ra.drawio,
        "marp": ra.marp,
        "pandoc": ra.pandoc,
        "soffice": ra.soffice,
        "pdftoppm": ra.pdftoppm,
        "mutool": ra.mutool,
    }))
}

/// PUT /config/render-apps — update render application paths.
pub async fn set_render_apps(
    State(state): State<AppState>,
    Json(body): Json<UpdateRenderAppsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let ra = RenderAppsConfig {
        drawio: normalize_optional_text(body.drawio),
        marp: normalize_optional_text(body.marp),
        pandoc: normalize_optional_text(body.pandoc),
        soffice: normalize_optional_text(body.soffice),
        pdftoppm: normalize_optional_text(body.pdftoppm),
        mutool: normalize_optional_text(body.mutool),
    };

    let has_any = ra.drawio.is_some()
        || ra.marp.is_some()
        || ra.pandoc.is_some()
        || ra.soffice.is_some()
        || ra.pdftoppm.is_some()
        || ra.mutool.is_some();
    let ra_val = if has_any { Some(ra.clone()) } else { None };
    state
        .config_service
        .mutate_and_save(|cfg| {
            cfg.render_apps = ra_val;
        })
        .map_err(|e| err_internal(e.to_string()))?;
    notify_config_changed(&state);
    log::info!("[config] Render application paths updated");
    Ok(Json(serde_json::json!({
        "drawio": ra.drawio,
        "marp": ra.marp,
        "pandoc": ra.pandoc,
        "soffice": ra.soffice,
        "pdftoppm": ra.pdftoppm,
        "mutool": ra.mutool,
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
}

fn lock_error() -> (StatusCode, Json<ErrorResponse>) {
    err_internal("Failed to lock config")
}

/// Lock config, apply a mutation, save, and notify.
fn mutate_config<F>(state: &AppState, mutate: F) -> Result<(), (StatusCode, Json<ErrorResponse>)>
where
    F: FnOnce(&mut crate::config::SyncConfig) -> Result<(), (StatusCode, Json<ErrorResponse>)>,
{
    let mut cfg = state.config.lock().map_err(|_| lock_error())?;
    mutate(&mut cfg)?;
    save_config(&state.config_path, &cfg).map_err(|e| err_internal(e.to_string()))?;
    drop(cfg);
    notify_config_changed(state);
    Ok(())
}

// ── Dashboard Tags ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct DashboardTagsQuery {
    pub workspace: Option<String>,
}

/// GET /config/dashboard-tags?workspace={id} — returns the resolved dashboard tag list.
/// Resolution: workspace override > global config > default.
pub async fn get_dashboard_tags(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<DashboardTagsQuery>,
) -> Json<serde_json::Value> {
    let default_tags: Vec<String> = vec!["#important".into(), "#blocked".into(), "#review".into()];
    let tags = state
        .config_service
        .read(|cfg| {
            // Try workspace-level override first
            if let Some(ref ws_id) = query.workspace {
                if let Some(ws) = cfg.workspaces.iter().find(|w| &w.id == ws_id) {
                    if let Some(ref ws_tags) = ws.dashboard_tags {
                        return Some(ws_tags.clone());
                    }
                }
            }
            // Fall back to global config
            cfg.dashboard_tags.clone()
        })
        .unwrap_or(default_tags);
    Json(serde_json::json!({ "tags": tags }))
}

#[derive(Deserialize)]
pub struct SetDashboardTagsRequest {
    pub tags: Vec<String>,
    pub workspace: Option<String>,
}

/// PUT /config/dashboard-tags — update dashboard tag list (global or per-workspace).
pub async fn set_dashboard_tags(
    State(state): State<AppState>,
    Json(body): Json<SetDashboardTagsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let tags: Vec<String> = body
        .tags
        .iter()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .collect();
    let ws_id = body.workspace.clone();
    let tags_val = if tags.is_empty() {
        None
    } else {
        Some(tags.clone())
    };
    mutate_config(&state, |cfg| {
        if let Some(ref ws_id) = ws_id {
            let ws = cfg
                .workspaces
                .iter_mut()
                .find(|w| &w.id == ws_id)
                .ok_or_else(|| err_not_found(format!("Workspace not found: {}", ws_id)))?;
            ws.dashboard_tags = tags_val.clone();
        } else {
            cfg.dashboard_tags = tags_val.clone();
        }
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "tags": tags })))
}

// ── Frontend Settings (unified) ────────────────────────────────────

#[derive(Deserialize)]
pub struct SettingsQuery {
    pub workspace: Option<String>,
}

/// GET /config/settings?workspace={id} — returns resolved frontend settings.
/// Resolution: workspace override > global default.
pub async fn get_settings(
    State(state): State<AppState>,
    axum::extract::Query(query): axum::extract::Query<SettingsQuery>,
) -> Json<serde_json::Value> {
    let cfg = state.config.lock().ok();
    let mut merged = std::collections::HashMap::<String, String>::new();

    // Start with global defaults
    if let Some(ref cfg) = cfg {
        if let Some(ref defaults) = cfg.default_settings {
            for (k, v) in defaults {
                merged.insert(k.clone(), v.clone());
            }
        }
    }

    // Apply workspace overrides
    if let Some(ref ws_id) = query.workspace {
        if let Some(ref cfg) = cfg {
            if let Some(ws) = cfg.workspaces.iter().find(|w| &w.id == ws_id) {
                if let Some(ref ws_settings) = ws.settings {
                    for (k, v) in ws_settings {
                        merged.insert(k.clone(), v.clone());
                    }
                }
            }
        }
    }

    Json(serde_json::json!({ "settings": merged }))
}

#[derive(Deserialize)]
pub struct SetSettingsRequest {
    pub settings: std::collections::HashMap<String, String>,
    pub workspace: Option<String>,
}

/// PUT /config/settings — update frontend settings (global or per-workspace).
pub async fn set_settings(
    State(state): State<AppState>,
    Json(body): Json<SetSettingsRequest>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    let settings: std::collections::HashMap<String, String> = body
        .settings
        .into_iter()
        .filter(|(k, _)| !k.trim().is_empty())
        .collect();
    let ws_id = body.workspace.clone();
    let settings_val = if settings.is_empty() {
        None
    } else {
        Some(settings.clone())
    };
    mutate_config(&state, |cfg| {
        if let Some(ref ws_id) = ws_id {
            let ws = cfg
                .workspaces
                .iter_mut()
                .find(|w| &w.id == ws_id)
                .ok_or_else(|| err_not_found(format!("Workspace not found: {}", ws_id)))?;
            ws.settings = settings_val.clone();
        } else {
            cfg.default_settings = settings_val.clone();
        }
        Ok(())
    })?;
    Ok(Json(serde_json::json!({ "settings": settings })))
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use crate::test_helpers::{register_test_user, test_router, test_state};

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
    async fn update_workspace_sync_persists_values() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let token = register_test_user(&state);
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
                    .header("authorization", format!("Bearer {}", token))
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
        let ws = cfg
            .workspaces
            .iter()
            .find(|entry| entry.id == "ws-1")
            .unwrap();
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
        let token = register_test_user(&state);
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
                    .header("authorization", format!("Bearer {}", token))
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
        let board = cfg
            .boards
            .iter()
            .find(|entry| entry.file.ends_with("board.md"))
            .unwrap();
        assert_eq!(board.xbel_name.as_deref(), Some("bookmarks.xbel"));
        assert_eq!(board.bookmark_sync, Some(true));
        assert_eq!(board.calendar_sync, Some(false));
        assert_eq!(board.calendar_slug.as_deref(), Some("project"));
        assert_eq!(board.calendar_name.as_deref(), Some("Project Calendar"));
    }

    #[test]
    fn shared_theme_source_drives_valid_theme_ids() {
        let ids = valid_theme_ids();
        assert!(ids.contains(&"lexera"));
    }
}
