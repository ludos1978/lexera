/// Tauri commands for the kanban viewer.
use base64::Engine;
use clipboard_rs::{common::RustImage, Clipboard, ClipboardContext as CrsContext};
use serde::Deserialize;
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
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open '{}': {}", path, e))?;
    Ok(())
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&url)
        .spawn()
        .map_err(|e| format!("Failed to open URL '{}': {}", url, e))?;
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

    let output = std::process::Command::new("open")
        .arg("-R")
        .arg(&resolved_str)
        .output()
        .map_err(|e| format!("Failed to reveal '{}': {}", resolved_str, e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("open -R failed: {}", stderr));
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
            return Ok(false);
        } else {
            window.open_devtools();
            return Ok(true);
        }
    }
    #[cfg(not(any(debug_assertions, target_os = "macos")))]
    {
        let _ = window;
        Ok(false)
    }
}

#[tauri::command]
pub fn set_menu_check_state(app: AppHandle, id: String, checked: bool) -> Result<(), String> {
    crate::app_menu::set_check_menu_state(&app, &id, checked);
    Ok(())
}

#[tauri::command]
pub fn quit_app(app: AppHandle) -> Result<(), String> {
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

    eprintln!(
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
            let mut sub_builder = SubmenuBuilder::new(&app, label);
            for sub_item in sub_items {
                if sub_item.separator {
                    sub_builder = sub_builder.separator();
                    continue;
                }
                let sub_label = sub_item.label.as_deref().unwrap_or("");
                let sub_id = sub_item.id.as_deref().unwrap_or("");
                let mi = MenuItemBuilder::with_id(sub_id, sub_label)
                    .enabled(!sub_item.disabled)
                    .build(&app)
                    .map_err(|e| e.to_string())?;
                sub_builder = sub_builder.item(&mi);
            }
            let submenu = sub_builder.build().map_err(|e| e.to_string())?;
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
        eprintln!("[lexera-kanban.menu] selected id={}", event.id().0);
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
        Some(action) => eprintln!("[lexera-kanban.menu] returning selection={}", action),
        None => eprintln!("[lexera-kanban.menu] closed without selection after wait"),
    }

    Ok(result)
}
