use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use super::{err_bad_request, err_internal, err_not_found, ErrorResponse};
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
        .read()
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
        if let Some(rest) = line.strip_prefix("name:") {
            name = unquote_yaml(rest.trim());
        } else if let Some(rest) = line.strip_prefix("type:") {
            template_type = unquote_yaml(rest.trim());
        } else if let Some(rest) = line.strip_prefix("description:") {
            description = unquote_yaml(rest.trim());
        } else if let Some(rest) = line.strip_prefix("icon:") {
            icon = unquote_yaml(rest.trim());
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

    let templates = tokio::task::spawn_blocking(move || {
        let mut templates: Vec<TemplateSummary> = Vec::new();

        let entries = match std::fs::read_dir(&templates_dir) {
            Ok(e) => e,
            Err(_) => return templates,
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

        templates
    })
    .await
    .unwrap_or_default();

    Json(serde_json::json!(templates))
}

/// GET /templates/{template_id} -- return full template content + list of extra files.
pub async fn get_template(
    State(state): State<AppState>,
    Path(template_id): Path<String>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal
    if template_id.contains("..") || template_id.contains('/') || template_id.contains('\\') {
        return Err(err_bad_request("Invalid template ID"));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    let template_md = template_dir.join("template.md");

    let content = tokio::fs::read_to_string(&template_md)
        .await
        .map_err(|_| err_not_found("Template not found"))?;

    // List extra files (everything except template.md)
    let mut files: Vec<String> = Vec::new();
    if let Ok(mut entries) = tokio::fs::read_dir(&template_dir).await {
        while let Ok(Some(entry)) = entries.next_entry().await {
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
        return Err(err_bad_request("Invalid template ID"));
    }

    let templates_dir = get_templates_dir(&state);
    let template_dir = templates_dir.join(&template_id);
    if tokio::fs::metadata(&template_dir)
        .await
        .map(|m| !m.is_dir())
        .unwrap_or(true)
    {
        return Err(err_not_found("Template not found"));
    }

    // Resolve board directory
    let board_path = state
        .storage
        .get_board_path(&body.board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .to_path_buf();

    // Copy all files except template.md (spawn_blocking for bulk fs operations)
    let variables = body.variables;
    let copied = tokio::task::spawn_blocking(move || {
        let mut copied: Vec<String> = Vec::new();
        let entries = match std::fs::read_dir(&template_dir) {
            Ok(e) => e,
            Err(e) => {
                log::warn!("[templates.copy] Failed to read template dir: {}", e);
                return Err(format!("Failed to read template dir: {}", e));
            }
        };

        for entry in entries.flatten() {
            let src_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name == "template.md" || src_path.is_dir() {
                continue;
            }

            // Apply variable substitution to filename
            let dest_name = sanitize_filename(&substitute_variables(&file_name, &variables));
            let dest_path = board_dir.join(&dest_name);

            // For text files, substitute variables in content; for binary, just copy
            if is_text_file(&src_path) {
                match std::fs::read_to_string(&src_path) {
                    Ok(content) => {
                        let substituted = substitute_variables(&content, &variables);
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

        Ok(copied)
    })
    .await
    .unwrap_or_else(|_| Ok(Vec::new()))
    .map_err(|e: String| err_internal(e))?;

    Ok(Json(serde_json::json!({
        "copied": copied,
    })))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    use crate::test_helpers::{body_json, test_router, test_state};

    #[tokio::test]
    async fn list_templates_returns_empty_without_templates_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let state = test_state(tmp.path());
        {
            let mut cfg = state.config.write().unwrap();
            cfg.templates_path = Some(tmp.path().join("no-such-dir").to_string_lossy().to_string());
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/templates")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let templates = json.as_array().unwrap();
        assert!(templates.is_empty());
    }

    #[tokio::test]
    async fn list_templates_finds_template() {
        let tmp = tempfile::tempdir().unwrap();
        let templates_dir = tmp.path().join("templates");
        let tpl_dir = templates_dir.join("my-tpl");
        std::fs::create_dir_all(&tpl_dir).unwrap();
        std::fs::write(
            tpl_dir.join("template.md"),
            "---\nname: My Template\ntype: card\ndescription: A test template\n---\nContent here\n",
        )
        .unwrap();

        let state = test_state(tmp.path());
        {
            let mut cfg = state.config.write().unwrap();
            cfg.templates_path = Some(templates_dir.to_string_lossy().to_string());
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/templates")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let json = body_json(resp.into_body()).await;
        let templates = json.as_array().unwrap();
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0]["id"], "my-tpl");
        assert_eq!(templates[0]["name"], "My Template");
        assert_eq!(templates[0]["templateType"], "card");
        assert_eq!(templates[0]["description"], "A test template");
    }

    #[tokio::test]
    async fn get_template_not_found() {
        let tmp = tempfile::tempdir().unwrap();
        let templates_dir = tmp.path().join("templates");
        std::fs::create_dir_all(&templates_dir).unwrap();

        let state = test_state(tmp.path());
        {
            let mut cfg = state.config.write().unwrap();
            cfg.templates_path = Some(templates_dir.to_string_lossy().to_string());
        }

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/templates/nonexistent")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }
}
