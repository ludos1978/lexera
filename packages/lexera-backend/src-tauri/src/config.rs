/// Configuration for the Lexera Backend.
/// Reads sync.json from ~/.config/lexera/sync.json (or platform equivalent).
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// Re-export shared config types from lexera-core.
pub use lexera_core::config::{BoardEntry, IncomingConfig};

/// Default HTTP server port for the backend.
pub const DEFAULT_PORT: u16 = 13080;
/// Default network interface to bind to (localhost only).
pub const DEFAULT_BIND_ADDRESS: &str = "127.0.0.1";
/// Config directory name under the platform config root.
pub const CONFIG_DIR_NAME: &str = "lexera";
/// Main sync configuration filename.
pub const SYNC_CONFIG_FILENAME: &str = "sync.json";
/// Local user identity filename.
pub const IDENTITY_FILENAME: &str = "identity.json";
/// Templates subdirectory name inside the config directory.
pub const TEMPLATES_DIR_NAME: &str = "templates";
/// Collaboration service persistence subdirectory.
pub const COLLAB_DIR_NAME: &str = "collab";

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
    #[serde(default)]
    pub templates_path: Option<String>,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_bind_address() -> String {
    DEFAULT_BIND_ADDRESS.to_string()
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            bind_address: default_bind_address(),
            boards: Vec::new(),
            incoming: None,
            templates_path: None,
        }
    }
}

/// Resolve the templates directory path.
/// Uses config value if set, otherwise defaults to ~/.config/lexera/templates/
pub fn resolve_templates_path(config_value: &Option<String>) -> PathBuf {
    if let Some(ref p) = config_value {
        PathBuf::from(p)
    } else {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(CONFIG_DIR_NAME)
            .join(TEMPLATES_DIR_NAME)
    }
}

/// Tauri command: return the backend's own URL from the config file.
/// Used by backend webviews (quick-capture, connection-settings) to find the local server.
#[tauri::command]
pub fn get_backend_url() -> Result<String, String> {
    let config = load_config(&default_config_path());
    let host = if config.bind_address == "0.0.0.0" {
        DEFAULT_BIND_ADDRESS.to_string()
    } else {
        config.bind_address
    };
    Ok(format!("http://{}:{}", host, config.port))
}

/// Default config path: ~/.config/lexera/sync.json
pub fn default_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR_NAME)
        .join(SYNC_CONFIG_FILENAME)
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
        .join(CONFIG_DIR_NAME)
        .join(IDENTITY_FILENAME);

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

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    // --- resolve_templates_path ---

    #[test]
    fn resolve_templates_path_with_custom_value() {
        let custom = Some("/my/custom/templates".to_string());
        let result = resolve_templates_path(&custom);
        assert_eq!(result, PathBuf::from("/my/custom/templates"));
    }

    #[test]
    fn resolve_templates_path_with_none_falls_back_to_default() {
        let result = resolve_templates_path(&None);
        // Should end with lexera/templates regardless of the platform config dir
        assert!(
            result.ends_with("lexera/templates"),
            "Expected path ending with lexera/templates, got: {}",
            result.display()
        );
    }

    // --- load_config ---

    #[test]
    fn load_config_with_valid_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        let json = r#"{
            "port": 9999,
            "bind_address": "0.0.0.0",
            "boards": [{"file": "board.md"}],
            "templates_path": "/tpl"
        }"#;
        fs::write(&path, json).unwrap();

        let cfg = load_config(&path.to_path_buf());
        assert_eq!(cfg.port, 9999);
        assert_eq!(cfg.bind_address, "0.0.0.0");
        assert_eq!(cfg.boards.len(), 1);
        assert_eq!(cfg.boards[0].file, "board.md");
        assert_eq!(cfg.templates_path, Some("/tpl".to_string()));
        assert!(cfg.incoming.is_none());
    }

    #[test]
    fn load_config_with_invalid_json_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        fs::write(&path, "NOT VALID JSON!!!").unwrap();

        let cfg = load_config(&path.to_path_buf());
        assert_eq!(cfg.port, 13080);
        assert_eq!(cfg.bind_address, "127.0.0.1");
        assert!(cfg.boards.is_empty());
    }

    #[test]
    fn load_config_missing_file_returns_default() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nonexistent.json");

        let cfg = load_config(&path.to_path_buf());
        assert_eq!(cfg.port, 13080);
        assert_eq!(cfg.bind_address, "127.0.0.1");
        assert!(cfg.boards.is_empty());
    }

    #[test]
    fn load_config_partial_json_fills_defaults() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        // Only port is specified; other fields should get defaults
        fs::write(&path, r#"{"port": 5555}"#).unwrap();

        let cfg = load_config(&path.to_path_buf());
        assert_eq!(cfg.port, 5555);
        assert_eq!(cfg.bind_address, "127.0.0.1");
        assert!(cfg.boards.is_empty());
        assert!(cfg.incoming.is_none());
        assert!(cfg.templates_path.is_none());
    }

    // --- save_config ---

    #[test]
    fn save_config_creates_parent_dirs_and_writes_valid_json() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("nested").join("deep").join("sync.json");

        let cfg = SyncConfig {
            port: 8080,
            bind_address: "192.168.1.1".to_string(),
            boards: vec![BoardEntry {
                file: "test.md".to_string(),
                name: Some("Test Board".to_string()),
            }],
            incoming: Some(IncomingConfig {
                board: "inbox.md".to_string(),
                column: 2,
            }),
            templates_path: Some("/tpl".to_string()),
        };

        save_config(&path.to_path_buf(), &cfg).unwrap();

        // File must exist and contain valid JSON
        let content = fs::read_to_string(&path).unwrap();
        let parsed: SyncConfig = serde_json::from_str(&content).unwrap();
        assert_eq!(parsed.port, 8080);
        assert_eq!(parsed.bind_address, "192.168.1.1");
        assert_eq!(parsed.boards.len(), 1);
        assert_eq!(parsed.boards[0].file, "test.md");
        assert!(parsed.incoming.is_some());
        assert_eq!(parsed.incoming.unwrap().column, 2);
    }

    // --- Config round-trip ---

    #[test]
    fn config_round_trip_preserves_data() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("roundtrip.json");

        let original = SyncConfig {
            port: 12345,
            bind_address: "10.0.0.1".to_string(),
            boards: vec![
                BoardEntry {
                    file: "a.md".to_string(),
                    name: None,
                },
                BoardEntry {
                    file: "b.md".to_string(),
                    name: Some("B".to_string()),
                },
            ],
            incoming: Some(IncomingConfig {
                board: "inbox.md".to_string(),
                column: 0,
            }),
            templates_path: Some("/my/templates".to_string()),
        };

        save_config(&path.to_path_buf(), &original).unwrap();
        let loaded = load_config(&path.to_path_buf());

        assert_eq!(loaded.port, original.port);
        assert_eq!(loaded.bind_address, original.bind_address);
        assert_eq!(loaded.boards.len(), original.boards.len());
        assert_eq!(loaded.boards[0].file, "a.md");
        assert_eq!(loaded.boards[1].name, Some("B".to_string()));
        assert_eq!(loaded.templates_path, original.templates_path);
        assert!(loaded.incoming.is_some());
        assert_eq!(loaded.incoming.as_ref().unwrap().board, "inbox.md");
        assert_eq!(loaded.incoming.as_ref().unwrap().column, 0);
    }

    // --- Identity persistence ---

    #[test]
    fn persist_identity_creates_file_and_preserves_on_reload() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("sub").join("identity.json");

        let user = crate::auth::User {
            id: "test-uuid-1234".to_string(),
            name: "Alice".to_string(),
            email: Some("alice@example.com".to_string()),
        };

        // First write
        persist_identity(&path.to_path_buf(), &user);
        assert!(path.exists(), "Identity file should have been created");

        // Read back
        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, "test-uuid-1234");
        assert_eq!(loaded.name, "Alice");
        assert_eq!(loaded.email, Some("alice@example.com".to_string()));
    }

    #[test]
    fn persist_identity_overwrites_existing() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("identity.json");

        let user1 = crate::auth::User {
            id: "id-1".to_string(),
            name: "First".to_string(),
            email: None,
        };
        persist_identity(&path.to_path_buf(), &user1);

        let user2 = crate::auth::User {
            id: "id-2".to_string(),
            name: "Second".to_string(),
            email: Some("second@test.com".to_string()),
        };
        persist_identity(&path.to_path_buf(), &user2);

        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, "id-2");
        assert_eq!(loaded.name, "Second");
    }

    #[test]
    fn create_and_persist_identity_generates_uuid() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("identity.json");

        let user = create_and_persist_identity(&path.to_path_buf());

        // Must be a valid UUID v4
        assert!(
            Uuid::parse_str(&user.id).is_ok(),
            "Identity id should be a valid UUID, got: {}",
            user.id
        );
        // Name should come from os_username helper
        assert!(!user.name.is_empty());
        assert!(user.email.is_none());

        // File should exist on disk with the same data
        let content = fs::read_to_string(&path).unwrap();
        let loaded: crate::auth::User = serde_json::from_str(&content).unwrap();
        assert_eq!(loaded.id, user.id);
    }

    // --- SyncConfig default values ---

    #[test]
    fn sync_config_default_values() {
        let cfg = SyncConfig::default();
        assert_eq!(cfg.port, 13080);
        assert_eq!(cfg.bind_address, "127.0.0.1");
        assert!(cfg.boards.is_empty());
        assert!(cfg.incoming.is_none());
        assert!(cfg.templates_path.is_none());
    }
}
