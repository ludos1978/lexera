use axum::{
    extract::{Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::Json,
};
use lexera_core::media::{compute_media_manifest, content_type_for_ext, dedup_filename};

use super::{
    err_bad_request, err_internal, err_not_found, has_path_traversal, insert_header_safe,
    resolve_board_file, ErrorResponse,
};
use crate::state::AppState;

/// Cache-Control header value for served media files (1 hour).
const MEDIA_CACHE_CONTROL: &str = "public, max-age=3600";

/// POST /boards/{board_id}/media -- upload a file to the board's media folder.
/// The media folder is `{board_basename}-Media/` next to the board .md file.
/// Returns the relative path suitable for markdown embedding.
pub async fn upload_media(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<serde_json::Value>), (StatusCode, Json<ErrorResponse>)> {
    // Get board file path
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;

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
    let field = multipart
        .next_field()
        .await
        .map_err(|e| err_bad_request(format!("Failed to read multipart: {}", e)))?;

    let field = field.ok_or_else(|| err_bad_request("No file provided"))?;

    let filename = field.file_name().unwrap_or("capture").to_string();

    // Prevent path traversal in uploaded filename
    if has_path_traversal(&filename) {
        return Err(err_bad_request("Invalid filename"));
    }

    let data = field
        .bytes()
        .await
        .map_err(|e| err_bad_request(format!("Failed to read file data: {}", e)))?;

    if data.is_empty() {
        return Err(err_bad_request("Empty file"));
    }

    // Create media directory if needed
    tokio::fs::create_dir_all(&media_dir)
        .await
        .map_err(|e| err_internal(format!("Failed to create media dir: {}", e)))?;

    // Deduplicate filename if it already exists
    let final_path = dedup_filename(&media_dir, &filename);
    let final_name = final_path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&filename)
        .to_string();

    // Write file
    tokio::fs::write(&final_path, &data)
        .await
        .map_err(|e| err_internal(format!("Failed to write file: {}", e)))?;

    // Return relative path from board directory
    let media_folder_name = format!("{}-Media", board_stem);
    let relative_path = format!("{}/{}", media_folder_name, final_name);

    // Notify sync peers that media changed
    let _ = state.event_tx.send(
        lexera_core::watcher::types::BoardChangeEvent::MediaChanged {
            board_id: board_id.clone(),
        },
    );

    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "path": relative_path,
            "filename": final_name,
        })),
    ))
}

/// GET /boards/{board_id}/media-manifest -- list all media files with SHA-256 hashes.
/// Used by sync clients to diff and fetch missing media from peers.
pub async fn media_manifest(
    State(state): State<AppState>,
    Path(board_id): Path<String>,
) -> Result<Json<Vec<lexera_core::media::MediaManifestEntry>>, (StatusCode, Json<ErrorResponse>)> {
    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;

    let manifest = tokio::task::spawn_blocking(move || compute_media_manifest(&board_path))
        .await
        .map_err(|e| err_internal(format!("Manifest computation failed: {}", e)))?;

    Ok(Json(manifest))
}

/// GET /media/workspace-index -- list all media files across every registered board.
/// Returns a unified index with per-file metadata and category counts.
pub async fn workspace_media_index(
    State(state): State<AppState>,
) -> Result<Json<lexera_core::media::WorkspaceMediaIndex>, (StatusCode, Json<ErrorResponse>)> {
    use lexera_core::storage::BoardStorage as _;

    let boards_info = state.storage.list_boards();
    let boards: Vec<(String, String, std::path::PathBuf)> = boards_info
        .into_iter()
        .filter_map(|info| {
            let path = state.storage.get_board_path(&info.id)?;
            Some((info.id, info.title, path))
        })
        .collect();

    let index = tokio::task::spawn_blocking(move || {
        let board_refs: Vec<(&str, &str, &std::path::Path)> = boards
            .iter()
            .map(|(id, title, path)| (id.as_str(), title.as_str(), path.as_path()))
            .collect();
        lexera_core::media::scan_workspace_media(&board_refs)
    })
    .await
    .map_err(|e| err_internal(format!("Workspace media scan failed: {}", e)))?;

    Ok(Json(index))
}

/// GET /boards/{board_id}/media/{filename} -- serve a media file from the board's media folder.
pub async fn serve_media(
    State(state): State<AppState>,
    Path((board_id, filename)): Path<(String, String)>,
) -> Result<(HeaderMap, Vec<u8>), (StatusCode, Json<ErrorResponse>)> {
    // Prevent path traversal (check before constructing file path)
    if has_path_traversal(&filename) {
        return Err(err_bad_request("Invalid filename"));
    }

    let board_path = state
        .storage
        .get_board_path(&board_id)
        .ok_or_else(|| err_not_found("Board not found"))?;
    let board_stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    let media_rel_path = format!("{}-Media/{}", board_stem, filename);
    let file_path = resolve_board_file(&state, &board_id, &media_rel_path)?;

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|_| err_not_found("File not found"))?;

    let ext = file_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    let content_type = content_type_for_ext(ext.as_deref());

    let mut headers = HeaderMap::new();
    insert_header_safe(&mut headers, "content-type", content_type);
    insert_header_safe(&mut headers, "cache-control", MEDIA_CACHE_CONTROL);

    Ok((headers, data))
}

#[cfg(test)]
mod tests {
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use crate::test_helpers::{authed_get, register_test_user, setup_board, test_router};

    #[tokio::test]
    async fn serve_media_nonexistent_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/media/nonexistent.png", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn upload_media_creates_file() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let boundary = "----TestBoundary";
        let body = format!(
            "--{boundary}\r\n\
             Content-Disposition: form-data; name=\"file\"; filename=\"test.png\"\r\n\
             Content-Type: image/png\r\n\
             \r\n\
             fakepng\r\n\
             --{boundary}--\r\n"
        );

        let app = test_router(state);
        let resp = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!("/boards/{}/media", board_id))
                    .header(
                        "content-type",
                        format!("multipart/form-data; boundary={}", boundary),
                    )
                    .header("authorization", format!("Bearer {}", token))
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::CREATED);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["filename"], "test.png");
        assert!(json["path"].as_str().unwrap().contains("test.png"));

        // Verify the file was actually written
        let media_dir = tmp.path().join("board-Media");
        assert!(media_dir.join("test.png").exists());
    }

    #[tokio::test]
    async fn media_manifest_empty_when_no_media() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/media-manifest", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json, serde_json::json!([]));
    }

    #[tokio::test]
    async fn media_manifest_lists_uploaded_files() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        // Create media files directly
        let media_dir = tmp.path().join("board-Media");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("image.png"), b"fakepng").unwrap();
        std::fs::write(media_dir.join("doc.pdf"), b"fakepdf").unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get(
                &format!("/boards/{}/media-manifest", board_id),
                &token,
            ))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let entries: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(entries.len(), 2);

        // Sorted by name
        assert_eq!(entries[0]["name"], "doc.pdf");
        assert_eq!(entries[0]["size"], 7);
        assert!(entries[0]["sha256"].as_str().unwrap().len() == 64);

        assert_eq!(entries[1]["name"], "image.png");
        assert_eq!(entries[1]["size"], 7);
        assert!(entries[1]["sha256"].as_str().unwrap().len() == 64);
    }

    #[tokio::test]
    async fn media_manifest_nonexistent_board_returns_404() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get("/boards/nonexistent/media-manifest", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn workspace_media_index_empty_when_no_media() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get("/media/workspace-index", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(json["totalFiles"], 0);
        assert_eq!(json["totalSize"], 0);
        assert_eq!(json["boardCount"], 1);
        assert!(json["files"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn workspace_media_index_lists_files_with_metadata() {
        let tmp = tempfile::tempdir().unwrap();
        let (state, _board_id) = setup_board(tmp.path());
        let token = register_test_user(&state);

        // Create media files in the board's media folder
        let media_dir = tmp.path().join("board-Media");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("photo.png"), b"fakepng").unwrap();
        std::fs::write(media_dir.join("clip.mp4"), b"fakevideo1234").unwrap();

        let app = test_router(state);
        let resp = app
            .oneshot(authed_get("/media/workspace-index", &token))
            .await
            .unwrap();

        assert_eq!(resp.status(), StatusCode::OK);
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        assert_eq!(json["totalFiles"], 2);
        assert!(json["totalSize"].as_u64().unwrap() > 0);
        assert_eq!(json["boardCount"], 1);

        let files = json["files"].as_array().unwrap();
        assert_eq!(files.len(), 2);

        // Files are sorted by relative_path: "board-Media/clip.mp4" < "board-Media/photo.png"
        assert_eq!(files[0]["name"], "clip.mp4");
        assert_eq!(files[0]["category"], "video");
        assert_eq!(files[0]["relativePath"], "board-Media/clip.mp4");
        assert_eq!(files[0]["sha256"].as_str().unwrap().len(), 64);

        assert_eq!(files[1]["name"], "photo.png");
        assert_eq!(files[1]["category"], "image");

        let by_cat = &json["byCategory"];
        assert_eq!(by_cat["image"], 1);
        assert_eq!(by_cat["video"], 1);
    }
}
