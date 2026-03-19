/// Media file helpers shared between desktop backend and iOS app.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// Generate a unique filename by appending a counter if the file already exists.
pub fn dedup_filename(dir: &Path, filename: &str) -> PathBuf {
    let path = dir.join(filename);
    if !path.exists() {
        return path;
    }

    let stem = Path::new(filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(filename);
    let ext = Path::new(filename).extension().and_then(|s| s.to_str());

    for i in 1..1000 {
        let new_name = match ext {
            Some(e) => format!("{}-{}.{}", stem, i, e),
            None => format!("{}-{}", stem, i),
        };
        let new_path = dir.join(&new_name);
        if !new_path.exists() {
            return new_path;
        }
    }

    // Fallback: timestamp-based
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let new_name = match ext {
        Some(e) => format!("{}-{}.{}", stem, ts, e),
        None => format!("{}-{}", stem, ts),
    };
    dir.join(&new_name)
}

/// Map a file extension to its MIME content type.
pub fn content_type_for_ext(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("svg") => "image/svg+xml",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("pdf") => "application/pdf",
        Some("json") => "application/json",
        Some("csv") => "text/csv",
        Some("txt") | Some("md") | Some("log") => "text/plain",
        _ => "application/octet-stream",
    }
}

/// Categorize a file by extension: image, video, audio, document, or unknown.
pub fn media_category(ext: Option<&str>) -> &'static str {
    match ext {
        Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg")
        | Some("bmp") | Some("ico") | Some("tiff") | Some("tif") => "image",
        Some("mp4") | Some("webm") | Some("mov") | Some("avi") | Some("mkv") => "video",
        Some("mp3") | Some("wav") | Some("ogg") | Some("flac") | Some("aac") | Some("m4a") => {
            "audio"
        }
        Some("pdf") | Some("doc") | Some("docx") | Some("xls") | Some("xlsx") | Some("ppt")
        | Some("pptx") | Some("txt") | Some("md") | Some("csv") | Some("json") => "document",
        _ => "unknown",
    }
}

/// Whether the file type can be previewed in a browser/webview.
pub fn is_previewable(ext: Option<&str>) -> bool {
    matches!(
        ext,
        Some("png")
            | Some("jpg")
            | Some("jpeg")
            | Some("gif")
            | Some("webp")
            | Some("svg")
            | Some("bmp")
            | Some("mp4")
            | Some("webm")
            | Some("mov")
            | Some("mp3")
            | Some("wav")
            | Some("ogg")
            | Some("pdf")
    )
}

/// Compute the media folder path for a board file: `{stem}-Media/` in the same directory.
pub fn media_folder_for_board(board_path: &Path) -> PathBuf {
    let dir = board_path.parent().unwrap_or_else(|| Path::new("."));
    let stem = board_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("board");
    dir.join(format!("{}-Media", stem))
}

// ── Media manifest for sync ────────────────────────────────────────────────

/// A single entry in a board's media manifest.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaManifestEntry {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

/// Scan the media folder for a board and compute a manifest of all files.
/// Returns an empty vec if the media folder doesn't exist.
pub fn compute_media_manifest(board_path: &Path) -> Vec<MediaManifestEntry> {
    let media_dir = media_folder_for_board(board_path);
    if !media_dir.is_dir() {
        return Vec::new();
    }

    let mut entries = Vec::new();
    let read_dir = match std::fs::read_dir(&media_dir) {
        Ok(rd) => rd,
        Err(e) => {
            log::warn!(
                "[media] Failed to read media dir {}: {}",
                media_dir.display(),
                e
            );
            return Vec::new();
        }
    };

    for entry in read_dir.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let metadata = match path.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let size = metadata.len();

        // Compute SHA-256 hash
        let data = match std::fs::read(&path) {
            Ok(d) => d,
            Err(e) => {
                log::warn!("[media] Failed to read {} for hashing: {}", path.display(), e);
                continue;
            }
        };
        let hash = hex::encode(Sha256::digest(&data));
        entries.push(MediaManifestEntry { name, sha256: hash, size });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    entries
}

/// Compute which files from a remote manifest are missing or different locally.
/// Returns the names of files that need to be fetched.
pub fn diff_media_manifests(
    local: &[MediaManifestEntry],
    remote: &[MediaManifestEntry],
) -> Vec<String> {
    remote
        .iter()
        .filter(|r| {
            !local
                .iter()
                .any(|l| l.name == r.name && l.sha256 == r.sha256)
        })
        .map(|r| r.name.clone())
        .collect()
}

#[cfg(test)]
mod manifest_tests {
    use super::*;

    fn entry(name: &str, sha256: &str, size: u64) -> MediaManifestEntry {
        MediaManifestEntry {
            name: name.to_string(),
            sha256: sha256.to_string(),
            size,
        }
    }

    // ── compute_media_manifest ─────────────────────────────────────────

    #[test]
    fn manifest_empty_when_no_media_folder() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("board.md");
        std::fs::write(&board, "# board").unwrap();
        let manifest = compute_media_manifest(&board);
        assert!(manifest.is_empty());
    }

    #[test]
    fn manifest_empty_when_media_folder_is_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("board.md");
        std::fs::write(&board, "# board").unwrap();
        std::fs::create_dir_all(tmp.path().join("board-Media")).unwrap();
        let manifest = compute_media_manifest(&board);
        assert!(manifest.is_empty());
    }

    #[test]
    fn manifest_lists_files_with_correct_hash_and_size() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("board.md");
        std::fs::write(&board, "# board").unwrap();
        let media_dir = tmp.path().join("board-Media");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("image.png"), b"fakepng").unwrap();
        std::fs::write(media_dir.join("doc.pdf"), b"fakepdf123").unwrap();

        let manifest = compute_media_manifest(&board);
        assert_eq!(manifest.len(), 2);

        // Sorted by name
        assert_eq!(manifest[0].name, "doc.pdf");
        assert_eq!(manifest[0].size, 10);
        assert_eq!(manifest[1].name, "image.png");
        assert_eq!(manifest[1].size, 7);

        // Verify hashes are valid hex SHA-256 (64 chars)
        assert_eq!(manifest[0].sha256.len(), 64);
        assert_eq!(manifest[1].sha256.len(), 64);
    }

    #[test]
    fn manifest_skips_subdirectories() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("board.md");
        std::fs::write(&board, "# board").unwrap();
        let media_dir = tmp.path().join("board-Media");
        std::fs::create_dir_all(media_dir.join("subdir")).unwrap();
        std::fs::write(media_dir.join("file.txt"), b"hello").unwrap();
        std::fs::write(media_dir.join("subdir").join("nested.txt"), b"nested").unwrap();

        let manifest = compute_media_manifest(&board);
        assert_eq!(manifest.len(), 1);
        assert_eq!(manifest[0].name, "file.txt");
    }

    #[test]
    fn manifest_is_deterministic() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("board.md");
        std::fs::write(&board, "# board").unwrap();
        let media_dir = tmp.path().join("board-Media");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("b.txt"), b"bbb").unwrap();
        std::fs::write(media_dir.join("a.txt"), b"aaa").unwrap();

        let m1 = compute_media_manifest(&board);
        let m2 = compute_media_manifest(&board);
        assert_eq!(m1, m2);
        assert_eq!(m1[0].name, "a.txt"); // sorted
    }

    // ── diff_media_manifests ───────────────────────────────────────────

    #[test]
    fn diff_empty_manifests() {
        let diff = diff_media_manifests(&[], &[]);
        assert!(diff.is_empty());
    }

    #[test]
    fn diff_identical_manifests() {
        let entries = vec![entry("a.png", "abc123", 100)];
        let diff = diff_media_manifests(&entries, &entries);
        assert!(diff.is_empty());
    }

    #[test]
    fn diff_finds_missing_files() {
        let local = vec![entry("a.png", "aaa", 100)];
        let remote = vec![
            entry("a.png", "aaa", 100),
            entry("b.png", "bbb", 200),
        ];
        let diff = diff_media_manifests(&local, &remote);
        assert_eq!(diff, vec!["b.png"]);
    }

    #[test]
    fn diff_finds_changed_files() {
        let local = vec![entry("a.png", "old_hash", 100)];
        let remote = vec![entry("a.png", "new_hash", 150)];
        let diff = diff_media_manifests(&local, &remote);
        assert_eq!(diff, vec!["a.png"]);
    }

    #[test]
    fn diff_bidirectional() {
        let local = vec![entry("a.png", "aaa", 100)];
        let remote = vec![entry("b.png", "bbb", 200)];
        // Files remote has that local doesn't
        let to_download = diff_media_manifests(&local, &remote);
        assert_eq!(to_download, vec!["b.png"]);
        // Files local has that remote doesn't
        let to_upload = diff_media_manifests(&remote, &local);
        assert_eq!(to_upload, vec!["a.png"]);
    }

    #[test]
    fn diff_same_name_different_hash_is_detected() {
        let local = vec![entry("photo.jpg", "hash1", 500)];
        let remote = vec![entry("photo.jpg", "hash2", 600)];
        let diff = diff_media_manifests(&local, &remote);
        assert_eq!(diff, vec!["photo.jpg"]);
    }
}
