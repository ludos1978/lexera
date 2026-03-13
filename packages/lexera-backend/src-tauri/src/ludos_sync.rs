use crate::config::{LudosSyncModuleConfig, SyncConfig};
use crate::state::AppState;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bookmarks_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caldav_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub caldav_discovery_url: Option<String>,
    pub auth_enabled: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_username: Option<String>,
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
        let effective_port = self.actual_port.unwrap_or(config.ludos_sync.port);
        let auth = module_auth(&config.ludos_sync);
        LudosSyncRuntimeStatus {
            enabled: config.ludos_sync.enabled,
            running: self.child.is_some(),
            configured_port: config.ludos_sync.port,
            actual_port: self.actual_port,
            bookmarks_enabled: config.ludos_sync.bookmarks_enabled,
            calendar_enabled: config.ludos_sync.calendar_enabled,
            generated_config_path: self.generated_config_path.to_string_lossy().to_string(),
            bookmarks_url: config
                .ludos_sync
                .bookmarks_enabled
                .then(|| format!("http://localhost:{}/bookmarks/", effective_port)),
            caldav_url: config
                .ludos_sync
                .calendar_enabled
                .then(|| format!("http://localhost:{}/caldav/", effective_port)),
            caldav_discovery_url: config
                .ludos_sync
                .calendar_enabled
                .then(|| format!("http://localhost:{}/.well-known/caldav", effective_port)),
            auth_enabled: auth.is_some(),
            auth_username: auth.map(|(username, _)| username.to_string()),
            pid: self.child.as_ref().and_then(|child| child.id()),
            last_error: self.last_error.clone(),
        }
    }

    pub async fn reconcile(&mut self, config: &SyncConfig) -> Result<(), String> {
        self.refresh_child_state();
        if !config.ludos_sync.enabled
            || (!config.ludos_sync.bookmarks_enabled && !config.ludos_sync.calendar_enabled)
        {
            terminate_stale_ludos_sync_processes(
                config.ludos_sync.port,
                &self.generated_config_path,
            )?;
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

        terminate_stale_ludos_sync_processes(config.ludos_sync.port, &self.generated_config_path)?;
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

        let mut child = Command::new("node")
            .arg(&cli_path)
            .arg("start")
            .arg("--config")
            .arg(&self.generated_config_path)
            .arg("--verbose")
            .current_dir(&ludos_sync_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to start ludos-sync: {}", e))?;

        crate::log_bridge::push_external_entry(
            "info",
            "ludos-sync.manager",
            format!(
                "Started managed WebDAV / CalDAV module on configured port {} with verbose logging",
                module.port
            ),
        );

        if let Some(stdout) = child.stdout.take() {
            tokio::spawn(forward_ludos_sync_output(
                BufReader::new(stdout),
                "stdout",
            ));
        }
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(forward_ludos_sync_output(
                BufReader::new(stderr),
                "stderr",
            ));
        }

        self.child = Some(child);
        self.last_config_json = Some(generated_string);
        self.actual_port = None;
        self.last_error = None;

        match wait_for_status(&module).await {
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

async fn forward_ludos_sync_output<R>(reader: BufReader<R>, stream_name: &'static str)
where
    R: tokio::io::AsyncRead + Unpin + Send + 'static,
{
    let mut lines = reader.lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let (level, target, message) = classify_ludos_sync_log_line(stream_name, trimmed);
                crate::log_bridge::push_external_entry(level, target, message);
            }
            Ok(None) => break,
            Err(error) => {
                crate::log_bridge::push_external_entry(
                    "error",
                    "ludos-sync.bridge",
                    format!("Failed reading {} from ludos-sync: {}", stream_name, error),
                );
                break;
            }
        }
    }
}

fn classify_ludos_sync_log_line(
    stream_name: &'static str,
    line: &str,
) -> (&'static str, &'static str, String) {
    let trimmed = line.trim();
    let without_prefix = trimmed
        .strip_prefix("[ludos-sync]")
        .map(str::trim_start)
        .unwrap_or(trimmed);

    if stream_name == "stderr" {
        if without_prefix.starts_with('⚠') {
            return (
                "warn",
                "ludos-sync.stderr",
                without_prefix.trim_start_matches('⚠').trim_start().to_string(),
            );
        }
        return ("error", "ludos-sync.stderr", without_prefix.to_string());
    }

    ("info", "ludos-sync.stdout", without_prefix.to_string())
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

fn terminate_stale_ludos_sync_processes(port: u16, generated_config_path: &Path) -> Result<(), String> {
    let port_arg = format!("-iTCP:{port}");
    let output = std::process::Command::new("lsof")
        .args(["-nP", &port_arg, "-sTCP:LISTEN", "-t"])
        .output()
        .map_err(|e| format!("Failed to inspect port {} for stale ludos-sync processes: {}", port, e))?;

    if !output.status.success() && output.stdout.is_empty() {
        return Ok(());
    }

    let expected_config = generated_config_path.to_string_lossy();
    let cli_fragment = "ludos-sync/dist/cli.js";
    for pid in String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let ps_output = std::process::Command::new("ps")
            .args(["-p", pid, "-o", "command="])
            .output()
            .map_err(|e| format!("Failed to inspect process {} on port {}: {}", pid, port, e))?;
        let command = String::from_utf8_lossy(&ps_output.stdout).trim().to_string();
        if command.is_empty() {
            continue;
        }
        if !command.contains(cli_fragment) {
            return Err(format!(
                "Port {} is occupied by a non-ludos-sync process: {}",
                port, command
            ));
        }

        let should_kill = command.contains(expected_config.as_ref()) || command.contains(" start ");
        if !should_kill {
            continue;
        }

        let status = std::process::Command::new("kill")
            .args(["-TERM", pid])
            .status()
            .map_err(|e| format!("Failed to terminate stale ludos-sync process {}: {}", pid, e))?;
        if !status.success() {
            return Err(format!("Failed to terminate stale ludos-sync process {}", pid));
        }

        for _ in 0..20 {
            let still_listening = std::process::Command::new("lsof")
                .args(["-nP", &port_arg, "-sTCP:LISTEN", "-t"])
                .output()
                .map(|out| String::from_utf8_lossy(&out.stdout).lines().any(|line| line.trim() == pid))
                .unwrap_or(false);
            if !still_listening {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }

    Ok(())
}

fn module_auth(module: &LudosSyncModuleConfig) -> Option<(&str, &str)> {
    match (&module.username, &module.password) {
        (Some(username), Some(password))
            if !username.trim().is_empty() && !password.trim().is_empty() =>
        {
            Some((username.as_str(), password.as_str()))
        }
        _ => None,
    }
}

async fn wait_for_status(module: &LudosSyncModuleConfig) -> Result<u16, String> {
    let url = format!("http://127.0.0.1:{}/status", module.port);
    let client = reqwest::Client::new();
    for _ in 0..STATUS_POLL_ATTEMPTS {
        let mut request = client.get(&url);
        if let Some((username, password)) = module_auth(module) {
            request = request.basic_auth(username, Some(password));
        }
        let attempt = request.send().await;
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
                        .unwrap_or(module.port);
                    return Ok(actual_port);
                }
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(STATUS_POLL_DELAY_MS)).await;
    }
    Err(format!(
        "Timed out waiting for ludos-sync status on port {}",
        module.port
    ))
}

fn generated_config_json(config: &SyncConfig) -> Result<serde_json::Value, String> {
    let module = &config.ludos_sync;

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
                "bookmarkSync": workspace.bookmark_sync,
                "calendarSync": workspace.calendar_sync,
                "calendarSlug": workspace.calendar_slug,
                "calendarName": workspace.calendar_name,
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
    use super::{
        classify_ludos_sync_log_line, generated_config_json, ludos_sync_cli_path, wait_for_status,
        LudosSyncManager,
    };
    use crate::config::{LudosSyncModuleConfig, SyncConfig};
    use lexera_core::config::{BoardEntry, WorkspaceEntry};
    use tokio::process::Command;
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

    #[test]
    fn classify_ludos_sync_stdout_as_info() {
        let (level, target, message) =
            classify_ludos_sync_log_line("stdout", "[ludos-sync] Server started");
        assert_eq!(level, "info");
        assert_eq!(target, "ludos-sync.stdout");
        assert_eq!(message, "Server started");
    }

    #[test]
    fn classify_ludos_sync_stderr_warn_and_error() {
        let (warn_level, warn_target, warn_message) =
            classify_ludos_sync_log_line("stderr", "[ludos-sync] ⚠ Auth rejected");
        assert_eq!(warn_level, "warn");
        assert_eq!(warn_target, "ludos-sync.stderr");
        assert_eq!(warn_message, "Auth rejected");

        let (error_level, error_target, error_message) =
            classify_ludos_sync_log_line("stderr", "[ludos-sync] ✗ Failed to start");
        assert_eq!(error_level, "error");
        assert_eq!(error_target, "ludos-sync.stderr");
        assert_eq!(error_message, "✗ Failed to start");
    }

    fn sidecar_runtime_available() -> bool {
        let ipv4_listen_allowed = std::net::TcpListener::bind("127.0.0.1:0").is_ok();
        let ipv6_listen_allowed = std::net::TcpListener::bind("[::1]:0").is_ok();
        ludos_sync_cli_path().is_file()
            && ipv4_listen_allowed
            && ipv6_listen_allowed
            && std::process::Command::new("node")
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
    }

    #[tokio::test]
    async fn manager_can_start_and_stop_sidecar_when_available() {
        if !sidecar_runtime_available() {
            eprintln!("Skipping ludos-sync sidecar integration test: runtime unavailable");
            return;
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let generated_path = temp_dir.path().join("ludos-sync.generated.json");
        let port = 23181;
        let enabled_config = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: None,
                password: None,
            },
            ..SyncConfig::default()
        };
        let disabled_config = SyncConfig {
            ludos_sync: LudosSyncModuleConfig {
                enabled: false,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: None,
                password: None,
            },
            ..enabled_config.clone()
        };

        let mut manager = LudosSyncManager::new(generated_path);
        if let Err(error) = manager.reconcile(&enabled_config).await {
            let _ = manager.stop().await;
            panic!("failed to start ludos-sync sidecar: {}", error);
        }

        let started = manager.status(&enabled_config);
        assert!(started.running);
        assert_eq!(started.actual_port, Some(port));
        assert!(started.pid.is_some());

        manager
            .reconcile(&disabled_config)
            .await
            .expect("stop sidecar");
        let stopped = manager.status(&disabled_config);
        assert!(!stopped.running);
        assert_eq!(stopped.actual_port, None);
        assert_eq!(stopped.pid, None);
    }

    #[tokio::test]
    async fn manager_can_start_with_auth_when_available() {
        if !sidecar_runtime_available() {
            eprintln!("Skipping authenticated ludos-sync sidecar integration test: runtime unavailable");
            return;
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let generated_path = temp_dir.path().join("ludos-sync.generated.json");
        let port = 23182;
        let enabled_config = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: Some("sync-user".to_string()),
                password: Some("sync-pass".to_string()),
            },
            ..SyncConfig::default()
        };

        let mut manager = LudosSyncManager::new(generated_path);
        if let Err(error) = manager.reconcile(&enabled_config).await {
            let _ = manager.stop().await;
            panic!("failed to start authenticated ludos-sync sidecar: {}", error);
        }

        let started = manager.status(&enabled_config);
        assert!(started.running);
        assert_eq!(started.actual_port, Some(port));
        assert!(started.auth_enabled);
        assert_eq!(started.auth_username.as_deref(), Some("sync-user"));

        let unauthenticated = reqwest::get(format!("http://127.0.0.1:{}/status", port))
            .await
            .expect("unauthenticated probe");
        assert_eq!(unauthenticated.status(), reqwest::StatusCode::UNAUTHORIZED);

        let authenticated = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/status", port))
            .basic_auth("sync-user", Some("sync-pass"))
            .send()
            .await
            .expect("authenticated probe");
        assert!(authenticated.status().is_success());

        manager
            .stop()
            .await
            .expect("stop authenticated sidecar");
        let stopped = manager.status(&enabled_config);
        assert!(!stopped.running);
    }

    #[tokio::test]
    async fn manager_replaces_stale_sidecar_process_when_available() {
        if !sidecar_runtime_available() {
            eprintln!("Skipping stale sidecar replacement test: runtime unavailable");
            return;
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let stale_config_path = temp_dir.path().join("stale-ludos-sync.generated.json");
        let managed_config_path = temp_dir.path().join("managed-ludos-sync.generated.json");
        let port = 23186;
        let cli_path = ludos_sync_cli_path();
        let ludos_sync_dir = cli_path
            .parent()
            .and_then(|p| p.parent())
            .expect("ludos-sync dir")
            .to_path_buf();

        let stale_config = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: Some("stale-user".to_string()),
                password: Some("stale-pass".to_string()),
            },
            ..SyncConfig::default()
        };
        let stale_json = serde_json::to_string_pretty(&generated_config_json(&stale_config).expect("stale generated config"))
            .expect("stale generated json");
        std::fs::write(&stale_config_path, stale_json).expect("write stale generated config");

        let mut stale_child = Command::new("node")
            .arg(&cli_path)
            .arg("start")
            .arg("--config")
            .arg(&stale_config_path)
            .current_dir(&ludos_sync_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::inherit())
            .stderr(std::process::Stdio::inherit())
            .spawn()
            .expect("spawn stale sidecar");
        wait_for_status(&stale_config.ludos_sync)
            .await
            .expect("wait for stale sidecar");

        let stale_probe = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/status", port))
            .basic_auth("stale-user", Some("stale-pass"))
            .send()
            .await
            .expect("stale sidecar probe");
        assert!(stale_probe.status().is_success());

        let enabled_config = SyncConfig {
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: Some("fresh-user".to_string()),
                password: Some("fresh-pass".to_string()),
            },
            ..SyncConfig::default()
        };

        let mut manager = LudosSyncManager::new(managed_config_path);
        if let Err(error) = manager.reconcile(&enabled_config).await {
            let _ = manager.stop().await;
            let _ = stale_child.kill().await;
            panic!("failed to replace stale ludos-sync sidecar: {}", error);
        }

        let started = manager.status(&enabled_config);
        assert!(started.running);
        assert_eq!(started.actual_port, Some(port));
        assert_eq!(started.auth_username.as_deref(), Some("fresh-user"));

        let fresh_probe = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/status", port))
            .basic_auth("fresh-user", Some("fresh-pass"))
            .send()
            .await
            .expect("fresh sidecar probe");
        assert!(fresh_probe.status().is_success());

        let stale_auth = reqwest::Client::new()
            .get(format!("http://127.0.0.1:{}/status", port))
            .basic_auth("stale-user", Some("stale-pass"))
            .send()
            .await
            .expect("stale auth probe");
        assert_eq!(stale_auth.status(), reqwest::StatusCode::UNAUTHORIZED);

        manager.stop().await.expect("stop replaced sidecar");
        let _ = stale_child.wait().await;
    }

    #[tokio::test]
    async fn manager_serves_caldav_discovery_and_apple_readonly_paths_when_available() {
        if !sidecar_runtime_available() {
            eprintln!("Skipping CalDAV sidecar integration test: runtime unavailable");
            return;
        }

        let temp_dir = tempfile::tempdir().expect("tempdir");
        let fixture_board = temp_dir.path().join("calendar-v2-board.md");
        std::fs::write(
            &fixture_board,
            "---\nkanban-plugin: board\n---\n\n# Planning\n\n## Sprint Alpha\n\n### Open Work\n- [ ] Overdue refactor follow-up !2026-03-05 #backend\n- [ ] Time slot example !09:00-11:00 #calendar\n",
        )
        .expect("write v2 calendar board");
        let generated_path = temp_dir.path().join("ludos-sync.generated.json");
        let port = 23183;
        let username = "sync-user";
        let password = "sync-pass";
        let enabled_config = SyncConfig {
            boards: vec![BoardEntry {
                file: fixture_board.to_string_lossy().to_string(),
                calendar_sync: Some(true),
                calendar_slug: Some("apple-smoke".to_string()),
                calendar_name: Some("Apple Smoke".to_string()),
                workspace_ids: vec!["ws-1".to_string()],
                ..BoardEntry::default()
            }],
            workspaces: vec![WorkspaceEntry {
                id: "ws-1".to_string(),
                name: "Main".to_string(),
                ..WorkspaceEntry::default()
            }],
            ludos_sync: LudosSyncModuleConfig {
                enabled: true,
                port,
                bookmarks_enabled: true,
                calendar_enabled: true,
                username: Some(username.to_string()),
                password: Some(password.to_string()),
            },
            ..SyncConfig::default()
        };

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("reqwest client");

        let mut manager = LudosSyncManager::new(generated_path);
        if let Err(error) = manager.reconcile(&enabled_config).await {
            let _ = manager.stop().await;
            panic!("failed to start ludos-sync sidecar: {}", error);
        }

        let unauthenticated = client
            .get(format!("http://127.0.0.1:{}/status", port))
            .send()
            .await
            .expect("unauthenticated probe");
        assert_eq!(unauthenticated.status(), reqwest::StatusCode::UNAUTHORIZED);

        let well_known = client
            .get(format!("http://127.0.0.1:{}/.well-known/caldav", port))
            .basic_auth(username, Some(password))
            .send()
            .await
            .expect("well-known probe");
        assert_eq!(well_known.status(), reqwest::StatusCode::MOVED_PERMANENTLY);
        assert_eq!(
            well_known
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok()),
            Some("/caldav/principal/")
        );

        let propfind_method = reqwest::Method::from_bytes(b"PROPFIND").expect("PROPFIND method");
        let report_method = reqwest::Method::from_bytes(b"REPORT").expect("REPORT method");
        let proppatch_method =
            reqwest::Method::from_bytes(b"PROPPATCH").expect("PROPPATCH method");
        let mkcalendar_method =
            reqwest::Method::from_bytes(b"MKCALENDAR").expect("MKCALENDAR method");

        let options = client
            .request(reqwest::Method::OPTIONS, format!("http://127.0.0.1:{}/caldav/", port))
            .basic_auth(username, Some(password))
            .send()
            .await
            .expect("options");
        assert_eq!(options.status(), reqwest::StatusCode::OK);
        let allow = options
            .headers()
            .get(reqwest::header::ALLOW)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(allow.contains("PROPFIND"));
        assert!(allow.contains("REPORT"));
        assert!(allow.contains("PROPPATCH"));
        assert!(allow.contains("MKCALENDAR"));

        let root_propfind = client
            .request(propfind_method.clone(), format!("http://127.0.0.1:{}/caldav/", port))
            .basic_auth(username, Some(password))
            .header("Depth", "0")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\"><D:prop><D:current-user-principal/></D:prop></D:propfind>")
            .send()
            .await
            .expect("root propfind");
        assert_eq!(root_propfind.status(), reqwest::StatusCode::from_u16(207).unwrap());
        let root_body = root_propfind.text().await.expect("root propfind body");
        assert!(root_body.contains("<D:current-user-principal><D:href>/caldav/principal/</D:href></D:current-user-principal>"));

        let principal_propfind = client
            .request(
                propfind_method.clone(),
                format!("http://127.0.0.1:{}/caldav/principal/", port),
            )
            .basic_auth(username, Some(password))
            .header("Depth", "0")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:current-user-principal/><C:calendar-home-set/></D:prop></D:propfind>")
            .send()
            .await
            .expect("principal propfind");
        assert_eq!(
            principal_propfind.status(),
            reqwest::StatusCode::from_u16(207).unwrap()
        );
        let principal_body = principal_propfind.text().await.expect("principal body");
        assert!(principal_body.contains("<C:calendar-home-set><D:href>/caldav/calendars/</D:href></C:calendar-home-set>"));
        assert!(principal_body.contains("<D:principal-URL><D:href>/caldav/principal/</D:href></D:principal-URL>"));
        assert!(principal_body.contains("<C:calendar-user-address-set>"));
        assert!(principal_body.contains("<D:supported-report-set>"));

        let apple_alias_propfind = client
            .request(
                propfind_method.clone(),
                format!("http://127.0.0.1:{}/calendar/dav/{}/user/", port, username),
            )
            .basic_auth(username, Some(password))
            .header("Depth", "0")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:principal-URL/><D:principal-collection-set/><C:calendar-home-set/><C:calendar-user-address-set/><D:supported-report-set/></D:prop></D:propfind>")
            .send()
            .await
            .expect("apple alias propfind");
        assert_eq!(
            apple_alias_propfind.status(),
            reqwest::StatusCode::from_u16(207).unwrap()
        );
        let alias_dav_header = apple_alias_propfind
            .headers()
            .get("DAV")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let alias_body = apple_alias_propfind.text().await.expect("alias body");
        assert!(alias_dav_header.contains("calendar-access"));
        assert!(alias_body.contains("<D:principal-URL><D:href>/caldav/principal/</D:href></D:principal-URL>"));
        assert!(alias_body.contains("<D:principal-collection-set>"));
        assert!(alias_body.contains("<C:calendar-home-set><D:href>/caldav/calendars/</D:href></C:calendar-home-set>"));
        assert!(alias_body.contains("<C:calendar-user-address-set>"));
        assert!(alias_body.contains("<D:supported-report-set>"));

        let calendar_propfind = client
            .request(
                propfind_method.clone(),
                format!("http://127.0.0.1:{}/caldav/calendars/apple-smoke/", port),
            )
            .basic_auth(username, Some(password))
            .header("Depth", "1")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:allprop/></D:propfind>")
            .send()
            .await
            .expect("calendar propfind");
        assert_eq!(
            calendar_propfind.status(),
            reqwest::StatusCode::from_u16(207).unwrap()
        );
        let calendar_body = calendar_propfind.text().await.expect("calendar body");
        assert!(calendar_body.contains("<D:displayname>Apple Smoke</D:displayname>"));
        assert!(calendar_body.contains("<D:current-user-privilege-set>"));
        assert!(calendar_body.contains("<C:supported-calendar-component-set>"));
        assert!(calendar_body.contains("<D:owner><D:href>/caldav/principal/</D:href></D:owner>"));
        assert!(calendar_body.contains("<D:supported-report-set>"));
        let uid_fragment = calendar_body
            .split("/caldav/calendars/apple-smoke/")
            .nth(1)
            .and_then(|value| value.split(".ics").next())
            .expect("ics uid fragment");
        let event_uid = uid_fragment.to_string();
        assert!(!event_uid.is_empty());

        let full_calendar = client
            .get(format!("http://127.0.0.1:{}/caldav/calendars/apple-smoke/", port))
            .basic_auth(username, Some(password))
            .send()
            .await
            .expect("full calendar get");
        assert!(full_calendar.status().is_success());
        let full_calendar_body = full_calendar.text().await.expect("full calendar body");
        assert!(full_calendar_body.contains("BEGIN:VCALENDAR"));
        assert!(full_calendar_body.contains("BEGIN:VEVENT"));

        let unauthenticated_calendar_list = client
            .request(
                propfind_method.clone(),
                format!("http://127.0.0.1:{}/caldav/calendars/", port),
            )
            .header("Depth", "1")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version=\"1.0\"?><D:propfind xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\"><D:prop><D:displayname/><D:resourcetype/><C:supported-calendar-component-set/></D:prop></D:propfind>")
            .send()
            .await
            .expect("unauthenticated calendar list");
        assert_eq!(
            unauthenticated_calendar_list.status(),
            reqwest::StatusCode::from_u16(207).unwrap()
        );
        let unauthenticated_calendar_list_body = unauthenticated_calendar_list
            .text()
            .await
            .expect("unauthenticated calendar list body");
        assert!(unauthenticated_calendar_list_body.contains("/caldav/calendars/apple-smoke/"));

        let multiget_body = format!(
            "<?xml version='1.0'?><C:calendar-multiget xmlns:D='DAV:' xmlns:C='urn:ietf:params:xml:ns:caldav'><D:prop><D:getetag/><C:calendar-data/></D:prop><D:href>/caldav/calendars/apple-smoke/{}.ics</D:href></C:calendar-multiget>",
            event_uid
        );
        let multiget = client
            .request(
                report_method.clone(),
                format!("http://127.0.0.1:{}/caldav/calendars/apple-smoke/", port),
            )
            .basic_auth(username, Some(password))
            .header("Depth", "1")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body(multiget_body)
            .send()
            .await
            .expect("calendar multiget");
        assert_eq!(multiget.status(), reqwest::StatusCode::from_u16(207).unwrap());
        let multiget_text = multiget.text().await.expect("multiget body");
        assert!(multiget_text.contains("<C:calendar-data>"));
        assert!(multiget_text.contains(&event_uid));

        let query = client
            .request(
                report_method,
                format!("http://127.0.0.1:{}/caldav/calendars/apple-smoke/", port),
            )
            .basic_auth(username, Some(password))
            .header("Depth", "1")
            .header(reqwest::header::CONTENT_TYPE, "application/xml")
            .body("<?xml version='1.0'?><C:calendar-query xmlns:D='DAV:' xmlns:C='urn:ietf:params:xml:ns:caldav'><D:prop><D:getetag/><C:calendar-data/></D:prop><C:filter><C:comp-filter name='VCALENDAR'><C:comp-filter name='VEVENT'><C:time-range start='20260301T000000Z' end='20260331T235959Z'/></C:comp-filter></C:comp-filter></C:filter></C:calendar-query>")
            .send()
            .await
            .expect("calendar query");
        assert_eq!(query.status(), reqwest::StatusCode::from_u16(207).unwrap());
        let query_text = query.text().await.expect("query body");
        assert!(query_text.contains("<C:calendar-data>"));
        assert!(query_text.contains("BEGIN:VEVENT"));

        let proppatch = client
            .request(
                proppatch_method,
                format!("http://127.0.0.1:{}/caldav/calendars/apple-smoke/", port),
            )
            .basic_auth(username, Some(password))
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/xml; charset=utf-8",
            )
            .body("<?xml version='1.0' encoding='UTF-8'?><D:propertyupdate xmlns:D='DAV:' xmlns:C='urn:ietf:params:xml:ns:caldav' xmlns:A='http://apple.com/ns/ical/'><D:set><D:prop><A:calendar-color>#FF0000FF</A:calendar-color><A:calendar-order>1</A:calendar-order></D:prop></D:set></D:propertyupdate>")
            .send()
            .await
            .expect("proppatch");
        assert_eq!(proppatch.status(), reqwest::StatusCode::from_u16(207).unwrap());
        let proppatch_text = proppatch.text().await.expect("proppatch body");
        assert!(proppatch_text.contains("<A:calendar-color/>"));
        assert!(proppatch_text.contains("<A:calendar-order/>"));
        assert!(proppatch_text.contains("HTTP/1.1 200 OK"));

        let mkcalendar = client
            .request(
                mkcalendar_method,
                format!("http://127.0.0.1:{}/caldav/calendars/new-calendar/", port),
            )
            .basic_auth(username, Some(password))
            .send()
            .await
            .expect("mkcalendar");
        assert_eq!(mkcalendar.status(), reqwest::StatusCode::FORBIDDEN);

        manager.stop().await.expect("stop caldav sidecar");
        let stopped = manager.status(&enabled_config);
        assert!(!stopped.running);
    }
}
