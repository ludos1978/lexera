/// Tauri commands for export functionality: Marp CLI, Pandoc CLI, theme discovery.
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

use tauri::State;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarpExportOptions {
    pub input_path: String,
    pub format: String, // "pdf" | "pptx" | "html" | "markdown"
    pub output_path: String,
    pub engine_path: Option<String>,
    pub theme: Option<String>,
    pub theme_dirs: Option<Vec<String>>,
    pub browser: Option<String>,
    pub pptx_editable: Option<bool>,
    pub additional_args: Option<Vec<String>>,
    // Handout options
    pub handout: Option<bool>,
    pub handout_layout: Option<String>,
    pub handout_slides_per_page: Option<u8>,
    pub handout_direction: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarpResult {
    pub success: bool,
    pub output_path: String,
    pub message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarpWatchResult {
    pub success: bool,
    pub pid: u32,
    pub watch_path: String,
    pub message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PandocExportOptions {
    pub input_path: String,
    pub output_path: String,
    pub format: String, // "docx" | "odt" | "epub"
    pub additional_args: Option<Vec<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    pub name: String,
    pub path: String,
    pub builtin: bool,
}

// ---------------------------------------------------------------------------
// Managed state: track watch mode PIDs
// ---------------------------------------------------------------------------

pub struct MarpWatchState {
    pub pids: Mutex<HashMap<String, u32>>,
}

impl MarpWatchState {
    pub fn new() -> Self {
        Self {
            pids: Mutex::new(HashMap::new()),
        }
    }
}

// ---------------------------------------------------------------------------
// Marp CLI argument builder
// ---------------------------------------------------------------------------

fn build_marp_args(opts: &MarpExportOptions) -> Vec<String> {
    let mut args = Vec::new();

    // Format flag
    match opts.format.as_str() {
        "pdf" => args.push("--pdf".to_string()),
        "pptx" => {
            args.push("--pptx".to_string());
            if opts.pptx_editable.unwrap_or(false) {
                args.push("--pptx-editable".to_string());
            }
        }
        "html" => args.push("--html".to_string()),
        _ => {} // "markdown" — no format flag
    }

    // Output file (skip for markdown format)
    if opts.format != "markdown" {
        args.push("--output".to_string());
        args.push(opts.output_path.clone());
    }

    // Engine
    if let Some(ref engine) = opts.engine_path {
        if !engine.is_empty() {
            args.push("--engine".to_string());
            args.push(engine.clone());
        }
    }

    // Theme
    if let Some(ref theme) = opts.theme {
        args.push("--theme".to_string());
        args.push(theme.clone());
    }

    // Theme directories (--theme-set)
    if let Some(ref dirs) = opts.theme_dirs {
        for dir in dirs {
            args.push("--theme-set".to_string());
            args.push(dir.clone());
        }
    }

    // Browser
    if let Some(ref browser) = opts.browser {
        if browser != "auto" && !browser.is_empty() {
            args.push("--browser".to_string());
            args.push(browser.clone());
        }
    }

    // Always allow local files
    args.push("--allow-local-files".to_string());

    // Additional args
    if let Some(ref extra) = opts.additional_args {
        args.extend(extra.clone());
    }

    // Input file last
    args.push(opts.input_path.clone());

    args
}

fn find_marp_cli() -> Option<PathBuf> {
    // Try npx first (most common for @marp-team/marp-cli)
    if let Ok(output) = Command::new("npx").args(["--yes", "@marp-team/marp-cli", "--version"]).output() {
        if output.status.success() {
            return Some(PathBuf::from("npx"));
        }
    }
    // Try marp directly
    if let Ok(output) = Command::new("marp").arg("--version").output() {
        if output.status.success() {
            return Some(PathBuf::from("marp"));
        }
    }
    None
}

fn find_pandoc() -> Option<(PathBuf, String)> {
    let candidates = [
        "pandoc",
        "/usr/local/bin/pandoc",
        "/opt/homebrew/bin/pandoc",
    ];
    for cmd in &candidates {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout);
                let version = version_str
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("unknown")
                    .to_string();
                return Some((PathBuf::from(cmd), version));
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Run Marp CLI for a one-shot export (PDF, PPTX, HTML).
#[tauri::command]
pub async fn marp_export(opts: MarpExportOptions) -> Result<MarpResult, String> {
    let args = build_marp_args(&opts);
    log::info!("[export] Marp CLI args: {:?}", args);

    // Build handout environment variables if needed
    let mut envs: Vec<(String, String)> = Vec::new();
    if opts.handout.unwrap_or(false) {
        envs.push(("MARP_HANDOUT".to_string(), "true".to_string()));
        if let Some(ref layout) = opts.handout_layout {
            envs.push(("MARP_HANDOUT_LAYOUT".to_string(), layout.clone()));
        }
        if let Some(spp) = opts.handout_slides_per_page {
            envs.push(("MARP_HANDOUT_SLIDES_PER_PAGE".to_string(), spp.to_string()));
        }
        if let Some(ref dir) = opts.handout_direction {
            envs.push(("MARP_HANDOUT_DIRECTION".to_string(), dir.clone()));
        }
    }

    // Determine CLI command
    let (cmd_name, extra_args) = if find_marp_cli() == Some(PathBuf::from("npx")) {
        ("npx", vec!["--yes".to_string(), "@marp-team/marp-cli".to_string()])
    } else {
        ("marp", vec![])
    };

    let cwd = Path::new(&opts.input_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let mut command = Command::new(cmd_name);
    command.args(&extra_args).args(&args).current_dir(&cwd);
    for (k, v) in &envs {
        command.env(k, v);
    }

    let output = command
        .output()
        .map_err(|e| format!("Failed to run Marp CLI: {}", e))?;

    if output.status.success() {
        Ok(MarpResult {
            success: true,
            output_path: opts.output_path,
            message: "Export completed".to_string(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Marp CLI failed: {}", stderr))
    }
}

/// Start Marp CLI in watch mode (--watch --preview). Returns PID for later stop.
#[tauri::command]
pub async fn marp_watch(
    opts: MarpExportOptions,
    watch_state: State<'_, MarpWatchState>,
) -> Result<MarpWatchResult, String> {
    let mut args = Vec::new();

    // Determine CLI command
    let (cmd_name, extra_args) = if find_marp_cli() == Some(PathBuf::from("npx")) {
        ("npx", vec!["--yes".to_string(), "@marp-team/marp-cli".to_string()])
    } else {
        ("marp", vec![])
    };

    args.extend(extra_args);
    args.push("--preview".to_string());
    args.push("--watch".to_string());

    // Theme
    if let Some(ref theme) = opts.theme {
        args.push("--theme".to_string());
        args.push(theme.clone());
    }
    if let Some(ref dirs) = opts.theme_dirs {
        for dir in dirs {
            args.push("--theme-set".to_string());
            args.push(dir.clone());
        }
    }
    if let Some(ref engine) = opts.engine_path {
        if !engine.is_empty() {
            args.push("--engine".to_string());
            args.push(engine.clone());
        }
    }
    args.push("--allow-local-files".to_string());
    args.push(opts.input_path.clone());

    let cwd = Path::new(&opts.input_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let child = Command::new(cmd_name)
        .args(&args)
        .current_dir(&cwd)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start Marp watch: {}", e))?;

    let pid = child.id();
    log::info!("[export] Marp watch started, PID: {}", pid);

    // Store PID for later cleanup
    if let Ok(mut pids) = watch_state.pids.lock() {
        pids.insert(opts.input_path.clone(), pid);
    }

    Ok(MarpWatchResult {
        success: true,
        pid,
        watch_path: opts.input_path,
        message: format!("Watch mode started (PID {})", pid),
    })
}

/// Stop a Marp watch process by its PID.
#[tauri::command]
pub async fn marp_stop_watch(
    pid: Option<u32>,
    watch_path: Option<String>,
    watch_state: State<'_, MarpWatchState>,
) -> Result<(), String> {
    let target_pid = if let Some(p) = pid {
        Some(p)
    } else if let Some(ref path) = watch_path {
        watch_state
            .pids
            .lock()
            .ok()
            .and_then(|pids| pids.get(path).copied())
    } else {
        None
    };

    if let Some(p) = target_pid {
        // Kill the process group on Unix (negative PID kills the group)
        #[cfg(unix)]
        {
            unsafe {
                libc::kill(-(p as i32), libc::SIGTERM);
            }
        }
        #[cfg(not(unix))]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &p.to_string(), "/F", "/T"])
                .output();
        }

        // Remove from tracking
        if let Ok(mut pids) = watch_state.pids.lock() {
            if let Some(ref path) = watch_path {
                pids.remove(path);
            } else {
                pids.retain(|_, &mut v| v != p);
            }
        }

        log::info!("[export] Stopped Marp watch PID: {}", p);
    }

    Ok(())
}

/// Stop all running Marp watch processes.
#[tauri::command]
pub async fn marp_stop_all_watches(
    watch_state: State<'_, MarpWatchState>,
) -> Result<u32, String> {
    let pids: Vec<u32> = watch_state
        .pids
        .lock()
        .map_err(|e| e.to_string())?
        .values()
        .copied()
        .collect();

    let count = pids.len() as u32;
    for p in &pids {
        #[cfg(unix)]
        unsafe {
            libc::kill(-(*p as i32), libc::SIGTERM);
        }
        #[cfg(not(unix))]
        {
            let _ = Command::new("taskkill")
                .args(["/PID", &p.to_string(), "/F", "/T"])
                .output();
        }
    }

    if let Ok(mut state) = watch_state.pids.lock() {
        state.clear();
    }

    log::info!("[export] Stopped {} Marp watch processes", count);
    Ok(count)
}

/// Export using Pandoc CLI.
#[tauri::command]
pub async fn pandoc_export(opts: PandocExportOptions) -> Result<MarpResult, String> {
    let pandoc = find_pandoc()
        .ok_or_else(|| "Pandoc not found. Install from https://pandoc.org/installing.html".to_string())?;

    let mut args = vec![
        opts.input_path.clone(),
        "-o".to_string(),
        opts.output_path.clone(),
        "-t".to_string(),
        opts.format.clone(),
        "-f".to_string(),
        "markdown+smart".to_string(),
        "--standalone".to_string(),
    ];

    if let Some(ref extra) = opts.additional_args {
        args.extend(extra.clone());
    }

    let cwd = Path::new(&opts.input_path)
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .to_path_buf();

    let output = Command::new(&pandoc.0)
        .args(&args)
        .current_dir(&cwd)
        .output()
        .map_err(|e| format!("Failed to run Pandoc: {}", e))?;

    if output.status.success() {
        Ok(MarpResult {
            success: true,
            output_path: opts.output_path,
            message: "Pandoc export completed".to_string(),
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        Err(format!("Pandoc failed: {}", stderr))
    }
}

/// Check if Marp CLI is available.
#[tauri::command]
pub async fn check_marp_available() -> CliStatus {
    if let Some(marp_path) = find_marp_cli() {
        let cmd = if marp_path == PathBuf::from("npx") {
            Command::new("npx")
                .args(["--yes", "@marp-team/marp-cli", "--version"])
                .output()
        } else {
            Command::new("marp").arg("--version").output()
        };

        let version = cmd
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());

        CliStatus {
            available: true,
            version,
            path: Some(marp_path.to_string_lossy().to_string()),
        }
    } else {
        CliStatus {
            available: false,
            version: None,
            path: None,
        }
    }
}

/// Check if Pandoc is available.
#[tauri::command]
pub async fn check_pandoc_available() -> CliStatus {
    if let Some((path, version)) = find_pandoc() {
        CliStatus {
            available: true,
            version: Some(version),
            path: Some(path.to_string_lossy().to_string()),
        }
    } else {
        CliStatus {
            available: false,
            version: None,
            path: None,
        }
    }
}

/// Discover Marp themes from configured and common directories.
#[tauri::command]
pub async fn discover_marp_themes(dirs: Vec<String>) -> Vec<ThemeInfo> {
    let mut themes = Vec::new();

    // Built-in themes
    for name in &["default", "gaia", "uncover"] {
        themes.push(ThemeInfo {
            name: name.to_string(),
            path: String::new(),
            builtin: true,
        });
    }

    // Common theme directories to scan
    let mut scan_dirs: Vec<PathBuf> = dirs.iter().map(PathBuf::from).collect();

    // Add common paths relative to home
    if let Some(home) = dirs::home_dir() {
        for common in &[".marp/themes", "themes", "_themes", "assets/themes"] {
            scan_dirs.push(home.join(common));
        }
    }

    // Scan each directory for .css and .marp.css files
    for dir in &scan_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                if name.ends_with(".marp.css") || name.ends_with(".css") {
                    let theme_name = name
                        .strip_suffix(".marp.css")
                        .or_else(|| name.strip_suffix(".css"))
                        .unwrap_or(&name)
                        .to_string();

                    themes.push(ThemeInfo {
                        name: theme_name,
                        path: path.to_string_lossy().to_string(),
                        builtin: false,
                    });
                }
            }
        }
    }

    themes
}

/// Open a folder in the system file manager.
#[tauri::command]
pub async fn open_export_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    let target = if p.is_file() {
        p.parent().unwrap_or(p)
    } else {
        p
    };

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    Ok(())
}

/// Write content to a file (used by the export pipeline to write markdown before Marp).
#[tauri::command]
pub async fn write_export_file(path: String, content: String) -> Result<(), String> {
    // Ensure parent directory exists
    if let Some(parent) = Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }
    std::fs::write(&path, &content)
        .map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Remove files created during a failed export and their parent directory if empty.
#[tauri::command]
pub async fn remove_export_files(paths: Vec<String>) -> Result<(), String> {
    for file_path in &paths {
        let p = Path::new(file_path);
        if p.exists() {
            std::fs::remove_file(p)
                .map_err(|e| format!("Failed to remove {}: {}", file_path, e))?;
            log::info!("[export] Cleaned up: {}", file_path);
        }
    }
    // Remove parent directories if they are now empty
    for file_path in &paths {
        if let Some(parent) = Path::new(file_path).parent() {
            if parent.is_dir() {
                if let Ok(mut entries) = std::fs::read_dir(parent) {
                    if entries.next().is_none() {
                        let _ = std::fs::remove_dir(parent);
                        log::info!("[export] Removed empty directory: {}", parent.display());
                    }
                }
            }
        }
    }
    Ok(())
}
