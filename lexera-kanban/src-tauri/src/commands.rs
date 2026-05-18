/// Tauri commands for the kanban viewer.
use base64::Engine;
use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext as CrsContext};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, LogicalPosition, Position, Window};

const MAX_CLIPBOARD_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Read the backend URL from the shared config file (~/.config/lexera/sync.json).
#[tauri::command]
pub fn get_backend_url() -> Result<String, String> {
    let config_path = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lexera")
        .join("sync.json");

    let content =
        std::fs::read_to_string(&config_path).map_err(|e| format!("Cannot read config: {}", e))?;

    #[derive(serde::Deserialize)]
    struct MinConfig {
        #[serde(default = "default_port")]
        port: u16,
        #[serde(default = "default_bind")]
        bind_address: String,
    }
    fn default_port() -> u16 {
        13080
    }
    fn default_bind() -> String {
        "127.0.0.1".to_string()
    }

    let cfg: MinConfig =
        serde_json::from_str(&content).map_err(|e| format!("Cannot parse config: {}", e))?;

    // If bound to 0.0.0.0, connect via localhost
    let host = if cfg.bind_address == "0.0.0.0" {
        "127.0.0.1".to_string()
    } else {
        cfg.bind_address
    };

    Ok(format!("http://{}:{}", host, cfg.port))
}

#[tauri::command]
pub fn open_in_system(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL '{}': {}", url, e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &url])
        .spawn()
        .map_err(|e| format!("Failed to open URL '{}': {}", url, e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL '{}': {}", url, e))?;
    Ok(())
}

/// Open a native file browse dialog and return selected paths.
#[tauri::command]
pub async fn browse_files(
    title: Option<String>,
    extensions: Option<Vec<String>>,
    multiple: Option<bool>,
    default_path: Option<String>,
) -> Result<Vec<String>, String> {
    let mut builder = rfd::AsyncFileDialog::new();
    if let Some(t) = &title {
        builder = builder.set_title(t);
    }
    if let Some(p) = &default_path {
        let path = std::path::PathBuf::from(p);
        // Walk up to find the closest existing ancestor directory
        let dir = if path.is_dir() { path.clone() } else { path.parent().map(|p| p.to_path_buf()).unwrap_or(path.clone()) };
        let mut candidate = dir.as_path();
        while !candidate.exists() {
            match candidate.parent() {
                Some(parent) => candidate = parent,
                None => break,
            }
        }
        if candidate.exists() {
            builder = builder.set_directory(candidate);
        }
    }
    if let Some(exts) = &extensions {
        let ext_refs: Vec<&str> = exts.iter().map(|s| s.as_str()).collect();
        builder = builder.add_filter("Files", &ext_refs);
    }
    let result = if multiple.unwrap_or(false) {
        builder.pick_files().await
            .unwrap_or_default()
            .into_iter()
            .map(|f| f.path().to_string_lossy().to_string())
            .collect()
    } else {
        match builder.pick_file().await {
            Some(f) => vec![f.path().to_string_lossy().to_string()],
            None => vec![],
        }
    };
    Ok(result)
}

/// Open a native folder browse dialog and return the selected folder path.
#[tauri::command]
pub async fn browse_folder(
    title: Option<String>,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    let mut builder = rfd::AsyncFileDialog::new();
    if let Some(t) = &title {
        builder = builder.set_title(t);
    }
    if let Some(p) = &default_path {
        let path = std::path::PathBuf::from(p);
        if path.exists() {
            builder = builder.set_directory(&path);
        }
    }
    match builder.pick_folder().await {
        Some(f) => Ok(Some(f.path().to_string_lossy().to_string())),
        None => Ok(None),
    }
}

/// Open a file with the system default application.
#[tauri::command]
pub fn open_with_default_app(path: String) -> Result<(), String> {
    let abs_path = std::path::Path::new(&path);
    if !abs_path.exists() {
        return Err(format!("File not found: {}", path));
    }
    #[cfg(target_os = "macos")]
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &path])
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub fn show_in_folder(path: String) -> Result<String, String> {
    // Canonicalize path to resolve relative paths and symlinks
    let abs_path = std::path::Path::new(&path);
    let resolved = if abs_path.is_absolute() {
        abs_path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Cannot resolve path: {}", e))?
            .join(abs_path)
    };
    let resolved_str = resolved.to_string_lossy().to_string();

    if !resolved.exists() {
        return Err(format!("File not found: {}", resolved_str));
    }

    #[cfg(target_os = "macos")]
    {
        let output = std::process::Command::new("open")
            .arg("-R")
            .arg(&resolved_str)
            .output()
            .map_err(|e| format!("Failed to reveal '{}': {}", resolved_str, e))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("open -R failed: {}", stderr));
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", &resolved_str))
            .spawn()
            .map_err(|e| format!("Failed to reveal '{}': {}", resolved_str, e))?;
    }
    #[cfg(target_os = "linux")]
    {
        // Open the parent directory; xdg-open doesn't support file selection
        let parent = resolved.parent().unwrap_or(&resolved);
        std::process::Command::new("xdg-open")
            .arg(parent.to_string_lossy().as_ref())
            .spawn()
            .map_err(|e| format!("Failed to reveal '{}': {}", resolved_str, e))?;
    }
    Ok(resolved_str)
}

#[tauri::command]
pub fn rename_path(from: String, to: String) -> Result<String, String> {
    let from_path = std::path::PathBuf::from(&from);
    let to_path = std::path::PathBuf::from(&to);

    let from_resolved = if from_path.is_absolute() {
        from_path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Cannot resolve source path: {}", e))?
            .join(from_path)
    };
    let to_resolved = if to_path.is_absolute() {
        to_path
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Cannot resolve destination path: {}", e))?
            .join(to_path)
    };

    if !from_resolved.exists() {
        return Err(format!(
            "Source file not found: {}",
            from_resolved.to_string_lossy()
        ));
    }
    if to_resolved.exists() {
        return Err(format!(
            "Destination already exists: {}",
            to_resolved.to_string_lossy()
        ));
    }

    if let Some(parent) = to_resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create destination directory '{}': {}",
                parent.to_string_lossy(),
                e
            )
        })?;
    }

    std::fs::rename(&from_resolved, &to_resolved).map_err(|e| {
        format!(
            "Failed to rename '{}' to '{}': {}",
            from_resolved.to_string_lossy(),
            to_resolved.to_string_lossy(),
            e
        )
    })?;

    Ok(to_resolved.to_string_lossy().to_string())
}

fn resolve_fs_path(path: &str) -> Result<std::path::PathBuf, String> {
    let raw = std::path::PathBuf::from(path);
    if raw.is_absolute() {
        Ok(raw)
    } else {
        std::env::current_dir()
            .map_err(|e| format!("Cannot resolve path: {}", e))
            .map(|cwd| cwd.join(raw))
    }
}

fn visual_themes_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lexera")
        .join("themes")
}

/// Copy bundled visual theme templates into the user's themes directory
/// the first time each one is encountered. Once a `<id>/` folder exists
/// in the user dir, it is left alone so user edits are never overwritten.
fn seed_builtin_visual_themes(app: &tauri::AppHandle) {
    use tauri::Manager;
    let resource_root = match app.path().resource_dir() {
        Ok(dir) => dir.join("templates"),
        Err(_) => return,
    };
    if !resource_root.is_dir() {
        return;
    }
    let user_root = visual_themes_path();
    if let Err(err) = std::fs::create_dir_all(&user_root) {
        log::warn!(
            "seed_builtin_visual_themes: cannot create user themes dir '{}': {}",
            user_root.to_string_lossy(),
            err
        );
        return;
    }
    let entries = match std::fs::read_dir(&resource_root) {
        Ok(it) => it,
        Err(err) => {
            log::warn!(
                "seed_builtin_visual_themes: cannot read bundled templates '{}': {}",
                resource_root.to_string_lossy(),
                err
            );
            return;
        }
    };
    for entry in entries.flatten() {
        let src_dir = entry.path();
        if !src_dir.is_dir() {
            continue;
        }
        let folder_name = match src_dir.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };
        let dst_dir = user_root.join(&folder_name);
        if dst_dir.exists() {
            // User has the template (possibly edited) — never overwrite.
            continue;
        }
        if let Err(err) = std::fs::create_dir_all(&dst_dir) {
            log::warn!(
                "seed_builtin_visual_themes: cannot create '{}': {}",
                dst_dir.to_string_lossy(),
                err
            );
            continue;
        }
        let inner = match std::fs::read_dir(&src_dir) {
            Ok(it) => it,
            Err(_) => continue,
        };
        for file in inner.flatten() {
            let from = file.path();
            if !from.is_file() {
                continue;
            }
            let to = dst_dir.join(file.file_name());
            if let Err(err) = std::fs::copy(&from, &to) {
                log::warn!(
                    "seed_builtin_visual_themes: copy '{}' → '{}' failed: {}",
                    from.to_string_lossy(),
                    to.to_string_lossy(),
                    err
                );
            }
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VisualThemeManifestFile {
    id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    extends: Option<String>,
    base_id: Option<String>,
    css_file: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualThemeManifest {
    id: String,
    name: String,
    description: String,
    extends: Option<String>,
    base_id: Option<String>,
    css_path: Option<String>,
    root_path: String,
    source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VisualThemeDiscovery {
    root_path: String,
    themes: Vec<VisualThemeManifest>,
}

fn normalize_theme_id(value: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in value.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            prev_dash = false;
        } else if (lower == '-' || lower == '_' || lower == ' ') && !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn prettify_theme_name(id: &str) -> String {
    let mut words = Vec::new();
    for part in id.split('-') {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let mut chars = trimmed.chars();
        if let Some(first) = chars.next() {
            let mut word = String::new();
            word.push(first.to_ascii_uppercase());
            word.push_str(chars.as_str());
            words.push(word);
        }
    }
    if words.is_empty() {
        "Custom Theme".to_string()
    } else {
        words.join(" ")
    }
}

#[tauri::command]
pub fn discover_visual_themes(app: tauri::AppHandle) -> Result<VisualThemeDiscovery, String> {
    seed_builtin_visual_themes(&app);

    let root = visual_themes_path();
    std::fs::create_dir_all(&root)
        .map_err(|e| format!("Failed to create visual themes directory '{}': {}", root.to_string_lossy(), e))?;

    let mut themes = Vec::new();
    let entries = std::fs::read_dir(&root)
        .map_err(|e| format!("Failed to read visual themes directory '{}': {}", root.to_string_lossy(), e))?;

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let manifest_path = path.join("theme.json");
        if !manifest_path.is_file() {
            continue;
        }

        let raw = match std::fs::read_to_string(&manifest_path) {
            Ok(content) => content,
            Err(err) => {
                log::warn!(
                    "Failed to read visual theme manifest '{}': {}",
                    manifest_path.to_string_lossy(),
                    err
                );
                continue;
            }
        };

        let manifest_file: VisualThemeManifestFile = match serde_json::from_str(&raw) {
            Ok(parsed) => parsed,
            Err(err) => {
                log::warn!(
                    "Failed to parse visual theme manifest '{}': {}",
                    manifest_path.to_string_lossy(),
                    err
                );
                continue;
            }
        };

        let folder_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("theme");
        let id_source = manifest_file.id.as_deref().unwrap_or(folder_name);
        let id = normalize_theme_id(id_source);
        if id.is_empty() {
            log::warn!(
                "Skipping visual theme with invalid id in '{}'",
                manifest_path.to_string_lossy()
            );
            continue;
        }

        let name = manifest_file
            .name
            .unwrap_or_else(|| prettify_theme_name(&id));
        let description = manifest_file.description.unwrap_or_default();
        let extends = manifest_file
            .extends
            .as_deref()
            .map(normalize_theme_id)
            .filter(|value| !value.is_empty());
        let base_id = manifest_file
            .base_id
            .as_deref()
            .map(normalize_theme_id)
            .filter(|value| !value.is_empty());

        let css_file = manifest_file.css_file.unwrap_or_else(|| "theme.css".to_string());
        let css_candidate = path.join(css_file);
        let css_path = if css_candidate.is_file() {
            Some(css_candidate.to_string_lossy().to_string())
        } else {
            None
        };

        themes.push(VisualThemeManifest {
            id,
            name,
            description,
            extends,
            base_id,
            css_path,
            root_path: path.to_string_lossy().to_string(),
            source: "user".to_string(),
        });
    }

    themes.sort_by(|a, b| {
        a.name
            .to_ascii_lowercase()
            .cmp(&b.name.to_ascii_lowercase())
            .then_with(|| a.id.cmp(&b.id))
    });

    Ok(VisualThemeDiscovery {
        root_path: root.to_string_lossy().to_string(),
        themes,
    })
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let resolved = resolve_fs_path(&path)?;
    std::fs::read_to_string(&resolved)
        .map_err(|e| format!("Failed to read '{}': {}", resolved.to_string_lossy(), e))
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let resolved = resolve_fs_path(&path)?;
    if let Some(parent) = resolved.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create directory '{}': {}",
                parent.to_string_lossy(),
                e
            )
        })?;
    }
    std::fs::write(&resolved, content)
        .map_err(|e| format!("Failed to write '{}': {}", resolved.to_string_lossy(), e))
}

fn keybindings_path() -> std::path::PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lexera")
        .join("keybindings.json")
}

#[tauri::command]
pub fn read_keybindings() -> Result<String, String> {
    let path = keybindings_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("Failed to read keybindings: {}", e)),
    }
}

#[tauri::command]
pub fn write_keybindings(content: String) -> Result<(), String> {
    let path = keybindings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {}", e))?;
    }
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write keybindings: {}", e))
}

/// Read the system clipboard as plain text.
///
/// Uses `clipboard-rs` directly rather than `navigator.clipboard.readText()`
/// so Tauri's WKWebView doesn't pop up a "paste" permission prompt when the
/// frontend needs the clipboard contents (e.g. during a "card from clipboard"
/// drag-drop). Returns "" when the clipboard has no text.
#[tauri::command]
pub fn read_clipboard_text() -> Result<String, String> {
    let ctx = CrsContext::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    Ok(ctx.get_text().unwrap_or_default())
}

#[tauri::command]
pub fn read_clipboard_image() -> Result<serde_json::Value, String> {
    let ctx = CrsContext::new().map_err(|e| format!("Failed to access clipboard: {}", e))?;
    let image = ctx
        .get_image()
        .map_err(|_| "No image found in clipboard".to_string())?;

    let (width, height) = image.get_size();
    if width == 0 || height == 0 {
        return Err("Clipboard image has invalid dimensions".to_string());
    }

    let png = image
        .to_png()
        .map_err(|e| format!("Failed to convert clipboard image to PNG: {}", e))?;
    let png_bytes = png.get_bytes();
    if png_bytes.is_empty() {
        return Err("Clipboard image is empty".to_string());
    }
    if png_bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err(format!(
            "Clipboard image exceeds {} bytes",
            MAX_CLIPBOARD_IMAGE_BYTES
        ));
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let filename = format!("clipboard-{}.png", timestamp);
    let data = base64::engine::general_purpose::STANDARD.encode(png_bytes);

    Ok(serde_json::json!({
        "data": data,
        "filename": filename,
    }))
}

#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    #[cfg(any(debug_assertions, target_os = "macos"))]
    {
        if window.is_devtools_open() {
            window.close_devtools();
            Ok(false)
        } else {
            window.open_devtools();
            Ok(true)
        }
    }
    #[cfg(not(any(debug_assertions, target_os = "macos")))]
    {
        let _ = window;
        Ok(false)
    }
}

/// Open the WebKit / WebView2 inspector for every child webview the app
/// currently hosts (board tabs, panel tabs, modal views, …) plus the
/// shell windows themselves.
///
/// The shell exposes 10+ panels and N board tabs as sibling Tauri child
/// webviews; the default `toggle_devtools` only opens devtools for the
/// CALLER's own webview, which is useless when something inside a
/// sub-app (e.g. the log panel) is broken and you need to inspect THAT
/// webview's DOM. This command iterates `app.webviews()` and opens
/// devtools on every one. Each devtools window is titled by the host
/// page's `<title>` (set per-view in subAppRuntime to include the panel
/// kind + pane id, so multiple instances are distinguishable).
///
/// Returns the number of devtools windows actually opened (skipping any
/// already-open ones).
#[tauri::command]
pub fn open_devtools_all(app: AppHandle) -> Result<usize, String> {
    use tauri::Manager;
    #[cfg(any(debug_assertions, target_os = "macos"))]
    {
        let webviews = app.webviews();
        let total = webviews.len();
        let mut opened = 0usize;
        let mut already_open = 0usize;
        eprintln!(
            "[devtools] open_devtools_all begin total_webviews={} labels={:?}",
            total,
            webviews.keys().collect::<Vec<_>>()
        );
        for (label, wv) in webviews.iter() {
            let was_open = wv.is_devtools_open();
            if !was_open {
                wv.open_devtools();
                opened += 1;
                eprintln!("[devtools] opened label='{}'", label);
            } else {
                already_open += 1;
                eprintln!("[devtools] skip already-open label='{}'", label);
            }
        }
        eprintln!(
            "[devtools] open_devtools_all done opened={} already_open={} total={}",
            opened, already_open, total
        );
        Ok(opened)
    }
    #[cfg(not(any(debug_assertions, target_os = "macos")))]
    {
        let _ = app;
        Ok(0)
    }
}

#[tauri::command]
pub fn set_menu_check_state(app: AppHandle, id: String, checked: bool) -> Result<(), String> {
    crate::app_menu::set_check_menu_state(&app, &id, checked);
    Ok(())
}

/// Rebuild the entire native menu so File > Open Workspace ▶ reflects
/// the current workspace catalog. Called by the frontend after every
/// `setWorkspacesState(...)` so users see fresh entries without a
/// restart.
#[tauri::command]
pub fn set_workspaces_submenu(
    app: AppHandle,
    workspaces: Vec<crate::app_menu::WorkspaceMenuEntry>,
) -> Result<(), String> {
    let menu = crate::app_menu::create_app_menu(&app, &workspaces)
        .map_err(|e| format!("set_workspaces_submenu: {}", e))?;
    app.set_menu(menu)
        .map_err(|e| format!("set_workspaces_submenu set_menu: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
    // Mark the exit as user-requested so the `ExitRequested` handler
    // in main.rs allows it to proceed. Without this flag, the
    // handler would prevent the exit (treating it as an
    // accidental "closed last window" event) and the user's Cmd+Q
    // would silently no-op.
    crate::USER_REQUESTED_QUIT.store(true, std::sync::atomic::Ordering::Relaxed);
    app.exit(0);
    Ok(())
}

#[derive(Deserialize, Clone)]
pub struct NativeMenuItem {
    pub id: Option<String>,
    pub label: Option<String>,
    #[serde(default)]
    pub separator: bool,
    #[serde(default)]
    pub disabled: bool,
    pub items: Option<Vec<NativeMenuItem>>,
}

/// Recursively build a native submenu so menus nested more than one level
/// deep (e.g. Marp Classes ▸ Local Classes ▸ lead) keep working. The previous
/// non-recursive builder flattened the third level into dead leaves whose ids
/// had no action handler.
fn build_native_submenu(
    app: &AppHandle,
    label: &str,
    items: &[NativeMenuItem],
) -> Result<tauri::menu::Submenu<tauri::Wry>, String> {
    let mut sub_builder = SubmenuBuilder::new(app, label);
    for sub_item in items {
        if sub_item.separator {
            sub_builder = sub_builder.separator();
            continue;
        }
        let sub_label = sub_item.label.as_deref().unwrap_or("");
        let sub_id = sub_item.id.as_deref().unwrap_or("");
        if let Some(nested) = &sub_item.items {
            let nested_menu = build_native_submenu(app, sub_label, nested)?;
            sub_builder = sub_builder.item(&nested_menu);
        } else {
            let mi = MenuItemBuilder::with_id(sub_id, sub_label)
                .enabled(!sub_item.disabled)
                .build(app)
                .map_err(|e| e.to_string())?;
            sub_builder = sub_builder.item(&mi);
        }
    }
    sub_builder.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn show_context_menu(
    window: Window,
    app: AppHandle,
    items: Vec<NativeMenuItem>,
    x: f64,
    y: f64,
) -> Result<Option<String>, String> {
    let selected: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
    let sel = selected.clone();
    let menu_labels: Vec<String> = items
        .iter()
        .filter(|item| !item.separator)
        .map(|item| item.id.clone().or(item.label.clone()).unwrap_or_default())
        .collect();

    log::info!(
        "[lexera-kanban.menu] open x={} y={} items={:?}",
        x, y, menu_labels
    );

    // Build menu items on this thread (menu building is thread-safe)
    let mut builder = MenuBuilder::new(&app);

    for item in &items {
        if item.separator {
            builder = builder.separator();
            continue;
        }

        let label = item.label.as_deref().unwrap_or("");
        let id = item.id.as_deref().unwrap_or("");

        if let Some(sub_items) = &item.items {
            let submenu = build_native_submenu(&app, label, sub_items)?;
            builder = builder.item(&submenu);
        } else {
            let mi = MenuItemBuilder::with_id(id, label)
                .enabled(!item.disabled)
                .build(&app)
                .map_err(|e| e.to_string())?;
            builder = builder.item(&mi);
        }
    }

    let menu = builder.build().map_err(|e| e.to_string())?;

    // Register event handler to capture selection
    window.on_menu_event(move |_win, event| {
        if let Ok(mut s) = sel.lock() {
            *s = Some(event.id().0.to_string());
        }
        log::info!("[lexera-kanban.menu] selected id={}", event.id().0);
    });

    // popup_menu_at must run on the main thread on macOS
    let win = window.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel::<Result<(), String>>(1);
    window
        .run_on_main_thread(move || {
            let pos = Position::Logical(LogicalPosition::new(x, y));
            let result = win.popup_menu_at(&menu, pos).map_err(|e| e.to_string());
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;

    // Wait for the popup to complete (blocking recv is fine here)
    rx.recv().map_err(|e| e.to_string())??;

    // On macOS the menu event can land a tick after popup_menu_at returns.
    let mut result = selected.lock().map_err(|e| e.to_string())?.clone();
    if result.is_none() {
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(10));
            result = selected.lock().map_err(|e| e.to_string())?.clone();
            if result.is_some() {
                break;
            }
        }
    }

    match &result {
        Some(action) => log::info!("[lexera-kanban.menu] returning selection={}", action),
        None => log::info!("[lexera-kanban.menu] closed without selection after wait"),
    }

    Ok(result)
}
