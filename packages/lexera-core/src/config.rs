/// Shared configuration types used by both desktop backend and iOS app.
use serde::{Deserialize, Serialize};

/// A workspace: a named group of boards.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
}

/// A board entry in the config file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardEntry {
    pub file: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
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
