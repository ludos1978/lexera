/// Configuration for the Lexera Backend.
/// Reads sync.json from ~/.config/lexera/sync.json (or platform equivalent).
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

/// Re-export shared config types from lexera-core.
pub use lexera_core::config::{BoardEntry, IncomingConfig, WorkspaceEntry};

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
        let cfg = state.config.lock().ok();
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

fn canonicalize_board_file(file: &str) -> String {
    let path = PathBuf::from(file);
    fs::canonicalize(&path)
        .unwrap_or(path)
        .to_string_lossy()
        .to_string()
}

fn canonicalize_and_deduplicate_board_entries(config: &mut SyncConfig) -> bool {
    let mut changed = false;

    let original_len = config.boards.len();
    let mut deduped: Vec<BoardEntry> = Vec::with_capacity(original_len);

    for mut entry in std::mem::take(&mut config.boards) {
        let canonical = canonicalize_board_file(&entry.file);
        if entry.file != canonical {
            entry.file = canonical.clone();
            changed = true;
        }

        if let Some(existing) = deduped.iter_mut().find(|b| b.file == canonical) {
            // Merge duplicate entries for the same board file.
            changed = true;
            if existing.name.is_none() && entry.name.is_some() {
                existing.name = entry.name.take();
            }
            for ws_id in entry.workspace_ids {
                if !existing.workspace_ids.contains(&ws_id) {
                    existing.workspace_ids.push(ws_id);
                }
            }
            continue;
        }

        deduped.push(entry);
    }

    if deduped.len() != original_len {
        changed = true;
    }
    config.boards = deduped;
    changed
}

/// Normalize workspace+board configuration so it remains usable:
/// - all board file paths are canonicalized and duplicate board entries are merged
/// - at least one workspace exists
/// - default workspace always points to an existing workspace
/// - every board belongs to at least one existing workspace
pub fn normalize_workspace_setup(config: &mut SyncConfig) -> bool {
    let mut changed = canonicalize_and_deduplicate_board_entries(config);

    // Remove duplicate/invalid workspace IDs.
    let mut seen_workspace_ids: HashSet<String> = HashSet::new();
    config.workspaces.retain(|ws| {
        let id = ws.id.trim();
        let keep = !id.is_empty() && seen_workspace_ids.insert(id.to_string());
        if !keep {
            changed = true;
        }
        keep
    });

    // Create "Default" workspace if no workspaces exist.
    if config.workspaces.is_empty() {
        let id = Uuid::new_v4().to_string();
        config.workspaces.push(WorkspaceEntry {
            id: id.clone(),
            name: "Default".to_string(),
            ..WorkspaceEntry::default()
        });
        config.default_workspace = Some(id);
        changed = true;
        log::info!("[config] Created default workspace");
    }

    // Ensure default_workspace points to an existing workspace.
    let default_is_valid = config
        .default_workspace
        .as_ref()
        .map(|id| config.workspaces.iter().any(|w| w.id == *id))
        .unwrap_or(false);
    if !default_is_valid {
        config.default_workspace = config.workspaces.first().map(|w| w.id.clone());
        changed = true;
    }

    let valid_workspace_ids: HashSet<String> =
        config.workspaces.iter().map(|w| w.id.clone()).collect();
    let fallback_ws_id = config
        .default_workspace
        .clone()
        .or_else(|| config.workspaces.first().map(|w| w.id.clone()));

    // Clean each board's workspace_ids and ensure at least one assignment.
    for board in &mut config.boards {
        let before = board.workspace_ids.clone();
        let mut cleaned: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for ws_id in &before {
            if valid_workspace_ids.contains(ws_id) && seen.insert(ws_id.clone()) {
                cleaned.push(ws_id.clone());
            }
        }
        if cleaned.is_empty() {
            if let Some(ref fallback) = fallback_ws_id {
                cleaned.push(fallback.clone());
            }
        }
        if cleaned != before {
            board.workspace_ids = cleaned;
            changed = true;
        }
    }

    changed
}

/// Ensure a "Default" workspace exists and all boards belong to at least one workspace.
/// Boards with no workspace assignment are placed into the default workspace.
pub fn ensure_default_workspace(config: &mut SyncConfig, config_path: &PathBuf) {
    let changed = normalize_workspace_setup(config);

    if changed {
        if let Err(e) = save_config(config_path, config) {
            log::error!("Failed to save config after workspace migration: {}", e);
        }
    }
}

/// Save config to path. Creates parent dirs if needed.
pub fn save_config(path: &PathBuf, config: &SyncConfig) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(config).map_err(std::io::Error::other)?;
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

    // --- normalize_workspace_setup ---

    #[test]
    fn normalize_workspace_setup_creates_default_and_assigns_board() {
        let mut cfg = SyncConfig {
            boards: vec![BoardEntry {
                file: "board.md".to_string(),
                name: None,
                workspace_ids: Vec::new(),
                ..BoardEntry::default()
            }],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.workspaces.len(), 1);
        let default_ws = cfg.default_workspace.clone().unwrap();
        assert_eq!(cfg.boards[0].workspace_ids, vec![default_ws]);
    }

    #[test]
    fn normalize_workspace_setup_removes_invalid_workspace_refs() {
        let ws_id = "ws-1".to_string();
        let mut cfg = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: ws_id.clone(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            default_workspace: None,
            boards: vec![BoardEntry {
                file: "board.md".to_string(),
                name: None,
                workspace_ids: vec!["missing".to_string(), ws_id.clone(), ws_id.clone()],
                ..BoardEntry::default()
            }],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.default_workspace, Some(ws_id.clone()));
        assert_eq!(cfg.boards[0].workspace_ids, vec![ws_id]);
    }

    #[test]
    fn normalize_workspace_setup_canonicalizes_and_deduplicates_boards() {
        let dir = tempdir().unwrap();
        let board_path = dir.path().join("board.md");
        fs::write(&board_path, "---\nkanban-plugin: board\n---\n").unwrap();

        let canonical = fs::canonicalize(&board_path).unwrap();
        let non_canonical = dir.path().join(".").join("board.md");

        let ws_a = "ws-a".to_string();
        let ws_b = "ws-b".to_string();
        let mut cfg = SyncConfig {
            workspaces: vec![
                WorkspaceEntry {
                    id: ws_a.clone(),
                    name: "A".to_string(),
                    ..WorkspaceEntry::default()
                },
                WorkspaceEntry {
                    id: ws_b.clone(),
                    name: "B".to_string(),
                    ..WorkspaceEntry::default()
                },
            ],
            default_workspace: Some(ws_a.clone()),
            boards: vec![
                BoardEntry {
                    file: non_canonical.to_string_lossy().to_string(),
                    name: None,
                    workspace_ids: vec![ws_a.clone()],
                    ..BoardEntry::default()
                },
                BoardEntry {
                    file: canonical.to_string_lossy().to_string(),
                    name: Some("Board".to_string()),
                    workspace_ids: vec![ws_b.clone()],
                    ..BoardEntry::default()
                },
            ],
            ..SyncConfig::default()
        };

        let changed = normalize_workspace_setup(&mut cfg);
        assert!(changed);
        assert_eq!(cfg.boards.len(), 1);
        assert_eq!(cfg.boards[0].file, canonical.to_string_lossy().to_string());
        assert!(cfg.boards[0].workspace_ids.contains(&ws_a));
        assert!(cfg.boards[0].workspace_ids.contains(&ws_b));
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
            }),
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
        assert!(cfg.remote_connections.is_empty());
    }
}
