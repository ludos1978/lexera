/// Configuration for the Lexera Backend.
/// Reads sync.json from ~/.config/lexera/sync.json (or platform equivalent).

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub boards: Vec<BoardEntry>,
    #[serde(default)]
    pub incoming: Option<IncomingConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingConfig {
    pub board: String,
    #[serde(default)]
    pub column: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoardEntry {
    pub file: String,
    #[serde(default)]
    pub name: Option<String>,
}

fn default_port() -> u16 {
    8080
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            boards: Vec::new(),
            incoming: None,
        }
    }
}

/// Default config path: ~/.config/lexera/sync.json
pub fn default_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lexera")
        .join("sync.json")
}

/// Load config from path. Returns default if file doesn't exist.
pub fn load_config(path: &PathBuf) -> SyncConfig {
    match fs::read_to_string(path) {
        Ok(content) => serde_json::from_str(&content).unwrap_or_else(|e| {
            log::warn!("Failed to parse config {}: {}", path.display(), e);
            SyncConfig::default()
        }),
        Err(_) => {
            log::info!("No config at {}, using defaults", path.display());
            SyncConfig::default()
        }
    }
}
