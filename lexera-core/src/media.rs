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

// ── Workspace media index ─────────────────────────────────────────────────

/// A single media file entry in the workspace-wide media index.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMediaFile {
    pub board_id: String,
    pub board_title: String,
    pub name: String,
    /// Relative path for markdown embedding, e.g. `"BoardName-Media/photo.png"`.
    pub relative_path: String,
    /// Category: `"image"`, `"video"`, `"audio"`, `"document"`, or `"unknown"`.
    pub category: String,
    pub size: u64,
    pub sha256: String,
}

/// Aggregated view of all media files across all boards in a workspace.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMediaIndex {
    pub files: Vec<WorkspaceMediaFile>,
    pub total_files: usize,
    pub total_size: u64,
    /// Count of files per category (`"image"`, `"video"`, etc.).
    pub by_category: std::collections::HashMap<String, usize>,
    pub board_count: usize,
}

/// Scan the media folders for every board and return a unified workspace index.
///
/// `boards` is a slice of `(board_id, board_title, board_path)` tuples.
/// Files are sorted by `relative_path` for deterministic output.
pub fn scan_workspace_media(boards: &[(&str, &str, &std::path::Path)]) -> WorkspaceMediaIndex {
    let mut files: Vec<WorkspaceMediaFile> = Vec::new();
    let mut total_size: u64 = 0;
    let mut by_category: std::collections::HashMap<String, usize> = std::collections::HashMap::new();

    for &(board_id, board_title, board_path) in boards {
        let stem = board_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("board");
        let media_folder_name = format!("{}-Media", stem);

        for entry in compute_media_manifest(board_path) {
            let ext = std::path::Path::new(&entry.name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|s| s.to_lowercase());
            let category = media_category(ext.as_deref()).to_string();
            let relative_path = format!("{}/{}", media_folder_name, entry.name);

            total_size += entry.size;
            *by_category.entry(category.clone()).or_insert(0) += 1;

            files.push(WorkspaceMediaFile {
                board_id: board_id.to_string(),
                board_title: board_title.to_string(),
                name: entry.name,
                relative_path,
                category,
                size: entry.size,
                sha256: entry.sha256,
            });
        }
    }

    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    let total_files = files.len();

    WorkspaceMediaIndex {
        files,
        total_files,
        total_size,
        by_category,
        board_count: boards.len(),
    }
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
                log::warn!(
                    "[media] Failed to read {} for hashing: {}",
                    path.display(),
                    e
                );
                continue;
            }
        };
        let hash = hex::encode(Sha256::digest(&data));
        entries.push(MediaManifestEntry {
            name,
            sha256: hash,
            size,
        });
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
        let remote = vec![entry("a.png", "aaa", 100), entry("b.png", "bbb", 200)];
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

#[cfg(test)]
mod workspace_tests {
    use super::*;

    #[test]
    fn workspace_scan_empty_when_no_media_folders() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("Board.md");
        std::fs::write(&board, "# Board").unwrap();

        let boards = vec![("b1", "My Board", board.as_path())];
        let index = scan_workspace_media(&boards);

        assert_eq!(index.total_files, 0);
        assert_eq!(index.total_size, 0);
        assert!(index.files.is_empty());
        assert_eq!(index.board_count, 1);
        assert!(index.by_category.is_empty());
    }

    #[test]
    fn workspace_scan_aggregates_multiple_boards() {
        let tmp = tempfile::tempdir().unwrap();

        let board1 = tmp.path().join("Board1.md");
        std::fs::write(&board1, "# Board1").unwrap();
        let media1 = tmp.path().join("Board1-Media");
        std::fs::create_dir_all(&media1).unwrap();
        std::fs::write(media1.join("photo.png"), b"fakepng").unwrap();

        let board2 = tmp.path().join("Board2.md");
        std::fs::write(&board2, "# Board2").unwrap();
        let media2 = tmp.path().join("Board2-Media");
        std::fs::create_dir_all(&media2).unwrap();
        std::fs::write(media2.join("report.pdf"), b"fakepdf123").unwrap();

        let boards = vec![
            ("b1", "Board 1", board1.as_path()),
            ("b2", "Board 2", board2.as_path()),
        ];
        let index = scan_workspace_media(&boards);

        assert_eq!(index.total_files, 2);
        assert_eq!(index.board_count, 2);
        assert!(index.total_size > 0);
        assert_eq!(index.by_category.get("image").copied().unwrap_or(0), 1);
        assert_eq!(index.by_category.get("document").copied().unwrap_or(0), 1);
    }

    #[test]
    fn workspace_scan_relative_paths_are_correct() {
        let tmp = tempfile::tempdir().unwrap();
        let board = tmp.path().join("MyBoard.md");
        std::fs::write(&board, "# Board").unwrap();
        let media_dir = tmp.path().join("MyBoard-Media");
        std::fs::create_dir_all(&media_dir).unwrap();
        std::fs::write(media_dir.join("shot.jpg"), b"fakejpg").unwrap();

        let boards = vec![("b1", "My Board", board.as_path())];
        let index = scan_workspace_media(&boards);

        assert_eq!(index.files.len(), 1);
        assert_eq!(index.files[0].name, "shot.jpg");
        assert_eq!(index.files[0].relative_path, "MyBoard-Media/shot.jpg");
        assert_eq!(index.files[0].category, "image");
        assert_eq!(index.files[0].board_id, "b1");
        assert_eq!(index.files[0].board_title, "My Board");
        assert_eq!(index.files[0].size, 7);
        assert_eq!(index.files[0].sha256.len(), 64);
    }

    #[test]
    fn workspace_scan_files_sorted_by_relative_path() {
        let tmp = tempfile::tempdir().unwrap();

        // Board A has "zzz.png", Board B has "aaa.mp3"
        let board_a = tmp.path().join("A.md");
        std::fs::write(&board_a, "# A").unwrap();
        let media_a = tmp.path().join("A-Media");
        std::fs::create_dir_all(&media_a).unwrap();
        std::fs::write(media_a.join("zzz.png"), b"z").unwrap();

        let board_b = tmp.path().join("B.md");
        std::fs::write(&board_b, "# B").unwrap();
        let media_b = tmp.path().join("B-Media");
        std::fs::create_dir_all(&media_b).unwrap();
        std::fs::write(media_b.join("aaa.mp3"), b"a").unwrap();

        let boards = vec![
            ("a", "A", board_a.as_path()),
            ("b", "B", board_b.as_path()),
        ];
        let index = scan_workspace_media(&boards);

        assert_eq!(index.files.len(), 2);
        // "A-Media/zzz.png" < "B-Media/aaa.mp3" alphabetically
        assert_eq!(index.files[0].relative_path, "A-Media/zzz.png");
        assert_eq!(index.files[1].relative_path, "B-Media/aaa.mp3");
    }

    #[test]
    fn workspace_scan_zero_boards() {
        let index = scan_workspace_media(&[]);
        assert_eq!(index.total_files, 0);
        assert_eq!(index.board_count, 0);
    }
}
