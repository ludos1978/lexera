/// Auth service: user management, room membership, and permissions.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomRole {
    Owner,
    Editor,
    Viewer,
}

impl RoomRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            RoomRole::Owner => "owner",
            RoomRole::Editor => "editor",
            RoomRole::Viewer => "viewer",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(RoomRole::Owner),
            "editor" => Some(RoomRole::Editor),
            "viewer" => Some(RoomRole::Viewer),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomMember {
    pub user_id: String,
    pub user_name: String,
    pub room_id: String,
    pub role: String,
    pub joined_via: String,
}

/// In-memory user and membership storage
pub struct AuthService {
    /// user_id -> User
    users: HashMap<String, User>,
    /// (room_id, user_id) -> RoomRole
    memberships: HashMap<(String, String), RoomRole>,
    /// room_id -> Vec<user_id>
    room_members: HashMap<String, Vec<String>>,
}

impl AuthService {
    pub fn new() -> Self {
        Self {
            users: HashMap::new(),
            memberships: HashMap::new(),
            room_members: HashMap::new(),
        }
    }

    /// Register a new user. Returns error if user ID already exists.
    pub fn register_user(&mut self, user: User) -> Result<(), AuthError> {
        if self.users.contains_key(&user.id) {
            return Err(AuthError::UserAlreadyExists);
        }
        let name = user.name.clone();
        let id = user.id.clone();
        self.users.insert(id.clone(), user);
        log::info!("[auth] Registered user: {} ({})", name, id);
        Ok(())
    }

    /// Get user by ID
    pub fn get_user(&self, user_id: &str) -> Option<&User> {
        self.users.get(user_id)
    }

    /// Update an existing user's name/email in place.
    pub fn update_user(&mut self, user: User) {
        self.users.insert(user.id.clone(), user);
    }

    /// Add user to room. Updates role if already a member instead of duplicating.
    pub fn add_to_room(
        &mut self,
        room_id: &str,
        user_id: &str,
        role: RoomRole,
        joined_via: &str,
    ) -> Result<(), AuthError> {
        let key = (room_id.to_string(), user_id.to_string());
        self.memberships.insert(key, role);

        let members = self
            .room_members
            .entry(room_id.to_string())
            .or_insert_with(Vec::new);
        if !members.iter().any(|id| id == user_id) {
            members.push(user_id.to_string());
        }

        log::info!(
            "[auth] Added user {} to room {} as {} via {}",
            user_id,
            room_id,
            role.as_str(),
            joined_via
        );

        Ok(())
    }

    /// Get user's role in a room
    pub fn get_role(&self, room_id: &str, user_id: &str) -> Option<RoomRole> {
        let key = (room_id.to_string(), user_id.to_string());
        self.memberships.get(&key).copied()
    }

    /// Check if user is member of a room
    pub fn is_member(&self, room_id: &str, user_id: &str) -> bool {
        let key = (room_id.to_string(), user_id.to_string());
        self.memberships.contains_key(&key)
    }

    /// Check if user can write (edit) a room
    pub fn can_write(&self, room_id: &str, user_id: &str) -> bool {
        match self.get_role(room_id, user_id) {
            Some(RoomRole::Owner) | Some(RoomRole::Editor) => true,
            _ => false,
        }
    }

    /// Check if user can invite others to a room
    pub fn can_invite(&self, room_id: &str, user_id: &str) -> bool {
        match self.get_role(room_id, user_id) {
            Some(RoomRole::Owner) => true,
            _ => false,
        }
    }

    /// Check if user can delete a room
    pub fn can_delete(&self, room_id: &str, user_id: &str) -> bool {
        match self.get_role(room_id, user_id) {
            Some(RoomRole::Owner) => true,
            _ => false,
        }
    }

    /// List all members of a room
    pub fn list_room_members(&self, room_id: &str) -> Vec<RoomMember> {
        let room_id_str = room_id.to_string();
        let user_ids = self
            .room_members
            .get(&room_id_str)
            .cloned()
            .unwrap_or_default();

        user_ids
            .iter()
            .filter_map(|uid| {
                let key = (room_id_str.clone(), uid.clone());
                self.memberships.get(&key).map(|role| {
                    let user_name = self
                        .users
                        .get(uid)
                        .map(|u| u.name.clone())
                        .unwrap_or_else(|| uid.clone());
                    RoomMember {
                        user_id: uid.clone(),
                        user_name,
                        room_id: room_id_str.clone(),
                        role: role.as_str().to_string(),
                        joined_via: "unknown".to_string(),
                    }
                })
            })
            .collect()
    }

    /// Remove user from room
    pub fn remove_from_room(&mut self, room_id: &str, user_id: &str) {
        let key = (room_id.to_string(), user_id.to_string());
        self.memberships.remove(&key);

        if let Some(members) = self.room_members.get_mut(room_id) {
            members.retain(|id| id != user_id);
        }

        log::info!("[auth] Removed user {} from room {}", user_id, room_id);
    }
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("User not found")]
    UserNotFound,

    #[error("User already exists")]
    UserAlreadyExists,

    #[error("Room not found")]
    RoomNotFound,

    #[error("Permission denied")]
    PermissionDenied,

    #[error("Invalid role")]
    InvalidRole,
}
