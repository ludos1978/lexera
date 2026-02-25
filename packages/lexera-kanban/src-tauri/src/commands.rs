/// Tauri commands for the kanban viewer.

use serde::Deserialize;
use std::sync::{Arc, Mutex};
use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, LogicalPosition, Position, Window};

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
