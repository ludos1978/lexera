/// Tauri commands for export functionality: Marp CLI, Pandoc CLI, theme discovery.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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
pub struct ExportAssetCopyItem {
    pub source_path: String,
    pub target_path: String,
    pub max_bytes: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportAssetCopyResult {
    pub source_path: String,
    pub target_path: String,
    pub success: bool,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEmbeddedFileOptions {
    pub plugin_id: String,
    pub source_path: String,
    pub target_path: String,
    pub page_number: Option<u32>,
    pub output_format: Option<String>,
    #[serde(default)]
    pub force: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderEmbeddedFileResult {
    pub success: bool,
    pub output_path: String,
    pub format: String,
    pub error: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlantUmlOptions {
    pub code: String,
    pub target_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderPlantUmlResult {
    pub success: bool,
    pub svg: Option<String>,
    pub output_path: Option<String>,
    pub error: Option<String>,
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
pub struct EmbeddedRendererStatus {
    pub id: String,
    pub label: String,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
    pub details: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeInfo {
    pub name: String,
    pub path: String,
    pub builtin: bool,
}

fn create_temp_render_dir(prefix: &str) -> Result<PathBuf, String> {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("lexera-kanban-{}-{}-{}", prefix, std::process::id(), stamp));
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create temp render directory: {}", e))?;
    Ok(dir)
}

const CLI_PROBE_TIMEOUT_MS: u64 = 2_000;
const DRAWIO_RENDER_TIMEOUT_MS: u64 = 60_000;

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory {}: {}", parent.display(), e))?;
    }
    Ok(())
}

fn run_command_capture(command: &Path, args: &[String], cwd: Option<&Path>) -> Result<(), String> {
    let mut cmd = Command::new(command);
    cmd.args(args);
    if let Some(current_dir) = cwd {
        cmd.current_dir(current_dir);
    }
    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run {}: {}", command.display(), e))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("process exited with {}", output.status)
    };
    Err(detail)
}

fn run_command_output_with_timeout(
    command: &Path,
    args: &[&str],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    let mut cmd = Command::new(command);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(current_dir) = cwd {
        cmd.current_dir(current_dir);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to run {}: {}", command.display(), e))?;
    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to collect output for {}: {}", command.display(), e));
            }
            Ok(None) => {
                if started_at.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(format!(
                        "{} timed out after {}ms",
                        command.display(),
                        timeout.as_millis()
                    ));
                }
                thread::sleep(Duration::from_millis(25));
            }
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("Failed to wait for {}: {}", command.display(), e));
            }
        }
    }
}

fn run_command_capture_with_timeout(
    command: &Path,
    args: &[String],
    cwd: Option<&Path>,
    timeout: Duration,
) -> Result<(), String> {
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_command_output_with_timeout(command, &arg_refs, cwd, timeout)?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() {
        stderr
    } else if !stdout.is_empty() {
        stdout
    } else {
        format!("process exited with {}", output.status)
    };
    Err(detail)
}

fn probe_command(candidates: &[&str], probe_args: &[&str]) -> Option<PathBuf> {
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        let output = run_command_output_with_timeout(
            &path,
            probe_args,
            None,
            Duration::from_millis(CLI_PROBE_TIMEOUT_MS),
        );
        if output.as_ref().map(|o| o.status.success()).unwrap_or(false) {
            return Some(path);
        }
    }
    None
}

fn find_soffice_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = [
        "/Applications/LibreOffice.app/Contents/MacOS/soffice",
        "/opt/homebrew/bin/soffice",
        "/usr/local/bin/soffice",
        "soffice",
    ];
    #[cfg(target_os = "windows")]
    let candidates = [
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
        "soffice.exe",
    ];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = [
        "/usr/bin/soffice",
        "/usr/local/bin/soffice",
        "/usr/lib/libreoffice/program/soffice",
        "soffice",
    ];
    probe_command(&candidates, &["--version"])
}

fn find_drawio_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = [
        "/opt/homebrew/bin/drawio",
        "/usr/local/bin/drawio",
        "/opt/local/bin/drawio",
        "drawio",
        "/Applications/draw.io.app/Contents/MacOS/draw.io",
    ];
    #[cfg(target_os = "windows")]
    let candidates = ["drawio.exe", "drawio"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = ["/usr/bin/drawio", "/usr/local/bin/drawio", "drawio"];
    probe_command(&candidates, &["--version"])
}

fn find_pdftoppm_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = ["/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm", "pdftoppm"];
    #[cfg(target_os = "windows")]
    let candidates = [
        "C:\\Program Files\\poppler\\bin\\pdftoppm.exe",
        "C:\\Program Files\\poppler-utils\\bin\\pdftoppm.exe",
        "pdftoppm.exe",
    ];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = ["/usr/bin/pdftoppm", "/usr/local/bin/pdftoppm", "pdftoppm"];
    probe_command(&candidates, &["-v"])
}

fn find_mutool_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = ["/opt/homebrew/bin/mutool", "/usr/local/bin/mutool", "mutool"];
    #[cfg(target_os = "windows")]
    let candidates = [
        "C:\\Program Files\\mupdf\\mutool.exe",
        "C:\\Program Files\\MuPDF\\mutool.exe",
        "mutool.exe",
    ];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = ["/usr/bin/mutool", "/usr/local/bin/mutool", "mutool"];
    probe_command(&candidates, &["-v"])
}

fn find_node_cli() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let candidates = ["node.exe", "node"];
    #[cfg(not(target_os = "windows"))]
    let candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node", "node"];
    probe_command(&candidates, &["--version"])
}

fn find_java_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = [
        "/usr/bin/java",
        "/opt/homebrew/opt/openjdk/bin/java",
        "/usr/local/opt/openjdk/bin/java",
        "java",
    ];
    #[cfg(target_os = "windows")]
    let candidates = ["java.exe", "java"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = ["/usr/bin/java", "/usr/local/bin/java", "java"];
    probe_command(&candidates, &["-version"])
}

fn find_graphviz_dot_cli() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    let candidates = ["/opt/homebrew/bin/dot", "/usr/local/bin/dot", "/usr/bin/dot", "dot"];
    #[cfg(target_os = "windows")]
    let candidates = ["dot.exe", "dot"];
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let candidates = ["/usr/bin/dot", "/usr/local/bin/dot", "dot"];
    probe_command(&candidates, &["-V"])
}

fn repo_root_dir() -> Result<PathBuf, String> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .ok_or_else(|| "Failed to resolve repository root".to_string())
}

fn find_plantuml_jar() -> Option<PathBuf> {
    let repo_root = repo_root_dir().ok()?;
    let candidates = [
        repo_root.join("node_modules/node-plantuml/vendor/plantuml.jar"),
        repo_root.join("lexera-kanban/node_modules/node-plantuml/vendor/plantuml.jar"),
    ];
    candidates.into_iter().find(|path| path.is_file())
}

fn read_command_version(command: &Path, args: &[&str]) -> Option<String> {
    let output = run_command_output_with_timeout(
        command,
        args,
        None,
        Duration::from_millis(CLI_PROBE_TIMEOUT_MS),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let raw = if !stdout.is_empty() { stdout } else { stderr };
    raw.lines()
        .next()
        .map(|line| line.trim().to_string())
        .filter(|line| !line.is_empty())
}

fn normalize_plantuml_source(code: &str) -> String {
    let trimmed = code.trim();
    if trimmed.is_empty() {
        return "@startuml\n@enduml\n".to_string();
    }
    let has_explicit_start = trimmed
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(|line| line.trim().to_ascii_lowercase().starts_with("@start"))
        .unwrap_or(false);
    if has_explicit_start {
        let mut normalized = trimmed.to_string();
        if !normalized.ends_with('\n') {
            normalized.push('\n');
        }
        return normalized;
    }
    format!("@startuml\n{}\n@enduml\n", trimmed)
}

fn build_plantuml_renderer_status() -> EmbeddedRendererStatus {
    let java_path = find_java_cli();
    let jar_path = find_plantuml_jar();
    let dot_path = find_graphviz_dot_cli();
    let available = java_path.is_some() && jar_path.is_some();
    let mut details = Vec::new();
    if let Some(path) = jar_path.as_ref() {
        details.push(format!("JAR: {}", path.display()));
    } else {
        details.push("Missing PlantUML JAR (node-plantuml vendor package).".to_string());
    }
    if let Some(path) = dot_path.as_ref() {
        details.push(format!("Graphviz dot: {}", path.display()));
    } else {
        details.push("Graphviz dot not found; some diagram types may fail.".to_string());
    }
    EmbeddedRendererStatus {
        id: "plantuml".to_string(),
        label: "PlantUML".to_string(),
        available,
        version: java_path
            .as_ref()
            .and_then(|path| read_command_version(path, &["-version"])),
        path: java_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .or_else(|| jar_path.as_ref().map(|path| path.to_string_lossy().to_string())),
        details: Some(details.join(" | ")),
    }
}

fn render_plantuml_svg_content(code: &str) -> Result<String, String> {
    let java = find_java_cli().ok_or_else(|| "Java not found for PlantUML rendering".to_string())?;
    let jar = find_plantuml_jar().ok_or_else(|| "PlantUML JAR not found (node-plantuml vendor package missing)".to_string())?;
    let temp_dir = create_temp_render_dir("plantuml")?;
    let input_path = temp_dir.join("diagram.puml");
    let output_path = temp_dir.join("diagram.svg");

    fs::write(&input_path, normalize_plantuml_source(code))
        .map_err(|e| format!("Failed to write PlantUML source: {}", e))?;

    let mut args = vec![
        "-Djava.awt.headless=true".to_string(),
        "-jar".to_string(),
        jar.to_string_lossy().to_string(),
        "-Playout=smetana".to_string(),
        "-tsvg".to_string(),
    ];
    if let Some(dot) = find_graphviz_dot_cli() {
        args.push("-graphvizdot".to_string());
        args.push(dot.to_string_lossy().to_string());
    }
    args.push(input_path.to_string_lossy().to_string());

    let render_result = run_command_capture(&java, &args, Some(&temp_dir))
        .and_then(|_| fs::read_to_string(&output_path).map_err(|e| format!("Failed to read rendered PlantUML SVG: {}", e)));

    let _ = fs::remove_dir_all(&temp_dir);

    render_result.and_then(|svg| {
        if svg.contains("<svg") {
            Ok(svg)
        } else {
            Err("PlantUML produced invalid SVG output".to_string())
        }
    })
}

fn build_renderer_cli_status(
    id: &str,
    label: &str,
    cli_path: Option<PathBuf>,
    version_args: &[&str],
    details: &str,
) -> EmbeddedRendererStatus {
    if let Some(path) = cli_path {
        EmbeddedRendererStatus {
            id: id.to_string(),
            label: label.to_string(),
            available: true,
            version: read_command_version(&path, version_args),
            path: Some(path.to_string_lossy().to_string()),
            details: Some(details.to_string()),
        }
    } else {
        EmbeddedRendererStatus {
            id: id.to_string(),
            label: label.to_string(),
            available: false,
            version: None,
            path: None,
            details: Some(details.to_string()),
        }
    }
}

fn build_excalidraw_worker_asset_status() -> EmbeddedRendererStatus {
    let repo_root = match repo_root_dir() {
        Ok(path) => path,
        Err(err) => {
            return EmbeddedRendererStatus {
                id: "excalidraw-assets".to_string(),
                label: "Excalidraw Worker Assets".to_string(),
                available: false,
                version: None,
                path: None,
                details: Some(err),
            };
        }
    };

    let required = [
        "node_modules/react/umd/react.production.min.js",
        "node_modules/react-dom/umd/react-dom.production.min.js",
        "node_modules/@excalidraw/excalidraw/dist/excalidraw.production.min.js",
        "node_modules/playwright/package.json",
    ];
    let missing: Vec<String> = required
        .iter()
        .filter_map(|rel| {
            let full = repo_root.join(rel);
            if full.exists() {
                None
            } else {
                Some((*rel).to_string())
            }
        })
        .collect();

    EmbeddedRendererStatus {
        id: "excalidraw-assets".to_string(),
        label: "Excalidraw Worker Assets".to_string(),
        available: missing.is_empty(),
        version: None,
        path: Some(repo_root.to_string_lossy().to_string()),
        details: if missing.is_empty() {
            Some("Required React, Excalidraw, and Playwright assets are present.".to_string())
        } else {
            Some(format!("Missing {}", missing.join(", ")))
        },
    }
}

fn build_drawio_renderer_status() -> EmbeddedRendererStatus {
    build_renderer_cli_status(
        "drawio",
        "Draw.io CLI",
        find_drawio_cli(),
        &["--version"],
        "Required for .drawio preview and SVG export rendering.",
    )
}

fn build_soffice_renderer_status() -> EmbeddedRendererStatus {
    build_renderer_cli_status(
        "soffice",
        "LibreOffice",
        find_soffice_cli(),
        &["--version"],
        "Required for spreadsheet previews and office-document conversion.",
    )
}

fn build_pdftoppm_renderer_status() -> EmbeddedRendererStatus {
    build_renderer_cli_status(
        "pdftoppm",
        "Poppler pdftoppm",
        find_pdftoppm_cli(),
        &["-v"],
        "Required for PDF page rendering and office-document page image extraction.",
    )
}

fn build_mutool_renderer_status() -> EmbeddedRendererStatus {
    build_renderer_cli_status(
        "mutool",
        "MuPDF mutool",
        find_mutool_cli(),
        &["-v"],
        "Required for EPUB preview and export rendering.",
    )
}

fn build_node_renderer_status() -> EmbeddedRendererStatus {
    build_renderer_cli_status(
        "node",
        "Node.js",
        find_node_cli(),
        &["--version"],
        "Required for raw Excalidraw rendering through the local Playwright worker.",
    )
}

fn path_stem_lossy(path: &Path) -> String {
    path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("render")
        .to_string()
}

fn find_generated_file_with_prefix(dir: &Path, prefix: &str, extension: &str) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    let wanted_ext = format!(".{}", extension.trim_start_matches('.')).to_lowercase();
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to scan {}: {}", dir.display(), e))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        if lower.starts_with(&prefix.to_lowercase()) && lower.ends_with(&wanted_ext) {
            candidates.push(path);
        }
    }
    candidates.sort();
    candidates
        .into_iter()
        .next()
        .ok_or_else(|| format!("Expected rendered {} output for prefix {}", extension, prefix))
}

fn find_spreadsheet_png(dir: &Path, base_name: &str, sheet_number: u32) -> Result<PathBuf, String> {
    let mut pngs = Vec::new();
    let read_dir = fs::read_dir(dir).map_err(|e| format!("Failed to scan {}: {}", dir.display(), e))?;
    for entry in read_dir.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|v| v.to_str()) else {
            continue;
        };
        let lower = name.to_lowercase();
        if lower.starts_with(&base_name.to_lowercase()) && lower.ends_with(".png") {
            pngs.push(path);
        }
    }
    pngs.sort();
    if pngs.is_empty() {
        return Err("LibreOffice conversion finished without any PNG output".to_string());
    }
    if pngs.len() == 1 {
        return Ok(pngs.remove(0));
    }

    let patterns = [
        format!("{}-sheet{}.png", base_name, sheet_number),
        format!("{}-{}.png", base_name, sheet_number),
        format!("{}_sheet{}.png", base_name, sheet_number),
        format!("{}_{}.png", base_name, sheet_number),
    ];

    for pattern in &patterns {
        for candidate in &pngs {
            if candidate
                .file_name()
                .and_then(|v| v.to_str())
                .map(|v| v.eq_ignore_ascii_case(pattern))
                .unwrap_or(false)
            {
                return Ok(candidate.clone());
            }
        }
    }

    let index = sheet_number.saturating_sub(1) as usize;
    Ok(pngs.get(index).cloned().unwrap_or_else(|| pngs[0].clone()))
}

fn render_drawio_file(source_path: &Path, target_path: &Path, output_format: &str) -> Result<(), String> {
    let cli = find_drawio_cli().ok_or_else(|| "draw.io CLI not found".to_string())?;
    let temp_dir = create_temp_render_dir("drawio")?;
    let rendered_path = temp_dir.join(format!("rendered.{}", output_format));
    let mut args = vec![
        "--export".to_string(),
        "--format".to_string(),
        output_format.to_string(),
        "--output".to_string(),
        rendered_path.to_string_lossy().to_string(),
        source_path.to_string_lossy().to_string(),
    ];
    if output_format.eq_ignore_ascii_case("png") {
        args.push("--transparent".to_string());
    }
    let result = (|| {
        run_command_capture_with_timeout(
            &cli,
            &args,
            source_path.parent(),
            Duration::from_millis(DRAWIO_RENDER_TIMEOUT_MS),
        )?;
        if !rendered_path.is_file() {
            return Err(format!("draw.io did not create {}", rendered_path.display()));
        }
        ensure_parent_dir(target_path)?;
        fs::copy(&rendered_path, target_path)
            .map_err(|e| format!("Failed to copy rendered draw.io output: {}", e))?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn render_spreadsheet_file(source_path: &Path, target_path: &Path, sheet_number: u32) -> Result<(), String> {
    let cli = find_soffice_cli().ok_or_else(|| "LibreOffice CLI not found".to_string())?;
    let temp_dir = create_temp_render_dir("xlsx")?;
    let result = (|| {
        let args = vec![
            "--headless".to_string(),
            "--convert-to".to_string(),
            "png".to_string(),
            "--outdir".to_string(),
            temp_dir.to_string_lossy().to_string(),
            source_path.to_string_lossy().to_string(),
        ];
        run_command_capture(&cli, &args, source_path.parent())?;
        let rendered = find_spreadsheet_png(&temp_dir, &path_stem_lossy(source_path), sheet_number)?;
        ensure_parent_dir(target_path)?;
        fs::copy(&rendered, target_path).map_err(|e| format!("Failed to copy rendered spreadsheet: {}", e))?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn count_unquoted_delimiter(line: &str, delimiter: char) -> usize {
    let mut count = 0usize;
    let mut chars = line.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if in_quotes {
            if ch == '"' {
                if matches!(chars.peek(), Some('"')) {
                    let _ = chars.next();
                } else {
                    in_quotes = false;
                }
            }
            continue;
        }

        match ch {
            '"' => in_quotes = true,
            _ if ch == delimiter => count += 1,
            _ => {}
        }
    }

    count
}

fn detect_delimited_text_separator(source: &str) -> char {
    let mut best = (',', 0usize);

    for line in source.lines().take(8) {
        if line.trim().is_empty() {
            continue;
        }
        for delimiter in [',', ';', '\t', '|'] {
            let score = count_unquoted_delimiter(line, delimiter);
            if score > best.1 {
                best = (delimiter, score);
            }
        }
    }

    best.0
}

fn parse_delimited_rows(source: &str, delimiter: char) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut chars = source.chars().peekable();
    let mut in_quotes = false;

    while let Some(ch) = chars.next() {
        if in_quotes {
            match ch {
                '"' => {
                    if matches!(chars.peek(), Some('"')) {
                        field.push('"');
                        let _ = chars.next();
                    } else {
                        in_quotes = false;
                    }
                }
                _ => field.push(ch),
            }
            continue;
        }

        match ch {
            '"' => in_quotes = true,
            _ if ch == delimiter => row.push(std::mem::take(&mut field)),
            '\r' => {
                if matches!(chars.peek(), Some('\n')) {
                    let _ = chars.next();
                }
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            '\n' => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            _ => field.push(ch),
        }
    }

    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }

    if let Some(first_row) = rows.first_mut() {
        if let Some(first_cell) = first_row.first_mut() {
            *first_cell = first_cell.trim_start_matches('\u{feff}').to_string();
        }
    }

    rows
}

fn escape_svg_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn truncate_svg_cell_text(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    let char_count = trimmed.chars().count();
    if char_count <= max_chars {
        return trimmed.to_string();
    }
    let mut out = String::new();
    for (idx, ch) in trimmed.chars().enumerate() {
        if idx + 3 >= max_chars {
            break;
        }
        out.push(ch);
    }
    out.push_str("...");
    out
}

fn delimiter_label(delimiter: char) -> &'static str {
    match delimiter {
        ';' => "semicolon",
        '\t' => "tab",
        '|' => "pipe",
        _ => "comma",
    }
}

fn render_csv_text_to_svg(source: &str, title: &str, page_number: u32) -> String {
    let delimiter = detect_delimited_text_separator(source);
    let rows = parse_delimited_rows(source, delimiter);

    let max_body_rows = 18usize;
    let max_columns = 8usize;
    let title_text = if title.trim().is_empty() {
        "CSV table"
    } else {
        title.trim()
    };

    let mut normalized_rows = if rows.is_empty() {
        vec![vec!["Empty CSV".to_string()]]
    } else {
        rows
    };

    let total_columns = normalized_rows.iter().map(|row| row.len()).max().unwrap_or(1).max(1);
    for row in &mut normalized_rows {
        while row.len() < total_columns {
            row.push(String::new());
        }
    }

    let header = normalized_rows
        .first()
        .cloned()
        .unwrap_or_else(|| vec!["Column 1".to_string()]);
    let body_rows = if normalized_rows.len() > 1 {
        normalized_rows[1..].to_vec()
    } else {
        Vec::new()
    };

    let page_index = page_number.saturating_sub(1) as usize;
    let body_start = page_index
        .saturating_mul(max_body_rows)
        .min(body_rows.len());
    let body_end = body_start.saturating_add(max_body_rows).min(body_rows.len());
    let visible_columns = total_columns.min(max_columns);

    let mut display_rows = Vec::new();
    display_rows.push(header[..visible_columns].to_vec());
    for row in body_rows[body_start..body_end].iter() {
        display_rows.push(row[..visible_columns].to_vec());
    }
    if display_rows.len() == 1 {
        display_rows.push(vec!["No data rows".to_string(); visible_columns]);
    }

    let mut col_widths = vec![120f32; visible_columns];
    for (col_idx, col_width) in col_widths.iter_mut().enumerate() {
        let mut width = 120f32;
        for row in &display_rows {
            let cell = row.get(col_idx).map(|value| value.as_str()).unwrap_or("");
            let chars = cell.chars().count().min(36) as f32;
            width = width.max(28.0 + chars * 7.2);
        }
        *col_width = width.min(280.0);
    }

    let header_height = 36f32;
    let row_height = 32f32;
    let title_height = 32f32;
    let meta_height = 24f32;
    let footer_height = 22f32;
    let outer_padding = 18f32;
    let table_width: f32 = col_widths.iter().sum();
    let width = outer_padding * 2.0 + table_width;
    let height = outer_padding * 2.0 + title_height + meta_height + footer_height + row_height * display_rows.len() as f32;

    let row_from = if body_start < body_rows.len() { body_start + 1 } else { 0 };
    let row_to = if body_start < body_rows.len() { body_end } else { 0 };
    let footer_note = if total_columns > visible_columns {
        format!("Showing {} of {} columns", visible_columns, total_columns)
    } else if body_end < body_rows.len() {
        format!("Showing rows {}-{} of {}", row_from, row_to, body_rows.len())
    } else {
        format!("Rows {} | Columns {}", body_rows.len(), total_columns)
    };

    let mut svg = String::new();
    svg.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{:.0}\" height=\"{:.0}\" viewBox=\"0 0 {:.0} {:.0}\">",
        width, height, width, height
    ));
    svg.push_str("<rect width=\"100%\" height=\"100%\" fill=\"#f6f1e8\"/>");
    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"18\" font-weight=\"700\" fill=\"#1d1d1d\">{}</text>",
        outer_padding,
        outer_padding + 20.0,
        escape_svg_text(title_text)
    ));
    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" fill=\"#4f4a45\">Delimiter: {} | Page {}</text>",
        outer_padding,
        outer_padding + title_height + 4.0,
        escape_svg_text(delimiter_label(delimiter)),
        page_number.max(1)
    ));

    let table_top = outer_padding + title_height + meta_height;
    let mut x = outer_padding;

    for (col_idx, col_width) in col_widths.iter().enumerate() {
        let header_value = truncate_svg_cell_text(display_rows[0].get(col_idx).map(|v| v.as_str()).unwrap_or(""), 28);
        svg.push_str(&format!(
            "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"#2f4f4f\" rx=\"4\" ry=\"4\"/>",
            x, table_top, col_width, header_height
        ));
        svg.push_str(&format!(
            "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" font-weight=\"700\" fill=\"#ffffff\">{}</text>",
            x + 10.0,
            table_top + 22.0,
            escape_svg_text(&header_value)
        ));
        x += col_width;
    }

    for (row_idx, row) in display_rows.iter().enumerate().skip(1) {
        let y = table_top + header_height + row_height * (row_idx as f32 - 1.0);
        let fill = if row_idx % 2 == 1 { "#fffdf9" } else { "#f0e8da" };
        let mut cell_x = outer_padding;
        for (col_idx, col_width) in col_widths.iter().enumerate() {
            svg.push_str(&format!(
                "<rect x=\"{:.1}\" y=\"{:.1}\" width=\"{:.1}\" height=\"{:.1}\" fill=\"{}\" stroke=\"#d7c9b1\" stroke-width=\"1\"/>",
                cell_x, y, col_width, row_height, fill
            ));
            let cell_value = truncate_svg_cell_text(row.get(col_idx).map(|v| v.as_str()).unwrap_or(""), 36);
            svg.push_str(&format!(
                "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"12\" fill=\"#2b2b2b\">{}</text>",
                cell_x + 10.0,
                y + 20.0,
                escape_svg_text(&cell_value)
            ));
            cell_x += col_width;
        }
    }

    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" fill=\"#5b5246\">{}</text>",
        outer_padding,
        height - outer_padding + 4.0,
        escape_svg_text(&footer_note)
    ));
    svg.push_str("</svg>");
    svg
}

fn render_plaintext_to_svg(source: &str, title: &str, page_number: u32) -> String {
    let max_lines_per_page = 30usize;
    let max_line_chars = 80usize;
    let title_text = if title.trim().is_empty() { "Text file" } else { title.trim() };

    let all_lines: Vec<&str> = source.lines().collect();
    let total_lines = all_lines.len().max(1);
    let page_index = page_number.saturating_sub(1) as usize;
    let start = (page_index * max_lines_per_page).min(total_lines);
    let end = (start + max_lines_per_page).min(total_lines);
    let visible_lines = if start < total_lines {
        &all_lines[start..end]
    } else {
        &[] as &[&str]
    };

    let line_height = 18f32;
    let title_height = 32f32;
    let meta_height = 22f32;
    let footer_height = 22f32;
    let outer_padding = 18f32;
    let content_height = line_height * visible_lines.len().max(1) as f32;
    let width = outer_padding * 2.0 + max_line_chars as f32 * 7.4 + 20.0;
    let height = outer_padding * 2.0 + title_height + meta_height + content_height + footer_height;

    let total_pages = total_lines.div_ceil(max_lines_per_page);
    let footer_note = format!(
        "Lines {}-{} of {} | Page {} of {}",
        if start < total_lines { start + 1 } else { 0 },
        end,
        total_lines,
        page_number.max(1),
        total_pages
    );

    let mut svg = String::new();
    svg.push_str(&format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{:.0}\" height=\"{:.0}\" viewBox=\"0 0 {:.0} {:.0}\">",
        width, height, width, height
    ));
    svg.push_str("<rect width=\"100%\" height=\"100%\" fill=\"#f6f1e8\"/>");
    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"18\" font-weight=\"700\" fill=\"#1d1d1d\">{}</text>",
        outer_padding,
        outer_padding + 20.0,
        escape_svg_text(title_text)
    ));
    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" fill=\"#4f4a45\">Plain text | Page {}</text>",
        outer_padding,
        outer_padding + title_height + 4.0,
        page_number.max(1)
    ));

    let content_top = outer_padding + title_height + meta_height;
    if visible_lines.is_empty() {
        svg.push_str(&format!(
            "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-monospace, monospace\" font-size=\"12\" fill=\"#8a8078\">Empty file</text>",
            outer_padding + 8.0,
            content_top + 14.0
        ));
    } else {
        for (i, line) in visible_lines.iter().enumerate() {
            let y = content_top + line_height * i as f32 + 14.0;
            let line_num = start + i + 1;
            svg.push_str(&format!(
                "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-monospace, monospace\" font-size=\"11\" fill=\"#8a8078\">{:>4}</text>",
                outer_padding,
                y,
                line_num
            ));
            let truncated = if line.chars().count() > max_line_chars {
                let s: String = line.chars().take(max_line_chars - 3).collect();
                format!("{}...", s)
            } else {
                line.to_string()
            };
            svg.push_str(&format!(
                "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-monospace, monospace\" font-size=\"12\" fill=\"#2b2b2b\">{}</text>",
                outer_padding + 40.0,
                y,
                escape_svg_text(&truncated)
            ));
        }
    }

    svg.push_str(&format!(
        "<text x=\"{:.1}\" y=\"{:.1}\" font-family=\"ui-sans-serif, system-ui, sans-serif\" font-size=\"11\" fill=\"#5b5246\">{}</text>",
        outer_padding,
        height - outer_padding + 4.0,
        escape_svg_text(&footer_note)
    ));
    svg.push_str("</svg>");
    svg
}

fn render_plaintext_file(source_path: &Path, target_path: &Path, page_number: u32) -> Result<(), String> {
    let output_format = target_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if output_format != "svg" {
        return Err("Plain text rendering currently supports SVG output only".to_string());
    }
    let source = fs::read_to_string(source_path)
        .map_err(|e| format!("Failed to read text source {}: {}", source_path.display(), e))?;
    let title = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Text file");
    let svg = render_plaintext_to_svg(&source, title, page_number);
    ensure_parent_dir(target_path)?;
    fs::write(target_path, svg)
        .map_err(|e| format!("Failed to write text SVG {}: {}", target_path.display(), e))?;
    Ok(())
}

fn render_csv_file(source_path: &Path, target_path: &Path, page_number: u32) -> Result<(), String> {
    let output_format = target_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_lowercase();
    if output_format != "svg" {
        return Err("CSV rendering currently supports SVG output only".to_string());
    }

    let source = fs::read_to_string(source_path)
        .map_err(|e| format!("Failed to read CSV source {}: {}", source_path.display(), e))?;
    let title = source_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("CSV table");
    let svg = render_csv_text_to_svg(&source, title, page_number);
    ensure_parent_dir(target_path)?;
    fs::write(target_path, svg)
        .map_err(|e| format!("Failed to write CSV SVG {}: {}", target_path.display(), e))?;
    Ok(())
}

fn render_pdf_page_to_png(source_path: &Path, target_path: &Path, page_number: u32, dpi: u32) -> Result<(), String> {
    let cli = find_pdftoppm_cli().ok_or_else(|| "pdftoppm CLI not found".to_string())?;
    let temp_dir = create_temp_render_dir("pdf")?;
    let result = (|| {
        let prefix = temp_dir.join("page");
        let args = vec![
            "-png".to_string(),
            "-f".to_string(),
            page_number.to_string(),
            "-l".to_string(),
            page_number.to_string(),
            "-r".to_string(),
            dpi.to_string(),
            source_path.to_string_lossy().to_string(),
            prefix.to_string_lossy().to_string(),
        ];
        run_command_capture(&cli, &args, source_path.parent())?;
        let rendered = find_generated_file_with_prefix(&temp_dir, "page", "png")?;
        ensure_parent_dir(target_path)?;
        fs::copy(&rendered, target_path).map_err(|e| format!("Failed to copy rendered PDF page: {}", e))?;
        Ok(())
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn render_document_file(source_path: &Path, target_path: &Path, page_number: u32) -> Result<(), String> {
    let soffice = find_soffice_cli().ok_or_else(|| "LibreOffice CLI not found".to_string())?;
    let temp_dir = create_temp_render_dir("document")?;
    let result = (|| {
        let args = vec![
            "--headless".to_string(),
            "--convert-to".to_string(),
            "pdf".to_string(),
            "--outdir".to_string(),
            temp_dir.to_string_lossy().to_string(),
            source_path.to_string_lossy().to_string(),
        ];
        run_command_capture(&soffice, &args, source_path.parent())?;
        let rendered_pdf = temp_dir.join(format!("{}.pdf", path_stem_lossy(source_path)));
        if !rendered_pdf.is_file() {
            return Err("LibreOffice conversion finished without PDF output".to_string());
        }
        render_pdf_page_to_png(&rendered_pdf, target_path, page_number, 150)
    })();
    let _ = fs::remove_dir_all(&temp_dir);
    result
}

fn render_epub_file(source_path: &Path, target_path: &Path, page_number: u32) -> Result<(), String> {
    let cli = find_mutool_cli().ok_or_else(|| "mutool CLI not found".to_string())?;
    ensure_parent_dir(target_path)?;
    let args = vec![
        "draw".to_string(),
        "-r".to_string(),
        "150".to_string(),
        "-o".to_string(),
        target_path.to_string_lossy().to_string(),
        source_path.to_string_lossy().to_string(),
        page_number.to_string(),
    ];
    run_command_capture(&cli, &args, source_path.parent())?;
    if !target_path.is_file() {
        return Err(format!("mutool did not create {}", target_path.display()));
    }
    Ok(())
}

fn render_excalidraw_file(source_path: &Path, target_path: &Path, output_format: &str) -> Result<(), String> {
    if output_format.eq_ignore_ascii_case("svg")
        && source_path
            .file_name()
            .and_then(|v| v.to_str())
            .map(|v| v.to_lowercase().ends_with(".excalidraw.svg"))
            .unwrap_or(false)
    {
        ensure_parent_dir(target_path)?;
        fs::copy(source_path, target_path)
            .map_err(|e| format!("Failed to copy rendered Excalidraw SVG: {}", e))?;
        return Ok(());
    }

    if !output_format.eq_ignore_ascii_case("svg") {
        return Err("Excalidraw rendering currently supports SVG output only".to_string());
    }

    let node = find_node_cli().ok_or_else(|| "Node.js not found for Excalidraw rendering".to_string())?;
    let worker = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("scripts").join("excalidraw-worker.cjs");
    let repo_root = repo_root_dir()?;
    ensure_parent_dir(target_path)?;

    let args = vec![
        worker.to_string_lossy().to_string(),
        source_path.to_string_lossy().to_string(),
        target_path.to_string_lossy().to_string(),
        repo_root.to_string_lossy().to_string(),
    ];
    run_command_capture(&node, &args, Some(&repo_root))?;

    if !target_path.is_file() {
        return Err(format!("Excalidraw worker did not create {}", target_path.display()));
    }
    Ok(())
}

type EmbeddedRenderFn = fn(&Path, &Path, u32, &str) -> Result<(), String>;

struct EmbeddedRendererDefinition {
    id: &'static str,
    render: EmbeddedRenderFn,
}

struct EmbeddedRendererStatusDefinition {
    build_status: fn() -> EmbeddedRendererStatus,
}

fn render_drawio_embedded(source_path: &Path, target_path: &Path, _page_number: u32, output_format: &str) -> Result<(), String> {
    render_drawio_file(source_path, target_path, output_format)
}

fn render_excalidraw_embedded(source_path: &Path, target_path: &Path, _page_number: u32, output_format: &str) -> Result<(), String> {
    render_excalidraw_file(source_path, target_path, output_format)
}

fn render_spreadsheet_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_spreadsheet_file(source_path, target_path, page_number)
}

fn render_csv_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_csv_file(source_path, target_path, page_number)
}

fn render_plaintext_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_plaintext_file(source_path, target_path, page_number)
}

fn render_pdf_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_pdf_page_to_png(source_path, target_path, page_number, 150)
}

fn render_document_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_document_file(source_path, target_path, page_number)
}

fn render_epub_embedded(source_path: &Path, target_path: &Path, page_number: u32, _output_format: &str) -> Result<(), String> {
    render_epub_file(source_path, target_path, page_number)
}

const EMBEDDED_RENDERERS: &[EmbeddedRendererDefinition] = &[
    EmbeddedRendererDefinition { id: "drawio", render: render_drawio_embedded },
    EmbeddedRendererDefinition { id: "excalidraw", render: render_excalidraw_embedded },
    EmbeddedRendererDefinition { id: "xlsx", render: render_spreadsheet_embedded },
    EmbeddedRendererDefinition { id: "csv", render: render_csv_embedded },
    EmbeddedRendererDefinition { id: "tsv", render: render_csv_embedded },
    EmbeddedRendererDefinition { id: "plaintext", render: render_plaintext_embedded },
    EmbeddedRendererDefinition { id: "pdf", render: render_pdf_embedded },
    EmbeddedRendererDefinition { id: "document", render: render_document_embedded },
    EmbeddedRendererDefinition { id: "epub", render: render_epub_embedded },
];

const EMBEDDED_RENDERER_STATUSES: &[EmbeddedRendererStatusDefinition] = &[
    EmbeddedRendererStatusDefinition { build_status: build_plantuml_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_drawio_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_soffice_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_pdftoppm_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_mutool_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_node_renderer_status },
    EmbeddedRendererStatusDefinition { build_status: build_excalidraw_worker_asset_status },
];

fn find_embedded_renderer(plugin_id: &str) -> Option<&'static EmbeddedRendererDefinition> {
    EMBEDDED_RENDERERS.iter().find(|renderer| renderer.id == plugin_id)
}

fn collect_marp_scan_dirs(dirs: &[String]) -> Vec<PathBuf> {
    let mut scan_dirs: Vec<PathBuf> = dirs.iter().map(PathBuf::from).collect();

    if let Some(home) = dirs::home_dir() {
        for common in &[".marp/themes", "themes", "_themes", "assets/themes"] {
            scan_dirs.push(home.join(common));
        }
    }

    scan_dirs
}

fn is_marp_theme_file(path: &Path) -> bool {
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
    name.ends_with(".marp.css") || name.ends_with(".css")
}

fn collect_marp_theme_files(scan_dirs: &[PathBuf]) -> Vec<PathBuf> {
    let mut seen = BTreeSet::new();
    let mut files = Vec::new();

    for dir in scan_dirs {
        if !dir.is_dir() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || !is_marp_theme_file(&path) {
                    continue;
                }
                let key = path.to_string_lossy().to_string();
                if seen.insert(key) {
                    files.push(path);
                }
            }
        }
    }

    files
}

fn strip_css_comments(source: &str) -> String {
    let mut out = String::with_capacity(source.len());
    let bytes = source.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }

    out
}

fn insert_selector_class_names(selector: &str, out: &mut BTreeSet<String>) {
    let trimmed = selector.trim();
    if trimmed.is_empty() || trimmed.starts_with('@') {
        return;
    }

    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '.' {
            let next = chars.get(i + 1).copied();
            if matches!(next, Some(ch) if ch.is_ascii_alphabetic() || ch == '_') {
                let mut j = i + 1;
                while j < chars.len() {
                    let ch = chars[j];
                    if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                        j += 1;
                    } else {
                        break;
                    }
                }
                if j > i + 1 {
                    let class_name: String = chars[i + 1..j].iter().collect();
                    if !class_name.is_empty() {
                        out.insert(class_name);
                    }
                }
                i = j;
                continue;
            }
        }
        i += 1;
    }
}

fn extract_marp_classes_from_css(source: &str) -> Vec<String> {
    let stripped = strip_css_comments(source);
    let mut classes = BTreeSet::new();
    let mut selector_buffer = String::new();

    for ch in stripped.chars() {
        if ch == '{' {
            insert_selector_class_names(&selector_buffer, &mut classes);
            selector_buffer.clear();
            continue;
        }
        if ch == '}' {
            selector_buffer.clear();
            continue;
        }
        selector_buffer.push(ch);
    }

    classes.into_iter().collect()
}

fn insert_marp_config_classes(scan_dirs: &[PathBuf], out: &mut BTreeSet<String>) {
    let mut seen = BTreeSet::new();

    for dir in scan_dirs {
        for ancestor in dir.ancestors() {
            let config_path = ancestor.join(".kanban").join("marp.json");
            let key = config_path.to_string_lossy().to_string();
            if !seen.insert(key) || !config_path.is_file() {
                continue;
            }

            let Ok(raw) = std::fs::read_to_string(&config_path) else {
                continue;
            };
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&raw) else {
                continue;
            };
            let Some(classes) = json.get("availableClasses").and_then(|value| value.as_array()) else {
                continue;
            };

            for class_name in classes {
                let Some(class_name) = class_name.as_str() else {
                    continue;
                };
                let trimmed = class_name.trim();
                if !trimmed.is_empty() {
                    out.insert(trimmed.to_string());
                }
            }
        }
    }
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
    if let Ok(output) = Command::new("npx")
        .args(["--yes", "@marp-team/marp-cli", "--version"])
        .output()
    {
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

/// Resolve the path to the custom Marp engine (packages/marp-engine/engine/engine.js).
/// The engine registers all markdown-it plugins Lexera uses (mark, ins, sub, sup,
/// underline, strikethrough-alt, abbr, multicolumn, anchor, toc-done-right,
/// mermaid-it, checkboxes, deflist, include, media) so Marp output matches the V1 app.
///
/// Search order: binary dir, current dir, and a few ancestors of each — covers
/// `cargo tauri dev` (runs from lexera-kanban/src-tauri/) and built-app locations.
#[tauri::command]
pub fn get_marp_engine_path() -> Result<Option<String>, String> {
    let relative = Path::new("packages").join("marp-engine").join("engine").join("engine.js");

    let mut seeds: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        seeds.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            seeds.push(parent.to_path_buf());
        }
    }

    for seed in &seeds {
        let mut current = Some(seed.as_path());
        for _ in 0..8 {
            let Some(dir) = current else { break };
            let candidate = dir.join(&relative);
            if candidate.is_file() {
                let node_modules = candidate
                    .parent()
                    .map(|p| p.join("node_modules"))
                    .filter(|p| p.is_dir());
                if node_modules.is_none() {
                    log::warn!(
                        "[export] Found Marp engine at {} but node_modules missing — run build-marp-engine.sh",
                        candidate.display()
                    );
                    return Ok(None);
                }
                return Ok(Some(candidate.to_string_lossy().to_string()));
            }
            current = dir.parent();
        }
    }
    Ok(None)
}

#[tauri::command]
pub async fn render_embedded_file(opts: RenderEmbeddedFileOptions) -> Result<RenderEmbeddedFileResult, String> {
    let source_path = PathBuf::from(&opts.source_path);
    let target_path = PathBuf::from(&opts.target_path);
    let page_number = opts.page_number.unwrap_or(1).max(1);
    let output_format = opts
        .output_format
        .clone()
        .unwrap_or_else(|| "png".to_string())
        .to_lowercase();

    if !source_path.is_file() {
        return Ok(RenderEmbeddedFileResult {
            success: false,
            output_path: opts.target_path,
            format: output_format,
            error: Some("Source file not found".to_string()),
        });
    }

    let force = opts.force.unwrap_or(false);
    if target_path.is_file() {
        if force {
            let _ = fs::remove_file(&target_path);
        } else {
            return Ok(RenderEmbeddedFileResult {
                success: true,
                output_path: opts.target_path,
                format: output_format,
                error: None,
            });
        }
    }

    let render_result = if let Some(renderer) = find_embedded_renderer(&opts.plugin_id) {
        (renderer.render)(&source_path, &target_path, page_number, &output_format)
    } else {
        Err(format!("Unknown embedded file renderer: {}", opts.plugin_id))
    };

    match render_result {
        Ok(()) => Ok(RenderEmbeddedFileResult {
            success: true,
            output_path: opts.target_path,
            format: output_format,
            error: None,
        }),
        Err(err) => Ok(RenderEmbeddedFileResult {
            success: false,
            output_path: opts.target_path,
            format: output_format,
            error: Some(err),
        }),
    }
}

#[tauri::command]
pub async fn render_plantuml_code(opts: RenderPlantUmlOptions) -> Result<RenderPlantUmlResult, String> {
    if let Some(target) = opts.target_path.as_ref() {
        let target_path = PathBuf::from(target);
        if target_path.is_file() {
            let svg = fs::read_to_string(&target_path)
                .map_err(|e| format!("Failed to read cached PlantUML SVG: {}", e))?;
            return Ok(RenderPlantUmlResult {
                success: true,
                svg: Some(svg),
                output_path: Some(target.clone()),
                error: None,
            });
        }
    }

    match render_plantuml_svg_content(&opts.code) {
        Ok(svg) => {
            if let Some(target) = opts.target_path.as_ref() {
                let target_path = PathBuf::from(target);
                ensure_parent_dir(&target_path)?;
                fs::write(&target_path, svg.as_bytes())
                    .map_err(|e| format!("Failed to write PlantUML cache {}: {}", target_path.display(), e))?;
            }
            Ok(RenderPlantUmlResult {
                success: true,
                svg: Some(svg),
                output_path: opts.target_path,
                error: None,
            })
        }
        Err(err) => Ok(RenderPlantUmlResult {
            success: false,
            svg: None,
            output_path: opts.target_path,
            error: Some(err),
        }),
    }
}

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
        (
            "npx",
            vec!["--yes".to_string(), "@marp-team/marp-cli".to_string()],
        )
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
        (
            "npx",
            vec!["--yes".to_string(), "@marp-team/marp-cli".to_string()],
        )
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
    if let Some(ref browser) = opts.browser {
        if browser != "auto" && !browser.is_empty() {
            args.push("--browser".to_string());
            args.push(browser.clone());
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
pub async fn marp_stop_all_watches(watch_state: State<'_, MarpWatchState>) -> Result<u32, String> {
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
    let pandoc = find_pandoc().ok_or_else(|| {
        "Pandoc not found. Install from https://pandoc.org/installing.html".to_string()
    })?;

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
        let cmd = if marp_path == Path::new("npx") {
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

/// Check availability for the local renderers used by embedded-file preview/export.
#[tauri::command]
pub async fn check_embedded_renderer_statuses() -> Vec<EmbeddedRendererStatus> {
    EMBEDDED_RENDERER_STATUSES
        .iter()
        .map(|status| (status.build_status)())
        .collect()
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TestRenderAppsRequest {
    #[serde(default)]
    pub drawio: Option<String>,
    #[serde(default)]
    pub marp: Option<String>,
    #[serde(default)]
    pub pandoc: Option<String>,
    #[serde(default)]
    pub soffice: Option<String>,
    #[serde(default)]
    pub pdftoppm: Option<String>,
    #[serde(default)]
    pub mutool: Option<String>,
    #[serde(default)]
    pub functional: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderAppTestResult {
    pub ok: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub source: String,
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub functional: Option<FunctionalResult>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FunctionalResult {
    pub ok: bool,
    pub details: Option<String>,
    pub error: Option<String>,
    pub duration_ms: u64,
}

fn normalize_user_path(raw: Option<String>) -> Option<String> {
    raw.and_then(|s| {
        let trimmed = s.trim();
        if trimmed.is_empty() { None } else { Some(trimmed.to_string()) }
    })
}

fn test_tool_with_auto(
    user_path: Option<String>,
    auto_finder: fn() -> Option<PathBuf>,
    version_args: &[&str],
) -> RenderAppTestResult {
    if let Some(user) = normalize_user_path(user_path) {
        let path_buf = PathBuf::from(&user);
        return match read_command_version(&path_buf, version_args) {
            Some(version) => RenderAppTestResult {
                ok: true,
                path: Some(user),
                version: Some(version),
                source: "user".to_string(),
                error: None,
                functional: None,
            },
            None => RenderAppTestResult {
                ok: false,
                path: Some(user),
                version: None,
                source: "user".to_string(),
                error: Some("Configured path failed to execute".to_string()),
                functional: None,
            },
        };
    }
    match auto_finder() {
        Some(path_buf) => match read_command_version(&path_buf, version_args) {
            Some(version) => RenderAppTestResult {
                ok: true,
                path: Some(path_buf.to_string_lossy().to_string()),
                version: Some(version),
                source: "auto".to_string(),
                error: None,
                functional: None,
            },
            None => RenderAppTestResult {
                ok: false,
                path: Some(path_buf.to_string_lossy().to_string()),
                version: None,
                source: "auto".to_string(),
                error: Some("Detected executable failed to run".to_string()),
                functional: None,
            },
        },
        None => RenderAppTestResult {
            ok: false,
            path: None,
            version: None,
            source: "missing".to_string(),
            error: Some("Not found on system".to_string()),
            functional: None,
        },
    }
}

fn test_marp(user_path: Option<String>) -> RenderAppTestResult {
    if let Some(user) = normalize_user_path(user_path) {
        let path_buf = PathBuf::from(&user);
        return match read_command_version(&path_buf, &["--version"]) {
            Some(version) => RenderAppTestResult {
                ok: true,
                path: Some(user),
                version: Some(version),
                source: "user".to_string(),
                error: None,
                functional: None,
            },
            None => RenderAppTestResult {
                ok: false,
                path: Some(user),
                version: None,
                source: "user".to_string(),
                error: Some("Configured path failed to execute".to_string()),
                functional: None,
            },
        };
    }
    if let Ok(output) = Command::new("npx")
        .args(["--yes", "@marp-team/marp-cli", "--version"])
        .output()
    {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            return RenderAppTestResult {
                ok: true,
                path: Some("npx @marp-team/marp-cli".to_string()),
                version,
                source: "auto".to_string(),
                error: None,
                functional: None,
            };
        }
    }
    if let Ok(output) = Command::new("marp").arg("--version").output() {
        if output.status.success() {
            let version = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());
            return RenderAppTestResult {
                ok: true,
                path: Some("marp".to_string()),
                version,
                source: "auto".to_string(),
                error: None,
                functional: None,
            };
        }
    }
    RenderAppTestResult {
        ok: false,
        path: None,
        version: None,
        source: "missing".to_string(),
        error: Some("Not found on system".to_string()),
        functional: None,
    }
}

fn test_pandoc(user_path: Option<String>) -> RenderAppTestResult {
    if let Some(user) = normalize_user_path(user_path) {
        let path_buf = PathBuf::from(&user);
        return match read_command_version(&path_buf, &["--version"]) {
            Some(version) => RenderAppTestResult {
                ok: true,
                path: Some(user),
                version: Some(version),
                source: "user".to_string(),
                error: None,
                functional: None,
            },
            None => RenderAppTestResult {
                ok: false,
                path: Some(user),
                version: None,
                source: "user".to_string(),
                error: Some("Configured path failed to execute".to_string()),
                functional: None,
            },
        };
    }
    match find_pandoc() {
        Some((path_buf, version)) => RenderAppTestResult {
            ok: true,
            path: Some(path_buf.to_string_lossy().to_string()),
            version: Some(version),
            source: "auto".to_string(),
            error: None,
            functional: None,
        },
        None => RenderAppTestResult {
            ok: false,
            path: None,
            version: None,
            source: "missing".to_string(),
            error: Some("Not found on system".to_string()),
            functional: None,
        },
    }
}

// ── Functional tests (minimal end-to-end render probes) ─────────────

const FUNCTIONAL_TEST_TIMEOUT_MS: u64 = 60_000;

/// Build a minimal, spec-valid one-page PDF at runtime so functional tests
/// for pdftoppm / mutool have a real input without bundling a fixture file.
fn build_minimal_pdf() -> Vec<u8> {
    let mut buf = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();
    buf.extend_from_slice(b"%PDF-1.4\n");
    offsets.push(buf.len());
    buf.extend_from_slice(b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
    offsets.push(buf.len());
    buf.extend_from_slice(b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
    offsets.push(buf.len());
    buf.extend_from_slice(b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Contents 4 0 R >>\nendobj\n");
    offsets.push(buf.len());
    let stream: &[u8] = b"q Q";
    let obj4_head = format!("4 0 obj\n<< /Length {} >>\nstream\n", stream.len());
    buf.extend_from_slice(obj4_head.as_bytes());
    buf.extend_from_slice(stream);
    buf.extend_from_slice(b"\nendstream\nendobj\n");
    let xref_offset = buf.len();
    buf.extend_from_slice(b"xref\n0 5\n");
    buf.extend_from_slice(b"0000000000 65535 f \n");
    for off in &offsets {
        buf.extend_from_slice(format!("{:010} 00000 n \n", off).as_bytes());
    }
    buf.extend_from_slice(b"trailer\n<< /Size 5 /Root 1 0 R >>\n");
    buf.extend_from_slice(format!("startxref\n{}\n%%EOF\n", xref_offset).as_bytes());
    buf
}

fn functional_test_drawio(path: &Path) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-drawio")?;
    let src = dir.join("in.drawio");
    let dst = dir.join("out.svg");
    fs::write(
        &src,
        r#"<mxfile><diagram id="x" name="Page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>"#,
    )
    .map_err(|e| format!("write fixture: {}", e))?;
    let args = vec![
        "--export".to_string(),
        "--format".to_string(),
        "svg".to_string(),
        "--output".to_string(),
        dst.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
    ];
    let run_result = run_command_capture_with_timeout(
        path,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let output_result = if run_result.is_ok() {
        if !dst.exists() {
            Err("drawio did not create SVG output".to_string())
        } else {
            match fs::read_to_string(&dst) {
                Ok(content) if content.contains("<svg") => {
                    Ok(format!("Rendered .drawio → SVG ({} bytes)", content.len()))
                }
                Ok(_) => Err("drawio output missing <svg> markup".to_string()),
                Err(e) => Err(format!("read output: {}", e)),
            }
        }
    } else {
        run_result.map(|_| String::new())
    };
    let _ = fs::remove_dir_all(&dir);
    output_result
}

fn functional_test_marp(source: &str, path_str: &str) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-marp")?;
    let src = dir.join("in.md");
    let dst = dir.join("out.html");
    fs::write(&src, "---\nmarp: true\n---\n\n# Test\n\nBody\n")
        .map_err(|e| format!("write fixture: {}", e))?;
    let use_npx = source == "auto" && path_str.starts_with("npx");
    let (command, args) = if use_npx {
        (
            PathBuf::from("npx"),
            vec![
                "--yes".to_string(),
                "@marp-team/marp-cli".to_string(),
                src.to_string_lossy().to_string(),
                "-o".to_string(),
                dst.to_string_lossy().to_string(),
            ],
        )
    } else {
        (
            PathBuf::from(path_str),
            vec![
                src.to_string_lossy().to_string(),
                "-o".to_string(),
                dst.to_string_lossy().to_string(),
            ],
        )
    };
    let run_result = run_command_capture_with_timeout(
        &command,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let output_result = if run_result.is_ok() {
        if !dst.exists() {
            Err("marp did not create HTML output".to_string())
        } else {
            let size = fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
            Ok(format!("Rendered Markdown → HTML ({} bytes)", size))
        }
    } else {
        run_result.map(|_| String::new())
    };
    let _ = fs::remove_dir_all(&dir);
    output_result
}

fn functional_test_pandoc(path: &Path) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-pandoc")?;
    let src = dir.join("in.md");
    fs::write(&src, "# Hello\n\nBody paragraph.\n")
        .map_err(|e| format!("write fixture: {}", e))?;
    let args = [
        "-f",
        "markdown",
        "-t",
        "html",
        &src.to_string_lossy().to_string(),
    ];
    let output = run_command_output_with_timeout(
        path,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let _ = fs::remove_dir_all(&dir);
    let output = output?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    let html = String::from_utf8_lossy(&output.stdout).to_string();
    if !html.contains("<h1") {
        return Err("pandoc output missing <h1>".to_string());
    }
    Ok(format!("Converted Markdown → HTML ({} bytes)", html.len()))
}

fn functional_test_soffice(path: &Path) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-soffice")?;
    let src = dir.join("in.txt");
    fs::write(&src, "Hello from Lexera render test.\n")
        .map_err(|e| format!("write fixture: {}", e))?;
    let args = vec![
        "--headless".to_string(),
        "--convert-to".to_string(),
        "pdf".to_string(),
        "--outdir".to_string(),
        dir.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
    ];
    let run_result = run_command_capture_with_timeout(
        path,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let output_result = if run_result.is_ok() {
        let expected = dir.join("in.pdf");
        if expected.exists() {
            let size = fs::metadata(&expected).map(|m| m.len()).unwrap_or(0);
            Ok(format!("Converted TXT → PDF ({} bytes)", size))
        } else {
            Err("soffice did not create PDF output".to_string())
        }
    } else {
        run_result.map(|_| String::new())
    };
    let _ = fs::remove_dir_all(&dir);
    output_result
}

fn functional_test_pdftoppm(path: &Path) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-pdftoppm")?;
    let src = dir.join("in.pdf");
    fs::write(&src, build_minimal_pdf()).map_err(|e| format!("write fixture: {}", e))?;
    let prefix = dir.join("page");
    let args = vec![
        "-png".to_string(),
        "-r".to_string(),
        "72".to_string(),
        "-f".to_string(),
        "1".to_string(),
        "-l".to_string(),
        "1".to_string(),
        src.to_string_lossy().to_string(),
        prefix.to_string_lossy().to_string(),
    ];
    let run_result = run_command_capture_with_timeout(
        path,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let output_result = if run_result.is_ok() {
        let candidates = [dir.join("page-1.png"), dir.join("page-01.png")];
        match candidates.iter().find(|p| p.exists()) {
            Some(found) => {
                let size = fs::metadata(found).map(|m| m.len()).unwrap_or(0);
                Ok(format!("Rendered PDF → PNG ({} bytes)", size))
            }
            None => Err("pdftoppm did not create PNG output".to_string()),
        }
    } else {
        run_result.map(|_| String::new())
    };
    let _ = fs::remove_dir_all(&dir);
    output_result
}

fn functional_test_mutool(path: &Path) -> Result<String, String> {
    let dir = create_temp_render_dir("rt-mutool")?;
    let src = dir.join("in.pdf");
    fs::write(&src, build_minimal_pdf()).map_err(|e| format!("write fixture: {}", e))?;
    let dst = dir.join("out.png");
    let args = vec![
        "draw".to_string(),
        "-o".to_string(),
        dst.to_string_lossy().to_string(),
        src.to_string_lossy().to_string(),
        "1".to_string(),
    ];
    let run_result = run_command_capture_with_timeout(
        path,
        &args,
        None,
        Duration::from_millis(FUNCTIONAL_TEST_TIMEOUT_MS),
    );
    let output_result = if run_result.is_ok() {
        if dst.exists() {
            let size = fs::metadata(&dst).map(|m| m.len()).unwrap_or(0);
            Ok(format!("Rendered PDF → PNG ({} bytes)", size))
        } else {
            Err("mutool did not create PNG output".to_string())
        }
    } else {
        run_result.map(|_| String::new())
    };
    let _ = fs::remove_dir_all(&dir);
    output_result
}

fn attach_functional_result(tool: &str, result: &mut RenderAppTestResult) {
    if !result.ok {
        return;
    }
    let path_str = match result.path.clone() {
        Some(s) => s,
        None => return,
    };
    let start = Instant::now();
    let outcome = match tool {
        "drawio" => functional_test_drawio(&PathBuf::from(&path_str)),
        "marp" => functional_test_marp(&result.source, &path_str),
        "pandoc" => functional_test_pandoc(&PathBuf::from(&path_str)),
        "soffice" => functional_test_soffice(&PathBuf::from(&path_str)),
        "pdftoppm" => functional_test_pdftoppm(&PathBuf::from(&path_str)),
        "mutool" => functional_test_mutool(&PathBuf::from(&path_str)),
        _ => return,
    };
    let duration_ms = start.elapsed().as_millis() as u64;
    result.functional = Some(match outcome {
        Ok(details) => FunctionalResult {
            ok: true,
            details: Some(details),
            error: None,
            duration_ms,
        },
        Err(error) => FunctionalResult {
            ok: false,
            details: None,
            error: Some(error),
            duration_ms,
        },
    });
}

/// Probe each configured render app path (or auto-detect when blank) and return
/// per-tool availability for the Render Applications settings panel. When
/// `functional` is set in the request, each available tool also runs a minimal
/// end-to-end conversion so the result reflects real render capability.
#[tauri::command]
pub async fn test_render_apps(
    request: Option<TestRenderAppsRequest>,
) -> HashMap<String, RenderAppTestResult> {
    let req = request.unwrap_or_default();
    let run_functional = req.functional.unwrap_or(false);
    let mut out: HashMap<String, RenderAppTestResult> = HashMap::new();
    let mut entries: Vec<(&'static str, RenderAppTestResult)> = vec![
        (
            "drawio",
            test_tool_with_auto(req.drawio, find_drawio_cli, &["--version"]),
        ),
        ("marp", test_marp(req.marp)),
        ("pandoc", test_pandoc(req.pandoc)),
        (
            "soffice",
            test_tool_with_auto(req.soffice, find_soffice_cli, &["--version"]),
        ),
        (
            "pdftoppm",
            test_tool_with_auto(req.pdftoppm, find_pdftoppm_cli, &["-v"]),
        ),
        (
            "mutool",
            test_tool_with_auto(req.mutool, find_mutool_cli, &["-v"]),
        ),
    ];
    if run_functional {
        for (tool, ref mut result) in entries.iter_mut() {
            attach_functional_result(tool, result);
        }
    }
    for (tool, result) in entries {
        out.insert(tool.to_string(), result);
    }
    out
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

    let scan_dirs = collect_marp_scan_dirs(&dirs);

    for path in collect_marp_theme_files(&scan_dirs) {
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

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

    themes
}

/// Discover Marp classes from workspace config and theme CSS files.
#[tauri::command]
pub async fn discover_marp_classes(dirs: Vec<String>) -> Vec<String> {
    let scan_dirs = collect_marp_scan_dirs(&dirs);
    let mut classes = BTreeSet::new();

    insert_marp_config_classes(&scan_dirs, &mut classes);

    for path in collect_marp_theme_files(&scan_dirs) {
        let Ok(source) = std::fs::read_to_string(&path) else {
            continue;
        };
        for class_name in extract_marp_classes_from_css(&source) {
            if !class_name.is_empty() {
                classes.insert(class_name);
            }
        }
    }

    classes.into_iter().collect()
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
    std::fs::write(&path, &content).map_err(|e| format!("Failed to write file: {}", e))?;
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

/// Copy export assets into the export folder without failing the whole export on one bad file.
#[tauri::command]
pub async fn copy_export_assets(items: Vec<ExportAssetCopyItem>) -> Result<Vec<ExportAssetCopyResult>, String> {
    let mut results = Vec::with_capacity(items.len());

    for item in items {
        let mut row = ExportAssetCopyResult {
            source_path: item.source_path.clone(),
            target_path: item.target_path.clone(),
            success: false,
            error: None,
        };

        let source = Path::new(&item.source_path);
        if !source.is_file() {
            row.error = Some("Source file not found".to_string());
            results.push(row);
            continue;
        }

        if let Some(limit) = item.max_bytes {
            match std::fs::metadata(source) {
                Ok(meta) if meta.len() > limit => {
                    row.error = Some(format!("File exceeds size limit ({} bytes)", limit));
                    results.push(row);
                    continue;
                }
                Ok(_) => {}
                Err(err) => {
                    row.error = Some(format!("Failed to read metadata: {}", err));
                    results.push(row);
                    continue;
                }
            }
        }

        if let Some(parent) = Path::new(&item.target_path).parent() {
            if let Err(err) = std::fs::create_dir_all(parent) {
                row.error = Some(format!("Failed to create directory: {}", err));
                results.push(row);
                continue;
            }
        }

        match std::fs::copy(source, &item.target_path) {
            Ok(_) => {
                row.success = true;
            }
            Err(err) => {
                row.error = Some(format!("Failed to copy file: {}", err));
            }
        }

        results.push(row);
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::{
        build_minimal_pdf, detect_delimited_text_separator, normalize_plantuml_source,
        parse_delimited_rows, render_csv_text_to_svg,
    };

    #[test]
    fn detects_semicolon_delimiter_for_semicolon_csv() {
        let source = "name;amount;status\nalpha;10;ok\nbeta;20;hold\n";
        assert_eq!(detect_delimited_text_separator(source), ';');
    }

    #[test]
    fn parses_quoted_csv_cells_with_commas_and_newlines() {
        let source = "name,notes\nalpha,\"line 1\nline 2, still quoted\"\n";
        let rows = parse_delimited_rows(source, ',');
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], vec!["name".to_string(), "notes".to_string()]);
        assert_eq!(rows[1][0], "alpha");
        assert_eq!(rows[1][1], "line 1\nline 2, still quoted");
    }

    #[test]
    fn renders_csv_svg_with_page_metadata() {
        let source = "task,owner,status\nA,Alice,done\nB,Bob,open\n";
        let svg = render_csv_text_to_svg(source, "tasks.csv", 2);
        assert!(svg.contains("<svg"));
        assert!(svg.contains("tasks.csv"));
        assert!(svg.contains("Delimiter: comma | Page 2"));
        assert!(svg.contains("Rows 2 | Columns 3"));
    }

    #[test]
    fn wraps_plain_plantuml_source() {
        let normalized = normalize_plantuml_source("Alice -> Bob: hello");
        assert!(normalized.starts_with("@startuml\n"));
        assert!(normalized.ends_with("@enduml\n"));
    }

    #[test]
    fn preserves_explicit_plantuml_block() {
        let source = "@startuml\nAlice -> Bob: hello\n@enduml";
        let normalized = normalize_plantuml_source(source);
        assert_eq!(normalized, "@startuml\nAlice -> Bob: hello\n@enduml\n");
    }

    #[test]
    fn minimal_pdf_has_valid_header_and_xref() {
        let pdf = build_minimal_pdf();
        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(pdf.ends_with(b"%%EOF\n"));
        // Check that xref offsets point at actual object headers so broken
        // byte-counting in build_minimal_pdf would surface here.
        let text = std::str::from_utf8(&pdf).expect("pdf is ascii");
        let xref_idx = text.find("xref\n").expect("xref section present");
        let startxref_idx = text.find("startxref\n").expect("startxref present");
        let after = &text[startxref_idx + "startxref\n".len()..];
        let offset_str = after.lines().next().expect("startxref offset line");
        let offset: usize = offset_str.trim().parse().expect("offset is number");
        assert_eq!(offset, xref_idx, "startxref must point at xref header");
        for n in 1..=4 {
            let marker = format!("{} 0 obj", n);
            assert!(text.contains(&marker), "object {} missing", n);
        }
    }
}
