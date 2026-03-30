use serde::{Deserialize, Serialize};
/// Invitation service: create, accept, and revoke invite links.
use std::io;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteLink {
    pub token: String,
    pub room_id: String,
    pub room_title: Option<String>,
    pub role: String,
    pub expires_at: u64,
    pub max_uses: u32,
    pub uses: u32,
    /// "board" (default) or "workspace"
    #[serde(default = "default_invite_scope")]
    pub scope: String,
}

fn default_invite_scope() -> String {
    "board".to_string()
}

#[derive(Debug, Clone)]
pub struct CreateInviteRequest {
    pub room_id: String,
    pub inviter_id: String,
    pub role: String,
    pub expires_in_hours: Option<u32>,
    pub max_uses: Option<u32>,
    /// "board" or "workspace"
    pub scope: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomJoin {
    pub room_id: String,
    pub room_title: String,
    pub role: String,
    /// "board" or "workspace"
    pub scope: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InviteRole {
    Owner,
    Editor,
    Viewer,
}

impl InviteRole {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(InviteRole::Owner),
            "editor" => Some(InviteRole::Editor),
            "viewer" => Some(InviteRole::Viewer),
            _ => None,
        }
    }
}

/// In-memory invite storage
pub struct InviteService {
    /// token -> InviteLink
    invites: std::collections::HashMap<String, InviteLink>,
}

impl Default for InviteService {
    fn default() -> Self {
        Self::new()
    }
}

impl InviteService {
    pub fn new() -> Self {
        Self {
            invites: std::collections::HashMap::new(),
        }
    }

    /// Maximum allowed value for `max_uses`.
    const MAX_USES_LIMIT: u32 = 100;

    /// Create a new invite link
    pub fn create_invite(
        &mut self,
        req: CreateInviteRequest,
        room_title: Option<String>,
    ) -> Result<InviteLink, InviteError> {
        // Validate role
        InviteRole::from_str(&req.role).ok_or(InviteError::InvalidRole)?;

        // Validate max_uses upper bound
        if let Some(max) = req.max_uses {
            if max > Self::MAX_USES_LIMIT {
                return Err(InviteError::MaxUsesTooHigh);
            }
        }

        let token = Uuid::new_v4().to_string();

        let expires_at = if let Some(hours) = req.expires_in_hours {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or(std::time::Duration::ZERO);
            now.as_secs() + (hours as u64 * 3600)
        } else {
            u64::MAX // Never expires
        };

        let max_uses = req.max_uses.unwrap_or(1);

        log::info!(
            "[invite] Created invite {}... for room {} by {}",
            &token[..8],
            req.room_id,
            req.inviter_id
        );

        let invite = InviteLink {
            token: token.clone(),
            room_id: req.room_id,
            room_title,
            role: req.role,
            expires_at,
            max_uses,
            uses: 0,
            scope: req.scope,
        };

        self.invites.insert(token, invite.clone());

        Ok(invite)
    }

    /// Accept an invite and return room join info
    pub fn accept_invite(&mut self, token: &str) -> Result<RoomJoin, InviteError> {
        let invite = self.invites.get(token).ok_or(InviteError::NotFound)?;

        // Check expiration
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(std::time::Duration::ZERO)
            .as_secs();

        if invite.expires_at < now {
            return Err(InviteError::Expired);
        }

        // Check usage limit
        if invite.uses >= invite.max_uses {
            return Err(InviteError::MaxUsesReached);
        }

        let room_id = invite.room_id.clone();
        let role = invite.role.clone();
        let scope = invite.scope.clone();
        let room_title = invite
            .room_title
            .clone()
            .unwrap_or_else(|| "Untitled".to_string());

        // Increment uses
        if let Some(invite_entry) = self.invites.get_mut(token) {
            invite_entry.uses += 1;
        }

        log::info!(
            "[invite] Accepted invite {}... for {} {}",
            &token[..8.min(token.len())],
            scope,
            room_id
        );

        Ok(RoomJoin {
            room_id,
            room_title,
            role,
            scope,
        })
    }

    /// List all invites for a room
    pub fn list_invites(&self, room_id: &str) -> Vec<InviteLink> {
        self.invites
            .values()
            .filter(|invite| invite.room_id == room_id)
            .cloned()
            .collect()
    }

    /// Revoke an invite
    pub fn revoke_invite(&mut self, token: &str, room_id: &str) -> Result<(), InviteError> {
        let invite = self.invites.get(token).ok_or(InviteError::NotFound)?;

        if invite.room_id != room_id {
            return Err(InviteError::NotFound);
        }

        self.invites.remove(token);
        log::info!(
            "[invite] Revoked invite {}... for room {}",
            &token[..8.min(token.len())],
            room_id
        );
        Ok(())
    }

    /// Cleanup expired invites (call periodically)
    pub fn cleanup_expired(&mut self) -> usize {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let before = self.invites.len();
        self.invites.retain(|_, invite| invite.expires_at >= now);
        let count = before - self.invites.len();

        if count > 0 {
            log::info!("[invite] Cleaned up {} expired invites", count);
        }
        count
    }

    /// Save all invite state to a JSON file. Uses atomic write (tmp + rename).
    pub fn save_to_file(&self, path: &Path) -> io::Result<()> {
        let json = serde_json::to_string_pretty(&self.invites).map_err(io::Error::other)?;

        let tmp_path = path.with_extension("tmp");
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, path)?;

        log::info!(
            "[invite.save] Saved {} invites to {}",
            self.invites.len(),
            path.display()
        );
        Ok(())
    }

    /// Load invite state from a JSON file. Returns empty service if file is missing or corrupt.
    pub fn load_from_file(path: &Path) -> io::Result<Self> {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                log::info!(
                    "[invite.load] No invite file at {}, starting empty",
                    path.display()
                );
                return Ok(Self::new());
            }
            Err(e) => return Err(e),
        };

        let invites: std::collections::HashMap<String, InviteLink> =
            match serde_json::from_str(&content) {
                Ok(d) => d,
                Err(e) => {
                    log::warn!(
                        "[invite.load] Corrupt invite file at {}: {}, starting empty",
                        path.display(),
                        e
                    );
                    return Ok(Self::new());
                }
            };

        log::info!(
            "[invite.load] Loaded {} invites from {}",
            invites.len(),
            path.display()
        );

        Ok(Self { invites })
    }
}

#[derive(Debug, Error)]
pub enum InviteError {
    #[error("Invite not found")]
    NotFound,

    #[error("Invite has expired")]
    Expired,

    #[error("Invite has reached maximum uses")]
    MaxUsesReached,

    #[error("max_uses exceeds limit of 100")]
    MaxUsesTooHigh,

    #[error("Invalid role")]
    InvalidRole,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tempfile::tempdir;

    fn make_request(room_id: &str, role: &str) -> CreateInviteRequest {
        CreateInviteRequest {
            room_id: room_id.to_string(),
            inviter_id: "user-1".to_string(),
            role: role.to_string(),
            expires_in_hours: None,
            max_uses: None,
            scope: "board".to_string(),
        }
    }

    // ── 1. Invite Creation ──────────────────────────────────────────────

    #[test]
    fn create_invite_with_valid_role() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "editor");
        let invite = svc.create_invite(req, Some("My Room".into())).unwrap();

        assert_eq!(invite.room_id, "room-a");
        assert_eq!(invite.role, "editor");
        assert_eq!(invite.room_title.as_deref(), Some("My Room"));
        assert_eq!(invite.uses, 0);
        assert_eq!(invite.max_uses, 1); // default
        assert!(!invite.token.is_empty());
    }

    #[test]
    fn create_invite_invalid_role_is_rejected() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "admin");
        let err = svc.create_invite(req, None).unwrap_err();
        assert!(matches!(err, InviteError::InvalidRole));
    }

    #[test]
    fn create_invite_default_non_expiring() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "viewer");
        let invite = svc.create_invite(req, None).unwrap();
        assert_eq!(invite.expires_at, u64::MAX);
    }

    #[test]
    fn create_invite_with_expiration() {
        let mut svc = InviteService::new();
        let mut req = make_request("room-a", "owner");
        req.expires_in_hours = Some(24);
        let invite = svc.create_invite(req, None).unwrap();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        // expires_at should be roughly now + 24h (allow 5s tolerance)
        let expected = now + 24 * 3600;
        assert!(invite.expires_at >= expected - 5 && invite.expires_at <= expected + 5);
    }

    #[test]
    fn create_invite_with_custom_max_uses() {
        let mut svc = InviteService::new();
        let mut req = make_request("room-a", "editor");
        req.max_uses = Some(10);
        let invite = svc.create_invite(req, None).unwrap();
        assert_eq!(invite.max_uses, 10);
    }

    #[test]
    fn create_invite_rejects_max_uses_over_limit() {
        let mut svc = InviteService::new();
        let mut req = make_request("room-a", "editor");
        req.max_uses = Some(101);
        let err = svc.create_invite(req, None).unwrap_err();
        assert!(matches!(err, InviteError::MaxUsesTooHigh));
    }

    #[test]
    fn create_invite_allows_max_uses_at_limit() {
        let mut svc = InviteService::new();
        let mut req = make_request("room-a", "editor");
        req.max_uses = Some(100);
        let invite = svc.create_invite(req, None).unwrap();
        assert_eq!(invite.max_uses, 100);
    }

    // ── 2. Expiration Enforcement ───────────────────────────────────────

    #[test]
    fn accept_invite_rejects_expired() {
        let mut svc = InviteService::new();
        // Insert an invite that is already expired
        let token = "expired-token".to_string();
        svc.invites.insert(
            token.clone(),
            InviteLink {
                token: token.clone(),
                room_id: "room-a".into(),
                room_title: Some("Room A".into()),
                role: "editor".into(),
                expires_at: 1, // epoch + 1s, long in the past
                max_uses: 10,
                uses: 0,
                scope: "board".into(),
            },
        );

        let err = svc.accept_invite(&token).unwrap_err();
        assert!(matches!(err, InviteError::Expired));
    }

    // ── 3. Usage Limit Tracking ─────────────────────────────────────────

    #[test]
    fn accept_invite_increments_uses() {
        let mut svc = InviteService::new();
        let mut req = make_request("room-a", "editor");
        req.max_uses = Some(3);
        let invite = svc.create_invite(req, Some("Room A".into())).unwrap();
        let token = invite.token.clone();

        // First use
        let join = svc.accept_invite(&token).unwrap();
        assert_eq!(join.room_id, "room-a");
        assert_eq!(join.role, "editor");
        assert_eq!(join.room_title, "Room A");
        assert_eq!(svc.invites.get(&token).unwrap().uses, 1);

        // Second use
        svc.accept_invite(&token).unwrap();
        assert_eq!(svc.invites.get(&token).unwrap().uses, 2);

        // Third use
        svc.accept_invite(&token).unwrap();
        assert_eq!(svc.invites.get(&token).unwrap().uses, 3);

        // Fourth use should fail
        let err = svc.accept_invite(&token).unwrap_err();
        assert!(matches!(err, InviteError::MaxUsesReached));
    }

    #[test]
    fn accept_invite_not_found() {
        let mut svc = InviteService::new();
        let err = svc.accept_invite("nonexistent").unwrap_err();
        assert!(matches!(err, InviteError::NotFound));
    }

    #[test]
    fn accept_invite_room_title_defaults_to_untitled() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "viewer");
        let invite = svc.create_invite(req, None).unwrap();
        let join = svc.accept_invite(&invite.token).unwrap();
        assert_eq!(join.room_title, "Untitled");
    }

    // ── 4. Cleanup ──────────────────────────────────────────────────────

    #[test]
    fn cleanup_expired_removes_only_expired_invites() {
        let mut svc = InviteService::new();

        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // One expired invite
        svc.invites.insert(
            "old".into(),
            InviteLink {
                token: "old".into(),
                room_id: "room-a".into(),
                room_title: None,
                role: "editor".into(),
                expires_at: 1, // long expired
                max_uses: 1,
                uses: 0,
                scope: "board".into(),
            },
        );

        // One still-valid invite (far future)
        svc.invites.insert(
            "fresh".into(),
            InviteLink {
                token: "fresh".into(),
                room_id: "room-a".into(),
                room_title: None,
                role: "viewer".into(),
                expires_at: now + 100_000,
                max_uses: 1,
                uses: 0,
                scope: "board".into(),
            },
        );

        // One non-expiring invite
        svc.invites.insert(
            "forever".into(),
            InviteLink {
                token: "forever".into(),
                room_id: "room-b".into(),
                room_title: None,
                role: "owner".into(),
                expires_at: u64::MAX,
                max_uses: 5,
                uses: 0,
                scope: "board".into(),
            },
        );

        let removed = svc.cleanup_expired();
        assert_eq!(removed, 1);
        assert!(svc.invites.get("old").is_none());
        assert!(svc.invites.get("fresh").is_some());
        assert!(svc.invites.get("forever").is_some());
    }

    #[test]
    fn cleanup_expired_returns_zero_when_none_expired() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "editor");
        svc.create_invite(req, None).unwrap(); // non-expiring

        let removed = svc.cleanup_expired();
        assert_eq!(removed, 0);
    }

    // ── 5. Revocation ───────────────────────────────────────────────────

    #[test]
    fn revoke_invite_matching_room() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "editor");
        let invite = svc.create_invite(req, None).unwrap();
        let token = invite.token.clone();

        svc.revoke_invite(&token, "room-a").unwrap();
        assert!(svc.invites.get(&token).is_none());
    }

    #[test]
    fn revoke_invite_mismatching_room_is_rejected() {
        let mut svc = InviteService::new();
        let req = make_request("room-a", "editor");
        let invite = svc.create_invite(req, None).unwrap();
        let token = invite.token.clone();

        let err = svc.revoke_invite(&token, "room-b").unwrap_err();
        assert!(matches!(err, InviteError::NotFound));
        // Invite should still exist
        assert!(svc.invites.get(&token).is_some());
    }

    #[test]
    fn revoke_invite_nonexistent_token() {
        let mut svc = InviteService::new();
        let err = svc.revoke_invite("no-such-token", "room-a").unwrap_err();
        assert!(matches!(err, InviteError::NotFound));
    }

    // ── 6. List Invites ─────────────────────────────────────────────────

    #[test]
    fn list_invites_returns_only_matching_room() {
        let mut svc = InviteService::new();

        let req_a1 = make_request("room-a", "editor");
        let req_a2 = make_request("room-a", "viewer");
        let req_b = make_request("room-b", "owner");

        svc.create_invite(req_a1, None).unwrap();
        svc.create_invite(req_a2, None).unwrap();
        svc.create_invite(req_b, None).unwrap();

        let room_a_invites = svc.list_invites("room-a");
        assert_eq!(room_a_invites.len(), 2);
        assert!(room_a_invites.iter().all(|i| i.room_id == "room-a"));

        let room_b_invites = svc.list_invites("room-b");
        assert_eq!(room_b_invites.len(), 1);
        assert_eq!(room_b_invites[0].room_id, "room-b");

        let room_c_invites = svc.list_invites("room-c");
        assert!(room_c_invites.is_empty());
    }

    // ── 7. Persistence Round-Trip ───────────────────────────────────────

    #[test]
    fn save_and_load_round_trip() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("invites.json");

        // Create a service with two invites
        let mut svc = InviteService::new();
        let req1 = make_request("room-a", "editor");
        let req2 = make_request("room-b", "viewer");
        let invite1 = svc.create_invite(req1, Some("Room A".into())).unwrap();
        let invite2 = svc.create_invite(req2, None).unwrap();

        // Accept one to bump its uses counter
        svc.accept_invite(&invite1.token).unwrap();

        // Save
        svc.save_to_file(&path).unwrap();

        // Load into a new service
        let loaded = InviteService::load_from_file(&path).unwrap();
        assert_eq!(loaded.invites.len(), 2);

        let l1 = loaded.invites.get(&invite1.token).unwrap();
        assert_eq!(l1.room_id, "room-a");
        assert_eq!(l1.role, "editor");
        assert_eq!(l1.room_title.as_deref(), Some("Room A"));
        assert_eq!(l1.uses, 1);

        let l2 = loaded.invites.get(&invite2.token).unwrap();
        assert_eq!(l2.room_id, "room-b");
        assert_eq!(l2.role, "viewer");
        assert_eq!(l2.uses, 0);
    }

    #[test]
    fn load_from_missing_file_returns_empty_service() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");
        let svc = InviteService::load_from_file(&path).unwrap();
        assert!(svc.invites.is_empty());
    }

    #[test]
    fn load_from_corrupt_file_returns_empty_service() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("corrupt.json");
        std::fs::write(&path, "not valid json {{{").unwrap();
        let svc = InviteService::load_from_file(&path).unwrap();
        assert!(svc.invites.is_empty());
    }

    #[test]
    fn save_overwrites_previous_file() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("invites.json");

        // Save once with one invite
        let mut svc = InviteService::new();
        let req = make_request("room-a", "editor");
        svc.create_invite(req, None).unwrap();
        svc.save_to_file(&path).unwrap();

        // Save again with empty service
        let empty = InviteService::new();
        empty.save_to_file(&path).unwrap();

        let loaded = InviteService::load_from_file(&path).unwrap();
        assert!(loaded.invites.is_empty());
    }
}
