/// Configuration for the Lexera Backend.
/// Reads sync.json from ~/.config/lexera/sync.json (or platform equivalent).
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

mod identity;
mod workspace_setup;

/// Re-export shared config types from lexera-core.
pub use lexera_core::config::{BoardEntry, IncomingConfig, WorkspaceEntry};

pub use identity::{load_or_create_identity, persist_identity};
pub use workspace_setup::{ensure_default_workspace, normalize_workspace_setup};

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
pub struct RemoteConnectionEntry {
    #[serde(alias = "localBoardId")]
    pub local_board_id: String,
    #[serde(alias = "remoteBoardId")]
    pub remote_board_id: String,
    #[serde(alias = "serverUrl")]
    pub server_url: String,
    #[serde(default, alias = "inviteToken")]
    pub invite_token: Option<String>,
    #[serde(default = "default_remote_connection_enabled")]
    pub enabled: bool,
    /// Bearer token for authenticating with the remote server.
    #[serde(default)]
    pub auth_token: Option<String>,
}

fn default_remote_connection_enabled() -> bool {
    true
}

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
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceEntry>,
    #[serde(default)]
    pub default_workspace: Option<String>,
    #[serde(default, alias = "remoteConnections")]
    pub remote_connections: Vec<RemoteConnectionEntry>,
    #[serde(default, alias = "renderApps")]
    pub render_apps: Option<RenderAppsConfig>,
    /// Global default for bookmark sync (overridden per-workspace or per-board).
    #[serde(
        default,
        alias = "bookmarkSync",
        skip_serializing_if = "Option::is_none"
    )]
    pub bookmark_sync: Option<bool>,
    /// Global default for calendar sync (overridden per-workspace or per-board).
    #[serde(
        default,
        alias = "calendarSync",
        skip_serializing_if = "Option::is_none"
    )]
    pub calendar_sync: Option<bool>,
    /// Global default calendar slug (overridden per-workspace or per-board).
    #[serde(
        default,
        alias = "calendarSlug",
        skip_serializing_if = "Option::is_none"
    )]
    pub calendar_slug: Option<String>,
    /// Global default calendar display name (overridden per-workspace or per-board).
    #[serde(
        default,
        alias = "calendarName",
        skip_serializing_if = "Option::is_none"
    )]
    pub calendar_name: Option<String>,
    /// Global default dashboard tag list (overridden per-workspace or per-board).
    #[serde(
        default,
        alias = "dashboardTags",
        skip_serializing_if = "Option::is_none"
    )]
    pub dashboard_tags: Option<Vec<String>>,
    /// Global default frontend settings (columnWidth, tagVisibility, theme, etc.).
    /// Overridden per-workspace via workspaces[].settings, per-board via board YAML.
    #[serde(
        default,
        alias = "defaultSettings",
        skip_serializing_if = "Option::is_none"
    )]
    pub default_settings: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RenderAppsConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drawio: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marp: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pandoc: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub soffice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pdftoppm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mutool: Option<String>,
    /// Custom Marp engine.js path. When set, overrides the bundled
    /// packages/marp-engine/engine/engine.js used by Marp CLI exports.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marp_engine_path: Option<String>,
    /// Directory passed to Marp CLI via `--theme-set` so custom theme
    /// CSS files (templates) are discovered for every export.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub marp_templates_path: Option<String>,
}

fn default_port() -> u16 {
    DEFAULT_PORT
}

fn default_bind_address() -> String {
    DEFAULT_BIND_ADDRESS.to_string()
}

fn backend_host_for_bind(bind_address: &str) -> String {
    if bind_address == "0.0.0.0" {
        DEFAULT_BIND_ADDRESS.to_string()
    } else {
        bind_address.to_string()
    }
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            port: default_port(),
            bind_address: default_bind_address(),
            boards: Vec::new(),
            incoming: None,
            templates_path: None,
            theme: None,
            workspaces: Vec::new(),
            default_workspace: None,
            remote_connections: Vec::new(),
            render_apps: None,
            bookmark_sync: None,
            calendar_sync: None,
            calendar_slug: None,
            calendar_name: None,
            dashboard_tags: None,
            default_settings: None,
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
pub fn get_backend_url(app: AppHandle) -> Result<String, String> {
    if let Some(state) = app.try_state::<AppState>() {
        let cfg = state.config.read().ok();
        let bind_address = cfg
            .as_ref()
            .map(|guard| guard.bind_address.clone())
            .unwrap_or_else(|| state.bind_address.clone());
        let configured_port = cfg.as_ref().map(|guard| guard.port).unwrap_or(state.port);
        let live_port = state
            .live_port
            .lock()
            .map(|guard| *guard)
            .unwrap_or(configured_port);
        return Ok(format!(
            "http://{}:{}",
            backend_host_for_bind(&bind_address),
            live_port
        ));
    }

    let config = load_config(&default_config_path());
    Ok(format!(
        "http://{}:{}",
        backend_host_for_bind(&config.bind_address),
        config.port
    ))
}

#[tauri::command]
pub async fn browse_files(
    title: Option<String>,
    extensions: Option<Vec<String>>,
    multiple: Option<bool>,
) -> Result<Vec<String>, String> {
    let mut builder = rfd::AsyncFileDialog::new();
    if let Some(title) = &title {
        builder = builder.set_title(title);
    }
    if let Some(extensions) = &extensions {
        let extension_refs: Vec<&str> = extensions
            .iter()
            .map(|extension| extension.as_str())
            .collect();
        builder = builder.add_filter("Files", &extension_refs);
    }
    let paths = if multiple.unwrap_or(false) {
        builder
            .pick_files()
            .await
            .unwrap_or_default()
            .into_iter()
            .map(|file| file.path().to_string_lossy().to_string())
            .collect()
    } else {
        match builder.pick_file().await {
            Some(file) => vec![file.path().to_string_lossy().to_string()],
            None => vec![],
        }
    };
    Ok(paths)
}

/// Default config path: ~/.config/lexera/sync.json
pub fn default_config_path() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(CONFIG_DIR_NAME)
        .join(SYNC_CONFIG_FILENAME)
}

/// Load config from path. Returns default if file doesn't exist.
/// Migrates the legacy `workspace_id` field to `workspace_ids` on each board.
pub fn load_config(path: &PathBuf) -> SyncConfig {
    match fs::read_to_string(path) {
        Ok(content) => {
            let raw: Option<serde_json::Value> = serde_json::from_str(&content).ok();
            let mut cfg: SyncConfig = serde_json::from_str(&content).unwrap_or_else(|e| {
                log::warn!("Failed to parse config {}: {}", path.display(), e);
                SyncConfig::default()
            });
            // Migrate legacy workspace_id → workspace_ids per board
            if let Some(serde_json::Value::Array(raw_boards)) =
                raw.as_ref().and_then(|v| v.get("boards").cloned())
            {
                for (entry, raw_board) in cfg.boards.iter_mut().zip(raw_boards.iter()) {
                    lexera_core::config::migrate_board_entry_workspace(entry, raw_board);
                }
            }
            cfg
        }
        Err(_) => {
            log::info!("No config at {}, using defaults", path.display());
            SyncConfig::default()
        }
    }
}

/// Save config to path atomically. Creates parent dirs if needed.
///
/// Durability sequence: write JSON to `<path>.tmp` -> fsync the tmp file ->
/// rename to `<path>` -> fsync the parent directory. A crash at any point
/// leaves either the previous valid `sync.json` or no change at all; the
/// target file is never observed half-written. The directory fsync ensures
/// the rename is durable across power loss on POSIX filesystems; on Windows
/// the directory-open step is a no-op (best effort) and rename is already
/// atomic on NTFS via the same-volume MoveFileEx semantics.
pub fn save_config(path: &PathBuf, config: &SyncConfig) -> Result<(), std::io::Error> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config).map_err(std::io::Error::other)?;

    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    let tmp_path = {
        let mut p = path.clone();
        let mut name = path
            .file_name()
            .map(|s| s.to_owned())
            .unwrap_or_else(|| std::ffi::OsString::from("sync.json"));
        name.push(".tmp");
        p.set_file_name(name);
        p
    };

    // Best-effort cleanup of any stale temp from a previous crash so we
    // never attempt to truncate over a file with funky permissions.
    let _ = fs::remove_file(&tmp_path);

    {
        let mut tmp_file = fs::File::create(&tmp_path)?;
        tmp_file.write_all(json.as_bytes())?;
        tmp_file.sync_all()?;
    }

    if let Err(rename_err) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(rename_err);
    }

    // Parent-directory fsync makes the rename durable. fs::File::open on a
    // directory works on Unix; on Windows it errors with PermissionDenied,
    // which we swallow because NTFS doesn't expose a portable equivalent.
    if let Ok(dir_file) = fs::File::open(parent) {
        let _ = dir_file.sync_all();
    }

    Ok(())
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
                workspace_ids: Vec::new(),
                ..BoardEntry::default()
            }],
            incoming: Some(IncomingConfig {
                board: "inbox.md".to_string(),
                column: 2,
            }),
            templates_path: Some("/tpl".to_string()),
            theme: None,
            workspaces: Vec::new(),
            default_workspace: None,
            remote_connections: Vec::new(),
            render_apps: None,
            bookmark_sync: None,
            calendar_sync: None,
            calendar_slug: None,
            calendar_name: None,
            dashboard_tags: None,
            default_settings: None,
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

    #[test]
    fn save_config_uses_atomic_tmp_rename_and_leaves_no_residue() {
        // Durability contract: save_config must write through a `.tmp`
        // sibling, fsync it, then rename onto the target so a mid-write
        // crash can't leave sync.json half-written. After success no
        // `.tmp` residue is left behind.
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        let tmp_path = dir.path().join("sync.json.tmp");

        let cfg = SyncConfig {
            port: 8080,
            ..SyncConfig::default()
        };
        save_config(&path.to_path_buf(), &cfg).unwrap();

        assert!(path.exists(), "target file must exist after save");
        assert!(
            !tmp_path.exists(),
            "tmp sibling must be cleaned up after successful rename"
        );

        // Content must be intact valid JSON — no partial-write residue.
        let parsed: SyncConfig =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed.port, 8080);
    }

    #[test]
    fn save_config_overwrites_existing_in_place_with_valid_content() {
        // Two consecutive saves: the second must atomically replace the
        // first without leaving a `.tmp` and without ever exposing an
        // intermediate truncated state. The rename is the only mutation
        // visible on the target inode.
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");

        let v1 = SyncConfig {
            port: 1001,
            ..SyncConfig::default()
        };
        save_config(&path.to_path_buf(), &v1).unwrap();

        let v2 = SyncConfig {
            port: 2002,
            ..SyncConfig::default()
        };
        save_config(&path.to_path_buf(), &v2).unwrap();

        assert!(!dir.path().join("sync.json.tmp").exists());
        let parsed: SyncConfig =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed.port, 2002, "second save must replace first");
    }

    #[test]
    fn save_config_recovers_when_stale_tmp_exists() {
        // A crash during a previous save can leave a stale .tmp file.
        // save_config must not fail — it should overwrite the stale tmp
        // and complete the rename normally.
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        let tmp_path = dir.path().join("sync.json.tmp");
        fs::write(&tmp_path, "STALE GARBAGE FROM PRIOR CRASH").unwrap();

        let cfg = SyncConfig {
            port: 7777,
            ..SyncConfig::default()
        };
        save_config(&path.to_path_buf(), &cfg).unwrap();

        assert!(path.exists());
        assert!(
            !tmp_path.exists(),
            "stale tmp must be replaced and renamed away, not left behind"
        );
        let parsed: SyncConfig =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(parsed.port, 7777);
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
                    workspace_ids: Vec::new(),
                    ..BoardEntry::default()
                },
                BoardEntry {
                    file: "b.md".to_string(),
                    name: Some("B".to_string()),
                    workspace_ids: Vec::new(),
                    ..BoardEntry::default()
                },
            ],
            incoming: Some(IncomingConfig {
                board: "inbox.md".to_string(),
                column: 0,
            }),
            templates_path: Some("/my/templates".to_string()),
            theme: Some("nord".to_string()),
            workspaces: vec![WorkspaceEntry {
                id: "ws-main".to_string(),
                name: "Main".to_string(),
                bookmark_sync: Some(false),
                calendar_sync: Some(true),
                calendar_slug: Some("team".to_string()),
                calendar_name: Some("Team Calendar".to_string()),
                dashboard_tags: None,
                settings: None,
            }],
            default_workspace: Some("ws-main".to_string()),
            remote_connections: vec![RemoteConnectionEntry {
                local_board_id: "remote-abc123".to_string(),
                remote_board_id: "abc123".to_string(),
                server_url: "http://192.168.1.50:13080".to_string(),
                invite_token: Some("token-xyz".to_string()),
                enabled: true,
                auth_token: Some("bearer-abc".to_string()),
            }],
            render_apps: Some(RenderAppsConfig {
                drawio: Some("/usr/local/bin/drawio".to_string()),
                marp: Some("npx".to_string()),
                pandoc: None,
                soffice: None,
                pdftoppm: None,
                mutool: None,
                marp_engine_path: None,
                marp_templates_path: None,
            }),
            bookmark_sync: None,
            calendar_sync: None,
            calendar_slug: None,
            calendar_name: None,
            dashboard_tags: None,
            default_settings: None,
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
        assert_eq!(loaded.theme, Some("nord".to_string()));
        assert_eq!(loaded.workspaces.len(), 1);
        assert_eq!(loaded.workspaces[0].bookmark_sync, Some(false));
        assert_eq!(loaded.workspaces[0].calendar_sync, Some(true));
        assert_eq!(loaded.workspaces[0].calendar_slug.as_deref(), Some("team"));
        assert_eq!(
            loaded.workspaces[0].calendar_name.as_deref(),
            Some("Team Calendar")
        );
        assert_eq!(loaded.default_workspace.as_deref(), Some("ws-main"));
        assert_eq!(loaded.remote_connections.len(), 1);
        assert_eq!(
            loaded.remote_connections[0].remote_board_id,
            "abc123".to_string()
        );
        assert_eq!(
            loaded.remote_connections[0].auth_token.as_deref(),
            Some("bearer-abc")
        );
        assert!(loaded.render_apps.is_some());
        let ra = loaded.render_apps.unwrap();
        assert_eq!(ra.drawio.as_deref(), Some("/usr/local/bin/drawio"));
        assert_eq!(ra.marp.as_deref(), Some("npx"));
        assert!(ra.pandoc.is_none());
    }

    #[test]
    fn remote_connection_auth_token_defaults_to_none() {
        // Backwards compat: old config files without auth_token should load fine
        let dir = tempdir().unwrap();
        let path = dir.path().join("sync.json");
        let json = r#"{
            "remote_connections": [{
                "local_board_id": "remote-xyz",
                "remote_board_id": "xyz",
                "server_url": "http://192.168.1.10:13080",
                "invite_token": "tok-1",
                "enabled": true
            }]
        }"#;
        fs::write(&path, json).unwrap();
        let cfg = load_config(&path.to_path_buf());
        assert_eq!(cfg.remote_connections.len(), 1);
        assert!(
            cfg.remote_connections[0].auth_token.is_none(),
            "auth_token should default to None for old config files"
        );
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
        assert!(cfg.remote_connections.is_empty());
    }
}
