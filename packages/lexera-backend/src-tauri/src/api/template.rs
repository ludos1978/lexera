use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use super::ErrorResponse;
use crate::state::AppState;

#[derive(Serialize)]
struct TemplateSummary {
    id: String,
    name: String,
    #[serde(rename = "templateType")]
    template_type: String,
    description: String,
    icon: String,
    #[serde(rename = "hasVariables")]
    has_variables: bool,
}

#[derive(Deserialize)]
pub(super) struct CopyTemplateBody {
    board_id: String,
    variables: HashMap<String, serde_json::Value>,
}

/// Text file extensions for variable substitution during template file copy.
const TEXT_EXTENSIONS: &[&str] = &[
    "md", "txt", "json", "yaml", "yml", "toml", "html", "htm", "css", "js", "ts", "xml", "svg",
    "sh", "py", "rb", "rs", "go", "java", "c", "h", "cpp", "hpp",
];

/// Resolve templates dir from the current config.
fn get_templates_dir(state: &AppState) -> PathBuf {
    let templates_path = state
        .config
        .lock()
        .ok()
        .and_then(|cfg| cfg.templates_path.clone());
    crate::config::resolve_templates_path(&templates_path)
}

/// Parse simple YAML frontmatter from template.md content (line-by-line, no YAML crate).
fn parse_template_frontmatter(content: &str) -> (String, String, String, String, bool) {
    let mut name = String::new();
    let mut template_type = String::from("card");
    let mut description = String::new();
    let mut icon = String::new();
    let mut has_variables = false;

    // Extract frontmatter between --- delimiters
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (name, template_type, description, icon, has_variables);
    }
    let after_first = &trimmed[3..];
    let end = after_first.find("\n---");
    let yaml = match end {
        Some(pos) => &after_first[..pos],
        None => return (name, template_type, description, icon, has_variables),
    };

    for line in yaml.lines() {
        let line = line.trim();
        if line.starts_with("name:") {
            name = unquote_yaml(line[5..].trim());
        } else if line.starts_with("type:") {
            template_type = unquote_yaml(line[5..].trim());
        } else if line.starts_with("description:") {
            description = unquote_yaml(line[12..].trim());
        } else if line.starts_with("icon:") {
            icon = unquote_yaml(line[5..].trim());
        } else if line.starts_with("variables:") {
            has_variables = true;
        }
    }

    (name, template_type, description, icon, has_variables)
}

fn unquote_yaml(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].to_string()
    } else {
        s.to_string()
    }
}

fn is_text_file(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| TEXT_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

/// Apply {varname} substitution to a string.
fn substitute_variables(content: &str, variables: &HashMap<String, serde_json::Value>) -> String {
    let mut result = content.to_string();
    for (key, value) in variables {
        let placeholder = format!("{{{}}}", key);
        let replacement = match value {
            serde_json::Value::String(s) => s.clone(),
            serde_json::Value::Number(n) => n.to_string(),
            serde_json::Value::Bool(b) => b.to_string(),
            _ => value.to_string(),
        };
        result = result.replace(&placeholder, &replacement);
    }
    result
}

/// Sanitize a filename by replacing filesystem-invalid characters.
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*' => '_',
            _ => c,
        })
        .collect()
}

/// GET /templates -- list all available templates.
pub async fn list_templates(State(state): State<AppState>) -> Json<serde_json::Value> {
    let templates_dir = get_templates_dir(&state);
    let mut templates: Vec<TemplateSummary> = Vec::new();

    let entries = match std::fs::read_dir(&templates_dir) {
        Ok(e) => e,
        Err(_) => return Json(serde_json::json!(templates)),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let template_md = path.join("template.md");
        if !template_md.exists() {
            continue;
        }
        let content = match std::fs::read_to_string(&template_md) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let id = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        let (parsed_name, template_type, description, icon, has_variables) =
            parse_template_frontmatter(&content);

        templates.push(TemplateSummary {
            name: if parsed_name.is_empty() {
                id.clone()
            } else {
                parsed_name
            },
            id,
            template_type,
            description,
            icon,
            has_variables,
        });
    }

    Json(serde_json::json!(templates))
}

/// GET /templates/{template_id} -- return full template content + list of extra files.
pub async fn get_template(
    State(state): State<AppState>,
    Path(template_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal
    if template_id.contains("..") || template_id.contains('/') || template_id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid template ID".to_string(),
            }),
        ));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    let template_md = template_dir.join("template.md");

    let content = std::fs::read_to_string(&template_md).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Template not found".to_string(),
            }),
        )
    })?;

    // List extra files (everything except template.md)
    let mut files: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&template_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name != "template.md" {
                files.push(name);
            }
        }
    }

    Ok(Json(serde_json::json!({
        "content": content,
        "files": files,
    })))
}

/// POST /templates/{template_id}/copy -- copy template files to board folder with variable substitution.
pub async fn copy_template_files(
    State(state): State<AppState>,
    Path(template_id): Path<String>,
    Json(body): Json<CopyTemplateBody>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal
    if template_id.contains("..") || template_id.contains('/') || template_id.contains('\\') {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Invalid template ID".to_string(),
            }),
        ));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    if !template_dir.is_dir() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Template not found".to_string(),
            }),
        ));
    }

    // Resolve board directory
    let board_path = state
        .storage
        .get_board_path(&body.board_id)
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    error: "Board not found".to_string(),
                }),
            )
        })?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));

    // Copy all files except template.md
    let mut copied: Vec<String> = Vec::new();
    let entries = std::fs::read_dir(&template_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to read template dir: {}", e),
            }),
        )
    })?;

    for entry in entries.flatten() {
        let src_path = entry.path();
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == "template.md" || src_path.is_dir() {
            continue;
        }

        // Apply variable substitution to filename
        let dest_name = sanitize_filename(&substitute_variables(&file_name, &body.variables));
        let dest_path = board_dir.join(&dest_name);

        // For text files, substitute variables in content; for binary, just copy
        if is_text_file(&src_path) {
            match std::fs::read_to_string(&src_path) {
                Ok(content) => {
                    let substituted = substitute_variables(&content, &body.variables);
                    if let Err(e) = std::fs::write(&dest_path, &substituted) {
                        log::warn!(
                            "[templates.copy] Failed to write {}: {}",
                            dest_path.display(),
                            e
                        );
                        continue;
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[templates.copy] Failed to read text file {}: {}",
                        src_path.display(),
                        e
                    );
                    continue;
                }
            }
        } else if let Err(e) = std::fs::copy(&src_path, &dest_path) {
            log::warn!(
                "[templates.copy] Failed to copy {}: {}",
                src_path.display(),
                e
            );
            continue;
        }

        copied.push(dest_name);
    }

    Ok(Json(serde_json::json!({
        "copied": copied,
    })))
}
