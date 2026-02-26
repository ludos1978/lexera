/// Configuration for the Lexera Backend.
/// Reads sync.json from ~/.config/lexera/sync.json (or platform equivalent).
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_bind_address")]
    pub bind_address: String,
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

fn default_bind_address() -> String {
    "127.0.0.1".to_string()
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            bind_address: default_bind_address(),
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

/// Save config to path. Creates parent dirs if needed.
pub fn save_config(path: &PathBuf, config: &SyncConfig) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
    fs::write(path, json)
}

/// Load local identity from ~/.config/lexera/identity.json.
/// Creates the file with a new UUID on first run.
pub fn load_or_create_identity() -> crate::auth::User {
    let path = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("lexera")
        .join("identity.json");

    match fs::read_to_string(&path) {
        Ok(content) => match serde_json::from_str::<crate::auth::User>(&content) {
            Ok(user) => {
                log::info!("[identity] Loaded identity: {} ({})", user.name, user.id);
                user
            }
            Err(e) => {
                log::warn!(
                    "[identity] Corrupt identity file at {}: {}",
                    path.display(),
                    e
                );
                backup_corrupt_identity(&path);
                create_and_persist_identity(&path)
            }
        },
        Err(e) => {
            log::info!(
                "[identity] No readable identity at {} ({}), creating one",
                path.display(),
                e
            );
            create_and_persist_identity(&path)
        }
    }
}

fn os_username() -> String {
    std::env::var("USER")
        .or_else(|_| std::env::var("USERNAME"))
        .unwrap_or_else(|_| "Local User".into())
}

fn create_and_persist_identity(path: &PathBuf) -> crate::auth::User {
    let user = crate::auth::User {
        id: Uuid::new_v4().to_string(),
        name: os_username(),
        email: None,
    };
    persist_identity(path, &user);
    log::info!(
        "[identity] Created new identity: {} ({})",
        user.name,
        user.id
    );
    user
}

pub fn persist_identity(path: &PathBuf, user: &crate::auth::User) {
    if let Some(parent) = path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            log::warn!(
                "[identity] Failed to create directory {}: {}",
                parent.display(),
                e
            );
            return;
        }
    }
    match serde_json::to_string_pretty(user) {
        Ok(json) => {
            if let Err(e) = fs::write(path, &json) {
                log::warn!("[identity] Failed to write {}: {}", path.display(), e);
            }
        }
        Err(e) => {
            log::warn!(
                "[identity] Failed to serialize identity for {}: {}",
                path.display(),
                e
            );
        }
    }
}

fn backup_corrupt_identity(path: &PathBuf) {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup = path.with_extension(format!("corrupt-{}.json", ts));
    if let Err(e) = fs::rename(path, &backup) {
        log::warn!(
            "[identity] Failed to backup corrupt identity {} -> {}: {}",
            path.display(),
            backup.display(),
            e
        );
    } else {
        log::warn!(
            "[identity] Backed up corrupt identity to {}",
            backup.display()
        );
    }
}
