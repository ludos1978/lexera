use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::media::{content_type_for_ext, dedup_filename};

use super::{has_path_traversal, insert_header_safe, ErrorResponse};
use crate::state::AppState;

/// POST /boards/{board_id}/media -- upload a file to the board's media folder.
/// The media folder is `{board_basename}-Media/` next to the board .md file.
/// Returns the relative path suitable for markdown embedding.
pub async fn upload_media(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    // Get board file path
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Compute media folder: {basename}-Media/ next to the board file
    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let board_stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    let media_dir = board_dir.join(format!("{}-Media", board_stem));

    // Process the first file field from multipart
    let field = multipart.next_field().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Failed to read multipart: {}", e),
            }),
        )
    })?;

    let field = field.ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "No file provided".to_string(),
            }),
        )
    })?;

    let filename = field.file_name().unwrap_or("capture").to_string();

    // Prevent path traversal in uploaded filename
    if has_path_traversal(&filename) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "Invalid filename".to_string() }),
        ));
    }

    let data = field.bytes().await.map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: format!("Failed to read file data: {}", e),
            }),
        )
    })?;

    if data.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "Empty file".to_string(),
            }),
        ));
    }

    // Create media directory if needed
    std::fs::create_dir_all(&media_dir).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to create media dir: {}", e),
            }),
        )
    })?;

    // Deduplicate filename if it already exists
    let final_path = dedup_filename(&media_dir, &filename);
    let final_name = final_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&filename)
        .to_string();

    // Write file
    std::fs::write(&final_path, &data).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: format!("Failed to write file: {}", e),
            }),
        )
    })?;

    // Return relative path from board directory
    let media_folder_name = format!("{}-Media", board_stem);
    let relative_path = format!("{}/{}", media_folder_name, final_name);

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "path": relative_path,
            "filename": final_name,
        })),
    ))
}

/// GET /boards/{board_id}/media/{filename} -- serve a media file from the board's media folder.
pub async fn serve_media(
    State(state): State<AppState>,
    Path((board_id, filename)): Path<(String, String)>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
    let board_path = state.storage.get_board_path(&board_id).ok_or_else(|| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "Board not found".to_string(),
            }),
        )
    })?;

    // Prevent path traversal (check before constructing file path)
    if has_path_traversal(&filename) {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse { error: "Invalid filename".to_string() }),
        ));
    }

    let board_dir = board_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."));
    let board_stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    let media_dir = board_dir.join(format!("{}-Media", board_stem));
    let file_path = media_dir.join(&filename);

    let data = std::fs::read(&file_path).map_err(|_| {
        (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: "File not found".to_string(),
            }),
        )
    })?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let content_type = content_type_for_ext(ext.as_deref());

    let mut headers = HeaderMap::new();
    insert_header_safe(&mut headers, "content-type", content_type);
    insert_header_safe(&mut headers, "cache-control", "public, max-age=3600");

    Ok((headers, data))
}
