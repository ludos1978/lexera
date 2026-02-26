/// Tauri commands for the kanban viewer.

use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, LogicalPosition, Position, Window};

/// Read the backend URL from the shared config file (~/.config/lexera/sync.json).
#[tauri::command]
pub fn get_backend_url() -> Result<String, String> {
    let config_path = dirs::config_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("lexera")
        .join("sync.json");

    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| format!("Cannot read config: {}", e))?;

    #[derive(serde::Deserialize)]
    struct MinConfig {
        #[serde(default = "default_port")]
        port: u16,
        #[serde(default = "default_bind")]
        bind_address: String,
    }
    fn default_port() -> u16 { 8080 }
    fn default_bind() -> String { "127.0.0.1".to_string() }

    let cfg: MinConfig = serde_json::from_str(&content)
        .map_err(|e| format!("Cannot parse config: {}", e))?;

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
        return Err(format!("Source file not found: {}", from_resolved.to_string_lossy()));
    }
    if to_resolved.exists() {
        return Err(format!(
            "Destination already exists: {}",
            to_resolved.to_string_lossy()
        ));
    }

    if let Some(parent) = to_resolved.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination directory '{}': {}", parent.to_string_lossy(), e))?;
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

#[tauri::command]
pub fn toggle_devtools(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.is_devtools_open() {
        window.close_devtools();
        Ok(false)
    } else {
        window.open_devtools();
        Ok(true)
    }
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

    // After popup returns, check what was selected
    let result = selected.lock().map_err(|e| e.to_string())?.clone();

    Ok(result)
}
