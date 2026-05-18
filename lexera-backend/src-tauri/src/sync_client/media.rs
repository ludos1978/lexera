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

/// Typed error for the HTTP media-sync helpers below. Each variant
/// Display-formats to the exact byte sequence the previous
/// `Result<_, String>` API produced via `format!()` / `friendly_error()`,
/// so the surrounding `log::warn!("…: {}", e)` call sites at lines 169
/// and 188 emit unchanged text. Variants stay matchable so callers can
/// distinguish transport (`Request`), HTTP-status (`*HttpStatus`),
/// parse (`ParseManifest`), file-system (`CreateMediaDir`, `WriteMedia`,
/// `ReadLocalMedia`), MIME (`Mime`), and join (`ComputeManifest`)
/// failures without parsing log strings.
#[derive(Debug, thiserror::Error)]
pub(super) enum MediaSyncError {
    #[error("{0}")]
    Request(String),
    #[error("Media manifest fetch failed (HTTP {status}): {body}")]
    ManifestHttpStatus {
        status: reqwest::StatusCode,
        body: String,
    },
    #[error("Parse media manifest: {0}")]
    ParseManifest(reqwest::Error),
    #[error("Download media {filename} failed (HTTP {status})")]
    DownloadHttpStatus {
        filename: String,
        status: reqwest::StatusCode,
    },
    #[error("Read media {filename} body: {source}")]
    ReadMediaBody {
        filename: String,
        #[source]
        source: reqwest::Error,
    },
    #[error("Create media dir: {0}")]
    CreateMediaDir(std::io::Error),
    #[error("Write media {filename}: {source}")]
    WriteMedia {
        filename: String,
        #[source]
        source: std::io::Error,
    },
    #[error("Read local media {filename}: {source}")]
    ReadLocalMedia {
        filename: String,
        #[source]
        source: std::io::Error,
    },
    #[error("MIME error: {0}")]
    Mime(reqwest::Error),
    #[error("Upload media {filename} failed (HTTP {status})")]
    UploadHttpStatus {
        filename: String,
        status: reqwest::StatusCode,
    },
    #[error("Compute local manifest: {0}")]
    ComputeManifest(tokio::task::JoinError),
}

impl MediaSyncError {
    fn request(context: &str, err: reqwest::Error) -> Self {
        Self::Request(friendly_error(context, err))
    }
}

// Keep upstream `Result<_, String>` `?` boundaries working unchanged —
// same pattern as CaptureGeometryError (Slice 5) and RemoteApiError (Slice 7).
impl From<MediaSyncError> for String {
    fn from(err: MediaSyncError) -> String {
        err.to_string()
    }
}

/// Fetch the remote board's media manifest via HTTP.
pub(super) async fn fetch_remote_media_manifest(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
) -> Result<Vec<MediaManifestEntry>, MediaSyncError> {
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
        .map_err(|e| MediaSyncError::request("Fetch media manifest", e))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(MediaSyncError::ManifestHttpStatus { status, body });
    }
    resp.json().await.map_err(MediaSyncError::ParseManifest)
}

/// Download a single media file from the remote server and save it locally.
pub(super) async fn download_media_file(
    client: &reqwest::Client,
    server_url: &str,
    remote_board_id: &str,
    auth_token: Option<&str>,
    filename: &str,
    local_media_dir: &std::path::Path,
) -> Result<(), MediaSyncError> {
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
        .map_err(|e| MediaSyncError::request(&format!("Download media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(MediaSyncError::DownloadHttpStatus {
            filename: filename.to_string(),
            status: resp.status(),
        });
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|source| MediaSyncError::ReadMediaBody {
            filename: filename.to_string(),
            source,
        })?;
    tokio::fs::create_dir_all(local_media_dir)
        .await
        .map_err(MediaSyncError::CreateMediaDir)?;
    let file_path = local_media_dir.join(filename);
    tokio::fs::write(&file_path, &bytes)
        .await
        .map_err(|source| MediaSyncError::WriteMedia {
            filename: filename.to_string(),
            source,
        })?;
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
) -> Result<(), MediaSyncError> {
    let file_path = local_media_dir.join(filename);
    let data =
        tokio::fs::read(&file_path)
            .await
            .map_err(|source| MediaSyncError::ReadLocalMedia {
                filename: filename.to_string(),
                source,
            })?;

    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(MediaSyncError::Mime)?;
    let form = reqwest::multipart::Form::new().part("file", part);

    let mut req = client.post(format!("{}/boards/{}/media", server_url, remote_board_id));
    if let Some(token) = auth_token {
        req = req.header("authorization", format!("Bearer {}", token));
    }
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| MediaSyncError::request(&format!("Upload media {}", filename), e))?;
    if !resp.status().is_success() {
        return Err(MediaSyncError::UploadHttpStatus {
            filename: filename.to_string(),
            status: resp.status(),
        });
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
) -> Result<(usize, usize), MediaSyncError> {
    let local_manifest = {
        let path = local_board_path.to_path_buf();
        tokio::task::spawn_blocking(move || compute_media_manifest(&path))
            .await
            .map_err(MediaSyncError::ComputeManifest)?
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_http_status_preserves_wire_format_with_reason_phrase() {
        // Prior format!("Media manifest fetch failed (HTTP {}): {}", status, text)
        // — `{status}` Display for reqwest::StatusCode emits canonical
        // reason phrase ("404 Not Found"), NOT bare numeric "404".
        let err = MediaSyncError::ManifestHttpStatus {
            status: reqwest::StatusCode::NOT_FOUND,
            body: "no manifest".into(),
        };
        assert_eq!(
            err.to_string(),
            "Media manifest fetch failed (HTTP 404 Not Found): no manifest"
        );
    }

    #[test]
    fn download_http_status_preserves_wire_format_without_body() {
        // Prior format!("Download media {} failed (HTTP {})", filename, status)
        // — no body suffix on download (unlike manifest).
        let err = MediaSyncError::DownloadHttpStatus {
            filename: "image.png".into(),
            status: reqwest::StatusCode::FORBIDDEN,
        };
        assert_eq!(
            err.to_string(),
            "Download media image.png failed (HTTP 403 Forbidden)"
        );
    }

    #[test]
    fn upload_http_status_preserves_wire_format_without_body() {
        let err = MediaSyncError::UploadHttpStatus {
            filename: "doc.pdf".into(),
            status: reqwest::StatusCode::PAYLOAD_TOO_LARGE,
        };
        assert_eq!(
            err.to_string(),
            "Upload media doc.pdf failed (HTTP 413 Payload Too Large)"
        );
    }

    #[test]
    fn fs_variants_preserve_wire_format() {
        // Three filesystem variants — confirm prior format!() strings match.
        let create_dir = MediaSyncError::CreateMediaDir(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        ));
        assert_eq!(create_dir.to_string(), "Create media dir: denied");

        let write = MediaSyncError::WriteMedia {
            filename: "x.png".into(),
            source: std::io::Error::new(std::io::ErrorKind::OutOfMemory, "OOM"),
        };
        assert_eq!(write.to_string(), "Write media x.png: OOM");

        let read = MediaSyncError::ReadLocalMedia {
            filename: "y.png".into(),
            source: std::io::Error::from(std::io::ErrorKind::NotFound),
        };
        assert!(read.to_string().starts_with("Read local media y.png: "));
    }

    #[test]
    fn request_variant_passes_friendly_error_output_through() {
        let err = MediaSyncError::Request(
            "Fetch media manifest: Connection timed out (check network)".into(),
        );
        assert_eq!(
            err.to_string(),
            "Fetch media manifest: Connection timed out (check network)"
        );
    }

    #[test]
    fn from_media_sync_error_for_string_uses_display() {
        let err = MediaSyncError::Request("hello".into());
        let s: String = err.into();
        assert_eq!(s, "hello");
    }
}
