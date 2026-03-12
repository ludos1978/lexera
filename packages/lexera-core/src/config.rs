/// Shared configuration types used by both desktop backend and iOS app.
use serde::{Deserialize, Serialize};

/// A workspace: a named group of boards.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    #[serde(default, alias = "bookmarkSync", skip_serializing_if = "Option::is_none")]
    pub bookmark_sync: Option<bool>,
    #[serde(default, alias = "calendarSync", skip_serializing_if = "Option::is_none")]
    pub calendar_sync: Option<bool>,
    #[serde(default, alias = "calendarSlug", skip_serializing_if = "Option::is_none")]
    pub calendar_slug: Option<String>,
    #[serde(default, alias = "calendarName", skip_serializing_if = "Option::is_none")]
    pub calendar_name: Option<String>,
}

/// A board entry in the config file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct BoardEntry {
    pub file: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, alias = "xbelName", skip_serializing_if = "Option::is_none")]
    pub xbel_name: Option<String>,
    #[serde(default, alias = "bookmarkSync", skip_serializing_if = "Option::is_none")]
    pub bookmark_sync: Option<bool>,
    #[serde(default, alias = "calendarSync", skip_serializing_if = "Option::is_none")]
    pub calendar_sync: Option<bool>,
    #[serde(default, alias = "calendarSlug", skip_serializing_if = "Option::is_none")]
    pub calendar_slug: Option<String>,
    #[serde(default, alias = "calendarName", skip_serializing_if = "Option::is_none")]
    pub calendar_name: Option<String>,
    /// Workspaces this board belongs to.  Backwards-compatible: reads the old
    /// single `workspace_id` field and promotes it into `workspace_ids`.
    #[serde(
        default,
        deserialize_with = "deserialize_workspace_ids",
        skip_serializing_if = "Vec::is_empty"
    )]
    pub workspace_ids: Vec<String>,
}

/// Deserialize `workspace_ids` with backwards compatibility for the old
/// `workspace_id: Option<String>` single-value field.
fn deserialize_workspace_ids<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<String>),
        One(String),
    }

    match Option::<OneOrMany>::deserialize(deserializer)? {
        Some(OneOrMany::Many(v)) => Ok(v),
        Some(OneOrMany::One(s)) => {
            if s.is_empty() {
                Ok(Vec::new())
            } else {
                Ok(vec![s])
            }
        }
        None => Ok(Vec::new()),
    }
}

/// Helper used during config loading to migrate the legacy single
/// `workspace_id` field into the new `workspace_ids` vec.
pub fn migrate_board_entry_workspace(entry: &mut BoardEntry, raw: &serde_json::Value) {
    if entry.workspace_ids.is_empty() {
        if let Some(ws) = raw.get("workspace_id").and_then(|v| v.as_str()) {
            if !ws.is_empty() {
                entry.workspace_ids = vec![ws.to_string()];
            }
        }
    }
}

/// Configuration for the incoming capture target (which board/column receives new captures).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingConfig {
    pub board: String,
    #[serde(default)]
    pub column: usize,
}

/// User identity (shared format between desktop and iOS).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserIdentity {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub email: Option<String>,
}
