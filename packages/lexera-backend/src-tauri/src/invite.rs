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
}

#[derive(Debug, Clone)]
pub struct CreateInviteRequest {
    pub room_id: String,
    pub inviter_id: String,
    pub role: String,
    pub expires_in_hours: Option<u32>,
    pub max_uses: Option<u32>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomJoin {
    pub room_id: String,
    pub room_title: String,
    pub role: String,
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

impl InviteService {
    pub fn new() -> Self {
        Self {
            invites: std::collections::HashMap::new(),
        }
    }

    /// Create a new invite link
    pub fn create_invite(
        &mut self,
        req: CreateInviteRequest,
        room_title: Option<String>,
    ) -> Result<InviteLink, InviteError> {
        // Validate role
        InviteRole::from_str(&req.role).ok_or(InviteError::InvalidRole)?;

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
        let room_title = invite
            .room_title
            .clone()
            .unwrap_or_else(|| "Untitled".to_string());

        // Increment uses
        if let Some(invite_entry) = self.invites.get_mut(token) {
            invite_entry.uses += 1;
        }

        log::info!(
            "[invite] Accepted invite {}... for room {}",
            &token[..8.min(token.len())],
            room_id
        );

        Ok(RoomJoin {
            room_id,
            room_title,
            role,
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
        let json = serde_json::to_string_pretty(&self.invites)
            .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;

        let tmp_path = path.with_extension("tmp");
        std::fs::write(&tmp_path, &json)?;
        std::fs::rename(&tmp_path, path)?;

        log::info!("[invite.save] Saved {} invites to {}", self.invites.len(), path.display());
        Ok(())
    }

    /// Load invite state from a JSON file. Returns empty service if file is missing or corrupt.
    pub fn load_from_file(path: &Path) -> io::Result<Self> {
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                log::info!("[invite.load] No invite file at {}, starting empty", path.display());
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

    #[error("Invalid role")]
    InvalidRole,
}
