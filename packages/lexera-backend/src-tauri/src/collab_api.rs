use crate::auth::{RoomMember as AuthRoomMember, RoomRole};
use crate::invite::{CreateInviteRequest, InviteLink, RoomJoin};
use crate::public::{MakePublicRequest, PublicRoom};
use crate::state::AppState;
/// Collaboration API: invitations, public rooms, user management.
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use lexera_core::storage::BoardStorage;
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex, MutexGuard};

// ============================================================================
// Request/Response Types
// ============================================================================

#[derive(Deserialize)]
struct AuthQuery {
    user: Option<String>,
}

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

fn require_authenticated_user(params: &AuthQuery) -> Result<String> {
    params.user.clone().ok_or_else(|| {
        (
            StatusCode::UNAUTHORIZED,
            Json(ErrorResponse::unauthorized()),
        )
    })
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

// ============================================================================
// Invite Endpoints
// ============================================================================

/// POST /collab/rooms/{room_id}/invites - Create an invite link
async fn create_invite(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
    Json(body): Json<CreateInviteBody>,
) -> Result<Json<InviteLink>> {
    let user_id = require_authenticated_user(&params)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    // Get room title
    let room_title = state.storage.read_board(&room_id).map(|b| b.title.clone());

    // Create invite
    let mut invite_service = lock_arc(&state.invite_service, "invite")?;
    let invite = invite_service
        .create_invite(
            CreateInviteRequest {
                room_id: room_id.clone(),
                inviter_id: user_id.clone(),
                role: body.role.clone(),
                expires_in_hours: body.expires_in_hours,
                max_uses: body.max_uses,
                email: None,
            },
            room_title,
        )
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request(&e.to_string())),
            )
        })?;

    Ok(Json(invite))
}

/// GET /collab/rooms/{room_id}/invites - List invites for a room
async fn list_invites(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<Vec<InviteLink>>> {
    let user_id = require_authenticated_user(&params)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    let invites = lock_arc(&state.invite_service, "invite")?.list_invites(&room_id);

    Ok(Json(invites))
}

/// POST /collab/invites/{token}/accept - Accept an invite
async fn accept_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<RoomJoin>> {
    let user_id = require_authenticated_user(&params)?;

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

    // Add user to room
    let role = parse_role_or_bad_request(&join.role)?;

    let mut auth_service = lock_arc(&state.auth_service, "auth")?;
    auth_service
        .add_to_room(&join.room_id, &user_id, role, "invite")
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse::new(&e.to_string())),
            )
        })?;

    Ok(Json(join))
}

/// DELETE /collab/rooms/{room_id}/invites/{token} - Revoke an invite
async fn revoke_invite(
    State(state): State<AppState>,
    Path((room_id, token)): Path<(String, String)>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&params)?;

    // Verify user is owner
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    lock_arc(&state.invite_service, "invite")?
        .revoke_invite(&token, &room_id)
        .map_err(|_| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;

    Ok(Json(SuccessResponse { success: true }))
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
    Query(params): Query<AuthQuery>,
    Json(body): Json<MakePublicBody>,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&params)?;

    // Verify user can invite (owner only)
    let member_count = require_invite_permission_and_member_count(&state, &room_id, &user_id)?;

    let req = MakePublicRequest {
        room_id: room_id.clone(),
        default_role: body.default_role.clone(),
        max_users: body.max_users,
    };
    let mut public = lock_arc(&state.public_service, "public")?;
    public.make_public(&req, member_count).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request(&e.to_string())),
        )
    })?;

    Ok(Json(SuccessResponse { success: true }))
}

/// DELETE /collab/rooms/{room_id}/make-public - Make a room private
async fn make_private(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&params)?;

    // Verify user can invite (owner only)
    require_invite_permission_in_state(&state, &room_id, &user_id)?;

    lock_arc(&state.public_service, "public")?.make_private(&room_id);

    Ok(Json(SuccessResponse { success: true }))
}

/// POST /collab/rooms/{room_id}/join-public - Join a public room
async fn join_public(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<RoomJoin>> {
    let user_id = require_authenticated_user(&params)?;

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
    }))
}

/// POST /collab/rooms/{room_id}/leave - Leave a room
async fn leave_room(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<SuccessResponse>> {
    let user_id = require_authenticated_user(&params)?;

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
    Query(params): Query<AuthQuery>,
) -> Result<Json<Vec<AuthRoomMember>>> {
    let user_id = require_authenticated_user(&params)?;

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

/// POST /collab/users/register - Register a new user
async fn register_user(
    State(state): State<AppState>,
    Json(body): Json<RegisterUserBody>,
) -> Result<Json<SuccessResponse>> {
    let mut auth = lock_arc(&state.auth_service, "auth")?;
    auth.register_user(crate::auth::User {
        id: body.id.clone(),
        name: body.name.clone(),
        email: body.email,
    })
    .map_err(|e| match e {
        crate::auth::AuthError::UserAlreadyExists => (
            StatusCode::CONFLICT,
            Json(ErrorResponse::new("User ID already exists")),
        ),
        _ => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new(&e.to_string())),
        ),
    })?;

    Ok(Json(SuccessResponse { success: true }))
}

/// GET /collab/users/{user_id} - Get user info (requires authentication)
async fn get_user(
    State(state): State<AppState>,
    Path(user_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<crate::auth::User>> {
    // Require authentication — caller must identify themselves
    let requester = require_authenticated_user(&params)?;

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

/// GET /collab/me - Get the local user identity
async fn get_me(State(state): State<AppState>) -> Result<Json<crate::auth::User>> {
    let auth = lock_arc(&state.auth_service, "auth")?;
    let user = auth.get_user(&state.local_user_id).ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse::new("Local user not found")),
        )
    })?;
    Ok(Json(user.clone()))
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
    let name = body.name.trim().to_string();
    if name.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request("Name cannot be empty")),
        ));
    }

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

    Ok(Json(updated_user))
}

/// GET /collab/server-info - Get server connection info for sharing
async fn server_info(State(state): State<AppState>) -> Json<serde_json::Value> {
    let user_name = lock_arc(&state.auth_service, "auth")
        .ok()
        .and_then(|auth| auth.get_user(&state.local_user_id).map(|u| u.name.clone()))
        .unwrap_or_else(|| "Unknown".to_string());

    // Determine the address to share: if bound to 0.0.0.0, try to detect a LAN IP
    let address = if state.bind_address == "0.0.0.0" {
        local_ip().unwrap_or_else(|| state.bind_address.clone())
    } else {
        state.bind_address.clone()
    };

    Json(serde_json::json!({
        "address": address,
        "bind_address": state.bind_address,
        "port": state.port,
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

    let mut client = state.sync_client.lock().await;
    let local_board_id = client
        .connect(
            body.server_url.clone(),
            body.token.clone(),
            state.local_user_id.clone(),
            user_name,
            state.storage.clone(),
            state.event_tx.clone(),
        )
        .await
        .map_err(|e| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request(&e)),
            )
        })?;

    Ok(Json(
        serde_json::json!({ "success": true, "local_board_id": local_board_id }),
    ))
}

/// DELETE /collab/connect/{local_board_id} — disconnect from a remote board
async fn disconnect_remote(
    State(state): State<AppState>,
    Path(local_board_id): Path<String>,
) -> Result<Json<SuccessResponse>> {
    let mut client = state.sync_client.lock().await;
    client.disconnect(&local_board_id, &state.storage);
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

/// GET /collab/network-interfaces — list available network interfaces for bind address selection
async fn list_network_interfaces(
    State(state): State<AppState>,
) -> Json<serde_json::Value> {
    let mut interfaces = Vec::new();

    // Always offer "All interfaces"
    interfaces.push(serde_json::json!({
        "address": "0.0.0.0",
        "name": "all",
        "label": "All interfaces",
    }));

    if let Ok(addrs) = if_addrs::get_if_addrs() {
        for iface in &addrs {
            // IPv4 only
            if let std::net::IpAddr::V4(ipv4) = iface.addr.ip() {
                let label = classify_interface(&iface.name, iface.addr.is_loopback());
                interfaces.push(serde_json::json!({
                    "address": ipv4.to_string(),
                    "name": iface.name,
                    "label": format!("{} ({})", label, iface.name),
                }));
            }
        }
    }

    let cfg = lock_arc(&state.config, "config").ok();
    let current_bind = cfg.as_ref().map(|c| c.bind_address.clone()).unwrap_or_else(|| state.bind_address.clone());
    let current_port = cfg.as_ref().map(|c| c.port).unwrap_or(state.port);

    Json(serde_json::json!({
        "interfaces": interfaces,
        "current_bind_address": current_bind,
        "current_port": current_port,
        "default_port": 8080,
    }))
}

#[derive(Deserialize)]
struct UpdateServerConfigBody {
    bind_address: String,
    port: u16,
}

/// PUT /collab/server-config — update bind address and port (requires restart)
async fn update_server_config(
    State(state): State<AppState>,
    Json(body): Json<UpdateServerConfigBody>,
) -> Result<Json<serde_json::Value>> {
    // Validate bind_address
    if body.bind_address != "0.0.0.0" {
        body.bind_address.parse::<std::net::Ipv4Addr>().map_err(|_| {
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse::bad_request("Invalid IP address")),
            )
        })?;
    }

    // Validate port
    if body.port < 1024 {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse::bad_request("Port must be >= 1024")),
        ));
    }

    let mut cfg = lock_arc(&state.config, "config")?;
    cfg.bind_address = body.bind_address;
    cfg.port = body.port;
    crate::config::save_config(&state.config_path, &cfg).map_err(|e| {
        internal_error(format!("Failed to save config: {}", e))
    })?;

    Ok(Json(serde_json::json!({
        "success": true,
        "restart_required": true,
    })))
}

// ============================================================================
// LAN Discovery
// ============================================================================

/// GET /collab/discovered-peers — list peers found via UDP broadcast
async fn discovered_peers(
    State(state): State<AppState>,
) -> Json<Vec<serde_json::Value>> {
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

pub fn collab_router() -> Router<AppState> {
    Router::new()
        // Invites
        .route(
            "/collab/rooms/{room_id}/invites",
            get(list_invites).post(create_invite),
        )
        .route("/collab/invites/{token}/accept", post(accept_invite))
        .route(
            "/collab/rooms/{room_id}/invites/{token}",
            delete(revoke_invite),
        )
        // Public rooms
        .route("/collab/public-rooms", get(list_public_rooms))
        .route(
            "/collab/rooms/{room_id}/make-public",
            post(make_public).delete(make_private),
        )
        .route("/collab/rooms/{room_id}/join-public", post(join_public))
        .route("/collab/rooms/{room_id}/leave", post(leave_room))
        .route("/collab/rooms/{room_id}/members", get(list_room_members))
        // Users
        .route("/collab/me", get(get_me).put(update_me))
        .route("/collab/users/register", post(register_user))
        .route("/collab/users/{user_id}", get(get_user))
        // Server info + config
        .route("/collab/server-info", get(server_info))
        .route("/collab/network-interfaces", get(list_network_interfaces))
        .route("/collab/server-config", axum::routing::put(update_server_config))
        // LAN discovery
        .route("/collab/discovered-peers", get(discovered_peers))
        // Sync client (backend-to-backend connections)
        .route("/collab/connect", post(connect_remote))
        .route(
            "/collab/connect/{local_board_id}",
            delete(disconnect_remote),
        )
        .route("/collab/connections", get(list_connections))
}
