/// Public rooms service: manage boards that anyone can join (server mode).

use serde::Serialize;
use thiserror::Error;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize)]
pub struct PublicRoom {
    pub id: String,
    pub title: String,
    pub default_role: String,
    pub max_users: Option<i64>,
    pub member_count: usize,
}

#[derive(Debug, Clone)]
pub struct MakePublicRequest {
    pub room_id: String,
    pub default_role: String,
    pub max_users: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DefaultRole {
    Editor,
    Viewer,
}

impl DefaultRole {
    fn from_str(s: &str) -> Option<Self> {
        match s {
            "editor" => Some(DefaultRole::Editor),
            "viewer" => Some(DefaultRole::Viewer),
            _ => None,
        }
    }
}

/// Configuration for a public room
#[derive(Debug, Clone)]
pub struct PublicRoomConfig {
    pub default_role: String,
    pub max_users: Option<i64>,
    pub created_at: u64,
}

/// In-memory public rooms storage
pub struct PublicRoomService {
    /// room_id -> PublicRoomConfig
    public_rooms: HashMap<String, PublicRoomConfig>,
    /// room_id -> member_count
    member_counts: HashMap<String, usize>,
}

impl PublicRoomService {
    pub fn new() -> Self {
        Self {
            public_rooms: HashMap::new(),
            member_counts: HashMap::new(),
        }
    }

    /// Make a room public (server mode)
    pub fn make_public(&mut self, req: &MakePublicRequest, member_count: usize) -> Result<(), PublicRoomError> {
        DefaultRole::from_str(&req.default_role)
            .ok_or_else(|| PublicRoomError::InvalidRole(req.default_role.clone()))?;

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        let config = PublicRoomConfig {
            default_role: req.default_role.clone(),
            max_users: req.max_users,
            created_at: now,
        };

        self.public_rooms.insert(req.room_id.clone(), config);
        self.member_counts.insert(req.room_id.clone(), member_count);

        log::info!("[public] Made room {} public (role: {})", req.room_id, req.default_role);

        Ok(())
    }

    /// Make a room private
    pub fn make_private(&mut self, room_id: &str) {
        self.public_rooms.remove(room_id);
        self.member_counts.remove(room_id);
        log::info!("[public] Made room {} private", room_id);
    }

    /// List all public rooms
    pub fn list_public_rooms<F>(&self, get_room_title: F) -> Vec<PublicRoom>
    where
        F: Fn(&str) -> Option<String>,
    {
        self.public_rooms
            .iter()
            .map(|(room_id, config)| PublicRoom {
                id: room_id.clone(),
                title: get_room_title(room_id).unwrap_or_else(|| "Untitled".to_string()),
                default_role: config.default_role.clone(),
                max_users: config.max_users,
                member_count: self.member_counts.get(room_id).copied().unwrap_or(0),
            })
            .collect()
    }

    /// Get room settings
    pub fn get_room_settings(&self, room_id: &str) -> Option<PublicRoomConfig> {
        self.public_rooms.get(room_id).cloned()
    }

    /// Update member count by delta
    pub fn update_member_count(&mut self, room_id: &str, delta: i32) {
        let count = self.member_counts.get(room_id).copied().unwrap_or(0);
        let new_count = (count as i32 + delta).max(0) as usize;
        self.member_counts.insert(room_id.to_string(), new_count);
    }

    /// Check if a room is public
    pub fn is_public(&self, room_id: &str) -> bool {
        self.public_rooms.contains_key(room_id)
    }
}

#[derive(Debug, Error)]
pub enum PublicRoomError {
    #[error("Invalid role: {0}")]
    InvalidRole(String),
}
