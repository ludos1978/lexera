//! HTTP-based media file sync between local and remote boards.
//!
//! Companion to the WebSocket-based CRDT sync in `sync_client.rs`:
//! whenever the WS handler decides a media diff is due, it calls
//! `sync_media` here, which compares the local and remote manifests
//! and uploads/downloads only the missing files.
//!
//! Split out of `sync_client.rs` so the HTTP file-transfer surface
//! (manifest fetch, single-file download/upload, full diff sync) lives
//! in its own module instead of mixing with the WS message loop.

use lexera_core::media::{
    compute_media_manifest, diff_media_manifests, media_folder_for_board, MediaManifestEntry,
};

use super::friendly_error;

/// Fetch the remote board's media manifest via HTTP.
pub(super) async fn fetch_remote_media_manifest(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
) -> Result<Vec<MediaManifestEntry>, String> {
    let mut req = client.get(format!(
        "{}/boards/{}/media-manifest",
        server_url, remote_board_id
    ));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| friendly_error("Fetch media manifest", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Media manifest fetch failed (HTTP {}): {}",
            status, text
        ));
    }
    resp.json()
        .await
        .map_err(|e| format!("Parse media manifest: {}", e))
}

/// Download a single media file from the remote server and save it locally.
pub(super) async fn download_media_file(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    filename: &str,
    local_media_dir: &std::path::Path,
) -> Result<(), String> {
    let mut req = client.get(format!(
        "{}/boards/{}/media/{}",
        server_url, remote_board_id, filename
    ));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .send()
        .await
        .map_err(|e| friendly_error(&format!("Download media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Download media {} failed (HTTP {})",
            filename,
            resp.status()
        ));
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Read media {} body: {}", filename, e))?;
    tokio::fs::create_dir_all(local_media_dir)
        .await
        .map_err(|e| format!("Create media dir: {}", e))?;
    let file_path = local_media_dir.join(filename);
    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|e| format!("Write media {}: {}", filename, e))?;
    log::info!(
        "[sync_client] Downloaded media file {} ({} bytes)",
        filename,
        bytes.len()
    );
    Ok(())
}

/// Upload a local media file to the remote server via multipart POST.
async fn upload_media_file(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    filename: &str,
    local_media_dir: &std::path::Path,
) -> Result<(), String> {
    let file_path = local_media_dir.join(filename);
    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| format!("Read local media {}: {}", filename, e))?;

    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| format!("MIME error: {}", e))?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let mut req = client.post(format!("{}/boards/{}/media", server_url, remote_board_id));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| friendly_error(&format!("Upload media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(format!(
            "Upload media {} failed (HTTP {})",
            filename,
            resp.status()
        ));
    }
    log::info!("[sync_client] Uploaded media file {} to remote", filename);
    Ok(())
}

/// Perform a full media sync: diff local vs remote manifests and transfer missing files.
pub(super) async fn sync_media(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    local_board_path: &std::path::Path,
) -> Result<(usize, usize), String> {
    let local_manifest = {
        let path = local_board_path.to_path_buf();
        tokio::task::spawn_blocking(move || compute_media_manifest(&path))
            .await
            .map_err(|e| format!("Compute local manifest: {}", e))?
    };
    let remote_manifest =
        fetch_remote_media_manifest(client, server_url, remote_board_id, auth_token).await?;

    let local_media_dir = media_folder_for_board(local_board_path);

    // Download files that remote has but we don't
    let to_download = diff_media_manifests(&local_manifest, &remote_manifest);
    let mut downloaded = 0;
    for filename in &to_download {
        match download_media_file(
            client,
            server_url,
            remote_board_id,
            auth_token,
            filename,
            &local_media_dir,
        )
        .await
        {
            Ok(()) => downloaded += 1,
            Err(e) => log::warn!("[sync_client] Failed to download media {}: {}", filename, e),
        }
    }

    // Upload files that we have but remote doesn't
    let to_upload = diff_media_manifests(&remote_manifest, &local_manifest);
    let mut uploaded = 0;
    for filename in &to_upload {
        match upload_media_file(
            client,
            server_url,
            remote_board_id,
            auth_token,
            filename,
            &local_media_dir,
        )
        .await
        {
            Ok(()) => uploaded += 1,
            Err(e) => log::warn!("[sync_client] Failed to upload media {}: {}", filename, e),
        }
    }

    if downloaded > 0 || uploaded > 0 {
        log::info!(
            "[sync_client] Media sync complete for {}: downloaded={}/{} uploaded={}/{}",
            remote_board_id,
            downloaded,
            to_download.len(),
            uploaded,
            to_upload.len()
        );
    }

    Ok((downloaded, uploaded))
}
