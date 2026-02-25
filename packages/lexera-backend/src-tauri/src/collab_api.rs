/// Collaboration API: invitations, public rooms, user management.

use axum::{
    Router,
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
    routing::{get, post, delete},
};
use serde::{Deserialize, Serialize};
use lexera_core::storage::BoardStorage;
use crate::state::AppState;
use crate::invite::{CreateInviteRequest, InviteLink, RoomJoin};
use crate::public::{MakePublicRequest, PublicRoom};
use crate::auth::{RoomRole, RoomMember as AuthRoomMember};

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
        Self { error: msg.to_string() }
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
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user can invite (owner only)
    let auth_service = state.auth_service.lock().unwrap();
    if !auth_service.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    if !auth_service.can_invite(&room_id, &user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    drop(auth_service);

    // Get room title
    let room_title = state.storage.read_board(&room_id)
        .map(|b| b.title.clone());

    // Create invite
    let mut invite_service = state.invite_service.lock().unwrap();
    let invite = invite_service.create_invite(
        CreateInviteRequest {
            room_id: room_id.clone(),
            inviter_id: user_id.clone(),
            role: body.role.clone(),
            expires_in_hours: body.expires_in_hours,
            max_uses: body.max_uses,
            email: None,
        },
        room_title,
    ).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request(&e.to_string())))
    })?;

    Ok(Json(invite))
}

/// GET /collab/rooms/{room_id}/invites - List invites for a room
async fn list_invites(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<Vec<InviteLink>>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user can invite (owner only)
    let auth_service = state.auth_service.lock().unwrap();
    if !auth_service.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    if !auth_service.can_invite(&room_id, &user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    drop(auth_service);

    let invites = state.invite_service.lock().unwrap()
        .list_invites(&room_id);

    Ok(Json(invites))
}

/// POST /collab/invites/{token}/accept - Accept an invite
async fn accept_invite(
    State(state): State<AppState>,
    Path(token): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<RoomJoin>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    let join = {
        let mut invite_service = state.invite_service.lock().unwrap();
        invite_service.accept_invite(&token).map_err(|e| {
            match e {
                crate::invite::InviteError::NotFound => {
                    (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found()))
                }
                crate::invite::InviteError::Expired => {
                    (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request("Invite has expired")))
                }
                crate::invite::InviteError::MaxUsesReached => {
                    (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request("Invite has reached maximum uses")))
                }
                _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new(&e.to_string()))),
            }
        })?
    };

    // Add user to room
    let role = RoomRole::from_str(&join.role)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request("Invalid role"))))?;

    let mut auth_service = state.auth_service.lock().unwrap();
    auth_service.add_to_room(&join.room_id, &user_id, role, "invite").map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new(&e.to_string())))
    })?;

    Ok(Json(join))
}

/// DELETE /collab/rooms/{room_id}/invites/{token} - Revoke an invite
async fn revoke_invite(
    State(state): State<AppState>,
    Path((room_id, token)): Path<(String, String)>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<SuccessResponse>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user is owner
    let auth_service = state.auth_service.lock().unwrap();
    if !auth_service.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    if !auth_service.can_invite(&room_id, &user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    drop(auth_service);

    state.invite_service.lock().unwrap()
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
async fn list_public_rooms(
    State(state): State<AppState>,
) -> Json<Vec<PublicRoom>> {
    let public = state.public_service.lock().unwrap();

    Json(public.list_public_rooms(|room_id| {
        state.storage.read_board(room_id).map(|b| b.title.clone())
    }))
}

/// POST /collab/rooms/{room_id}/make-public - Make a room public
async fn make_public(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
    Json(body): Json<MakePublicBody>,
) -> Result<Json<SuccessResponse>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user can invite (owner only)
    let auth_service = state.auth_service.lock().unwrap();
    if !auth_service.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    if !auth_service.can_invite(&room_id, &user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    // Get member count while we still hold the lock
    let member_count = auth_service.list_room_members(&room_id).len();
    drop(auth_service);

    let req = MakePublicRequest {
        room_id: room_id.clone(),
        default_role: body.default_role.clone(),
        max_users: body.max_users,
    };
    let mut public = state.public_service.lock().unwrap();
    public.make_public(&req, member_count).map_err(|e| {
        (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request(&e.to_string())))
    })?;

    Ok(Json(SuccessResponse { success: true }))
}

/// DELETE /collab/rooms/{room_id}/make-public - Make a room private
async fn make_private(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<SuccessResponse>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user can invite (owner only)
    let auth_service = state.auth_service.lock().unwrap();
    if !auth_service.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }
    if !auth_service.can_invite(&room_id, &user_id) {
        return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::forbidden())));
    }
    drop(auth_service);

    state.public_service.lock().unwrap()
        .make_private(&room_id);

    Ok(Json(SuccessResponse { success: true }))
}

/// POST /collab/rooms/{room_id}/join-public - Join a public room
async fn join_public(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    Query(params): Query<AuthQuery>,
) -> Result<Json<RoomJoin>> {
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Get board title (storage has its own internal RwLock, safe to call outside our mutexes)
    let room_title = state.storage.read_board(&room_id)
        .map(|b| b.title.clone())
        .unwrap_or_else(|| "Untitled".to_string());

    // Lock auth before public (consistent ordering with make_public/make_private/leave_room)
    // Hold both locks to make the max_users check + add atomic
    let mut auth = state.auth_service.lock().unwrap();
    let mut public = state.public_service.lock().unwrap();

    if !public.is_public(&room_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }

    let settings = public.get_room_settings(&room_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;

    // Check max users atomically with add
    if let Some(max_users) = settings.max_users {
        let member_count = auth.list_room_members(&room_id).len() as i64;
        if member_count >= max_users {
            return Err((StatusCode::FORBIDDEN, Json(ErrorResponse::bad_request("Room is full"))));
        }
    }

    let role = RoomRole::from_str(&settings.default_role)
        .ok_or_else(|| (StatusCode::BAD_REQUEST, Json(ErrorResponse::bad_request("Invalid role"))))?;

    auth.add_to_room(&room_id, &user_id, role, "public").map_err(|e| {
        (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new(&e.to_string())))
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
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    let mut auth = state.auth_service.lock().unwrap();
    auth.remove_from_room(&room_id, &user_id);
    drop(auth);

    // Update member count if public
    let mut public = state.public_service.lock().unwrap();
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
    let user_id = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    // Verify user is member
    let auth = state.auth_service.lock().unwrap();
    if !auth.is_member(&room_id, &user_id) {
        return Err((StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())));
    }

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
    let mut auth = state.auth_service.lock().unwrap();
    auth.register_user(crate::auth::User {
        id: body.id.clone(),
        name: body.name.clone(),
        email: body.email,
    }).map_err(|e| {
        match e {
            crate::auth::AuthError::UserAlreadyExists => {
                (StatusCode::CONFLICT, Json(ErrorResponse::new("User ID already exists")))
            }
            _ => (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse::new(&e.to_string()))),
        }
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
    let requester = params.user.ok_or_else(|| (StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())))?;

    let auth = state.auth_service.lock().unwrap();

    // Verify requester is a registered user
    if auth.get_user(&requester).is_none() {
        return Err((StatusCode::UNAUTHORIZED, Json(ErrorResponse::unauthorized())));
    }

    let user = auth.get_user(&user_id)
        .ok_or_else(|| (StatusCode::NOT_FOUND, Json(ErrorResponse::not_found())))?;

    Ok(Json(user.clone()))
}

// ============================================================================
// Router
// ============================================================================

pub fn collab_router() -> Router<AppState> {
    Router::new()
        // Invites
        .route("/collab/rooms/{room_id}/invites", get(list_invites).post(create_invite))
        .route("/collab/invites/{token}/accept", post(accept_invite))
        .route("/collab/rooms/{room_id}/invites/{token}", delete(revoke_invite))

        // Public rooms
        .route("/collab/public-rooms", get(list_public_rooms))
        .route("/collab/rooms/{room_id}/make-public", post(make_public).delete(make_private))
        .route("/collab/rooms/{room_id}/join-public", post(join_public))
        .route("/collab/rooms/{room_id}/leave", post(leave_room))
        .route("/collab/rooms/{room_id}/members", get(list_room_members))

        // Users
        .route("/collab/users/register", post(register_user))
        .route("/collab/users/{user_id}", get(get_user))
}
