use crate::config::{LudosSyncModuleConfig, SyncConfig};
use crate::state::AppState;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tokio::process::{Child, Command};

const STATUS_POLL_ATTEMPTS: usize = 24;
const STATUS_POLL_DELAY_MS: u64 = 250;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LudosSyncRuntimeStatus {
    pub enabled: bool,
    pub running: bool,
    pub configured_port: u16,
    pub actual_port: Option<u16>,
    pub bookmarks_enabled: bool,
    pub calendar_enabled: bool,
    pub generated_config_path: String,
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

pub struct LudosSyncManager {
    child: Option<Child>,
    actual_port: Option<u16>,
    last_error: Option<String>,
    generated_config_path: PathBuf,
    last_config_json: Option<String>,
}

impl LudosSyncManager {
    pub fn new(generated_config_path: PathBuf) -> Self {
        Self {
            child: None,
            actual_port: None,
            last_error: None,
            generated_config_path,
            last_config_json: None,
        }
    }

    pub fn status(&mut self, config: &SyncConfig) -> LudosSyncRuntimeStatus {
        self.refresh_child_state();
        LudosSyncRuntimeStatus {
            enabled: config.ludos_sync.enabled,
            running: self.child.is_some(),
            configured_port: config.ludos_sync.port,
            actual_port: self.actual_port,
            bookmarks_enabled: config.ludos_sync.bookmarks_enabled,
            calendar_enabled: config.ludos_sync.calendar_enabled,
            generated_config_path: self.generated_config_path.to_string_lossy().to_string(),
            pid: self.child.as_ref().and_then(|child| child.id()),
            last_error: self.last_error.clone(),
        }
    }

    pub async fn reconcile(&mut self, config: &SyncConfig) -> Result<(), String> {
        self.refresh_child_state();
        if !config.ludos_sync.enabled
            || (!config.ludos_sync.bookmarks_enabled && !config.ludos_sync.calendar_enabled)
        {
            self.stop().await?;
            self.last_config_json = None;
            self.last_error = None;
            return Ok(());
        }

        let generated = generated_config_json(config)?;
        let generated_string = serde_json::to_string_pretty(&generated)
            .map_err(|e| format!("Failed to serialize ludos-sync config: {}", e))?;

        let needs_restart = self.child.is_none()
            || self.last_config_json.as_deref() != Some(generated_string.as_str())
            || self.actual_port != Some(config.ludos_sync.port);

        if !needs_restart {
            return Ok(());
        }

        self.stop().await?;
        write_generated_config(&self.generated_config_path, &generated_string)?;
        self.start(config.ludos_sync.clone(), generated_string).await
    }

    pub async fn restart(&mut self, config: &SyncConfig) -> Result<(), String> {
        self.last_config_json = None;
        self.reconcile(config).await
    }

    pub async fn stop(&mut self) -> Result<(), String> {
        self.actual_port = None;
        if let Some(mut child) = self.child.take() {
            if let Err(e) = child.kill().await {
                self.last_error = Some(format!("Failed to stop ludos-sync: {}", e));
                return Err(self.last_error.clone().unwrap_or_default());
            }
            let _ = child.wait().await;
        }
        Ok(())
    }

    fn refresh_child_state(&mut self) {
        let Some(child) = self.child.as_mut() else {
            return;
        };
        match child.try_wait() {
            Ok(Some(status)) => {
                self.last_error = Some(format!("ludos-sync exited with status {}", status));
                self.child = None;
                self.actual_port = None;
            }
            Ok(None) => {}
            Err(e) => {
                self.last_error = Some(format!("Failed to probe ludos-sync process: {}", e));
            }
        }
    }

    async fn start(
        &mut self,
        module: LudosSyncModuleConfig,
        generated_string: String,
    ) -> Result<(), String> {
        let cli_path = ludos_sync_cli_path();
        if !cli_path.is_file() {
            let error = format!("ludos-sync CLI not found at {}", cli_path.display());
            self.last_error = Some(error.clone());
            return Err(error);
        }

        let ludos_sync_dir = cli_path
            .parent()
            .and_then(|p| p.parent())
            .map(Path::to_path_buf)
            .ok_or_else(|| format!("Invalid ludos-sync CLI path {}", cli_path.display()))?;

        let child = Command::new("node")
            .arg(&cli_path)
            .arg("start")
            .arg("--config")
            .arg(&self.generated_config_path)
            .current_dir(&ludos_sync_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .map_err(|e| format!("Failed to start ludos-sync: {}", e))?;

        self.child = Some(child);
        self.last_config_json = Some(generated_string);
        self.actual_port = None;
        self.last_error = None;

        match wait_for_status(module.port).await {
            Ok(port) => {
                self.actual_port = Some(port);
                Ok(())
            }
            Err(e) => {
                self.last_error = Some(e.clone());
                Err(e)
            }
        }
    }
}

fn ludos_sync_cli_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../ludos-sync/dist/cli.js")
}

fn write_generated_config(path: &Path, contents: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create ludos-sync config dir: {}", e))?;
    }
    std::fs::write(path, contents)
        .map_err(|e| format!("Failed to write ludos-sync config {}: {}", path.display(), e))
}

async fn wait_for_status(configured_port: u16) -> Result<u16, String> {
    let url = format!("http://127.0.0.1:{}/status", configured_port);
    for _ in 0..STATUS_POLL_ATTEMPTS {
        let attempt = reqwest::get(&url).await;
        if let Ok(response) = attempt {
            if response.status().is_success() {
                let json: serde_json::Value = response
                    .json()
                    .await
                    .map_err(|e| format!("Failed to parse ludos-sync status: {}", e))?;
                if json["status"].as_str() == Some("running") {
                    let actual_port = json["port"]
                        .as_u64()
                        .and_then(|value| u16::try_from(value).ok())
                        .unwrap_or(configured_port);
                    return Ok(actual_port);
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(STATUS_POLL_DELAY_MS)).await;
    }
    Err(format!(
        "Timed out waiting for ludos-sync status on port {}",
        configured_port
    ))
}

fn generated_config_json(config: &SyncConfig) -> Result<serde_json::Value, String> {
    let module = &config.ludos_sync;
    let workspace_names: BTreeMap<String, String> = config
        .workspaces
        .iter()
        .map(|workspace| (workspace.id.clone(), workspace.name.clone()))
        .collect();

    let mut workspaces = serde_json::Map::new();
    for workspace in &config.workspaces {
        let boards = config
            .boards
            .iter()
            .filter(|board| board.workspace_ids.iter().any(|id| id == &workspace.id))
            .map(|board| {
                serde_json::json!({
                    "file": board.file,
                    "name": board.name,
                    "xbelName": board.xbel_name,
                    "bookmarkSync": board.bookmark_sync,
                    "calendarSync": board.calendar_sync,
                    "calendarSlug": board.calendar_slug,
                    "calendarName": board.calendar_name,
                })
            })
            .collect::<Vec<_>>();

        workspaces.insert(
            workspace.id.clone(),
            serde_json::json!({
                "boards": boards,
                "bookmarkSync": module.bookmarks_enabled,
                "calendarSync": module.calendar_enabled,
                "calendarName": workspace_names.get(&workspace.id).cloned().unwrap_or_else(|| workspace.name.clone()),
            }),
        );
    }

    let auth = match (&module.username, &module.password) {
        (Some(username), Some(password)) if !username.trim().is_empty() => {
            Some(serde_json::json!({ "username": username, "password": password }))
        }
        _ => None,
    };

    Ok(serde_json::json!({
        "port": module.port,
        "auth": auth,
        "bookmarks": { "enabled": module.bookmarks_enabled },
        "calendar": { "enabled": module.calendar_enabled },
        "workspaces": workspaces,
    }))
}

pub fn spawn_ludos_sync_reconcile(state: AppState) {
    tauri::async_runtime::spawn(async move {
        let config_snapshot = match state.config.lock() {
            Ok(cfg) => cfg.clone(),
            Err(e) => {
                log::error!("[ludos-sync] Config lock poisoned during reconcile: {}", e);
                return;
            }
        };

        let mut manager = state.ludos_sync.lock().await;
        if let Err(e) = manager.reconcile(&config_snapshot).await {
            log::error!("[ludos-sync] Reconcile failed: {}", e);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::generated_config_json;
    use crate::config::{LudosSyncModuleConfig, SyncConfig};
    use lexera_core::config::{BoardEntry, WorkspaceEntry};

    #[test]
    fn generated_config_maps_workspaces_and_board_overrides() {
        let config = SyncConfig {
            boards: vec![BoardEntry {
                file: "/tmp/a.md".to_string(),
                name: Some("Alpha".to_string()),
                xbel_name: Some("alpha.xbel".to_string()),
                bookmark_sync: Some(false),
                calendar_sync: Some(true),
                calendar_slug: Some("alpha-slug".to_string()),
                calendar_name: Some("Alpha Calendar".to_string()),
                workspace_ids: vec!["ws-1".to_string()],
            }],
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                bookmark_sync: Some(false),
                calendar_sync: Some(true),
                calendar_slug: Some("workspace-slug".to_string()),
                calendar_name: Some("Workspace Calendar".to_string()),
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port: 13123,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: Some("user".to_string()),
                password: Some("pass".to_string()),
            },
            ..SyncConfig::default()
        };

        let generated = generated_config_json(&config).expect("generated config");
        assert_eq!(generated["port"].as_u64(), Some(13123));
        assert_eq!(generated["bookmarks"]["enabled"].as_bool(), Some(true));
        assert_eq!(generated["calendar"]["enabled"].as_bool(), Some(true));
        assert_eq!(generated["auth"]["username"].as_str(), Some("user"));
        assert_eq!(
            generated["workspaces"]["ws-1"]["bookmarkSync"].as_bool(),
            Some(false)
        );
        assert_eq!(
            generated["workspaces"]["ws-1"]["calendarSync"].as_bool(),
            Some(true)
        );
        assert_eq!(
            generated["workspaces"]["ws-1"]["calendarSlug"].as_str(),
            Some("workspace-slug")
        );
        assert_eq!(
            generated["workspaces"]["ws-1"]["calendarName"].as_str(),
            Some("Workspace Calendar")
        );
        assert_eq!(
            generated["workspaces"]["ws-1"]["boards"][0]["calendarSlug"].as_str(),
            Some("alpha-slug")
        );
        assert_eq!(
            generated["workspaces"]["ws-1"]["boards"][0]["xbelName"].as_str(),
            Some("alpha.xbel")
        );
    }
}
