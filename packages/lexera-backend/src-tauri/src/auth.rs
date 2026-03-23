/// Auth service: user management, room membership, and permissions.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::path::Path;
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
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
        log::info!("[auth] Registered user: {} ({})", user.name, user.id);
        let id = user.id.clone();
        self.users.insert(id, user);
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
        let empty = Vec::new();
        let user_ids = self
            .room_members
            .get(room_id)
            .unwrap_or(&empty);

        user_ids
            .iter()
            .filter_map(|uid| {
                let key = (room_id.to_string(), uid.clone());
                self.memberships.get(&key).map(|role| {
                    let user_name = self
                        .users
                        .get(uid.as_str())
                        .map(|u| u.name.clone())
                        .unwrap_or_else(|| uid.clone());
                    RoomMember {
                        user_id: uid.clone(),
                        user_name,
                        room_id: room_id.to_string(),
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

    /// Save all auth state to a JSON file. Uses atomic write (tmp + rename).
    pub fn save_to_file(&self, path: &Path) -> io::Result<()> {
        // Convert tuple-keyed memberships to a serializable list
        let membership_list: Vec<MembershipEntry> = self
            .memberships
            .iter()
            .map(|((room_id, user_id), role)| MembershipEntry {
                room_id: room_id.clone(),
                user_id: user_id.clone(),
                role: *role,
            })
            .collect();

        let data = AuthData {
            users: self.users.clone(),
            memberships: membership_list,
            room_members: self.room_members.clone(),
        };

        let json = serde_json::to_string_pretty(&data)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        let tmp_path = path.with_extension("tmp");
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, path)?;

        log::info!("[auth.save] Saved auth state to {}", path.display());
        Ok(())
    }

    /// Load auth state from a JSON file. Returns empty service if file is missing or corrupt.
    pub fn load_from_file(path: &Path) -> io::Result<Self> {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                log::info!("[auth.load] No auth file at {}, starting empty", path.display());
                return Ok(Self::new());
            }
            Err(e) => return Err(e),
        };

        let data: AuthData = match serde_json::from_str(&content) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[auth.load] Corrupt auth file at {}: {}, starting empty", path.display(), e);
                return Ok(Self::new());
            }
        };

        // Rebuild the tuple-keyed memberships map from the list
        let mut memberships = HashMap::new();
        for entry in &data.memberships {
            memberships.insert(
                (entry.room_id.clone(), entry.user_id.clone()),
                entry.role,
            );
        }

        log::info!(
            "[auth.load] Loaded {} users, {} memberships from {}",
            data.users.len(),
            memberships.len(),
            path.display()
        );

        Ok(Self {
            users: data.users,
            memberships,
            room_members: data.room_members,
        })
    }
}

/// Serializable representation of a single membership entry.
/// Needed because HashMap<(String, String), RoomRole> can't be directly serialized
/// as JSON (JSON object keys must be strings, not tuples).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct MembershipEntry {
    room_id: String,
    user_id: String,
    role: RoomRole,
}

/// Serializable container for all AuthService state.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct AuthData {
    users: HashMap<String, User>,
    memberships: Vec<MembershipEntry>,
    room_members: HashMap<String, Vec<String>>,
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
