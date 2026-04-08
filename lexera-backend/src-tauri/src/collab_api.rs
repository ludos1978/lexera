use crate::auth::{RoomMember as AuthRoomMember, RoomRole};
use crate::invite::{CreateInviteRequest, InviteLink, RoomJoin};
use crate::public::{MakePublicRequest, PublicRoom};
use crate::state::AppState;
/// Collaboration API: invitations, public rooms, user management.
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    routing::{delete, get, post},
    Json, Router,
};
use lexera_core::storage::local::LocalStorage;
use lexera_core::storage::BoardStorage;
use lexera_core::watcher::types::BoardChangeEvent;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};

/// Minimum allowed port number for server configuration (ports below this are privileged).
const MIN_CONFIGURABLE_PORT: u16 = 1024;

/// Maximum length for user names and IDs (bytes).
const MAX_USER_NAME_LEN: usize = 200;
const MAX_USER_ID_LEN: usize = 200;

/// Validate a user name: must not be empty after trimming, must not exceed
/// MAX_USER_NAME_LEN, and must not contain HTML tags (XSS prevention).
fn validate_user_name(name: &str) -> Result<String> {
    let trimmed = name.trim().to_string();
    if trimmed.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request("Name cannot be empty")),
        ));
    }
    if trimmed.len() > MAX_USER_NAME_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(&format!(
                "Name exceeds maximum length of {} characters",
                MAX_USER_NAME_LEN
            ))),
        ));
    }
    if trimmed.contains('<') || trimmed.contains('>') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(
                "Name must not contain < or > characters",
            )),
        ));
    }
    Ok(trimmed)
}

/// Validate a user ID: must not be empty, must not exceed MAX_USER_ID_LEN,
/// and must not contain path-traversal or HTML characters.
fn validate_user_id(id: &str) -> Result<String> {
    let trimmed = id.trim().to_string();
    if trimmed.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request("User ID cannot be empty")),
        ));
    }
    if trimmed.len() > MAX_USER_ID_LEN {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(&format!(
                "User ID exceeds maximum length of {} characters",
                MAX_USER_ID_LEN
            ))),
        ));
    }
    if trimmed.contains('<') || trimmed.contains('>') || trimmed.contains("..") {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(
                "User ID contains invalid characters",
            )),
        ));
    }
    Ok(trimmed)
}

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Deserialize)]
struct CreateInviteBody {
    role: String,
    #[serde(default)]
    expires_in_hours: Option<u32>,
    #[serde(default)]
    max_uses: Option<u32>,
}

#[derive(Serialize)]
struct SuccessResponse {
    success: bool,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

impl ErrorResponse {
    fn new(msg: &str) -> Self {
        Self {
            error: msg.to_string(),
        }
    }

    fn not_found() -> Self {
        Self::new("Not found")
    }

    fn unauthorized() -> Self {
        Self::new("Unauthorized")
    }

    fn forbidden() -> Self {
        Self::new("Forbidden")
    }

    fn bad_request(msg: &str) -> Self {
        Self::new(&format!("Bad request: {}", msg))
    }
}

type Result<T> = std::result::Result<T, (StatusCode, Json<ErrorResponse>)>;

fn internal_error(msg: impl Into<String>) -> (StatusCode, Json<ErrorResponse>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(ErrorResponse::new(&msg.into())),
    )
}

fn lock_arc<'a, T>(service: &'a Arc<Mutex<T>>, name: &str) -> Result<MutexGuard<'a, T>> {
    service
        .lock()
        .map_err(|e| internal_error(format!("{} service unavailable: {}", name, e)))
}

/// Extract a bearer token from the Authorization header ("Bearer <token>").
fn extract_bearer_token(headers: &HeaderMap) -> Option<String> {
    crate::api::auth_middleware::extract_bearer_from_headers(headers)
}

/// Authenticate a request via bearer token.
/// Validates the `Authorization: Bearer <token>` header against the AuthService.
fn require_authenticated_user(headers: &HeaderMap, state: &AppState) -> Result<String> {
    if let Some(token) = extract_bearer_token(headers) {
        let auth = lock_arc(&state.auth_service, "auth")?;
        if let Some(user_id) = auth.validate_token(&token) {
            return Ok(user_id.to_string());
        }
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::new("Invalid token")),
        ));
    }

    Err((
        StatusCode::UNAUTHORIZED,
        Json(ErrorResponse::unauthorized()),
    ))
}

fn require_room_member(
    auth_service: &crate::auth::AuthService,
    room_id: &str,
    user_id: &str,
) -> Result<()> {
    if !auth_service.is_member(room_id, user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    Ok(())
}

fn require_invite_permission(
    auth_service: &crate::auth::AuthService,
    room_id: &str,
    user_id: &str,
) -> Result<()> {
    require_room_member(auth_service, room_id, user_id)?;
    if !auth_service.can_invite(room_id, user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    Ok(())
}

fn require_invite_permission_in_state(
    state: &AppState,
    room_id: &str,
    user_id: &str,
) -> Result<()> {
    let auth_service = lock_arc(&state.auth_service, "auth")?;
    require_invite_permission(&auth_service, room_id, user_id)
}

fn workspace_board_ids(state: &AppState, workspace_id: &str) -> Result<Vec<String>> {
    let cfg = lock_arc(&state.config, "config")?;
    Ok(cfg
        .boards
        .iter()
        .filter(|board| board.workspace_ids.iter().any(|id| id == workspace_id))
        .map(|board| {
            let path =
                std::fs::canonicalize(&board.file).unwrap_or_else(|_| PathBuf::from(&board.file));
            LocalStorage::board_id_from_path(&path)
        })
        .collect())
}

/// Check that the user is an owner of at least one board in the workspace.
/// Workspace invites grant access to all boards, so only board owners may create them.
fn require_workspace_invite_permission(
    state: &AppState,
    workspace_id: &str,
    user_id: &str,
) -> Result<()> {
    let board_ids = workspace_board_ids(state, workspace_id)?;

    let auth = lock_arc(&state.auth_service, "auth")?;
    let is_owner = board_ids
        .iter()
        .any(|board_id| auth.can_invite(board_id, user_id));

    if !is_owner {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    Ok(())
}

fn require_invite_permission_and_member_count(
    state: &AppState,
    room_id: &str,
    user_id: &str,
) -> Result<usize> {
    let auth_service = lock_arc(&state.auth_service, "auth")?;
    require_invite_permission(&auth_service, room_id, user_id)?;
    Ok(auth_service.list_room_members(room_id).len())
}

fn parse_role_or_bad_request(role: &str) -> Result<RoomRole> {
    RoomRole::from_str(role).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request("Invalid role")),
        )
    })
}

/// Save auth service state to disk. Logs errors but does not fail the request.
fn save_auth(state: &AppState) {
    if let Ok(auth) = state.auth_service.lock() {
        if let Err(e) = auth.save_to_file(&state.collab_dir.join("auth.json")) {
            log::error!("[collab.save] Failed to save auth state: {}", e);
        }
    }
}

/// Save invite service state to disk. Logs errors but does not fail the request.
fn save_invites(state: &AppState) {
    if let Ok(invite) = state.invite_service.lock() {
        if let Err(e) = invite.save_to_file(&state.collab_dir.join("invites.json")) {
            log::error!("[collab.save] Failed to save invite state: {}", e);
        }
    }
}

/// Save public room service state to disk. Logs errors but does not fail the request.
fn save_public_rooms(state: &AppState) {
    if let Ok(public) = state.public_service.lock() {
        if let Err(e) = public.save_to_file(&state.collab_dir.join("public_rooms.json")) {
            log::error!("[collab.save] Failed to save public rooms state: {}", e);
        }
    }
}

fn remote_board_id_from_local(local_board_id: &str) -> String {
    local_board_id
        .strip_prefix("remote-")
        .unwrap_or(local_board_id)
        .to_string()
}

fn persist_remote_connection(
    state: &AppState,
    server_url: &str,
    local_board_id: &str,
    invite_token: Option<String>,
    auth_token: Option<String>,
) -> std::result::Result<(), String> {
    let mut cfg = state
        .config
        .lock()
        .map_err(|e| format!("config lock poisoned: {}", e))?;
    let remote_board_id = remote_board_id_from_local(local_board_id);
    cfg.remote_connections
        .retain(|entry| entry.local_board_id != local_board_id);
    cfg.remote_connections
        .push(crate::config::RemoteConnectionEntry {
            local_board_id: local_board_id.to_string(),
            remote_board_id,
            server_url: server_url.trim_end_matches('/').to_string(),
            invite_token,
            enabled: true,
            auth_token,
        });
    crate::config::save_config(&state.config_path, &cfg)
        .map_err(|e| format!("failed to save config: {}", e))
}

fn remove_persisted_remote_connection(
    state: &AppState,
    local_board_id: &str,
) -> std::result::Result<bool, String> {
    let mut cfg = state
        .config
        .lock()
        .map_err(|e| format!("config lock poisoned: {}", e))?;
    let before = cfg.remote_connections.len();
    cfg.remote_connections
        .retain(|entry| entry.local_board_id != local_board_id);
    let changed = cfg.remote_connections.len() != before;
    if changed {
        crate::config::save_config(&state.config_path, &cfg)
            .map_err(|e| format!("failed to save config: {}", e))?;
    }
    Ok(changed)
}

// ============================================================================
// Invite Endpoints
// ============================================================================

/// POST /collab/rooms/{room_id}/invites - Create an invite link
async fn create_invite(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CreateInviteBody>,
) -> Result<Json<InviteLink>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    // Get room title
    let room_title = state.storage.read_board(&room_id).map(|b| b.title.clone());

    // Create invite
    let invite = {
        let mut invite_service = lock_arc(&state.invite_service, "invite")?;
        invite_service
            .create_invite(
                CreateInviteRequest {
                    room_id: room_id.clone(),
                    inviter_id: user_id.clone(),
                    role: body.role.clone(),
                    expires_in_hours: body.expires_in_hours,
                    max_uses: body.max_uses,
                    scope: "board".to_string(),
                },
                room_title,
            )
            .map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::bad_request(&e.to_string())),
                )
            })?
    };

    save_invites(&state);
    Ok(Json(invite))
}

/// GET /collab/rooms/{room_id}/invites - List invites for a room
async fn list_invites(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<InviteLink>>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    let invites = lock_arc(&state.invite_service, "invite")?.list_invites(&room_id);

    Ok(Json(invites))
}

/// POST /collab/invites/{token}/accept - Accept an invite
///
/// Returns the room join info plus an `auth_token` for the accepting user.
/// Remote clients should store this token and include it as
/// `Authorization: Bearer <token>` in all subsequent requests.
async fn accept_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    let join = {
        let mut invite_service = lock_arc(&state.invite_service, "invite")?;
        invite_service.accept_invite(&token).map_err(|e| match e {
            crate::invite::InviteError::NotFound => {
                (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found()))
            }
            crate::invite::InviteError::Expired => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request("Invite has expired")),
            ),
            crate::invite::InviteError::MaxUsesReached => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request(
                    "Invite has reached maximum uses",
                )),
            ),
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(&e.to_string())),
            ),
        })?
    };

    // Add user to room(s)
    let role = parse_role_or_bad_request(&join.role)?;

    if join.scope == "workspace" {
        // Workspace invite: add user to all boards in this workspace
        let board_ids = workspace_board_ids(&state, &join.room_id)?;

        let mut auth_service = lock_arc(&state.auth_service, "auth")?;
        for board_id in &board_ids {
            let _ = auth_service.add_to_room(board_id, &user_id, role, "workspace-invite");
        }
        log::info!(
            "[collab.accept] Workspace invite for {} — added user {} to {} boards",
            join.room_id,
            user_id,
            board_ids.len()
        );
    } else {
        // Board invite: add user to the single board
        let mut auth_service = lock_arc(&state.auth_service, "auth")?;
        auth_service
            .add_to_room(&join.room_id, &user_id, role, "invite")
            .map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse::new(&e.to_string())),
                )
            })?;
    }

    // Get or generate an auth token for the accepting user so remote clients
    // can authenticate subsequent requests without query-param fallback.
    let auth_token = {
        let mut auth_service = lock_arc(&state.auth_service, "auth")?;
        match auth_service.get_token_for_user(&user_id) {
            Some(existing) => existing.to_string(),
            None => auth_service
                .generate_token_for_user(&user_id)
                .unwrap_or_default(),
        }
    };

    save_invites(&state);
    save_auth(&state);

    Ok(Json(serde_json::json!({
        "room_id": join.room_id,
        "room_title": join.room_title,
        "role": join.role,
        "scope": join.scope,
        "auth_token": auth_token,
    })))
}

/// DELETE /collab/rooms/{room_id}/invites/{token} - Revoke an invite
async fn revoke_invite(
    State(state): State<AppState>,
    Path((room_id, token)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user is owner
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    {
        lock_arc(&state.invite_service, "invite")?
            .revoke_invite(&token, &room_id)
            .map_err(|_| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;
    }

    save_invites(&state);
    Ok(Json(SuccessResponse { success: true }))
}

// ============================================================================
// Workspace Invite Endpoints
// ============================================================================

/// POST /collab/workspaces/{workspace_id}/invites - Create a workspace invite
async fn create_workspace_invite(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<CreateInviteBody>,
) -> Result<Json<InviteLink>> {
    let _user_id = require_authenticated_user(&headers, &state)?;

    // Verify user owns at least one board in the workspace
    require_workspace_invite_permission(&state, &workspace_id, &_user_id)?;

    // Verify workspace exists
    let workspace_name = {
        let cfg = lock_arc(&state.config, "config")?;
        cfg.workspaces
            .iter()
            .find(|w| w.id == workspace_id)
            .map(|w| w.name.clone())
            .ok_or_else(|| {
                (
                    StatusCode::NOT_FOUND,
                    Json(ErrorResponse::new("Workspace not found")),
                )
            })?
    };

    let invite = {
        let mut invite_service = lock_arc(&state.invite_service, "invite")?;
        invite_service
            .create_invite(
                CreateInviteRequest {
                    room_id: workspace_id.clone(),
                    inviter_id: _user_id.clone(),
                    role: body.role.clone(),
                    expires_in_hours: body.expires_in_hours,
                    max_uses: body.max_uses,
                    scope: "workspace".to_string(),
                },
                Some(workspace_name),
            )
            .map_err(|e| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::bad_request(&e.to_string())),
                )
            })?
    };

    save_invites(&state);
    Ok(Json(invite))
}

/// GET /collab/workspaces/{workspace_id}/invites - List workspace invites
async fn list_workspace_invites(
    State(state): State<AppState>,
    Path(workspace_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<InviteLink>>> {
    let _user_id = require_authenticated_user(&headers, &state)?;

    // Verify user owns at least one board in the workspace
    require_workspace_invite_permission(&state, &workspace_id, &_user_id)?;

    // Verify workspace exists
    {
        let cfg = lock_arc(&state.config, "config")?;
        if !cfg.workspaces.iter().any(|w| w.id == workspace_id) {
            return Err((
                StatusCode::NOT_FOUND,
                Json(ErrorResponse::new("Workspace not found")),
            ));
        }
    }

    let invites = lock_arc(&state.invite_service, "invite")?.list_invites(&workspace_id);
    Ok(Json(invites))
}

/// DELETE /collab/workspaces/{workspace_id}/invites/{token} - Revoke a workspace invite
async fn revoke_workspace_invite(
    State(state): State<AppState>,
    Path((workspace_id, token)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Json<SuccessResponse>> {
    let _user_id = require_authenticated_user(&headers, &state)?;

    // Verify user owns at least one board in the workspace
    require_workspace_invite_permission(&state, &workspace_id, &_user_id)?;

    {
        lock_arc(&state.invite_service, "invite")?
            .revoke_invite(&token, &workspace_id)
            .map_err(|_| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;
    }

    save_invites(&state);
    Ok(Json(SuccessResponse { success: true }))
}

/// GET /collab/rooms/{room_id}/presence - Get online users for a room
async fn get_presence(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<String>>> {
    let user_id = require_authenticated_user(&headers, &state)?;
    {
        let auth = lock_arc(&state.auth_service, "auth")?;
        require_room_member(&auth, &room_id, &user_id)?;
    }

    let hub = state.sync_hub.lock().await;
    let users = hub.online_users(&room_id);
    Ok(Json(users))
}

// ============================================================================
// Public Room Endpoints
// ============================================================================

#[derive(Deserialize)]
struct MakePublicBody {
    default_role: String,
    #[serde(default)]
    max_users: Option<i64>,
}

/// GET /collab/public-rooms - List all public rooms
async fn list_public_rooms(State(state): State<AppState>) -> Result<Json<Vec<PublicRoom>>> {
    let public = lock_arc(&state.public_service, "public")?;

    Ok(Json(public.list_public_rooms(|room_id| {
        state.storage.read_board(room_id).map(|b| b.title.clone())
    })))
}

/// POST /collab/rooms/{room_id}/make-public - Make a room public
async fn make_public(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    Json(body): Json<MakePublicBody>,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user can invite (owner only)
    let member_count = require_invite_permission_and_member_count(&state, &room_id, &user_id)?;

    let req = MakePublicRequest {
        room_id: room_id.clone(),
        default_role: body.default_role.clone(),
        max_users: body.max_users,
    };
    {
        let mut public = lock_arc(&state.public_service, "public")?;
        public.make_public(&req, member_count).map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request(&e.to_string())),
            )
        })?;
    }

    save_public_rooms(&state);
    Ok(Json(SuccessResponse { success: true }))
}

/// DELETE /collab/rooms/{room_id}/make-public - Make a room private
async fn make_private(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    {
        lock_arc(&state.public_service, "public")?.make_private(&room_id);
    }

    save_public_rooms(&state);
    Ok(Json(SuccessResponse { success: true }))
}

/// POST /collab/rooms/{room_id}/join-public - Join a public room
async fn join_public(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<RoomJoin>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Get board title (storage has its own internal RwLock, safe to call outside our mutexes)
    let room_title = state
        .storage
        .read_board(&room_id)
        .map(|b| b.title.clone())
        .unwrap_or_else(|| "Untitled".to_string());

    // Lock auth before public (consistent ordering with make_public/make_private/leave_room)
    // Hold both locks to make the max_users check + add atomic
    let mut auth = lock_arc(&state.auth_service, "auth")?;
    let mut public = lock_arc(&state.public_service, "public")?;

    if !public.is_public(&room_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }

    let settings = public
        .get_room_settings(&room_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;

    // Check max users atomically with add
    if let Some(max_users) = settings.max_users {
        let member_count = auth.list_room_members(&room_id).len() as i64;
        if member_count >= max_users {
            return Err((
                StatusCode::FORBIDDEN,
                Json(ErrorResponse::bad_request("Room is full")),
            ));
        }
    }

    let role = parse_role_or_bad_request(&settings.default_role)?;

    auth.add_to_room(&room_id, &user_id, role, "public")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(&e.to_string())),
            )
        })?;

    public.update_member_count(&room_id, 1);

    Ok(Json(RoomJoin {
        room_id,
        room_title,
        role: role.as_str().to_string(),
        scope: "board".to_string(),
    }))
}

/// POST /collab/rooms/{room_id}/leave - Leave a room
async fn leave_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    let mut auth = lock_arc(&state.auth_service, "auth")?;
    auth.remove_from_room(&room_id, &user_id);
    drop(auth);

    // Update member count if public
    let mut public = lock_arc(&state.public_service, "public")?;
    if public.is_public(&room_id) {
        public.update_member_count(&room_id, -1);
    }

    Ok(Json(SuccessResponse { success: true }))
}

/// GET /collab/rooms/{room_id}/members - List room members
async fn list_room_members(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<Vec<AuthRoomMember>>> {
    let user_id = require_authenticated_user(&headers, &state)?;

    // Verify user is member
    let auth = lock_arc(&state.auth_service, "auth")?;
    require_room_member(&auth, &room_id, &user_id)?;

    let members = auth.list_room_members(&room_id);
    Ok(Json(members))
}

// ============================================================================
// User Endpoints
// ============================================================================

#[derive(Deserialize)]
struct RegisterUserBody {
    id: String,
    name: String,
    #[serde(default)]
    email: Option<String>,
}

/// POST /collab/users/register - Register a new user. Returns a bearer token.
async fn register_user(
    State(state): State<AppState>,
    Json(body): Json<RegisterUserBody>,
) -> Result<Json<serde_json::Value>> {
    let id = validate_user_id(&body.id)?;
    let name = validate_user_name(&body.name)?;

    let mut auth = lock_arc(&state.auth_service, "auth")?;
    let token = auth
        .register_user(crate::auth::User {
            id,
            name,
            email: body.email,
        })
        .map_err(|e| match e {
            crate::auth::AuthError::UserAlreadyExists => (
                StatusCode::CONFLICT,
                Json(ErrorResponse::new("User ID already exists")),
            ),
            crate::auth::AuthError::UserNotFound => {
                (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found()))
            }
        })?;

    drop(auth);
    save_auth(&state);

    Ok(Json(serde_json::json!({
        "success": true,
        "token": token,
    })))
}

/// GET /collab/users/{user_id} - Get user info (requires authentication)
async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    headers: HeaderMap,
) -> Result<Json<crate::auth::User>> {
    // Require authentication — caller must identify themselves
    let requester = require_authenticated_user(&headers, &state)?;

    let auth = lock_arc(&state.auth_service, "auth")?;

    // Verify requester is a registered user
    if auth.get_user(&requester).is_none() {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::unauthorized()),
        ));
    }

    let user = auth
        .get_user(&user_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;

    Ok(Json(user.clone()))
}

/// GET /collab/me - Get the local user identity (includes auth token for frontend)
async fn get_me(State(state): State<AppState>) -> Result<Json<serde_json::Value>> {
    let auth = lock_arc(&state.auth_service, "auth")?;
    let user = auth.get_user(&state.local_user_id).ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("Local user not found")),
        )
    })?;
    let token = auth
        .get_token_for_user(&state.local_user_id)
        .map(|t| t.to_string());
    Ok(Json(serde_json::json!({
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "token": token,
    })))
}

#[derive(Deserialize)]
struct UpdateMeBody {
    name: String,
}

/// PUT /collab/me - Update the local user's display name
async fn update_me(
    State(state): State<AppState>,
    Json(body): Json<UpdateMeBody>,
) -> Result<Json<crate::auth::User>> {
    let name = validate_user_name(&body.name)?;

    let updated_user = {
        let mut auth = lock_arc(&state.auth_service, "auth")?;
        let user = auth.get_user(&state.local_user_id).ok_or_else(|| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new("Local user not found")),
            )
        })?;
        let updated = crate::auth::User {
            id: user.id.clone(),
            name: name.clone(),
            email: user.email.clone(),
        };
        auth.update_user(updated.clone());
        updated
    };

    // Persist to identity.json
    crate::config::persist_identity(&state.identity_path, &updated_user);

    let _ = state.event_tx.send(BoardChangeEvent::ConfigChanged);
    Ok(Json(updated_user))
}

/// GET /collab/server-info - Get server connection info for sharing
async fn server_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let user_name = lock_arc(&state.auth_service, "auth")
        .ok()
        .and_then(|auth| auth.get_user(&state.local_user_id).map(|u| u.name.clone()))
        .unwrap_or_else(|| "Unknown".to_string());

    let cfg = lock_arc(&state.config, "config").ok();
    let configured_bind = cfg
        .as_ref()
        .map(|c| c.bind_address.clone())
        .unwrap_or_else(|| state.bind_address.clone());
    let configured_port = cfg.as_ref().map(|c| c.port).unwrap_or(state.port);
    let actual_port = state
        .live_port
        .lock()
        .map(|p| *p)
        .unwrap_or(configured_port);

    // Determine the address to share: if bound to 0.0.0.0, try to detect a LAN IP
    let address = if configured_bind == "0.0.0.0" {
        local_ip().unwrap_or_else(|| configured_bind.clone())
    } else {
        configured_bind.clone()
    };

    Json(serde_json::json!({
        "address": address,
        "bind_address": configured_bind,
        "port": actual_port,
        "user_id": state.local_user_id,
        "user_name": user_name,
    }))
}

/// Best-effort detection of a LAN IPv4 address.
fn local_ip() -> Option<String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("8.8.8.8:80").ok()?;
    let addr = socket.local_addr().ok()?;
    Some(addr.ip().to_string())
}

// ============================================================================
// Sync Client Endpoints (backend-to-backend connections)
// ============================================================================

#[derive(Deserialize)]
struct ConnectBody {
    server_url: String,
    token: String,
}

/// POST /collab/connect — connect to a remote backend using an invite token
async fn connect_remote(
    State(state): State<AppState>,
    Json(body): Json<ConnectBody>,
) -> Result<Json<serde_json::Value>> {
    let user_name = lock_arc(&state.auth_service, "auth")
        .ok()
        .and_then(|auth| auth.get_user(&state.local_user_id).map(|u| u.name.clone()))
        .unwrap_or_else(|| "Unknown".to_string());

    let pending = crate::sync_client::SyncClientManager::prepare_invite_connection(
        body.server_url.clone(),
        body.token.clone(),
        state.local_user_id.clone(),
        user_name,
        state.storage.clone(),
    )
    .await
    .map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(&e)),
        )
    })?;

    let local_board_id = pending.local_board_id.clone();
    let auth_token = pending.auth_token.clone();
    {
        let mut client = state.sync_client.lock().await;
        if client.is_connected(&local_board_id) {
            return Ok(Json(serde_json::json!({
                "success": true,
                "local_board_id": local_board_id,
                "persisted": false
            })));
        }
        client.register_prepared_connection(
            pending,
            state.storage.clone(),
            state.event_tx.clone(),
            state.sync_hub.clone(),
        );
    }
    let persisted = match persist_remote_connection(
        &state,
        &body.server_url,
        &local_board_id,
        Some(body.token.clone()),
        auth_token,
    ) {
        Ok(()) => {
            log::info!(
                "[collab.connect] Persisted remote connection local_board_id={} server={}",
                local_board_id,
                body.server_url
            );
            true
        }
        Err(error) => {
            log::error!(
                "[collab.connect] Failed to persist remote connection local_board_id={} server={}: {}",
                local_board_id,
                body.server_url,
                error
            );
            false
        }
    };

    let _ = state
        .event_tx
        .send(BoardChangeEvent::CollabConnectionChanged);

    Ok(Json(serde_json::json!({
        "success": true,
        "local_board_id": local_board_id,
        "persisted": persisted
    })))
}

/// DELETE /collab/connect/{local_board_id} — disconnect from a remote board
async fn disconnect_remote(
    State(state): State<AppState>,
    Path(local_board_id): Path<String>,
) -> Result<Json<SuccessResponse>> {
    let mut client = state.sync_client.lock().await;
    client.disconnect(&local_board_id, &state.storage);
    match remove_persisted_remote_connection(&state, &local_board_id) {
        Ok(true) => {
            log::info!(
                "[collab.disconnect] Removed persisted remote connection local_board_id={}",
                local_board_id
            );
        }
        Ok(false) => {}
        Err(error) => {
            log::error!(
                "[collab.disconnect] Failed to remove persisted remote connection local_board_id={}: {}",
                local_board_id,
                error
            );
        }
    }
    let _ = state
        .event_tx
        .send(BoardChangeEvent::CollabConnectionChanged);
    Ok(Json(SuccessResponse { success: true }))
}

/// GET /collab/connections — list active remote connections
async fn list_connections(
    State(state): State<AppState>,
) -> Json<Vec<crate::sync_client::RemoteConnectionInfo>> {
    let client = state.sync_client.lock().await;
    Json(client.list_connections())
}

// ============================================================================
// Network Interfaces + Server Config
// ============================================================================

fn classify_interface(name: &str, is_loopback: bool) -> &'static str {
    if is_loopback {
        return "Loopback";
    }
    let lower = name.to_lowercase();
    // macOS: en0 is typically Wi-Fi; Linux: wlan*, wlp* are wireless
    if lower == "en0" || lower.starts_with("wlan") || lower.starts_with("wlp") {
        "WLAN"
    } else if lower.starts_with("en") || lower.starts_with("eth") || lower.starts_with("enp") {
        "LAN"
    } else {
        "Other"
    }
}

fn push_interface_entry(
    interfaces: &mut Vec<serde_json::Value>,
    seen: &mut std::collections::HashSet<String>,
    address: &str,
    name: &str,
    label: &str,
) {
    let normalized = address.trim();
    if normalized.is_empty() || !seen.insert(normalized.to_string()) {
        return;
    }
    interfaces.push(serde_json::json!({
        "address": normalized,
        "name": name,
        "label": label,
    }));
}

/// GET /collab/network-interfaces — list available network interfaces for bind address selection
async fn list_network_interfaces(State(state): State<AppState>) -> Json<serde_json::Value> {
    let cfg = lock_arc(&state.config, "config").ok();
    let current_bind = cfg
        .as_ref()
        .map(|c| c.bind_address.clone())
        .unwrap_or_else(|| state.bind_address.clone());
    let configured_port = cfg.as_ref().map(|c| c.port).unwrap_or(state.port);
    let actual_port = state.live_port.lock().map(|p| *p).unwrap_or(state.port);

    let mut interfaces = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Always offer reliable fallback choices even if interface enumeration fails.
    push_interface_entry(
        &mut interfaces,
        &mut seen,
        "0.0.0.0",
        "all",
        "All interfaces",
    );
    push_interface_entry(
        &mut interfaces,
        &mut seen,
        "127.0.0.1",
        "loopback",
        "Localhost",
    );
    if current_bind != "0.0.0.0" && current_bind != "127.0.0.1" {
        push_interface_entry(
            &mut interfaces,
            &mut seen,
            &current_bind,
            "current",
            "Current bind address",
        );
    }
    if let Some(lan_ip) = local_ip() {
        push_interface_entry(
            &mut interfaces,
            &mut seen,
            &lan_ip,
            "detected",
            "Detected LAN address",
        );
    }

    match if_addrs::get_if_addrs() {
        Ok(addrs) => {
            for iface in &addrs {
                if let std::net::IpAddr::V4(ipv4) = iface.addr.ip() {
                    let label = classify_interface(&iface.name, iface.addr.is_loopback());
                    push_interface_entry(
                        &mut interfaces,
                        &mut seen,
                        &ipv4.to_string(),
                        &iface.name,
                        &format!("{} ({})", label, iface.name),
                    );
                }
            }
        }
        Err(err) => {
            log::warn!(
                target: "lexera.collab.network_interfaces",
                "Failed to enumerate network interfaces: {}",
                err
            );
        }
    }

    Json(serde_json::json!({
        "interfaces": interfaces,
        "current_bind_address": current_bind,
        "current_port": actual_port,
        "configured_port": configured_port,
        "default_port": crate::config::DEFAULT_PORT,
    }))
}

#[derive(Deserialize)]
struct UpdateServerConfigBody {
    bind_address: String,
    port: u16,
}

/// PUT /collab/server-config — update bind address and port, live-restart the HTTP server.
async fn update_server_config(
    State(state): State<AppState>,
    Json(body): Json<UpdateServerConfigBody>,
) -> Result<Json<serde_json::Value>> {
    // Validate bind_address
    if body.bind_address != "0.0.0.0" {
        body.bind_address
            .parse::<std::net::Ipv4Addr>()
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse::bad_request("Invalid IP address")),
                )
            })?;
    }

    // Validate port
    if body.port < MIN_CONFIGURABLE_PORT {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(&format!(
                "Port must be >= {}",
                MIN_CONFIGURABLE_PORT
            ))),
        ));
    }

    // All mutex work in a block that drops guards before any await
    let (new_bind, new_port, user_id, user_name) = {
        let mut cfg = lock_arc(&state.config, "config")?;
        cfg.bind_address = body.bind_address.clone();
        cfg.port = body.port;
        crate::config::save_config(&state.config_path, &cfg)
            .map_err(|e| internal_error(format!("Failed to save config: {}", e)))?;
        drop(cfg);

        let uid = state.local_user_id.clone();
        let uname = state
            .auth_service
            .lock()
            .ok()
            .and_then(|auth| auth.get_user(&state.local_user_id).map(|u| u.name.clone()))
            .unwrap_or_else(|| "Unknown".to_string());

        (body.bind_address.clone(), body.port, uid, uname)
    };
    // All MutexGuards dropped here ^^^

    // restart_server is async but does not hold any MutexGuard across its awaits
    match crate::server::restart_server(state.clone(), new_bind.clone(), new_port).await {
        Ok(actual_port) => {
            // Update tray to reflect new port
            if let Some(ref handle) = state.app_handle {
                if let Err(e) = crate::tray::setup_tray(handle, actual_port) {
                    log::error!(
                        target: "lexera.tray",
                        "Failed to update tray icon after restart on port {}: {}",
                        actual_port,
                        e
                    );
                }
            }

            // Restart discovery if needed
            if let Ok(mut disc) = state.discovery.lock() {
                disc.stop();
                if new_bind != crate::config::DEFAULT_BIND_ADDRESS {
                    disc.start(actual_port, user_id, user_name, state.event_tx.clone());
                    log::info!("[discovery] Restarted on port {}", actual_port);
                }
            }

            let _ = state.event_tx.send(BoardChangeEvent::ConfigChanged);
            Ok(Json(serde_json::json!({
                "success": true,
                "port": actual_port,
                "bind_address": new_bind,
                "restarted": true,
            })))
        }
        Err(e) => {
            log::error!("[server] Live restart failed: {}", e);
            Err(internal_error(format!("Server restart failed: {}", e)))
        }
    }
}

// ============================================================================
// LAN Discovery
// ============================================================================

/// GET /collab/discovered-peers — list peers found via UDP broadcast
async fn discovered_peers(State(state): State<AppState>) -> Json<Vec<serde_json::Value>> {
    let peers = lock_arc(&state.discovery, "discovery")
        .map(|d| d.list_peers())
        .unwrap_or_default();

    let result: Vec<serde_json::Value> = peers
        .into_iter()
        .map(|p| {
            serde_json::json!({
                "address": p.address,
                "port": p.port,
                "user_id": p.user_id,
                "user_name": p.user_name,
                "url": format!("http://{}:{}", p.address, p.port),
            })
        })
        .collect();

    Json(result)
}

// ============================================================================
// Router
// ============================================================================

/// Rate limit for auth-sensitive collab endpoints (requests per second).
const COLLAB_AUTH_RATE_LIMIT: usize = 5;

pub fn collab_router() -> Router<AppState> {
    use crate::api::rate_limit::{rate_limit_middleware, RateLimiter};

    // Rate-limited routes: registration, invite accept, remote connect
    let rate_limited_routes = Router::new()
        .route("/collab/users/register", post(register_user))
        .route("/collab/invites/{token}/accept", post(accept_invite))
        .route("/collab/connect", post(connect_remote))
        .route("/collab/rooms/{room_id}/join-public", post(join_public))
        .route_layer(axum::middleware::from_fn_with_state(
            RateLimiter::new(COLLAB_AUTH_RATE_LIMIT),
            rate_limit_middleware,
        ));

    Router::new()
        .merge(rate_limited_routes)
        // Invites
        .route(
            "/collab/rooms/{room_id}/invites",
            get(list_invites).post(create_invite),
        )
        .route(
            "/collab/rooms/{room_id}/invites/{token}",
            delete(revoke_invite),
        )
        // Workspace invites
        .route(
            "/collab/workspaces/{workspace_id}/invites",
            get(list_workspace_invites).post(create_workspace_invite),
        )
        .route(
            "/collab/workspaces/{workspace_id}/invites/{token}",
            delete(revoke_workspace_invite),
        )
        // Public rooms
        .route("/collab/public-rooms", get(list_public_rooms))
        .route(
            "/collab/rooms/{room_id}/make-public",
            post(make_public).delete(make_private),
        )
        .route("/collab/rooms/{room_id}/leave", post(leave_room))
        .route("/collab/rooms/{room_id}/members", get(list_room_members))
        .route("/collab/rooms/{room_id}/presence", get(get_presence))
        // Users
        .route("/collab/me", get(get_me).put(update_me))
        .route("/collab/users/{user_id}", get(get_user))
        // Server info + config
        .route("/collab/server-info", get(server_info))
        .route("/collab/network-interfaces", get(list_network_interfaces))
        .route(
            "/collab/server-config",
            axum::routing::put(update_server_config),
        )
        // LAN discovery
        .route("/collab/discovered-peers", get(discovered_peers))
        // Sync client (backend-to-backend connections)
        .route(
            "/collab/connect/{local_board_id}",
            delete(disconnect_remote),
        )
        .route("/collab/connections", get(list_connections))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use axum::Router;
    use lexera_core::config::{BoardEntry, WorkspaceEntry};
    use tower::ServiceExt;

    use crate::state::AppState;
    use crate::test_helpers::{body_json, test_state};

    fn test_router(state: AppState) -> Router {
        super::collab_router().with_state(state)
    }

    /// Register "test-user" as room owner, return their bearer token.
    fn seed_owner(state: &AppState, room_id: &str) -> String {
        let mut auth = state.auth_service.lock().unwrap();
        auth.register_user(crate::auth::User {
            id: "test-user".into(),
            name: "Test User".into(),
            email: None,
        })
        .unwrap();
        auth.add_to_room(room_id, "test-user", crate::auth::RoomRole::Owner, "test")
            .unwrap();
        auth.generate_token_for_user("test-user").unwrap()
    }

    /// Register a user and return their bearer token.
    fn seed_user_token(state: &AppState, id: &str, name: &str) -> String {
        let mut auth = state.auth_service.lock().unwrap();
        auth.register_user(crate::auth::User {
            id: id.into(),
            name: name.into(),
            email: None,
        })
        .unwrap();
        auth.generate_token_for_user(id).unwrap()
    }

    #[tokio::test]
    async fn register_user() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "id": "alice",
                            "name": "Alice"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["success"], true);
    }

    #[tokio::test]
    async fn register_duplicate_user_returns_conflict() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());

        {
            let mut auth = state.auth_service.lock().unwrap();
            auth.register_user(crate::auth::User {
                id: "alice".into(),
                name: "Alice".into(),
                email: None,
            })
            .unwrap();
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "id": "alice",
                            "name": "Alice Again"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CONFLICT);
    }

    #[tokio::test]
    async fn list_members_requires_auth() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn list_members_after_join() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let token = seed_owner(&state, "room1");

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let members = json.as_array().unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["user_id"], "test-user");
        assert_eq!(members[0]["role"], "owner");
    }

    #[tokio::test]
    async fn create_invite_and_accept() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("collab")).unwrap();
        let state = test_state(tmp.path());
        let owner_token = seed_owner(&state, "room1");

        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/rooms/room1/invites")
                    .header("authorization", format!("Bearer {}", owner_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "role": "editor"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let invite_json = body_json(resp.into_body()).await;
        let token = invite_json["token"].as_str().unwrap().to_string();
        assert_eq!(invite_json["room_id"], "room1");
        assert_eq!(invite_json["role"], "editor");

        let bob_token = seed_user_token(&state, "bob", "Bob");

        let app2 = test_router(state.clone());
        let resp2 = app2
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/collab/invites/{}/accept", token))
                    .header("authorization", format!("Bearer {}", bob_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp2.status(), StatusCode::OK);
        let join_json = body_json(resp2.into_body()).await;
        assert_eq!(join_json["room_id"], "room1");
        assert_eq!(join_json["role"], "editor");

        let app3 = test_router(state);
        let resp3 = app3
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .header("authorization", format!("Bearer {}", owner_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp3.status(), StatusCode::OK);
        let members = body_json(resp3.into_body()).await;
        let members = members.as_array().unwrap();
        assert_eq!(members.len(), 2);
    }

    #[tokio::test]
    async fn accept_invalid_invite_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let alice_token = seed_user_token(&state, "alice", "Alice");
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/invites/bad-token/accept")
                    .header("authorization", format!("Bearer {}", alice_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn create_invite_requires_owner() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());

        let viewer_token = {
            let mut auth = state.auth_service.lock().unwrap();
            auth.register_user(crate::auth::User {
                id: "viewer1".into(),
                name: "Viewer".into(),
                email: None,
            })
            .unwrap();
            auth.add_to_room("room1", "viewer1", crate::auth::RoomRole::Viewer, "test")
                .unwrap();
            auth.generate_token_for_user("viewer1").unwrap()
        };

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/rooms/room1/invites")
                    .header("authorization", format!("Bearer {}", viewer_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "role": "editor" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    }

    #[tokio::test]
    async fn leave_room() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let owner_token = seed_owner(&state, "room1");

        let bob_token = {
            let mut auth = state.auth_service.lock().unwrap();
            auth.register_user(crate::auth::User {
                id: "bob".into(),
                name: "Bob".into(),
                email: None,
            })
            .unwrap();
            auth.add_to_room("room1", "bob", crate::auth::RoomRole::Editor, "test")
                .unwrap();
            auth.generate_token_for_user("bob").unwrap()
        };

        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/rooms/room1/leave")
                    .header("authorization", format!("Bearer {}", bob_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);

        let app2 = test_router(state);
        let resp2 = app2
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .header("authorization", format!("Bearer {}", owner_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        let members = body_json(resp2.into_body()).await;
        let members = members.as_array().unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["user_id"], "test-user");
    }

    #[tokio::test]
    async fn network_interfaces_always_include_fallback_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let mut state = test_state(tmp.path());
        state.bind_address = "192.168.1.77".into();
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.bind_address = "192.168.1.77".into();
            cfg.port = 1431;
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/network-interfaces")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let interfaces = json["interfaces"].as_array().unwrap();
        assert!(!interfaces.is_empty());
        assert!(interfaces.iter().any(|entry| entry["address"] == "0.0.0.0"));
        assert!(interfaces
            .iter()
            .any(|entry| entry["address"] == "127.0.0.1"));
        assert!(interfaces
            .iter()
            .any(|entry| entry["address"] == "192.168.1.77"));
        assert_eq!(json["current_bind_address"], "192.168.1.77");
        assert_eq!(json["configured_port"], 1431);
    }

    #[tokio::test]
    async fn register_user_returns_token() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "id": "alice",
                            "name": "Alice"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["success"], true);
        assert!(json["token"].is_string());
        assert!(!json["token"].as_str().unwrap().is_empty());
    }

    #[tokio::test]
    async fn bearer_token_authenticates_request() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());

        // Register user and get token
        let token = {
            let mut auth = state.auth_service.lock().unwrap();
            let token = auth
                .register_user(crate::auth::User {
                    id: "alice".into(),
                    name: "Alice".into(),
                    email: None,
                })
                .unwrap();
            auth.add_to_room("room1", "alice", crate::auth::RoomRole::Owner, "test")
                .unwrap();
            token
        };

        // Use bearer token instead of query param to list members
        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let members = body_json(resp.into_body()).await;
        let members = members.as_array().unwrap();
        assert_eq!(members.len(), 1);
        assert_eq!(members[0]["user_id"], "alice");
    }

    #[tokio::test]
    async fn invalid_bearer_token_returns_unauthorized() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        seed_owner(&state, "room1");

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/rooms/room1/members")
                    .header("authorization", "Bearer invalid-token-12345")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn accept_invite_returns_auth_token() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());

        // Register the inviter and accepting user
        let _inviter_token = {
            let mut auth = state.auth_service.lock().unwrap();
            let t = auth
                .register_user(crate::auth::User {
                    id: "inviter".into(),
                    name: "Inviter".into(),
                    email: None,
                })
                .unwrap();
            auth.add_to_room("board-1", "inviter", crate::auth::RoomRole::Owner, "test")
                .unwrap();
            t
        };
        let acceptor_token = {
            let mut auth = state.auth_service.lock().unwrap();
            auth.register_user(crate::auth::User {
                id: "acceptor".into(),
                name: "Acceptor".into(),
                email: None,
            })
            .unwrap()
        };

        // Create an invite
        let invite_token = {
            let mut invite_svc = state.invite_service.lock().unwrap();
            let invite = invite_svc
                .create_invite(
                    crate::invite::CreateInviteRequest {
                        room_id: "board-1".into(),
                        inviter_id: "inviter".into(),
                        role: "editor".into(),
                        expires_in_hours: None,
                        max_uses: Some(5),
                        scope: "board".into(),
                    },
                    Some("Test Board".into()),
                )
                .unwrap();
            invite.token
        };

        // Accept the invite with bearer token auth
        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/collab/invites/{}/accept", invite_token))
                    .header("authorization", format!("Bearer {}", acceptor_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["room_id"], "board-1");
        assert_eq!(json["role"], "editor");
        assert_eq!(json["scope"], "board");
        // auth_token must be present and non-empty
        assert!(
            json["auth_token"].is_string(),
            "accept_invite must return auth_token"
        );
        let returned_token = json["auth_token"].as_str().unwrap();
        assert!(!returned_token.is_empty(), "auth_token must not be empty");
        // The returned token should be the acceptor's existing token
        assert_eq!(returned_token, acceptor_token);
    }

    #[tokio::test]
    async fn create_workspace_invite_allows_owner_of_board_in_workspace() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("workspace-board.md");
        std::fs::write(&board_path, crate::test_helpers::MINIMAL_BOARD).unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();
        let board_path = std::fs::canonicalize(&board_path).unwrap_or(board_path);

        {
            let mut cfg = state.config.lock().unwrap();
            cfg.workspaces.push(WorkspaceEntry {
                id: "ws-1".into(),
                name: "Workspace".into(),
                ..WorkspaceEntry::default()
            });
            cfg.boards.push(BoardEntry {
                file: board_path.to_string_lossy().to_string(),
                workspace_ids: vec!["ws-1".into()],
                ..BoardEntry::default()
            });
        }

        let owner_token = {
            let mut auth = state.auth_service.lock().unwrap();
            let token = auth
                .register_user(crate::auth::User {
                    id: "owner".into(),
                    name: "Owner".into(),
                    email: None,
                })
                .unwrap();
            auth.add_to_room(&board_id, "owner", crate::auth::RoomRole::Owner, "test")
                .unwrap();
            token
        };

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/workspaces/ws-1/invites")
                    .header("authorization", format!("Bearer {}", owner_token))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "role": "editor" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["scope"], "workspace");
        assert_eq!(json["room_id"], "ws-1");
    }

    #[tokio::test]
    async fn accept_workspace_invite_adds_user_to_board_ids_not_file_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let board_path = tmp.path().join("workspace-accept.md");
        std::fs::write(&board_path, crate::test_helpers::MINIMAL_BOARD).unwrap();

        let state = test_state(tmp.path());
        let board_id = state.storage.add_board(&board_path).unwrap();
        let board_path = std::fs::canonicalize(&board_path).unwrap_or(board_path);

        {
            let mut cfg = state.config.lock().unwrap();
            cfg.workspaces.push(WorkspaceEntry {
                id: "ws-accept".into(),
                name: "Workspace Accept".into(),
                ..WorkspaceEntry::default()
            });
            cfg.boards.push(BoardEntry {
                file: board_path.to_string_lossy().to_string(),
                workspace_ids: vec!["ws-accept".into()],
                ..BoardEntry::default()
            });
        }

        let invite_token = {
            let mut invite_svc = state.invite_service.lock().unwrap();
            invite_svc
                .create_invite(
                    crate::invite::CreateInviteRequest {
                        room_id: "ws-accept".into(),
                        inviter_id: "owner".into(),
                        role: "viewer".into(),
                        expires_in_hours: None,
                        max_uses: Some(3),
                        scope: "workspace".into(),
                    },
                    Some("Workspace Accept".into()),
                )
                .unwrap()
                .token
        };

        let acceptor_token = {
            let mut auth = state.auth_service.lock().unwrap();
            auth.register_user(crate::auth::User {
                id: "acceptor".into(),
                name: "Acceptor".into(),
                email: None,
            })
            .unwrap()
        };

        let app = test_router(state.clone());
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(format!("/collab/invites/{}/accept", invite_token))
                    .header("authorization", format!("Bearer {}", acceptor_token))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let auth = state.auth_service.lock().unwrap();
        assert_eq!(
            auth.get_role(&board_id, "acceptor"),
            Some(crate::auth::RoomRole::Viewer)
        );
        assert_eq!(
            auth.get_role(&board_path.to_string_lossy(), "acceptor"),
            None
        );
    }

    #[tokio::test]
    async fn server_info_uses_current_config_bind_address_and_live_port() {
        let tmp = tempfile::tempdir().unwrap();
        let mut state = test_state(tmp.path());
        state.bind_address = "0.0.0.0".into();
        {
            let mut cfg = state.config.lock().unwrap();
            cfg.bind_address = "127.0.0.1".into();
            cfg.port = 1431;
        }
        {
            let mut live = state.live_port.lock().unwrap();
            *live = 1555;
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/collab/server-info")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        assert_eq!(json["bind_address"], "127.0.0.1");
        assert_eq!(json["address"], "127.0.0.1");
        assert_eq!(json["port"], 1555);
    }

    #[tokio::test]
    async fn register_user_rejects_empty_name() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "id": "u1", "name": "   " }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn register_user_rejects_html_in_name() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "id": "u1", "name": "<script>alert(1)</script>" })
                            .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn register_user_rejects_overlong_name() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let long_name = "A".repeat(201);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "id": "u1", "name": long_name }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn register_user_rejects_path_traversal_in_id() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        let app = test_router(state);

        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/collab/users/register")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "id": "../etc/passwd", "name": "Hacker" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    }
}
