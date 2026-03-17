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

impl Default for AuthService {
    fn default() -> Self {
        Self::new()
    }
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
            .or_default();
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
        matches!(self.get_role(room_id, user_id), Some(RoomRole::Owner) | Some(RoomRole::Editor))
    }

    /// Check if user can invite others to a room
    pub fn can_invite(&self, room_id: &str, user_id: &str) -> bool {
        matches!(self.get_role(room_id, user_id), Some(RoomRole::Owner))
    }

    /// Check if user can delete a room
    pub fn can_delete(&self, room_id: &str, user_id: &str) -> bool {
        matches!(self.get_role(room_id, user_id), Some(RoomRole::Owner))
    }

    /// List all members of a room
    pub fn list_room_members(&self, room_id: &str) -> Vec<RoomMember> {
        let empty = Vec::new();
        let user_ids = self.room_members.get(room_id).unwrap_or(&empty);

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
            .map_err(io::Error::other)?;

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
                log::info!(
                    "[auth.load] No auth file at {}, starting empty",
                    path.display()
                );
                return Ok(Self::new());
            }
            Err(e) => return Err(e),
        };

        let data: AuthData = match serde_json::from_str(&content) {
            Ok(d) => d,
            Err(e) => {
                log::warn!(
                    "[auth.load] Corrupt auth file at {}: {}, starting empty",
                    path.display(),
                    e
                );
                return Ok(Self::new());
            }
        };

        // Rebuild the tuple-keyed memberships map from the list
        let mut memberships = HashMap::new();
        for entry in &data.memberships {
            memberships.insert((entry.room_id.clone(), entry.user_id.clone()), entry.role);
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
    #[error("User already exists")]
    UserAlreadyExists,
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn make_user(id: &str, name: &str, email: Option<&str>) -> User {
        User {
            id: id.to_string(),
            name: name.to_string(),
            email: email.map(|e| e.to_string()),
        }
    }

    // ---- User Registration ----

    #[test]
    fn register_user_succeeds() {
        let mut svc = AuthService::new();
        let user = make_user("u1", "Alice", Some("alice@test.com"));
        assert!(svc.register_user(user).is_ok());
        let fetched = svc.get_user("u1").expect("user should exist");
        assert_eq!(fetched.name, "Alice");
        assert_eq!(fetched.email.as_deref(), Some("alice@test.com"));
    }

    #[test]
    fn register_duplicate_user_rejected() {
        let mut svc = AuthService::new();
        let user1 = make_user("u1", "Alice", None);
        svc.register_user(user1).unwrap();

        let user2 = make_user("u1", "Alice Clone", None);
        let err = svc.register_user(user2).unwrap_err();
        assert!(matches!(err, AuthError::UserAlreadyExists));
    }

    #[test]
    fn get_user_returns_none_for_unknown_id() {
        let svc = AuthService::new();
        assert!(svc.get_user("nonexistent").is_none());
    }

    // ---- Role Parsing ----

    #[test]
    fn room_role_from_str_valid_values() {
        assert_eq!(RoomRole::from_str("owner"), Some(RoomRole::Owner));
        assert_eq!(RoomRole::from_str("editor"), Some(RoomRole::Editor));
        assert_eq!(RoomRole::from_str("viewer"), Some(RoomRole::Viewer));
    }

    #[test]
    fn room_role_from_str_invalid_returns_none() {
        assert_eq!(RoomRole::from_str("admin"), None);
        assert_eq!(RoomRole::from_str(""), None);
        assert_eq!(RoomRole::from_str("Owner"), None); // case-sensitive
    }

    #[test]
    fn room_role_as_str_round_trip() {
        for role in [RoomRole::Owner, RoomRole::Editor, RoomRole::Viewer] {
            let s = role.as_str();
            let parsed = RoomRole::from_str(s).expect("round-trip should succeed");
            assert_eq!(parsed, role);
        }
    }

    // ---- Permission Hierarchy ----

    fn svc_with_member(room: &str, user: &str, role: RoomRole) -> AuthService {
        let mut svc = AuthService::new();
        svc.register_user(make_user(user, user, None)).unwrap();
        svc.add_to_room(room, user, role, "test").unwrap();
        svc
    }

    #[test]
    fn can_write_grants_owner_and_editor() {
        let svc = svc_with_member("r1", "owner1", RoomRole::Owner);
        assert!(svc.can_write("r1", "owner1"));

        let svc = svc_with_member("r1", "editor1", RoomRole::Editor);
        assert!(svc.can_write("r1", "editor1"));
    }

    #[test]
    fn can_write_denies_viewer() {
        let svc = svc_with_member("r1", "viewer1", RoomRole::Viewer);
        assert!(!svc.can_write("r1", "viewer1"));
    }

    #[test]
    fn can_invite_grants_only_owner() {
        let svc = svc_with_member("r1", "owner1", RoomRole::Owner);
        assert!(svc.can_invite("r1", "owner1"));

        let svc = svc_with_member("r1", "editor1", RoomRole::Editor);
        assert!(!svc.can_invite("r1", "editor1"));

        let svc = svc_with_member("r1", "viewer1", RoomRole::Viewer);
        assert!(!svc.can_invite("r1", "viewer1"));
    }

    #[test]
    fn can_delete_grants_only_owner() {
        let svc = svc_with_member("r1", "owner1", RoomRole::Owner);
        assert!(svc.can_delete("r1", "owner1"));

        let svc = svc_with_member("r1", "editor1", RoomRole::Editor);
        assert!(!svc.can_delete("r1", "editor1"));

        let svc = svc_with_member("r1", "viewer1", RoomRole::Viewer);
        assert!(!svc.can_delete("r1", "viewer1"));
    }

    #[test]
    fn non_members_have_no_permissions() {
        let svc = AuthService::new();
        assert!(!svc.can_write("r1", "nobody"));
        assert!(!svc.can_invite("r1", "nobody"));
        assert!(!svc.can_delete("r1", "nobody"));
        assert!(!svc.is_member("r1", "nobody"));
    }

    // ---- Room Membership ----

    #[test]
    fn add_to_room_and_list_members() {
        let mut svc = AuthService::new();
        svc.register_user(make_user("u1", "Alice", None)).unwrap();
        svc.register_user(make_user("u2", "Bob", None)).unwrap();
        svc.add_to_room("r1", "u1", RoomRole::Owner, "invite")
            .unwrap();
        svc.add_to_room("r1", "u2", RoomRole::Editor, "link")
            .unwrap();

        let members = svc.list_room_members("r1");
        assert_eq!(members.len(), 2);

        let alice = members.iter().find(|m| m.user_id == "u1").unwrap();
        assert_eq!(alice.user_name, "Alice");
        assert_eq!(alice.role, "owner");

        let bob = members.iter().find(|m| m.user_id == "u2").unwrap();
        assert_eq!(bob.user_name, "Bob");
        assert_eq!(bob.role, "editor");
    }

    #[test]
    fn add_to_room_updates_role_without_duplicating() {
        let mut svc = AuthService::new();
        svc.register_user(make_user("u1", "Alice", None)).unwrap();
        svc.add_to_room("r1", "u1", RoomRole::Viewer, "invite")
            .unwrap();
        svc.add_to_room("r1", "u1", RoomRole::Editor, "upgrade")
            .unwrap();

        // Role should be updated
        assert_eq!(svc.get_role("r1", "u1"), Some(RoomRole::Editor));

        // Should still have only one member entry, not two
        let members = svc.list_room_members("r1");
        assert_eq!(members.len(), 1);
    }

    #[test]
    fn remove_from_room_clears_membership() {
        let mut svc = svc_with_member("r1", "u1", RoomRole::Owner);
        assert!(svc.is_member("r1", "u1"));

        svc.remove_from_room("r1", "u1");
        assert!(!svc.is_member("r1", "u1"));
        assert!(svc.list_room_members("r1").is_empty());
    }

    #[test]
    fn list_room_members_empty_for_unknown_room() {
        let svc = AuthService::new();
        assert!(svc.list_room_members("nonexistent").is_empty());
    }

    #[test]
    fn is_member_reflects_membership() {
        let mut svc = AuthService::new();
        svc.register_user(make_user("u1", "Alice", None)).unwrap();
        assert!(!svc.is_member("r1", "u1"));
        svc.add_to_room("r1", "u1", RoomRole::Viewer, "test")
            .unwrap();
        assert!(svc.is_member("r1", "u1"));
    }

    // ---- Persistence Round-Trip ----

    #[test]
    fn save_and_load_preserves_all_data() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("auth.json");

        // Build state
        let mut svc = AuthService::new();
        svc.register_user(make_user("u1", "Alice", Some("alice@test.com")))
            .unwrap();
        svc.register_user(make_user("u2", "Bob", None)).unwrap();
        svc.add_to_room("r1", "u1", RoomRole::Owner, "create")
            .unwrap();
        svc.add_to_room("r1", "u2", RoomRole::Editor, "invite")
            .unwrap();
        svc.add_to_room("r2", "u1", RoomRole::Viewer, "link")
            .unwrap();

        // Save
        svc.save_to_file(&path).unwrap();
        assert!(path.exists());

        // Load into new service
        let loaded = AuthService::load_from_file(&path).unwrap();

        // Verify users
        let alice = loaded.get_user("u1").expect("alice should be loaded");
        assert_eq!(alice.name, "Alice");
        assert_eq!(alice.email.as_deref(), Some("alice@test.com"));

        let bob = loaded.get_user("u2").expect("bob should be loaded");
        assert_eq!(bob.name, "Bob");
        assert!(bob.email.is_none());

        // Verify memberships
        assert_eq!(loaded.get_role("r1", "u1"), Some(RoomRole::Owner));
        assert_eq!(loaded.get_role("r1", "u2"), Some(RoomRole::Editor));
        assert_eq!(loaded.get_role("r2", "u1"), Some(RoomRole::Viewer));

        // Verify room member lists
        let r1_members = loaded.list_room_members("r1");
        assert_eq!(r1_members.len(), 2);
        let r2_members = loaded.list_room_members("r2");
        assert_eq!(r2_members.len(), 1);

        // Verify permission logic still works on loaded data
        assert!(loaded.can_write("r1", "u1"));
        assert!(loaded.can_write("r1", "u2"));
        assert!(!loaded.can_write("r2", "u2"));
    }

    #[test]
    fn load_from_missing_file_returns_empty_service() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("does_not_exist.json");

        let svc = AuthService::load_from_file(&path).unwrap();
        assert!(svc.get_user("anyone").is_none());
        assert!(svc.list_room_members("any_room").is_empty());
    }

    #[test]
    fn load_from_corrupt_file_returns_empty_service() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(&path, "this is not valid json {{{").unwrap();

        let svc = AuthService::load_from_file(&path).unwrap();
        assert!(svc.get_user("anyone").is_none());
    }

    #[test]
    fn save_overwrites_previous_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("auth.json");

        let mut svc = AuthService::new();
        svc.register_user(make_user("u1", "Alice", None)).unwrap();
        svc.save_to_file(&path).unwrap();

        // Modify and save again
        svc.register_user(make_user("u2", "Bob", None)).unwrap();
        svc.save_to_file(&path).unwrap();

        let loaded = AuthService::load_from_file(&path).unwrap();
        assert!(loaded.get_user("u1").is_some());
        assert!(loaded.get_user("u2").is_some());
    }
}
